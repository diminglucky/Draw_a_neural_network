using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class LongLivedWorkerRuntimeTests
{
    [Fact]
    public async Task Idle_checkpoint_at_exactly_fifteen_minutes_saves_closes_and_fresh_runtime_recovers_the_same_session()
    {
        var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z"));
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using var first = new LongLivedWorkerRuntime(backend, store, clock, TimeSpan.FromMinutes(15), 4);

        await first.ProcessAsync(Open("open-1", "session.vsdx"));
        await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
        clock.Advance(TimeSpan.FromMinutes(15));

        await first.CheckpointIdleSessionsAsync();

        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(1, backend.CloseCalls);
        Assert.NotNull(await store.LoadAsync(Key()));

        await using var second = new LongLivedWorkerRuntime(backend, store, clock, TimeSpan.FromMinutes(15), 4);
        var response = await second.ProcessAsync(Recover("recover-1"));

        Assert.Equal("succeeded", response.Status);
        Assert.Equal(1, backend.RecoverCalls);
        Assert.Equal("page-1", backend.RecoveredFromPageHandle);
    }

    [Fact]
    public async Task Idle_checkpoint_at_fourteen_minutes_and_fifty_nine_seconds_does_not_touch_the_session()
    {
        var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z"));
        var backend = new RecordingSessionBackend();
        await using var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), clock, TimeSpan.FromMinutes(15), 4);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
        clock.Advance(TimeSpan.FromMinutes(14) + TimeSpan.FromSeconds(59));

        await runtime.CheckpointIdleSessionsAsync();

        Assert.Equal(0, backend.SaveCalls);
        Assert.Equal(0, backend.CloseCalls);
    }

    [Fact]
    public async Task Repeated_open_and_replayed_request_id_do_not_create_or_apply_a_second_canvas()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        var open = Open("open-1", "session.vsdx");
        var apply = Apply("apply-1", "operation-1", 'a');

        await runtime.ProcessAsync(open);
        await runtime.ProcessAsync(open);
        await runtime.ProcessAsync(apply);
        var replay = await runtime.ProcessAsync(apply);

        Assert.Equal("succeeded", replay.Status);
        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_diff_uses_the_diff_backend_and_conflicting_request_id_fails_closed()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));

        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', WorkerV2Command.ApplyDiff));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Snapshot("apply-1")));
        Assert.Equal(0, backend.ApplyCalls);
        Assert.Equal(1, backend.ApplyDiffCalls);
    }

    [Fact]
    public async Task Close_save_persists_the_manifest_and_close_discard_keeps_the_last_manifest()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'));

        await runtime.ProcessAsync(Close("close-save", "save"));
        var saved = await store.LoadAsync(Key());
        await runtime.ProcessAsync(Recover("recover-1"));
        await runtime.ProcessAsync(Close("close-discard", "discard"));

        Assert.NotNull(saved);
        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(2, backend.CloseCalls);
        Assert.Equal(saved, await store.LoadAsync(Key()));
    }

    [Fact]
    public async Task Different_session_quartets_do_not_share_documents_or_request_replays()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);

        await runtime.ProcessAsync(Open("open-1", "one.vsdx", userId: "user-one"));
        await runtime.ProcessAsync(Open("open-1", "two.vsdx", userId: "user-two"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', userId: "user-one"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', userId: "user-two"));

        Assert.Equal(2, backend.OpenOrCreateCalls);
        Assert.Equal(2, backend.ApplyCalls);
        Assert.Equal(2, backend.CreatedDocuments.Distinct().Count());
    }

    [Fact]
    public async Task Capacity_checkpoints_the_least_recently_active_safe_session_before_opening_the_next()
    {
        var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z"));
        var backend = new RecordingSessionBackend();
        await using var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), clock, TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first"));
        clock.Advance(TimeSpan.FromSeconds(1));

        await runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second"));

        Assert.Equal(2, backend.OpenOrCreateCalls);
        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(1, backend.CloseCalls);
        Assert.Equal("document-1", backend.SavedDocuments.Single());
    }

    [Fact]
    public async Task Capacity_checkpoint_failure_rejects_the_new_open_without_creating_a_replacement_document()
    {
        var backend = new RecordingSessionBackend { FailSave = true };
        await using var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.UtcNow), TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first"));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second")));

        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(0, backend.CloseCalls);
    }

    [Fact]
    public async Task Recovery_failure_blocks_open_from_creating_a_substitute_document()
    {
        var backend = new RecordingSessionBackend { FailRecover = true };
        var store = new InMemoryManifestStore();
        await store.SaveAsync(new VisioSessionRecoveryManifest(Key(), "session.vsdx", new VisioSessionDocument("saved-document", "saved-page"), null, []), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        await using var runtime = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Recover("recover-1")));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-1", "session.vsdx")));

        Assert.Equal(1, backend.RecoverCalls);
        Assert.Equal(0, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Recovery_manifest_load_uncertainty_blocks_a_later_open_from_creating_a_substitute_document()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore { FailNextLoad = true };
        await using var runtime = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Recover("recover-1")));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-1", "session.vsdx")));

        Assert.Equal(0, backend.RecoverCalls);
        Assert.Equal(0, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Snapshot_is_read_only_and_returns_the_bound_path()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));

        var snapshot = await runtime.ProcessAsync(Snapshot("snapshot-1"));

        Assert.Equal("succeeded", snapshot.Status);
        Assert.Equal("session.vsdx", snapshot.OutputPath);
        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(0, backend.SaveCalls);
        Assert.Equal(0, backend.CloseCalls);
    }

    [Fact]
    public async Task Full_request_replay_ledger_rejects_close_before_mutating_the_session()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        for (var index = 0; index < VisioSessionOperationJournal.MaximumEntries - 1; index++)
        {
            await runtime.ProcessAsync(Snapshot($"snapshot-{index:D4}"));
        }

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Close("close-over-limit", "discard")));

        Assert.Equal(0, backend.CloseCalls);
    }

    private static LongLivedWorkerRuntime CreateRuntime(RecordingSessionBackend backend, InMemoryManifestStore? store = null) =>
        new(backend, store ?? new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z")), TimeSpan.FromMinutes(15), 4);

    private static WorkerV2Request Open(string requestId, string outputPath, string userId = "user", string workflowId = "workflow") =>
        new(requestId, WorkerV2Command.Open, Session(userId, workflowId), outputPath, null, null, null, null);

    private static WorkerV2Request Apply(string requestId, string operationId, char hashCharacter, WorkerV2Command command = WorkerV2Command.Apply, string userId = "user", string workflowId = "workflow") =>
        new(requestId, command, Session(userId, workflowId), null, operationId, new string(hashCharacter, 64), new DiagramEnvelope { Figure = new DiagramFigure { Title = "diagram" } }, null);

    private static WorkerV2Request Close(string requestId, string disposition) =>
        new(requestId, WorkerV2Command.Close, Session(), null, null, null, null, disposition);

    private static WorkerV2Request Recover(string requestId) =>
        new(requestId, WorkerV2Command.Recover, Session(), null, null, null, null, null);

    private static WorkerV2Request Snapshot(string requestId) =>
        new(requestId, WorkerV2Command.Snapshot, Session(), null, null, null, null, null);

    private static WorkerV2Session Session(string userId = "user", string workflowId = "workflow") => new("tenant", userId, "device", workflowId);
    private static VisioSessionKey Key() => Session().ToKey();

    private sealed class FakeWorkerClock(DateTimeOffset utcNow) : IWorkerClock
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan elapsed) => UtcNow = UtcNow.Add(elapsed);
    }

    private sealed class InMemoryManifestStore : ISessionRecoveryManifestStore
    {
        private readonly Dictionary<VisioSessionKey, StoredSessionRecoveryManifest> _stored = [];
        public bool FailNextLoad { get; set; }

        public Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default)
        {
            _stored[manifest.Key] = new StoredSessionRecoveryManifest(manifest, savedAt, lastActivity);
            return Task.CompletedTask;
        }

        public Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
        {
            if (FailNextLoad)
            {
                FailNextLoad = false;
                throw new InvalidOperationException("manifest store temporarily unavailable");
            }

            return Task.FromResult(_stored.TryGetValue(key, out var stored) ? stored : null);
        }
    }

    private sealed class RecordingSessionBackend : IVisioSessionBackend
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public int ApplyDiffCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int RecoverCalls { get; private set; }
        public bool FailSave { get; init; }
        public bool FailRecover { get; init; }
        public List<string> CreatedDocuments { get; } = [];
        public List<string> SavedDocuments { get; } = [];
        public string? RecoveredFromPageHandle { get; private set; }

        public string NormalizeOutputPath(string outputPath) => outputPath;

        public Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default)
        {
            OpenOrCreateCalls++;
            var document = new VisioSessionDocument($"document-{OpenOrCreateCalls}", $"page-{OpenOrCreateCalls}");
            CreatedDocuments.Add(document.DocumentHandle);
            return Task.FromResult(document);
        }

        public Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyCalls++;
            return Task.CompletedTask;
        }

        public Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyDiffCalls++;
            return Task.CompletedTask;
        }

        public Task SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            if (FailSave) throw new InvalidOperationException("save failed");
            SavedDocuments.Add(document.DocumentHandle);
            return Task.CompletedTask;
        }

        public Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default)
        {
            CloseCalls++;
            return Task.CompletedTask;
        }

        public Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, string outputPath, CancellationToken cancellationToken = default)
        {
            RecoverCalls++;
            if (FailRecover) throw new InvalidOperationException("recover failed");
            RecoveredFromPageHandle = "page-1";
            return Task.FromResult(new VisioSessionDocument("recovered-document", RecoveredFromPageHandle));
        }
    }
}
