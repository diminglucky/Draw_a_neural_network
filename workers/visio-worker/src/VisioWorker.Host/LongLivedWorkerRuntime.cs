using VisioWorker.Core;
using VisioWorker.Live;
using System.Security.Cryptography;
using System.Text;

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
            var trusted = PrepareTrustedCommand(request, key);
            var fingerprint = trusted.Fingerprint;

            if (!_runtimeSessions.ContainsKey(key))
            {
                try
                {
                    var persistedReplay = await ReplayPersistedCommandAsync(key, request.RequestId, request.Command, fingerprint, cancellationToken).ConfigureAwait(false);
                    if (persistedReplay is not null) return persistedReplay;
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    _runtimeSessions.TryAdd(key, RuntimeSession.CreateUncertain());
                    throw Fail("Unable to load the worker-owned recovery manifest.", error);
                }
            }

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
                WorkerV2Command.Open => await OpenAsync(key, request, trusted, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Apply => await ApplyAsync(key, request, trusted, isDiff: false, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.ApplyDiff => await ApplyAsync(key, request, trusted, isDiff: true, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Save => await SaveAsync(key, request, trusted, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Snapshot => Snapshot(key, request),
                WorkerV2Command.Close => await CloseAsync(key, request, trusted, cancellationToken).ConfigureAwait(false),
                WorkerV2Command.Recover => await RecoverAsync(key, request, trusted, cancellationToken).ConfigureAwait(false),
                _ => throw new WorkerProtocolException("Unsupported worker command."),
            };

            var runtimeSession = RequireRuntimeSession(key);
            runtimeSession.LastActivity = _clock.UtcNow;
            RecordAcceptedRequest(runtimeSession, request.RequestId, request.Command, fingerprint, response);
            return response;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (request.Session is not null && _runtimeSessions.TryGetValue(request.Session.ToKey(), out var runtimeSession)) runtimeSession.Uncertain = true;
            throw;
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
            List<Exception>? failures = null;
            foreach (var pair in _runtimeSessions.Where(pair => IsActive(pair.Key, pair.Value)).ToArray())
            {
                try
                {
                    if (IsCheckpointSafe(pair.Key, pair.Value))
                    {
                        await CheckpointAsync(pair.Key, pair.Value, CancellationToken.None).ConfigureAwait(false);
                    }
                    else
                    {
                        await ReleaseAsync(pair.Key, CancellationToken.None).ConfigureAwait(false);
                    }
                }
                catch (Exception error)
                {
                    pair.Value.Uncertain = true;
                    (failures ??= []).Add(error);
                    try { await ReleaseAsync(pair.Key, CancellationToken.None).ConfigureAwait(false); }
                    catch (Exception releaseError) { failures.Add(releaseError); }
                }
            }

            if (failures is not null) throw Fail("Visio worker disposal left one or more native sessions unreleased.", new AggregateException(failures));
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    private async Task ReleaseAsync(VisioSessionKey key, CancellationToken cancellationToken)
    {
        var snapshot = _sessions.GetSnapshot(key);
        if (snapshot is null || snapshot.State == VisioSessionState.Closed) return;
        if (snapshot.State is VisioSessionState.Open or VisioSessionState.Dirty or VisioSessionState.Saving)
        {
            await _sessions.CloseAsync(key, cancellationToken).ConfigureAwait(false);
            return;
        }

        await _sessions.ReleaseUncertainAsync(key, cancellationToken).ConfigureAwait(false);
    }

    private async Task<WorkerV2Response> OpenAsync(VisioSessionKey key, WorkerV2Request request, TrustedCommand trusted, CancellationToken cancellationToken)
    {
        var outputPath = trusted.OutputPath!;
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
        if (stored is not null)
        {
            RequireCurrentRuntimeManifest(stored);
        }
        if (stored is not null && !string.Equals(stored.Manifest.OutputPath, outputPath, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("The requested output path does not match the worker-owned recovery manifest.");
        }

        var runtimeSession = new RuntimeSession(outputPath, _clock.UtcNow, stored?.Manifest);
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

    private async Task<WorkerV2Response> ApplyAsync(VisioSessionKey key, WorkerV2Request request, TrustedCommand trusted, bool isDiff, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        try
        {
            var document = trusted.Plan!;
            var operation = new VisioSessionOperation(request.OperationId!, request.PlanHash!);
            if (isDiff)
            {
                await _sessions.ApplyPlanDiffAsync(key, operation, document, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await _sessions.ApplyPlanAsync(key, operation, document, cancellationToken).ConfigureAwait(false);
            }

            var response = Succeeded(request, runtimeSession.OutputPath);
            await PersistSavedManifestAsync(key, runtimeSession, new ReplayEntry(request.RequestId, request.Command, trusted.Fingerprint, response), cancellationToken).ConfigureAwait(false);
            return response;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to apply the Visio plan.", error);
        }
    }

    private async Task<WorkerV2Response> SaveAsync(VisioSessionKey key, WorkerV2Request request, TrustedCommand trusted, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        EnsureBoundPath(runtimeSession, trusted.OutputPath!);
        var response = Succeeded(request, runtimeSession.OutputPath);
        await PersistSavedManifestAsync(key, runtimeSession, new ReplayEntry(request.RequestId, request.Command, trusted.Fingerprint, response), cancellationToken).ConfigureAwait(false);
        return response;
    }

    private WorkerV2Response Snapshot(VisioSessionKey key, WorkerV2Request request)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        if (_sessions.GetSnapshot(key)?.State is not (VisioSessionState.Open or VisioSessionState.Dirty)) throw new WorkerProtocolException("Visio session snapshot is unavailable.");
        return Succeeded(request, runtimeSession.OutputPath);
    }

    private async Task<WorkerV2Response> CloseAsync(VisioSessionKey key, WorkerV2Request request, TrustedCommand trusted, CancellationToken cancellationToken)
    {
        var runtimeSession = RequireRuntimeSession(key);
        EnsureCertain(runtimeSession);
        if (request.CloseDisposition == "save")
        {
            await PersistSavedManifestAsync(key, runtimeSession, replay: null, cancellationToken).ConfigureAwait(false);
        }

        try
        {
            await _sessions.CloseAsync(key, cancellationToken).ConfigureAwait(false);
            var response = Succeeded(request, runtimeSession.OutputPath);
            await PersistTerminalReplayAsync(key, runtimeSession, new ReplayEntry(request.RequestId, request.Command, trusted.Fingerprint, response), cancellationToken).ConfigureAwait(false);
            return response;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to close the Visio session.", error);
        }
    }

    private async Task<WorkerV2Response> RecoverAsync(VisioSessionKey key, WorkerV2Request request, TrustedCommand trusted, CancellationToken cancellationToken)
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
            RequireCurrentRuntimeManifest(stored);
            runtimeSession = new RuntimeSession(stored.Manifest.OutputPath, stored.LastActivity, stored.Manifest);
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
            RequireCurrentRuntimeManifest(stored);
            EnsureBoundPath(runtimeSession, stored.Manifest.OutputPath);
            await _sessions.RecoverAsync(key, stored.Manifest, cancellationToken).ConfigureAwait(false);
            runtimeSession.RestoreManifest(stored.Manifest);
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
            await PersistSavedManifestAsync(key, runtimeSession, replay: null, cancellationToken).ConfigureAwait(false);
            await _sessions.CloseAsync(key, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to checkpoint the Visio session.", error);
        }
    }

    private async Task PersistSavedManifestAsync(VisioSessionKey key, RuntimeSession runtimeSession, ReplayEntry? replay, CancellationToken cancellationToken)
    {
        try
        {
            var saved = await _sessions.SaveAsAsync(key, runtimeSession.OutputPath, cancellationToken).ConfigureAwait(false);
            var manifest = saved.RecoveryManifest ?? throw new WorkerProtocolException("Visio save did not produce a recovery manifest.");
            manifest = WithCommandReplays(manifest, runtimeSession, replay);
            await _manifestStore.SaveAsync(manifest, _clock.UtcNow, runtimeSession.LastActivity, cancellationToken).ConfigureAwait(false);
            runtimeSession.RestoreManifest(manifest);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to durably save the Visio session.", error);
        }
    }

    private async Task PersistTerminalReplayAsync(VisioSessionKey key, RuntimeSession runtimeSession, ReplayEntry replay, CancellationToken cancellationToken)
    {
        if (runtimeSession.Manifest is null) return;
        try
        {
            var manifest = WithCommandReplays(runtimeSession.Manifest, runtimeSession, replay);
            await _manifestStore.SaveAsync(manifest, _clock.UtcNow, runtimeSession.LastActivity, cancellationToken).ConfigureAwait(false);
            runtimeSession.RestoreManifest(manifest);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            runtimeSession.Uncertain = true;
            throw Fail("Unable to persist the terminal Visio command replay.", error);
        }
    }

    private static VisioSessionRecoveryManifest WithCommandReplays(VisioSessionRecoveryManifest manifest, RuntimeSession runtimeSession, ReplayEntry? additional)
    {
        var entries = runtimeSession.Requests.Values
            .Select(ToPersistedReplay)
            .ToDictionary(entry => entry.RequestId, StringComparer.Ordinal);
        if (additional is not null)
        {
            entries[additional.RequestId] = ToPersistedReplay(additional);
        }

        return new VisioSessionRecoveryManifest(manifest.Key, manifest.OutputPath, manifest.Document, manifest.LastPlanHash, manifest.OperationJournal, entries.Values);
    }

    private static VisioSessionCommandReplayEntry ToPersistedReplay(ReplayEntry entry) => new(
        entry.RequestId,
        ToReplayCommand(entry.Command),
        entry.Fingerprint,
        entry.Response.Status,
        entry.Response.OutputPath!);

    private static VisioSessionReplayCommand ToReplayCommand(WorkerV2Command command) => command switch
    {
        WorkerV2Command.Open => VisioSessionReplayCommand.Open,
        WorkerV2Command.Apply => VisioSessionReplayCommand.Apply,
        WorkerV2Command.ApplyDiff => VisioSessionReplayCommand.ApplyDiff,
        WorkerV2Command.Save => VisioSessionReplayCommand.Save,
        WorkerV2Command.Snapshot => VisioSessionReplayCommand.Snapshot,
        WorkerV2Command.Close => VisioSessionReplayCommand.Close,
        WorkerV2Command.Recover => VisioSessionReplayCommand.Recover,
        _ => throw new WorkerProtocolException("Unsupported worker command."),
    };

    private static WorkerV2Command ToWorkerCommand(VisioSessionReplayCommand command) => command switch
    {
        VisioSessionReplayCommand.Open => WorkerV2Command.Open,
        VisioSessionReplayCommand.Apply => WorkerV2Command.Apply,
        VisioSessionReplayCommand.ApplyDiff => WorkerV2Command.ApplyDiff,
        VisioSessionReplayCommand.Save => WorkerV2Command.Save,
        VisioSessionReplayCommand.Snapshot => WorkerV2Command.Snapshot,
        VisioSessionReplayCommand.Close => WorkerV2Command.Close,
        VisioSessionReplayCommand.Recover => WorkerV2Command.Recover,
        _ => throw new WorkerProtocolException("Recovery manifest contains an unsupported command replay."),
    };

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

    private bool IsActive(VisioSessionKey key, RuntimeSession runtimeSession)
    {
        var state = _sessions.GetSnapshot(key)?.State;
        return state != VisioSessionState.Closed
            && (runtimeSession.Uncertain || state is VisioSessionState.Open or VisioSessionState.Dirty or VisioSessionState.Saving or VisioSessionState.Recovering);
    }

    private static WorkerV2Response Succeeded(WorkerV2Request request, string outputPath) =>
        new(request.RequestId, "succeeded", outputPath);

    private string NormalizePath(string outputPath)
    {
        try { return _backend.NormalizeOutputPath(outputPath); }
        catch (Exception error) when (error is not OperationCanceledException) { throw Fail("Output path is invalid.", error); }
    }

    private TrustedCommand PrepareTrustedCommand(WorkerV2Request request, VisioSessionKey key)
    {
        try
        {
            var outputPath = request.OutputPath is null ? null : NormalizePath(request.OutputPath);
            DiagramDocument? plan = null;
            string? digest = null;
            if (request.Command is WorkerV2Command.Apply or WorkerV2Command.ApplyDiff)
            {
                plan = DiagramMapper.Map(request.Diagram!);
                digest = DiagramPlanDigest.Compute(plan);
                if (!string.Equals(request.PlanHash, digest, StringComparison.OrdinalIgnoreCase))
                {
                    throw new WorkerProtocolException("planHash does not match the trusted canonical diagram plan.");
                }
            }

            return new TrustedCommand(plan, outputPath, RequestFingerprint.For(request, key, outputPath, digest));
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Fail("Worker diagram request is invalid.", error);
        }
    }

    private async Task<WorkerV2Response?> ReplayPersistedCommandAsync(VisioSessionKey key, string requestId, WorkerV2Command command, string fingerprint, CancellationToken cancellationToken)
    {
        var stored = await _manifestStore.LoadAsync(key, cancellationToken).ConfigureAwait(false);
        if (stored is null) return null;
        RequireCurrentRuntimeManifest(stored);
        var replay = stored.Manifest.CommandReplayJournal.SingleOrDefault(entry => string.Equals(entry.RequestId, requestId, StringComparison.Ordinal));
        if (replay is null) return null;
        if (!string.Equals(replay.Fingerprint, fingerprint, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("requestId is already bound to a different durable command.");
        }
        if (replay.Command != ToReplayCommand(command))
        {
            throw new WorkerProtocolException("requestId is already bound to a different durable command.");
        }

        var response = new WorkerV2Response(replay.RequestId, replay.Status, replay.OutputPath);
        if (replay.Command == VisioSessionReplayCommand.Close) return response;

        await EnsureCapacityAsync(cancellationToken).ConfigureAwait(false);
        var runtimeSession = new RuntimeSession(stored.Manifest.OutputPath, stored.LastActivity, stored.Manifest);
        _runtimeSessions.Add(key, runtimeSession);
        await RecoverStoredAsync(key, runtimeSession, cancellationToken).ConfigureAwait(false);
        return response;
    }

    private static void RequireCurrentRuntimeManifest(StoredSessionRecoveryManifest stored)
    {
        if (stored.FormatVersion != SessionRecoveryManifestStore.CurrentFormatVersion
            || stored.Manifest.CommandReplayJournal.Any(entry => entry.Command == VisioSessionReplayCommand.Unknown))
        {
            throw new WorkerProtocolException("Recovery manifest lacks the current durable replay identity guarantees.");
        }
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

    private static void RecordAcceptedRequest(RuntimeSession session, string requestId, WorkerV2Command command, string fingerprint, WorkerV2Response response)
    {
        if (session.Requests.TryGetValue(requestId, out var existing))
        {
            if (existing.Command == command && string.Equals(existing.Fingerprint, fingerprint, StringComparison.Ordinal) && existing.Response == response) return;
            throw new WorkerProtocolException("requestId is already bound to a different command.");
        }

        if (session.Requests.Count >= VisioSessionOperationJournal.MaximumEntries)
        {
            throw new WorkerProtocolException("Visio session request replay ledger has reached its bounded limit.");
        }

        session.Requests.Add(requestId, new ReplayEntry(requestId, command, fingerprint, response));
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(LongLivedWorkerRuntime));
    }

    private static WorkerProtocolException Fail(string message, Exception error) => new(message, error);

    private sealed class RuntimeSession
    {
        public RuntimeSession(string outputPath, DateTimeOffset lastActivity, VisioSessionRecoveryManifest? manifest = null)
        {
            OutputPath = outputPath;
            LastActivity = lastActivity;
            RestoreManifest(manifest);
        }

        public static RuntimeSession CreateUncertain() => new("<unavailable>", DateTimeOffset.MinValue) { Uncertain = true };

        public string OutputPath { get; }
        public DateTimeOffset LastActivity { get; set; }
        public bool Uncertain { get; set; }
        public Dictionary<string, ReplayEntry> Requests { get; } = new(StringComparer.Ordinal);
        public VisioSessionRecoveryManifest? Manifest { get; private set; }

        public void RestoreManifest(VisioSessionRecoveryManifest? manifest)
        {
            Manifest = manifest;
            if (manifest is null) return;
            foreach (var replay in manifest.CommandReplayJournal)
            {
                Requests[replay.RequestId] = new ReplayEntry(replay.RequestId, ToWorkerCommand(replay.Command), replay.Fingerprint, new WorkerV2Response(replay.RequestId, replay.Status, replay.OutputPath));
            }
        }
    }

    private sealed record ReplayEntry(string RequestId, WorkerV2Command Command, string Fingerprint, WorkerV2Response Response);

    private sealed record TrustedCommand(DiagramDocument? Plan, string? OutputPath, string Fingerprint);

    private static class RequestFingerprint
    {
        public static string For(WorkerV2Request request, VisioSessionKey key, string? outputPath, string? planDigest)
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            foreach (var field in new[]
            {
                ((int)request.Command).ToString(System.Globalization.CultureInfo.InvariantCulture),
                key.TenantId, key.UserId, key.DeviceId, key.WorkflowId,
                outputPath ?? string.Empty,
                request.OperationId ?? string.Empty,
                request.PlanHash ?? string.Empty,
                planDigest ?? string.Empty,
                request.CloseDisposition ?? string.Empty,
            })
            {
                var bytes = Encoding.UTF8.GetBytes(field);
                hash.AppendData(BitConverter.GetBytes(bytes.Length));
                hash.AppendData(bytes);
            }

            return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        }
    }
}
