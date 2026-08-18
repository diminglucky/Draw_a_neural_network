using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class VisioSessionManagerTests
{
    private static readonly DiagramDocument Diagram = new("Session diagram", [], [], []);

    [Fact]
    public void Session_key_rejects_missing_or_unsafe_identifier_segments()
    {
        Assert.Throws<ArgumentException>(() => new VisioSessionKey("tenant", "user", "device", ""));
        Assert.Throws<ArgumentException>(() => new VisioSessionKey("tenant", "user/other", "device", "workflow"));
    }

    [Fact]
    public async Task Open_or_reuse_returns_the_single_document_and_page_for_an_exact_key()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        var first = await manager.OpenOrReuseAsync(key);
        var second = await manager.OpenOrReuseAsync(key);

        Assert.Equal(VisioSessionState.Open, first.State);
        Assert.Equal(first.Document, second.Document);
        Assert.Equal("document-1", first.Document!.DocumentHandle);
        Assert.Equal("page-1", first.Document.PageHandle);
        Assert.Equal(1, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Open_or_reuse_rejects_a_closed_session_instead_of_creating_a_second_canvas()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.OpenOrReuseAsync(key);
        await manager.CloseAsync(key);

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.OpenOrReuseAsync(key));
        Assert.Equal(1, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Open_backend_failure_moves_the_session_to_recovering_and_blocks_retry()
    {
        var backend = new RecordingBackend
        {
            FailOpen = true,
        };
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.OpenOrReuseAsync(key));
        Assert.Equal(VisioSessionState.Recovering, manager.GetSnapshot(key)!.State);

        backend.FailOpen = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.OpenOrReuseAsync(key));
        Assert.Equal(1, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Apply_plan_marks_the_session_dirty_and_replays_plan_or_operation_without_a_backend_mutation()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        var firstOperation = Operation("operation-1", 'a');

        var first = await manager.ApplyPlanAsync(key, firstOperation, Diagram);
        var samePlanDifferentOperation = await manager.ApplyPlanAsync(key, Operation("operation-2", 'a'), Diagram);
        var sameOperationDifferentPlan = await manager.ApplyPlanAsync(key, firstOperation, Diagram);

        Assert.Equal(VisioSessionState.Dirty, first.Snapshot.State);
        Assert.False(first.Replayed);
        Assert.True(samePlanDifferentOperation.Replayed);
        Assert.True(sameOperationDifferentPlan.Replayed);
        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_rejects_an_operation_id_reused_with_a_different_plan_hash()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, Operation("operation-1", 'b'), Diagram));
        Assert.Equal(new string('a', 64), manager.GetSnapshot(key)!.LastPlanHash);
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Same_plan_replay_records_the_new_operation_id_for_future_conflict_detection()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var replay = await manager.ApplyPlanAsync(key, Operation("operation-2", 'a'), Diagram);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, Operation("operation-2", 'b'), Diagram));
        Assert.True(replay.Replayed);
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Snapshots_publish_a_coherent_immutable_operation_journal()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        var planHash = new string('a', 64);

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var beforeReplay = manager.GetSnapshot(key)!;
        await manager.ApplyPlanAsync(key, Operation("operation-2", 'a'), Diagram);
        var afterReplay = manager.GetSnapshot(key)!;

        Assert.Equal(VisioSessionState.Dirty, beforeReplay.State);
        Assert.Equal(planHash, beforeReplay.LastPlanHash);
        Assert.Collection(
            beforeReplay.OperationJournal,
            entry => Assert.Equal(new VisioSessionOperationJournalEntry("operation-1", planHash), entry));
        Assert.Collection(
            afterReplay.OperationJournal,
            first => Assert.Equal(new VisioSessionOperationJournalEntry("operation-1", planHash), first),
            second => Assert.Equal(new VisioSessionOperationJournalEntry("operation-2", planHash), second));
    }

    [Fact]
    public async Task Apply_rejects_a_closed_session_instead_of_reopening_and_mutating_a_second_canvas()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.OpenOrReuseAsync(key);
        await manager.CloseAsync(key);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram));
        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(0, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_backend_failure_moves_the_session_to_recovering_and_blocks_retry()
    {
        var backend = new RecordingBackend
        {
            FailApply = true,
        };
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        var operation = Operation("operation-1", 'a');

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, operation, Diagram));
        Assert.Equal(VisioSessionState.Recovering, manager.GetSnapshot(key)!.State);

        backend.FailApply = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, operation, Diagram));
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_plan_diff_reuses_the_open_document_and_only_new_identities_reach_the_backend()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.OpenOrReuseAsync(key);
        var applied = await manager.ApplyPlanDiffAsync(key, Operation("diff-1", 'b'), Diagram);
        var replayed = await manager.ApplyPlanDiffAsync(key, Operation("diff-1", 'b'), Diagram);

        Assert.False(applied.Replayed);
        Assert.True(replayed.Replayed);
        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(1, backend.ApplyDiffCalls);
        Assert.Equal(0, backend.ApplyCalls);
    }

    [Fact]
    public async Task Save_close_and_recovery_are_explicit_idempotent_lifecycle_operations()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saved = await manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var closed = await manager.CloseAsync(key);
        var closedAgain = await manager.CloseAsync(key);
        var manifest = Assert.IsType<VisioSessionRecoveryManifest>(saved.RecoveryManifest);
        var recovered = await manager.RecoverAsync(key, manifest);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.RecoverAsync(key, manifest));

        Assert.Equal(VisioSessionState.Open, saved.State);
        Assert.Equal(VisioSessionState.Closed, closed.State);
        Assert.Equal(VisioSessionState.Closed, closedAgain.State);
        Assert.Equal(VisioSessionState.Open, recovered.State);
        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(1, backend.CloseCalls);
        Assert.Equal(1, backend.RecoverCalls);
    }

    [Fact]
    public async Task Close_backend_failure_moves_the_session_to_recovering_and_blocks_retry()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        await manager.OpenOrReuseAsync(key);
        backend.FailClose = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.CloseAsync(key));
        Assert.Equal(VisioSessionState.Recovering, manager.GetSnapshot(key)!.State);

        backend.FailClose = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.CloseAsync(key));
        Assert.Equal(1, backend.CloseCalls);
    }

    [Fact]
    public async Task Recover_rejects_a_healthy_dirty_session_without_replacing_its_live_document()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        var applied = await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);

        var manifest = new VisioSessionRecoveryManifest(
            key,
            "C:\\exports\\session.vsdx",
            applied.Snapshot.Document!,
            applied.Snapshot.LastPlanHash,
            applied.Snapshot.OperationJournal);
        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.RecoverAsync(key, manifest));
        Assert.Equal(VisioSessionState.Dirty, manager.GetSnapshot(key)!.State);
        Assert.Equal(applied.Snapshot.Document, manager.GetSnapshot(key)!.Document);
        Assert.Equal(0, backend.RecoverCalls);
    }

    [Fact]
    public async Task Recover_waiting_behind_save_rejects_the_healthy_session_after_save_completes()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var firstSaved = await manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var manifest = Assert.IsType<VisioSessionRecoveryManifest>(firstSaved.RecoveryManifest);
        await manager.ApplyPlanAsync(key, Operation("operation-2", 'b'), Diagram);
        backend.SaveStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        backend.AllowSave = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var saving = manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        await backend.SaveStarted.Task;
        var recovering = manager.RecoverAsync(key, manifest);
        Assert.False(recovering.IsCompleted);

        backend.AllowSave.SetResult();
        await saving;
        await Assert.ThrowsAsync<InvalidOperationException>(() => recovering);
        Assert.Equal(VisioSessionState.Open, manager.GetSnapshot(key)!.State);
        Assert.Equal(0, backend.RecoverCalls);
    }

    [Fact]
    public async Task Save_exposes_the_saving_state_until_the_serialized_backend_operation_completes()
    {
        var backend = new RecordingBackend
        {
            SaveStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously),
            AllowSave = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously),
        };
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saving = manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        await backend.SaveStarted.Task;

        Assert.Equal(VisioSessionState.Saving, manager.GetSnapshot(key)!.State);

        backend.AllowSave.SetResult();
        Assert.Equal(VisioSessionState.Open, (await saving).State);
    }

    [Fact]
    public async Task Save_backend_failure_moves_the_session_to_recovering_and_blocks_retry()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        backend.FailSave = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.SaveAsAsync(key, "C:\\exports\\session.vsdx"));
        Assert.Equal(VisioSessionState.Recovering, manager.GetSnapshot(key)!.State);

        backend.FailSave = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.SaveAsAsync(key, "C:\\exports\\session.vsdx"));
        Assert.Equal(1, backend.SaveCalls);
    }

    [Fact]
    public async Task Recovery_manifest_rejects_a_foreign_key_or_changed_journal_without_calling_the_backend()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saved = await manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var manifest = Assert.IsType<VisioSessionRecoveryManifest>(saved.RecoveryManifest);
        await manager.CloseAsync(key);
        var foreignKeyManifest = new VisioSessionRecoveryManifest(
            Key("workflow-b"),
            manifest.OutputPath,
            manifest.Document,
            manifest.LastPlanHash,
            manifest.OperationJournal);
        var changedJournalManifest = new VisioSessionRecoveryManifest(
            key,
            manifest.OutputPath,
            manifest.Document,
            new string('b', 64),
            [new VisioSessionOperationJournalEntry("operation-1", new string('b', 64))]);

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.RecoverAsync(key, foreignKeyManifest));
        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.RecoverAsync(key, changedJournalManifest));

        Assert.Equal(VisioSessionState.Closed, manager.GetSnapshot(key)!.State);
        Assert.Equal(0, backend.RecoverCalls);
    }

    [Fact]
    public async Task Recovery_backend_failure_remains_recovering_instead_of_silently_closing_the_session()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saved = await manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var manifest = Assert.IsType<VisioSessionRecoveryManifest>(saved.RecoveryManifest);
        await manager.CloseAsync(key);
        backend.FailRecover = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.RecoverAsync(key, manifest));

        Assert.Equal(VisioSessionState.Recovering, manager.GetSnapshot(key)!.State);
        Assert.Equal(1, backend.RecoverCalls);
        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.RecoverAsync(key, manifest));
        Assert.Equal(1, backend.RecoverCalls);
    }

    [Fact]
    public async Task Recovery_manifest_restores_the_saved_plan_journal_after_a_manager_restart()
    {
        var sourceBackend = new RecordingBackend();
        var sourceManager = new VisioSessionManager(sourceBackend);
        var key = Key("workflow-a");

        await sourceManager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saved = await sourceManager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var manifest = Assert.IsType<VisioSessionRecoveryManifest>(saved.RecoveryManifest);

        var recoveryBackend = new RecordingBackend();
        var restartedManager = new VisioSessionManager(recoveryBackend);
        var recovered = await restartedManager.RecoverAsync(key, manifest);

        Assert.Equal(VisioSessionState.Open, recovered.State);
        Assert.Equal(manifest.OutputPath, recovered.LastSavedPath);
        Assert.Equal(manifest.LastPlanHash, recovered.LastPlanHash);
        Assert.Equal(manifest.OperationJournal, recovered.OperationJournal);
        Assert.Equal(recovered.Document, recovered.RecoveryManifest!.Document);
        Assert.Equal(1, recoveryBackend.RecoverCalls);
        var replay = await restartedManager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        Assert.True(replay.Replayed);
        Assert.Equal(0, recoveryBackend.ApplyCalls);
    }

    [Fact]
    public async Task Recovery_accepts_an_equivalent_reconstructed_manifest_for_the_same_saved_session()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        await manager.ApplyPlanAsync(key, Operation("operation-1", 'a'), Diagram);
        var saved = await manager.SaveAsAsync(key, "C:\\exports\\session.vsdx");
        var original = Assert.IsType<VisioSessionRecoveryManifest>(saved.RecoveryManifest);
        var reconstructed = new VisioSessionRecoveryManifest(
            new VisioSessionKey(key.TenantId, key.UserId, key.DeviceId, key.WorkflowId),
            string.Concat(original.OutputPath),
            new VisioSessionDocument(original.Document.DocumentHandle, original.Document.PageHandle),
            original.LastPlanHash,
            original.OperationJournal.Select(entry => new VisioSessionOperationJournalEntry(entry.OperationId, entry.PlanHash)));
        await manager.CloseAsync(key);

        await manager.RecoverAsync(key, reconstructed);

        Assert.Equal(1, backend.RecoverCalls);
    }

    [Fact]
    public async Task Operation_journal_rejects_new_identities_after_the_bounded_replay_limit()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");

        for (var index = 0; index < VisioSessionOperationJournal.MaximumEntries; index++)
        {
            var planHash = index.ToString("x").PadLeft(64, '0');
            await manager.ApplyPlanAsync(key, new VisioSessionOperation($"operation-{index:D4}", planHash), Diagram);
        }

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            manager.ApplyPlanAsync(key, Operation("operation-over-limit", 'f'), Diagram));

        Assert.Equal(VisioSessionOperationJournal.MaximumEntries, backend.ApplyCalls);
        Assert.Equal(VisioSessionOperationJournal.MaximumEntries, manager.GetSnapshot(key)!.OperationJournal.Count);
    }

    [Fact]
    public async Task Concurrent_snapshot_readers_observe_committed_state_without_enumerating_a_mutating_journal()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);
        var key = Key("workflow-a");
        using var started = new ManualResetEventSlim();
        var writer = Task.Run(async () =>
        {
            started.Set();
            for (var index = 0; index < 200; index++)
            {
                var operationId = $"operation-{index:D3}";
                var planHash = index.ToString("x").PadLeft(64, '0');
                await manager.ApplyPlanAsync(key, new VisioSessionOperation(operationId, planHash), Diagram);
            }
        });
        started.Wait();
        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
        {
            while (!writer.IsCompleted)
            {
                var snapshot = manager.GetSnapshot(key);
                if (snapshot?.LastPlanHash is not null)
                {
                    Assert.Contains(snapshot.OperationJournal, entry => entry.PlanHash == snapshot.LastPlanHash);
                }

                await Task.Yield();
            }
        }));

        await Task.WhenAll(readers.Append(writer));
        var final = manager.GetSnapshot(key)!;
        Assert.Equal(200, final.OperationJournal.Count);
        Assert.Equal(200, backend.ApplyCalls);
    }

    [Fact]
    public async Task Sessions_with_a_different_owner_or_workflow_do_not_share_native_handles()
    {
        var backend = new RecordingBackend();
        var manager = new VisioSessionManager(backend);

        var ownerOne = await manager.OpenOrReuseAsync(Key("workflow-a", userId: "user-one"));
        var ownerTwo = await manager.OpenOrReuseAsync(Key("workflow-a", userId: "user-two"));
        var workflowTwo = await manager.OpenOrReuseAsync(Key("workflow-b", userId: "user-one"));

        Assert.NotEqual(ownerOne.Document, ownerTwo.Document);
        Assert.NotEqual(ownerOne.Document, workflowTwo.Document);
        Assert.Equal(3, backend.OpenOrCreateCalls);
    }

    private static VisioSessionKey Key(string workflowId, string userId = "user-one") => new("tenant-one", userId, "device-one", workflowId);

    private static VisioSessionOperation Operation(string operationId, char hashCharacter) => new(operationId, new string(hashCharacter, 64));

    private sealed class RecordingBackend : IVisioSessionBackend
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public int ApplyDiffCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int RecoverCalls { get; private set; }
        public TaskCompletionSource? SaveStarted { get; set; }
        public TaskCompletionSource? AllowSave { get; set; }
        public bool FailApply { get; set; }
        public bool FailSave { get; set; }
        public bool FailOpen { get; set; }
        public bool FailClose { get; set; }
        public bool FailRecover { get; set; }

        public string NormalizeOutputPath(string outputPath) => outputPath;

        public Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default)
        {
            OpenOrCreateCalls++;
            if (FailOpen) throw new InvalidOperationException("simulated partial open failure");
            return Task.FromResult(new VisioSessionDocument($"document-{OpenOrCreateCalls}", $"page-{OpenOrCreateCalls}"));
        }

        public Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyCalls++;
            if (FailApply) throw new InvalidOperationException("simulated partial apply failure");
            return Task.CompletedTask;
        }

        public Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyDiffCalls++;
            return Task.CompletedTask;
        }

        public async Task SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            if (FailSave) throw new InvalidOperationException("simulated partial save failure");
            SaveStarted?.TrySetResult();
            if (AllowSave is not null) await AllowSave.Task.WaitAsync(cancellationToken);
        }

        public Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default)
        {
            CloseCalls++;
            if (FailClose) throw new InvalidOperationException("simulated partial close failure");
            return Task.CompletedTask;
        }

        public Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, string outputPath, CancellationToken cancellationToken = default)
        {
            RecoverCalls++;
            if (FailRecover) throw new InvalidOperationException("simulated partial recovery failure");
            return Task.FromResult(new VisioSessionDocument("recovered-document", "recovered-page"));
        }
    }
}
