using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

/// <summary>
/// Serializes trusted v2 requests for the lifetime of one worker process. The Core manager owns
/// native-document state; this layer owns the durable path/activity/request-replay boundary.
/// </summary>
public sealed class LongLivedWorkerRuntime : IAsyncDisposable
{
    private readonly IVisioSessionBackend _backend;
    private readonly ISessionRecoveryManifestStore _manifestStore;
    private readonly IWorkerClock _clock;
    private readonly TimeSpan _checkpointInterval;
    private readonly int _capacity;
    private readonly VisioSessionManager _sessions;
    private readonly Dictionary<VisioSessionKey, RuntimeSession> _runtimeSessions = [];
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    public LongLivedWorkerRuntime(
        IVisioSessionBackend backend,
        ISessionRecoveryManifestStore manifestStore,
        IWorkerClock clock,
        TimeSpan checkpointInterval,
        int capacity)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
        _manifestStore = manifestStore ?? throw new ArgumentNullException(nameof(manifestStore));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        if (checkpointInterval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(checkpointInterval));
        if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));

        _checkpointInterval = checkpointInterval;
        _capacity = capacity;
        _sessions = new VisioSessionManager(_backend);
    }

    public async Task<WorkerV2Response> ProcessAsync(WorkerV2Request request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var key = ValidateRequest(request);
            var fingerprint = RequestFingerprint.For(request);

            if (_runtimeSessions.TryGetValue(key, out var known)
                && known.Requests.TryGetValue(request.RequestId, out var replay))
            {
                if (!string.Equals(replay.Fingerprint, fingerprint, StringComparison.Ordinal))
                {
                    throw new WorkerProtocolException("requestId is already bound to a different command.");
                }

                return replay.Response;
            }

            if (_runtimeSessions.TryGetValue(key, out known)
                && known.Requests.Count >= VisioSessionOperationJournal.MaximumEntries)
            {
                throw new WorkerProtocolException("Visio session request replay ledger has reached its bounded limit.");
            }

            var response = request.Command switch
            {
                WorkerV2Command.Open => await OpenAsync(key, request, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Apply => await ApplyAsync(key, request, isDiff: false, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.ApplyDiff => await ApplyAsync(key, request, isDiff: true, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Save => await SaveAsync(key, request, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Snapshot => Snapshot(key, request),
                WorkerV2Command.Close => await CloseAsync(key, request, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Recover => await RecoverAsync(key, request, cancellationToken).ConfigureAwait(false),
                _ => throw new WorkerProtocolException("Unsupported worker command."),
            };

            var runtimeSession = RequireRuntimeSession(key);
            runtimeSession.LastActivity = _clock.UtcNow;
            RecordAcceptedRequest(runtimeSession, request.RequestId, fingerprint, response);
            return response;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task CheckpointIdleSessionsAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var now = _clock.UtcNow;
            foreach (var pair in _runtimeSessions
                .Where(pair => IsCheckpointSafe(pair.Key, pair.Value))
                .Where(pair => now - pair.Value.LastActivity >= _checkpointInterval)
                .OrderBy(pair => pair.Value.LastActivity)
                .ToArray())
            {
                await CheckpointAsync(pair.Key, pair.Value, cancellationToken).ConfigureAwait(false);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var pair in _runtimeSessions.Where(pair => IsCheckpointSafe(pair.Key, pair.Value)).ToArray())
            {
                try { await CheckpointAsync(pair.Key, pair.Value, CancellationToken.None).ConfigureAwait(false); }
                catch { pair.Value.Uncertain = true; }
            }
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    private async Task<WorkerV2Response> OpenAsync(VisioSessionKey key, WorkerV2Request request, CancellationToken cancellationToken)
    {
        var outputPath = NormalizePath(request.OutputPath!);
        if (_runtimeSessions.TryGetValue(key, out var existing))
        {
            EnsureCertain(existing);
            EnsureBoundPath(existing, outputPath);
            var snapshot = _sessions.GetSnapshot(key);
            if (snapshot?.State is VisioSessionState.Open or VisioSessionState.Dirty)
            {
                return Succeeded(request, existing.OutputPath);
            }

            await RecoverStoredAsync(key, existing, cancellationToken).ConfigureAwait(false);
            return Succeeded(request, existing.OutputPath);
        }

        await EnsureCapacityAsync(cancellationToken).ConfigureAwait(false);
        StoredSessionRecoveryManifest? stored;
        try
        {
            stored = await LoadManifestAsync(key, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            _runtimeSessions.TryAdd(key, RuntimeSession.CreateUncertain());
            throw;
        }
        if (stored is not null && !string.Equals(stored.Manifest.OutputPath, outputPath, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("The requested output path does not match the worker-owned recovery manifest.");
        }

        var runtimeSession = new RuntimeSession(outputPath, _clock.UtcNow);
        _runtimeSessions.Add(key, runtimeSession);
        try
        {
            if (stored is null)
            {
                await _sessions.OpenOrReuseAsync(key, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await _sessions.RecoverAsync(key, stored.Manifest, cancellationToken).ConfigureAwait(false);
            }

            return Succeeded(request, outputPath);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to open the durable Visio session.", error);
        }
    }

    private async Task<WorkerV2Response> ApplyAsync(VisioSessionKey key, WorkerV2Request request, bool isDiff, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        try
        {
            var document = DiagramMapper.Map(request.Diagram!);
            var operation = new VisioSessionOperation(request.OperationId!, request.PlanHash!);
            if (isDiff)
            {
                await _sessions.ApplyPlanDiffAsync(key, operation, document, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await _sessions.ApplyPlanAsync(key, operation, document, cancellationToken).ConfigureAwait(false);
            }

            return Succeeded(request, runtimeSession.OutputPath);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to apply the Visio plan.", error);
        }
    }

    private async Task<WorkerV2Response> SaveAsync(VisioSessionKey key, WorkerV2Request request, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        EnsureBoundPath(runtimeSession, NormalizePath(request.OutputPath!));
        await PersistSavedManifestAsync(key, runtimeSession, cancellationToken).ConfigureAwait(false);
        return Succeeded(request, runtimeSession.OutputPath);
    }

    private WorkerV2Response Snapshot(VisioSessionKey key, WorkerV2Request request)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        if (_sessions.GetSnapshot(key) is null) throw new WorkerProtocolException("Visio session snapshot is unavailable.");
        return Succeeded(request, runtimeSession.OutputPath);
    }

    private async Task<WorkerV2Response> CloseAsync(VisioSessionKey key, WorkerV2Request request, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        if (request.CloseDisposition == "save")
        {
            await PersistSavedManifestAsync(key, runtimeSession, cancellationToken).ConfigureAwait(false);
        }

        try
        {
            await _sessions.CloseAsync(key, cancellationToken).ConfigureAwait(false);
            return Succeeded(request, runtimeSession.OutputPath);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to close the Visio session.", error);
        }
    }

    private async Task<WorkerV2Response> RecoverAsync(VisioSessionKey key, WorkerV2Request request, CancellationToken cancellationToken)
    {
        RuntimeSession runtimeSession;
        if (_runtimeSessions.TryGetValue(key, out var existing))
        {
            runtimeSession = existing;
            EnsureCertain(runtimeSession);
        }
        else
        {
            StoredSessionRecoveryManifest? stored;
            try
            {
                stored = await LoadManifestAsync(key, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                _runtimeSessions.TryAdd(key, RuntimeSession.CreateUncertain());
                throw;
            }

            if (stored is null) throw new WorkerProtocolException("No worker-owned recovery manifest exists for this session.");
            runtimeSession = new RuntimeSession(stored.Manifest.OutputPath, stored.LastActivity);
            _runtimeSessions.Add(key, runtimeSession);
        }

        await RecoverStoredAsync(key, runtimeSession, cancellationToken).ConfigureAwait(false);
        return Succeeded(request, runtimeSession.OutputPath);
    }

    private async Task RecoverStoredAsync(VisioSessionKey key, RuntimeSession runtimeSession, CancellationToken cancellationToken)
    {
        try
        {
            var stored = await LoadManifestAsync(key, cancellationToken).ConfigureAwait(false)
                ?? throw new WorkerProtocolException("No worker-owned recovery manifest exists for this session.");
            EnsureBoundPath(runtimeSession, stored.Manifest.OutputPath);
            await _sessions.RecoverAsync(key, stored.Manifest, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to recover the durable Visio session.", error);
        }
    }

    private async Task EnsureCapacityAsync(CancellationToken cancellationToken)
    {
        var active = _runtimeSessions.Where(pair => IsActive(pair.Key, pair.Value)).ToArray();
        if (active.Length < _capacity) return;

        var candidate = active
            .Where(pair => IsCheckpointSafe(pair.Key, pair.Value))
            .OrderBy(pair => pair.Value.LastActivity)
            .FirstOrDefault();
        if (candidate.Key is null)
        {
            throw new WorkerProtocolException("Worker session capacity is full and no safe session can be checkpointed.");
        }

        await CheckpointAsync(candidate.Key, candidate.Value, cancellationToken).ConfigureAwait(false);
    }

    private async Task CheckpointAsync(VisioSessionKey key, RuntimeSession runtimeSession, CancellationToken cancellationToken)
    {
        try
        {
            await PersistSavedManifestAsync(key, runtimeSession, cancellationToken).ConfigureAwait(false);
            await _sessions.CloseAsync(key, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to checkpoint the Visio session.", error);
        }
    }

    private async Task PersistSavedManifestAsync(VisioSessionKey key, RuntimeSession runtimeSession, CancellationToken cancellationToken)
    {
        try
        {
            var saved = await _sessions.SaveAsAsync(key, runtimeSession.OutputPath, cancellationToken).ConfigureAwait(false);
            var manifest = saved.RecoveryManifest ?? throw new WorkerProtocolException("Visio save did not produce a recovery manifest.");
            await _manifestStore.SaveAsync(manifest, _clock.UtcNow, runtimeSession.LastActivity, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to durably save the Visio session.", error);
        }
    }

    private async Task<StoredSessionRecoveryManifest?> LoadManifestAsync(VisioSessionKey key, CancellationToken cancellationToken)
    {
        try
        {
            return await _manifestStore.LoadAsync(key, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Fail("Unable to load the worker-owned recovery manifest.", error);
        }
    }

    private bool IsCheckpointSafe(VisioSessionKey key, RuntimeSession runtimeSession) =>
        !runtimeSession.Uncertain && _sessions.GetSnapshot(key)?.State is VisioSessionState.Open or VisioSessionState.Dirty;

    private bool IsActive(VisioSessionKey key, RuntimeSession runtimeSession) =>
        !runtimeSession.Uncertain && _sessions.GetSnapshot(key)?.State is VisioSessionState.Open or VisioSessionState.Dirty;

    private static WorkerV2Response Succeeded(WorkerV2Request request, string outputPath) =>
        new(request.RequestId, "succeeded", outputPath);

    private string NormalizePath(string outputPath)
    {
        try { return _backend.NormalizeOutputPath(outputPath); }
        catch (Exception error) when (error is not OperationCanceledException) { throw Fail("Output path is invalid.", error); }
    }

    private static VisioSessionKey ValidateRequest(WorkerV2Request request)
    {
        try
        {
            if (!IsIdentifier(request.RequestId)) throw new WorkerProtocolException("requestId is invalid.");
            var key = request.Session?.ToKey() ?? throw new WorkerProtocolException("session is required.");
            switch (request.Command)
            {
                case WorkerV2Command.Open when string.IsNullOrWhiteSpace(request.OutputPath):
                case WorkerV2Command.Save when string.IsNullOrWhiteSpace(request.OutputPath):
                    throw new WorkerProtocolException("outputPath is required.");
                case WorkerV2Command.Apply or WorkerV2Command.ApplyDiff when request.Diagram is null || request.OperationId is null || request.PlanHash is null:
                    throw new WorkerProtocolException("operationId, planHash, and diagram are required.");
                case WorkerV2Command.Close when request.CloseDisposition is not ("save" or "discard"):
                    throw new WorkerProtocolException("closeDisposition must be 'save' or 'discard'.");
                case WorkerV2Command.Open or WorkerV2Command.Apply or WorkerV2Command.ApplyDiff or WorkerV2Command.Save or WorkerV2Command.Snapshot or WorkerV2Command.Close or WorkerV2Command.Recover:
                    break;
                default:
                    throw new WorkerProtocolException("Unsupported worker command.");
            }

            return key;
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Fail("Worker request is invalid.", error);
        }
    }

    private static bool IsIdentifier(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length <= 128
        && value.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-');

    private RuntimeSession RequireRuntimeSession(VisioSessionKey key) =>
        _runtimeSessions.TryGetValue(key, out var session)
            ? session
            : throw new WorkerProtocolException("Visio session has not been opened by this worker runtime.");

    private static void EnsureBoundPath(RuntimeSession session, string outputPath)
    {
        if (!string.Equals(session.OutputPath, outputPath, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Visio session output path is already bound to a different VSDX file.");
        }
    }

    private static void EnsureCertain(RuntimeSession session)
    {
        if (session.Uncertain) throw new WorkerProtocolException("Visio session is uncertain and cannot be reused without a fresh worker recovery.");
    }

    private static void RecordAcceptedRequest(RuntimeSession session, string requestId, string fingerprint, WorkerV2Response response)
    {
        if (session.Requests.Count >= VisioSessionOperationJournal.MaximumEntries)
        {
            throw new WorkerProtocolException("Visio session request replay ledger has reached its bounded limit.");
        }

        session.Requests.Add(requestId, new ReplayEntry(fingerprint, response));
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(LongLivedWorkerRuntime));
    }

    private static WorkerProtocolException Fail(string message, Exception error) => new(message, error);

    private sealed class RuntimeSession(string outputPath, DateTimeOffset lastActivity)
    {
        public static RuntimeSession CreateUncertain() => new("<unavailable>", DateTimeOffset.MinValue) { Uncertain = true };

        public string OutputPath { get; } = outputPath;
        public DateTimeOffset LastActivity { get; set; } = lastActivity;
        public bool Uncertain { get; set; }
        public Dictionary<string, ReplayEntry> Requests { get; } = new(StringComparer.Ordinal);
    }

    private sealed record ReplayEntry(string Fingerprint, WorkerV2Response Response);

    private static class RequestFingerprint
    {
        public static string For(WorkerV2Request request) => string.Join("|", [
            ((int)request.Command).ToString(System.Globalization.CultureInfo.InvariantCulture),
            request.OutputPath ?? string.Empty,
            request.OperationId ?? string.Empty,
            request.PlanHash ?? string.Empty,
            request.CloseDisposition ?? string.Empty]);
    }
}
