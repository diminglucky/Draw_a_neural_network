using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;
using System.Reflection;
using System.Text.Json.Nodes;

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

        Assert.Equal(2, backend.SaveCalls);
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
        var saveCallsBeforeCheckpoint = backend.SaveCalls;
        clock.Advance(TimeSpan.FromMinutes(14) + TimeSpan.FromSeconds(59));

        await runtime.CheckpointIdleSessionsAsync();

        Assert.Equal(saveCallsBeforeCheckpoint, backend.SaveCalls);
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
    public async Task Apply_without_a_caller_plan_hash_uses_the_worker_canonical_digest_for_the_operation()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        var diagram = new DiagramEnvelope { Figure = new DiagramFigure { Title = "worker-derived-digest" } };
        var request = new WorkerV2Request("apply-1", WorkerV2Command.Apply, Session(), null, "operation-1", null, diagram, null);

        var response = await runtime.ProcessAsync(request);
        var manifest = await store.LoadAsync(Key());

        Assert.Equal("succeeded", response.Status);
        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal(DiagramPlanDigest.Compute(DiagramMapper.Map(diagram)), manifest!.Manifest.LastPlanHash);
        Assert.Contains(manifest.Manifest.OperationJournal, entry => entry.OperationId == "operation-1" && entry.PlanHash == manifest.Manifest.LastPlanHash);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task Apply_replays_when_a_matching_caller_plan_hash_is_added_or_omitted(bool initialHasPlanHash, bool retryHasPlanHash)
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        var diagram = new DiagramEnvelope { Figure = new DiagramFigure { Title = "worker-fingerprint" } };
        var digest = DiagramPlanDigest.Compute(DiagramMapper.Map(diagram));
        var initial = new WorkerV2Request("apply-1", WorkerV2Command.Apply, Session(), null, "operation-1", initialHasPlanHash ? digest : null, diagram, null);
        var retry = initial with { PlanHash = retryHasPlanHash ? digest.ToUpperInvariant() : null };

        await runtime.ProcessAsync(initial);
        var replay = await runtime.ProcessAsync(retry);

        Assert.Equal("succeeded", replay.Status);
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_diff_without_a_caller_plan_hash_uses_the_worker_canonical_digest_for_the_operation()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        var diagram = new DiagramEnvelope { Figure = new DiagramFigure { Title = "worker-derived-diff-digest" } };
        var request = new WorkerV2Request("apply-diff-1", WorkerV2Command.ApplyDiff, Session(), null, "operation-diff-1", null, diagram, null);

        var response = await runtime.ProcessAsync(request);
        var manifest = await store.LoadAsync(Key());

        Assert.Equal("succeeded", response.Status);
        Assert.Equal(1, backend.ApplyDiffCalls);
        Assert.Equal(DiagramPlanDigest.Compute(DiagramMapper.Map(diagram)), manifest!.Manifest.LastPlanHash);
        Assert.Contains(manifest.Manifest.OperationJournal, entry => entry.OperationId == "operation-diff-1" && entry.PlanHash == manifest.Manifest.LastPlanHash);
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
        Assert.Equal(2, backend.SaveCalls);
        Assert.Equal(2, backend.CloseCalls);
        var afterDiscard = await store.LoadAsync(Key());
        Assert.NotNull(afterDiscard);
        Assert.Equal(saved!.Manifest.Document, afterDiscard!.Manifest.Document);
        Assert.Equal(saved.Manifest.LastPlanHash, afterDiscard.Manifest.LastPlanHash);
        Assert.Contains(afterDiscard.Manifest.CommandReplayJournal, entry => entry.RequestId == "close-save");
        Assert.Contains(afterDiscard.Manifest.CommandReplayJournal, entry => entry.RequestId == "close-discard");
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
        Assert.Equal(2, backend.SaveCalls);
        Assert.Equal(1, backend.CloseCalls);
        Assert.Equal(["document-1", "document-1"], backend.SavedDocuments);
    }

    [Fact]
    public async Task Capacity_checkpoint_failure_rejects_the_new_open_without_creating_a_replacement_document()
    {
        var backend = new RecordingSessionBackend();
        var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.UtcNow), TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first"));
        backend.FailSave = true;

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second")));

        Assert.Equal(1, backend.OpenOrCreateCalls);
        Assert.Equal(2, backend.SaveCalls);
        Assert.Equal(0, backend.CloseCalls);
        await runtime.DisposeAsync();
        Assert.Equal(1, backend.CloseCalls);
    }

    [Fact]
    public async Task Recovery_failure_blocks_open_from_creating_a_substitute_document()
    {
        var backend = new RecordingSessionBackend { FailRecover = true };
        var store = new InMemoryManifestStore();
        await store.SaveAsync(new VisioSessionRecoveryManifest(Key(), "session.vsdx", new VisioSessionDocument("saved-document", "saved-page"), null, []), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var runtime = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Recover("recover-1")));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-1", "session.vsdx")));

        Assert.Equal(1, backend.RecoverCalls);
        Assert.Equal(0, backend.OpenOrCreateCalls);
        await Assert.ThrowsAsync<WorkerProtocolException>(async () => await runtime.DisposeAsync());
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

    [Fact]
    public async Task Same_request_id_with_a_different_diagram_fails_before_a_second_native_apply()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        var first = ApplyWithDiagram("apply-1", "operation-1", PlanHash("first diagram"), "first diagram");
        var changed = ApplyWithDiagram("apply-1", "operation-1", PlanHash("changed diagram"), "changed diagram");

        await runtime.ProcessAsync(first);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(changed));
        Assert.Equal(1, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_rejects_a_supplied_plan_hash_that_does_not_match_the_trusted_mapped_diagram()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(ApplyWithDiagram("apply-1", "operation-1", new string('f', 64), "diagram")));

        Assert.Equal(0, backend.ApplyCalls);
    }

    [Fact]
    public async Task Apply_diff_rejects_a_supplied_plan_hash_that_does_not_match_the_trusted_mapped_diagram()
    {
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        var request = ApplyWithDiagram("apply-diff-1", "operation-diff-1", new string('f', 64), "diagram") with { Command = WorkerV2Command.ApplyDiff };

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(request));

        Assert.Equal(0, backend.ApplyDiffCalls);
    }

    [Fact]
    public async Task Recovery_returning_a_different_page_fails_closed_and_releases_the_accidental_native_open()
    {
        var backend = new RecordingSessionBackend { RecoveredDocument = new VisioSessionDocument("document-1", "wrong-page") };
        var store = new InMemoryManifestStore();
        await store.SaveAsync(new VisioSessionRecoveryManifest(Key(), "session.vsdx", new VisioSessionDocument("document-1", "page-1"), null, []), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        await using var runtime = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Recover("recover-1")));

        Assert.Equal(1, backend.RecoverCalls);
        Assert.Equal(1, backend.CloseCalls);
        Assert.Empty(backend.OpenDocumentHandles);
    }

    [Fact]
    public async Task Uncertain_native_session_remains_a_capacity_occupant_until_released()
    {
        var backend = new RecordingSessionBackend { FailApply = true };
        var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.UtcNow), TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first")));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second")));

        Assert.Equal(1, backend.OpenOrCreateCalls);
        await runtime.DisposeAsync();
        Assert.Equal(1, backend.CloseCalls);
        Assert.Empty(backend.OpenDocumentHandles);
    }

    [Fact]
    public async Task Cancellation_after_native_open_marks_the_session_uncertain_and_blocks_snapshot_and_reuse()
    {
        using var cancellation = new CancellationTokenSource();
        var backend = new RecordingSessionBackend { CancelAfterOpen = true, OnOpen = cancellation.Cancel };
        var runtime = CreateRuntime(backend);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runtime.ProcessAsync(Open("open-1", "session.vsdx"), cancellation.Token));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Snapshot("snapshot-1")));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-2", "session.vsdx")));

        Assert.Equal(1, backend.OpenOrCreateCalls);
        await Assert.ThrowsAsync<WorkerProtocolException>(async () => await runtime.DisposeAsync());
    }

    [Fact]
    public async Task Dispose_surfaces_manifest_save_failure_after_attempting_native_release()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
        store.FailSave = true;

        await Assert.ThrowsAsync<WorkerProtocolException>(async () => await runtime.DisposeAsync());

        Assert.Equal(1, backend.CloseCalls);
    }

    [Fact]
    public async Task Dispose_surfaces_native_close_failure_instead_of_silently_succeeding()
    {
        var backend = new RecordingSessionBackend { FailClose = true };
        var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'));

        await Assert.ThrowsAsync<WorkerProtocolException>(async () => await runtime.DisposeAsync());

        Assert.Equal(2, backend.CloseCalls);
    }

    [Fact]
    public async Task Fresh_runtime_replays_a_durable_save_without_repeating_the_native_save()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using (var first = CreateRuntime(backend, store))
        {
            await first.ProcessAsync(Open("open-1", "session.vsdx"));
            await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
            await first.ProcessAsync(Save("save-1", "session.vsdx"));
            await first.ProcessAsync(Close("close-1", "discard"));
        }

        await using var second = CreateRuntime(backend, store);
        var replay = await second.ProcessAsync(Save("save-1", "session.vsdx"));

        Assert.Equal("succeeded", replay.Status);
        Assert.Equal(2, backend.SaveCalls);
    }

    [Fact]
    public async Task Fresh_runtime_rejects_replayed_close_when_persisted_command_is_open_before_recovery_or_native_work()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using (var first = CreateRuntime(backend, store))
        {
            await first.ProcessAsync(Open("open-1", "session.vsdx"));
            await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
            await first.ProcessAsync(Close("close-1", "discard"));
        }

        store.ReplaceReplayCommand(Key(), "close-1", VisioSessionReplayCommand.Open);
        var openCallsBeforeReplay = backend.OpenOrCreateCalls;
        var applyCallsBeforeReplay = backend.ApplyCalls;
        var closeCallsBeforeReplay = backend.CloseCalls;
        var recoverCallsBeforeReplay = backend.RecoverCalls;
        await using var second = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => second.ProcessAsync(Close("close-1", "discard")));

        Assert.Equal(openCallsBeforeReplay, backend.OpenOrCreateCalls);
        Assert.Equal(applyCallsBeforeReplay, backend.ApplyCalls);
        Assert.Equal(closeCallsBeforeReplay, backend.CloseCalls);
        Assert.Equal(recoverCallsBeforeReplay, backend.RecoverCalls);
    }

    [Fact]
    public async Task Fresh_runtime_rejects_replayed_stateful_command_when_persisted_command_is_close_before_recovery_or_native_work()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using (var first = CreateRuntime(backend, store))
        {
            await first.ProcessAsync(Open("open-1", "session.vsdx"));
            await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
            await first.ProcessAsync(Close("close-1", "discard"));
        }

        store.ReplaceReplayCommand(Key(), "apply-1", VisioSessionReplayCommand.Close);
        var openCallsBeforeReplay = backend.OpenOrCreateCalls;
        var applyCallsBeforeReplay = backend.ApplyCalls;
        var closeCallsBeforeReplay = backend.CloseCalls;
        var recoverCallsBeforeReplay = backend.RecoverCalls;
        await using var second = CreateRuntime(backend, store);

        await Assert.ThrowsAsync<WorkerProtocolException>(() => second.ProcessAsync(Apply("apply-1", "operation-1", 'a')));

        Assert.Equal(openCallsBeforeReplay, backend.OpenOrCreateCalls);
        Assert.Equal(applyCallsBeforeReplay, backend.ApplyCalls);
        Assert.Equal(closeCallsBeforeReplay, backend.CloseCalls);
        Assert.Equal(recoverCallsBeforeReplay, backend.RecoverCalls);
    }

    [Theory]
    [InlineData("open")]
    [InlineData("apply")]
    [InlineData("applyDiff")]
    [InlineData("save")]
    [InlineData("snapshot")]
    [InlineData("recover")]
    public async Task Fresh_runtime_replay_of_each_persisted_stateful_command_recovers_before_returning_its_original_response(string command)
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using (var first = CreateRuntime(backend, store))
        {
            await first.ProcessAsync(Open("open-1", "session.vsdx"));
            await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
            await first.ProcessAsync(Apply("apply-diff-1", "operation-2", 'b', WorkerV2Command.ApplyDiff));
            await first.ProcessAsync(Snapshot("snapshot-1"));
            await first.ProcessAsync(Save("save-1", "session.vsdx"));
            await first.ProcessAsync(Close("close-1", "discard"));
            await first.ProcessAsync(Recover("recover-1"));
            await first.ProcessAsync(Save("save-2", "session.vsdx"));
            await first.ProcessAsync(Close("close-2", "discard"));
        }

        var recoverCallsBeforeReplay = backend.RecoverCalls;
        var applyCallsBeforeReplay = backend.ApplyCalls;
        var applyDiffCallsBeforeReplay = backend.ApplyDiffCalls;
        await using var second = CreateRuntime(backend, store);

        var response = await second.ProcessAsync(StatefulReplayRequest(command));

        Assert.Equal("succeeded", response.Status);
        Assert.Equal(recoverCallsBeforeReplay + 1, backend.RecoverCalls);
        Assert.Equal(applyCallsBeforeReplay, backend.ApplyCalls);
        Assert.Equal(applyDiffCallsBeforeReplay, backend.ApplyDiffCalls);
        await second.ProcessAsync(Close($"close-stateful-replay-{command}", "discard"));
    }

    [Fact]
    public async Task Fresh_runtime_rejects_a_legacy_manifest_without_native_document_identity_before_native_work()
    {
        var root = Path.Combine(Path.GetTempPath(), "visio-runtime-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var key = Key();
            var outputPath = Path.Combine(root, "session.vsdx");
            var store = new SessionRecoveryManifestStore(root);
            await store.SaveAsync(
                new VisioSessionRecoveryManifest(
                    key,
                    outputPath,
                    new VisioSessionDocument("document-1", "page-1", new string('a', 32), new string('b', 32)),
                    null,
                    []),
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow);
            var manifestPath = Directory.EnumerateFiles(Path.Combine(root, ".synapse-sessions"), "*.json").Single();
            var legacy = JsonNode.Parse(await File.ReadAllTextAsync(manifestPath))!.AsObject();
            legacy["formatVersion"] = 3;
            var legacyDocument = legacy["manifest"]!["document"]!.AsObject();
            legacyDocument.Remove("nativeDocumentIdentity");
            legacyDocument.Remove("nativePageIdentity");
            await File.WriteAllTextAsync(manifestPath, legacy.ToJsonString());
            var backend = new RecordingSessionBackend();
            await using var runtime = CreateRuntime(backend, store);

            await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-1", outputPath)));

            Assert.Equal(0, backend.OpenOrCreateCalls);
            Assert.Equal(0, backend.RecoverCalls);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Apply_saves_and_persists_its_replay_before_reporting_success()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));

        var response = await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
        var stored = await store.LoadAsync(Key());

        Assert.Equal("succeeded", response.Status);
        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal(1, backend.SaveCalls);
        Assert.NotNull(stored);
        Assert.Contains(stored!.Manifest.CommandReplayJournal, entry => entry.RequestId == "apply-1");
    }

    [Fact]
    public async Task Apply_does_not_report_success_and_marks_the_session_uncertain_when_manifest_persistence_fails_after_native_apply()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore { FailSave = true };
        await using var runtime = CreateRuntime(backend, store);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));

        try
        {
            await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a')));
        }
        finally
        {
            store.FailSave = false;
        }

        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal(1, backend.SaveCalls);
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Snapshot("snapshot-1")));
    }

    [Fact]
    public async Task Apply_cancellation_after_native_save_begins_marks_the_session_uncertain_and_does_not_report_success()
    {
        using var cancellation = new CancellationTokenSource();
        var backend = new RecordingSessionBackend();
        await using var runtime = CreateRuntime(backend);
        await runtime.ProcessAsync(Open("open-1", "session.vsdx"));
        backend.CancelAfterSave = true;
        backend.OnSave = cancellation.Cancel;

        try
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a'), cancellation.Token));
        }
        finally
        {
            backend.CancelAfterSave = false;
            backend.OnSave = null;
        }

        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal(1, backend.SaveCalls);
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Snapshot("snapshot-1")));
    }

    [Fact]
    public async Task Idle_checkpoint_cancellation_after_native_save_begins_marks_the_actual_candidate_uncertain_and_keeps_it_at_capacity()
    {
        using var cancellation = new CancellationTokenSource();
        var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z"));
        var backend = new RecordingSessionBackend();
        await using var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), clock, TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first"));
        backend.CancelAfterSave = true;
        backend.OnSave = cancellation.Cancel;
        clock.Advance(TimeSpan.FromMinutes(15));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runtime.CheckpointIdleSessionsAsync(cancellation.Token));

        AssertRuntimeSessionIsUncertain(runtime, Key("first"));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second")));
        Assert.Equal(1, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Capacity_checkpoint_cancellation_after_native_save_begins_marks_the_actual_candidate_uncertain_and_keeps_it_at_capacity()
    {
        using var cancellation = new CancellationTokenSource();
        var backend = new RecordingSessionBackend();
        await using var runtime = new LongLivedWorkerRuntime(backend, new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.UtcNow), TimeSpan.FromMinutes(15), 1);
        await runtime.ProcessAsync(Open("open-1", "first.vsdx", workflowId: "first"));
        await runtime.ProcessAsync(Apply("apply-1", "operation-1", 'a', workflowId: "first"));
        backend.CancelAfterSave = true;
        backend.OnSave = cancellation.Cancel;

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runtime.ProcessAsync(Open("open-2", "second.vsdx", workflowId: "second"), cancellation.Token));

        AssertRuntimeSessionIsUncertain(runtime, Key("first"));
        await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Open("open-3", "second.vsdx", workflowId: "second")));
        Assert.Equal(1, backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Fresh_runtime_replays_a_durable_close_without_repeating_the_native_close()
    {
        var backend = new RecordingSessionBackend();
        var store = new InMemoryManifestStore();
        await using (var first = CreateRuntime(backend, store))
        {
            await first.ProcessAsync(Open("open-1", "session.vsdx"));
            await first.ProcessAsync(Apply("apply-1", "operation-1", 'a'));
            await first.ProcessAsync(Save("save-1", "session.vsdx"));
            await first.ProcessAsync(Close("close-1", "discard"));
        }

        await using var second = CreateRuntime(backend, store);
        var replay = await second.ProcessAsync(Close("close-1", "discard"));

        Assert.Equal("succeeded", replay.Status);
        Assert.Equal(1, backend.CloseCalls);
        Assert.Equal(0, backend.RecoverCalls);
    }

    private static LongLivedWorkerRuntime CreateRuntime(RecordingSessionBackend backend, ISessionRecoveryManifestStore? store = null) =>
        new(backend, store ?? new InMemoryManifestStore(), new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z")), TimeSpan.FromMinutes(15), 4);

    private static WorkerV2Request Open(string requestId, string outputPath, string userId = "user", string workflowId = "workflow") =>
        new(requestId, WorkerV2Command.Open, Session(userId, workflowId), outputPath, null, null, null, null);

    private static WorkerV2Request Apply(string requestId, string operationId, char hashCharacter, WorkerV2Command command = WorkerV2Command.Apply, string userId = "user", string workflowId = "workflow")
    {
        var diagram = new DiagramEnvelope { Figure = new DiagramFigure { Title = "diagram-" + hashCharacter } };
        return new WorkerV2Request(requestId, command, Session(userId, workflowId), null, operationId, DiagramPlanDigest.Compute(DiagramMapper.Map(diagram)), diagram, null);
    }

    private static WorkerV2Request ApplyWithDiagram(string requestId, string operationId, string planHash, string title) =>
        new(requestId, WorkerV2Command.Apply, Session(), null, operationId, planHash, new DiagramEnvelope { Figure = new DiagramFigure { Title = title } }, null);

    private static string PlanHash(string title)
    {
        var diagram = new DiagramEnvelope { Figure = new DiagramFigure { Title = title } };
        return DiagramPlanDigest.Compute(DiagramMapper.Map(diagram));
    }

    private static WorkerV2Request Save(string requestId, string outputPath) =>
        new(requestId, WorkerV2Command.Save, Session(), outputPath, null, null, null, null);

    private static WorkerV2Request Close(string requestId, string disposition) =>
        new(requestId, WorkerV2Command.Close, Session(), null, null, null, null, disposition);

    private static WorkerV2Request Recover(string requestId) =>
        new(requestId, WorkerV2Command.Recover, Session(), null, null, null, null, null);

    private static WorkerV2Request Snapshot(string requestId) =>
        new(requestId, WorkerV2Command.Snapshot, Session(), null, null, null, null, null);

    private static WorkerV2Request StatefulReplayRequest(string command) => command switch
    {
        "open" => Open("open-1", "session.vsdx"),
        "apply" => Apply("apply-1", "operation-1", 'a'),
        "applyDiff" => Apply("apply-diff-1", "operation-2", 'b', WorkerV2Command.ApplyDiff),
        "save" => Save("save-1", "session.vsdx"),
        "snapshot" => Snapshot("snapshot-1"),
        "recover" => Recover("recover-1"),
        _ => throw new ArgumentOutOfRangeException(nameof(command)),
    };

    private static WorkerV2Session Session(string userId = "user", string workflowId = "workflow") => new("tenant", userId, "device", workflowId);
    private static VisioSessionKey Key(string workflowId = "workflow") => Session(workflowId: workflowId).ToKey();

    private static void AssertRuntimeSessionIsUncertain(LongLivedWorkerRuntime runtime, VisioSessionKey key)
    {
        var field = typeof(LongLivedWorkerRuntime).GetField("_runtimeSessions", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(field);
        var sessions = Assert.IsAssignableFrom<System.Collections.IDictionary>(field!.GetValue(runtime));
        var runtimeSession = sessions[key];
        Assert.NotNull(runtimeSession);
        var uncertain = runtimeSession!.GetType().GetProperty("Uncertain", BindingFlags.Instance | BindingFlags.Public);
        Assert.NotNull(uncertain);
        Assert.True(Assert.IsType<bool>(uncertain!.GetValue(runtimeSession)));
    }

    private sealed class FakeWorkerClock(DateTimeOffset utcNow) : IWorkerClock
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan elapsed) => UtcNow = UtcNow.Add(elapsed);
    }

    private sealed class InMemoryManifestStore : ISessionRecoveryManifestStore
    {
        private readonly Dictionary<VisioSessionKey, StoredSessionRecoveryManifest> _stored = [];
        public bool FailNextLoad { get; set; }
        public bool FailSave { get; set; }

        public Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default)
        {
            if (FailSave) throw new InvalidOperationException("manifest save failed");
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

        public void ReplaceReplayCommand(VisioSessionKey key, string requestId, VisioSessionReplayCommand command)
        {
            var stored = _stored[key];
            if (stored.FormatVersion != SessionRecoveryManifestStore.CurrentFormatVersion)
            {
                throw new InvalidOperationException("Test replay mutation requires the current manifest format.");
            }

            var entries = stored.Manifest.CommandReplayJournal
                .Select(entry => string.Equals(entry.RequestId, requestId, StringComparison.Ordinal)
                    ? new VisioSessionCommandReplayEntry(entry.RequestId, command, entry.Fingerprint, entry.Status, entry.OutputPath)
                    : entry)
                .ToArray();
            if (entries.All(entry => !string.Equals(entry.RequestId, requestId, StringComparison.Ordinal)))
            {
                throw new KeyNotFoundException(requestId);
            }

            _stored[key] = new StoredSessionRecoveryManifest(
                new VisioSessionRecoveryManifest(
                    stored.Manifest.Key,
                    stored.Manifest.OutputPath,
                    stored.Manifest.Document,
                    stored.Manifest.LastPlanHash,
                    stored.Manifest.OperationJournal,
                    entries),
                stored.SavedAt,
                stored.LastActivity,
                stored.FormatVersion);
        }
    }

    private sealed class RecordingSessionBackend : IVisioSessionBackend, IVisioSessionReadbackBackend
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public int ApplyDiffCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int RecoverCalls { get; private set; }
        public bool FailSave { get; set; }
        public bool FailApply { get; init; }
        public bool FailRecover { get; init; }
        public bool FailClose { get; init; }
        public bool CancelAfterOpen { get; init; }
        public Action? OnOpen { get; init; }
        public bool CancelAfterSave { get; set; }
        public Action? OnSave { get; set; }
        public VisioSessionDocument? RecoveredDocument { get; init; }
        public List<string> CreatedDocuments { get; } = [];
        public List<string> SavedDocuments { get; } = [];
        public HashSet<string> OpenDocumentHandles { get; } = new(StringComparer.Ordinal);
        public string? RecoveredFromPageHandle { get; private set; }

        public string NormalizeOutputPath(string outputPath) => outputPath;

        public Task<VisioSessionDocument> OpenOrCreateAsync(VisioSessionKey sessionKey, CancellationToken cancellationToken = default)
        {
            OpenOrCreateCalls++;
            var document = new VisioSessionDocument($"document-{OpenOrCreateCalls}", $"page-{OpenOrCreateCalls}");
            CreatedDocuments.Add(document.DocumentHandle);
            OpenDocumentHandles.Add(document.DocumentHandle);
            if (CancelAfterOpen)
            {
                OnOpen?.Invoke();
                throw new OperationCanceledException(cancellationToken);
            }
            return Task.FromResult(document);
        }

        public Task ApplyPlanAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyCalls++;
            if (FailApply) throw new InvalidOperationException("apply failed");
            return Task.CompletedTask;
        }

        public Task ApplyPlanDiffAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyDiffCalls++;
            return Task.CompletedTask;
        }

        public Task<ReadbackResult> ReadbackAsync(VisioSessionDocument document, DiagramDocument plan, CancellationToken cancellationToken = default) =>
            Task.FromResult(ReadbackValidator.Legacy(shapeCount: 1, connectorCount: 0));

        public Task<VisioSessionDocument> SaveAsAsync(VisioSessionDocument document, string outputPath, CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            SavedDocuments.Add(document.DocumentHandle);
            if (CancelAfterSave)
            {
                OnSave?.Invoke();
                throw new OperationCanceledException(cancellationToken);
            }
            if (FailSave) throw new InvalidOperationException("save failed");
            return Task.FromResult(document);
        }

        public Task CloseAsync(VisioSessionDocument document, CancellationToken cancellationToken = default)
        {
            CloseCalls++;
            if (FailClose) throw new InvalidOperationException("close failed");
            OpenDocumentHandles.Remove(document.DocumentHandle);
            return Task.CompletedTask;
        }

        public Task<VisioSessionDocument> RecoverAsync(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest, CancellationToken cancellationToken = default)
        {
            RecoverCalls++;
            if (FailRecover) throw new InvalidOperationException("recover failed");
            var document = RecoveredDocument ?? manifest.Document;
            RecoveredFromPageHandle = document.PageHandle;
            OpenDocumentHandles.Add(document.DocumentHandle);
            return Task.FromResult(document);
        }
    }
}
