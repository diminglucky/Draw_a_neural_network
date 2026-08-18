using System.Collections.Concurrent;
using System.Threading;

namespace VisioWorker.Core;

public sealed class VisioSessionManager
{
    private readonly IVisioSessionBackend _backend;
    private readonly ConcurrentDictionary<VisioSessionKey, SessionEntry> _sessions = new();

    public VisioSessionManager(IVisioSessionBackend backend)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    /// <summary>
    /// Returns one atomically published immutable state. This intentionally does not wait for the
    /// session gate: callers can observe Saving while the native save is still serialized by that gate.
    /// </summary>
    public VisioSessionSnapshot? GetSnapshot(VisioSessionKey key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return _sessions.TryGetValue(key, out var entry) ? entry.Snapshot(key) : null;
    }

    public async Task<VisioSessionSnapshot> OpenOrReuseAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
    {
        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            if (current.State is VisioSessionState.Closed or VisioSessionState.Recovering)
            {
                throw new InvalidOperationException("A closed or recovering Visio session can only be reopened through explicit recovery.");
            }

            if (current.State is VisioSessionState.Open or VisioSessionState.Dirty or VisioSessionState.Saving)
            {
                return entry.Snapshot(key);
            }

            try
            {
                var document = await _backend.OpenOrCreateAsync(key, cancellationToken).ConfigureAwait(false);
                entry.Publish(current with { State = VisioSessionState.Open, Document = document });
                return entry.Snapshot(key);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                entry.Publish(current with { State = VisioSessionState.Recovering, NativeHandleUncertain = true });
                throw;
            }
            catch
            {
                entry.Publish(current with { State = VisioSessionState.Recovering });
                throw;
            }
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    public Task<VisioSessionApplyResult> ApplyPlanAsync(
        VisioSessionKey key,
        VisioSessionOperation operation,
        DiagramDocument plan,
        CancellationToken cancellationToken = default) =>
        ApplyAsync(key, operation, plan, isDiff: false, cancellationToken);

    public Task<VisioSessionApplyResult> ApplyPlanDiffAsync(
        VisioSessionKey key,
        VisioSessionOperation operation,
        DiagramDocument plan,
        CancellationToken cancellationToken = default) =>
        ApplyAsync(key, operation, plan, isDiff: true, cancellationToken);

    public async Task<VisioSessionSnapshot> SaveAsAsync(VisioSessionKey key, string outputPath, CancellationToken cancellationToken = default)
    {
        var normalizedOutputPath = _backend.NormalizeOutputPath(outputPath);
        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            EnsureOpen(current, key);
            var saving = current with { State = VisioSessionState.Saving };
            entry.Publish(saving);
            try
            {
                var persistedDocument = await _backend.SaveAsAsync(saving.Document!, normalizedOutputPath, cancellationToken).ConfigureAwait(false);
                var persisted = saving with { Document = persistedDocument };
                var manifest = CreateRecoveryManifest(key, normalizedOutputPath, persisted);
                entry.Publish(saving with
                {
                    State = VisioSessionState.Open,
                    Document = persistedDocument,
                    LastSavedPath = normalizedOutputPath,
                    RecoveryManifest = manifest,
                });
                return entry.Snapshot(key);
            }
            catch
            {
                entry.Publish(saving with { State = VisioSessionState.Recovering });
                throw;
            }
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    public async Task<VisioSessionSnapshot> CloseAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
    {
        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            if (current.State == VisioSessionState.Closed) return entry.Snapshot(key);
            if (current.State == VisioSessionState.Recovering)
            {
                throw new InvalidOperationException("A recovering Visio session cannot be closed before explicit recovery.");
            }

            if (current.Document is not null)
            {
                try
                {
                    await _backend.CloseAsync(current.Document, cancellationToken).ConfigureAwait(false);
                }
                catch
                {
                    entry.Publish(current with { State = VisioSessionState.Recovering, NativeHandleUncertain = true });
                    throw;
                }
            }

            entry.Publish(current with { State = VisioSessionState.Closed, Document = null });
            return entry.Snapshot(key);
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    /// <summary>Attempts to release a known native handle after a fail-closed transition.</summary>
    public async Task<VisioSessionSnapshot> ReleaseUncertainAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
    {
        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            if (current.State != VisioSessionState.Recovering || current.Document is null)
            {
                throw new InvalidOperationException("The uncertain Visio session has no provable native handle to release.");
            }

            try
            {
                await _backend.CloseAsync(current.Document, cancellationToken).ConfigureAwait(false);
                entry.Publish(current with { State = VisioSessionState.Closed, Document = null, NativeHandleUncertain = false });
                return entry.Snapshot(key);
            }
            catch
            {
                entry.Publish(current with { NativeHandleUncertain = true });
                throw;
            }
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    public async Task<VisioSessionSnapshot> RecoverAsync(
        VisioSessionKey key,
        VisioSessionRecoveryManifest manifest,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        var normalizedOutputPath = _backend.NormalizeOutputPath(manifest.OutputPath);
        if (!string.Equals(normalizedOutputPath, manifest.OutputPath, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Recovery manifest output path must already be normalized by the session backend.");
        }

        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            if (current.State is VisioSessionState.Open or VisioSessionState.Dirty or VisioSessionState.Saving)
            {
                throw new InvalidOperationException("A healthy live Visio session cannot be replaced through recovery.");
            }

            ValidateRecoveryManifest(key, current, manifest);
            var recovering = current with { State = VisioSessionState.Recovering, Document = null };
            entry.Publish(recovering);
            try
            {
                var document = await _backend.RecoverAsync(key, manifest, cancellationToken).ConfigureAwait(false);
                if (document != manifest.Document)
                {
                    try
                    {
                        await _backend.CloseAsync(document, cancellationToken).ConfigureAwait(false);
                    }
                    catch
                    {
                        entry.Publish(recovering with { NativeHandleUncertain = true });
                        throw new InvalidOperationException("Recovery returned a different Visio document or page and the accidental native open could not be released.");
                    }

                    entry.Publish(recovering with { State = VisioSessionState.Closed, RecoveryManifest = manifest });
                    throw new InvalidOperationException("Recovery returned a different Visio document or page.");
                }
                var restoredJournal = ToJournal(manifest.OperationJournal);
                var recovered = recovering with
                {
                    State = VisioSessionState.Open,
                    Document = document,
                    LastPlanHash = manifest.LastPlanHash,
                    LastSavedPath = normalizedOutputPath,
                    OperationJournal = restoredJournal,
                };
                entry.Publish(recovered with
                {
                    RecoveryManifest = CreateRecoveryManifest(key, normalizedOutputPath, recovered),
                });
                return entry.Snapshot(key);
            }
            catch
            {
                // Do not silently close after recovery fails: callers must resolve this state rather
                // than retrying into a second document/page for the same workflow.
                if (entry.Current.State != VisioSessionState.Closed)
                {
                    entry.Publish(recovering with { NativeHandleUncertain = true });
                }
                throw;
            }
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    private async Task<VisioSessionApplyResult> ApplyAsync(
        VisioSessionKey key,
        VisioSessionOperation operation,
        DiagramDocument plan,
        bool isDiff,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentNullException.ThrowIfNull(plan);

        var entry = GetOrCreate(key);
        await entry.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = entry.Current;
            if (current.State is VisioSessionState.Closed or VisioSessionState.Recovering)
            {
                throw new InvalidOperationException("A closed or recovering Visio session cannot apply a plan before explicit recovery.");
            }

            if (current.OperationJournal.TryGetValue(operation.OperationId, out var recordedPlanHash))
            {
                if (!string.Equals(recordedPlanHash, operation.PlanHash, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException($"Operation {operation.OperationId} is already bound to a different plan hash.");
                }

                return new VisioSessionApplyResult(entry.Snapshot(key), Replayed: true);
            }

            if (current.OperationJournal.Values.Any(planHash => string.Equals(planHash, operation.PlanHash, StringComparison.Ordinal)))
            {
                entry.Publish(current with { OperationJournal = AddJournalEntry(current.OperationJournal, operation) });
                return new VisioSessionApplyResult(entry.Snapshot(key), Replayed: true);
            }

            if (current.OperationJournal.Count >= VisioSessionOperationJournal.MaximumEntries)
            {
                throw new InvalidOperationException("Visio session operation journal has reached its bounded replay limit.");
            }

            if (current.State == VisioSessionState.Created)
            {
                try
                {
                    var document = await _backend.OpenOrCreateAsync(key, cancellationToken).ConfigureAwait(false);
                    entry.Publish(current with { State = VisioSessionState.Open, Document = document });
                    current = entry.Current;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    entry.Publish(current with { State = VisioSessionState.Recovering, NativeHandleUncertain = true });
                    throw;
                }
                catch
                {
                    entry.Publish(current with { State = VisioSessionState.Recovering });
                    throw;
                }
            }

            EnsureOpen(current, key);
            try
            {
                if (isDiff)
                {
                    await _backend.ApplyPlanDiffAsync(current.Document!, plan, cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    await _backend.ApplyPlanAsync(current.Document!, plan, cancellationToken).ConfigureAwait(false);
                }
            }
            catch
            {
                entry.Publish(current with { State = VisioSessionState.Recovering, NativeHandleUncertain = true });
                throw;
            }

            entry.Publish(current with
            {
                State = VisioSessionState.Dirty,
                LastPlanHash = operation.PlanHash,
                OperationJournal = AddJournalEntry(current.OperationJournal, operation),
            });
            return new VisioSessionApplyResult(entry.Snapshot(key), Replayed: false);
        }
        finally
        {
            entry.Gate.Release();
        }
    }

    private SessionEntry GetOrCreate(VisioSessionKey key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return _sessions.GetOrAdd(key, static _ => new SessionEntry());
    }

    private static void EnsureOpen(SessionState state, VisioSessionKey key)
    {
        if (state.Document is null || state.State is not (VisioSessionState.Open or VisioSessionState.Dirty))
        {
            throw new InvalidOperationException($"Visio session {key.TenantId}/{key.UserId}/{key.DeviceId}/{key.WorkflowId} is not open.");
        }
    }

    private static void ValidateRecoveryManifest(VisioSessionKey key, SessionState current, VisioSessionRecoveryManifest manifest)
    {
        if (manifest.Key != key)
        {
            throw new InvalidOperationException("Recovery manifest session key does not match the requested session.");
        }

        if (current.State == VisioSessionState.Created)
        {
            return;
        }

        if (current.NativeHandleUncertain || current.Document is not null)
        {
            throw new InvalidOperationException("Recovery is blocked until the uncertain native Visio handle has been reconciled.");
        }

        if (current.RecoveryManifest is null || !RecoveryManifestEquals(current.RecoveryManifest, manifest))
        {
            throw new InvalidOperationException("Recovery manifest does not match the last saved state for this Visio session.");
        }
    }

    private static VisioSessionRecoveryManifest CreateRecoveryManifest(VisioSessionKey key, string outputPath, SessionState state) =>
        new(key, outputPath, state.Document!, state.LastPlanHash, ToSnapshotJournal(state.OperationJournal));

    private static bool RecoveryManifestEquals(VisioSessionRecoveryManifest left, VisioSessionRecoveryManifest right) =>
        left.Key == right.Key &&
        string.Equals(left.OutputPath, right.OutputPath, StringComparison.Ordinal) &&
        left.Document == right.Document &&
        string.Equals(left.LastPlanHash, right.LastPlanHash, StringComparison.Ordinal) &&
        left.OperationJournal.SequenceEqual(right.OperationJournal);

    private static IReadOnlyDictionary<string, string> AddJournalEntry(
        IReadOnlyDictionary<string, string> current,
        VisioSessionOperation operation)
    {
        var updated = new Dictionary<string, string>(current, StringComparer.Ordinal)
        {
            [operation.OperationId] = operation.PlanHash,
        };
        return updated;
    }

    private static IReadOnlyDictionary<string, string> ToJournal(IEnumerable<VisioSessionOperationJournalEntry> journal) =>
        journal.ToDictionary(entry => entry.OperationId, entry => entry.PlanHash, StringComparer.Ordinal);

    private static IReadOnlyList<VisioSessionOperationJournalEntry> ToSnapshotJournal(IReadOnlyDictionary<string, string> journal) =>
        Array.AsReadOnly(journal
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => new VisioSessionOperationJournalEntry(entry.Key, entry.Value))
            .ToArray());

    private sealed class SessionEntry
    {
        private SessionState _current = SessionState.Created;

        public SemaphoreSlim Gate { get; } = new(1, 1);
        public SessionState Current => Volatile.Read(ref _current);

        public void Publish(SessionState next) => Volatile.Write(ref _current, next);

        public VisioSessionSnapshot Snapshot(VisioSessionKey key)
        {
            var current = Current;
            return new VisioSessionSnapshot(
                key,
                current.State,
                current.Document,
                current.LastPlanHash,
                current.LastSavedPath,
                ToSnapshotJournal(current.OperationJournal),
                current.RecoveryManifest);
        }
    }

    private sealed record SessionState(
        VisioSessionState State,
        VisioSessionDocument? Document,
        string? LastPlanHash,
        string? LastSavedPath,
        IReadOnlyDictionary<string, string> OperationJournal,
        VisioSessionRecoveryManifest? RecoveryManifest,
        bool NativeHandleUncertain)
    {
        public static readonly SessionState Created = new(
            VisioSessionState.Created,
            null,
            null,
            null,
            new Dictionary<string, string>(StringComparer.Ordinal),
            null,
            false);
    }
}
