using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class VisioComSessionBackendTests
{
    [Fact]
    public async Task Visible_session_keeps_one_document_open_through_apply_and_diff_until_explicit_close()
    {
        var operations = new RecordingComOperations();
        await using var backend = new VisioComSessionBackend(
            new VisioComEngineOptions(Visible: true, OutputRoot: Path.GetTempPath()),
            operations);
        var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
        var plan = new DiagramDocument("diagram", [], [], []);

        var document = await backend.OpenOrCreateAsync(key);
        await backend.ApplyPlanAsync(document, plan);
        await backend.ApplyPlanDiffAsync(document, plan);

        Assert.Equal(1, operations.OpenOrCreateCalls);
        Assert.Equal(1, operations.ApplyPlanCalls);
        Assert.Equal(1, operations.ApplyPlanDiffCalls);
        Assert.Equal(0, operations.CloseCalls);
        Assert.All(operations.OperatedDocuments, operated => Assert.Same(document, operated));

        await backend.CloseAsync(document);

        Assert.Equal(1, operations.CloseCalls);
    }

    [Fact]
    public async Task Disposal_failure_on_the_STA_is_retryable_without_marking_the_backend_disposed()
    {
        var operations = new RecordingComOperations { FailFirstDispose = true };
        var backend = new VisioComSessionBackend(
            new VisioComEngineOptions(OutputRoot: Path.GetTempPath()),
            operations);

        var error = await Assert.ThrowsAsync<WorkerProtocolException>(async () => await backend.DisposeAsync());

        Assert.Contains("simulated lifecycle exit failure", error.Message, StringComparison.Ordinal);
        Assert.Equal(1, operations.DisposeCalls);
        Assert.Single(operations.ThreadIds);
        Assert.Collection(operations.ApartmentStates, state => Assert.Equal(ApartmentState.STA, state));

        await backend.DisposeAsync();

        Assert.Equal(2, operations.DisposeCalls);
    }

    [Fact]
    public async Task Pre_canceled_operation_is_rejected_before_STA_queue_admission()
    {
        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-session-backend-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputRoot);
        try
        {
            var operations = new RecordingComOperations
            {
                BlockFirstApply = true,
            };
            await using var backend = new VisioComSessionBackend(
                new VisioComEngineOptions(OutputRoot: outputRoot),
                operations);
            var document = new VisioSessionDocument("document-one", "page-one");
            var plan = new DiagramDocument("diagram", [], [], []);

            var firstApply = backend.ApplyPlanAsync(document, plan);
            await operations.FirstApplyStarted.Task;
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();

            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                backend.ApplyPlanAsync(document, plan, cancellation.Token));

            operations.AllowFirstApply.SetResult();
            await firstApply;
            await backend.CloseAsync(document);

            Assert.Equal(1, operations.ApplyPlanCalls);
        }
        finally
        {
            if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
        }
    }

    [Fact]
    public async Task Cancellation_after_STA_submission_drains_save_before_releasing_the_session_gate_or_temporary_path()
    {
        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-session-backend-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputRoot);
        try
        {
            var operations = new RecordingComOperations
            {
                BlockSave = true,
            };
            await using var backend = new VisioComSessionBackend(
                new VisioComEngineOptions(OutputRoot: outputRoot),
                operations);
            var manager = new VisioSessionManager(backend);
            var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
            var plan = new DiagramDocument("diagram", [], [], []);
            await manager.ApplyPlanAsync(
                key,
                new VisioSessionOperation("operation-one", new string('a', 64)),
                plan);

            using var cancellation = new CancellationTokenSource();
            var outputPath = Path.Combine(outputRoot, "session.vsdx");
            var saving = manager.SaveAsAsync(key, outputPath, cancellation.Token);
            await operations.SaveStarted.Task;
            var temporaryPath = Assert.Single(operations.TemporaryPaths);

            cancellation.Cancel();
            var reuse = manager.OpenOrReuseAsync(key);

            var savingCompletedBeforeRelease = ReferenceEquals(
                saving,
                await Task.WhenAny(saving, Task.Delay(TimeSpan.FromMilliseconds(100))));
            var reuseCompletedBeforeRelease = ReferenceEquals(
                reuse,
                await Task.WhenAny(reuse, Task.Delay(TimeSpan.FromMilliseconds(100))));
            var stateBeforeRelease = manager.GetSnapshot(key)!.State;
            var temporaryPathExistedBeforeRelease = File.Exists(temporaryPath);

            operations.AllowSave.SetResult();
            VisioSessionSnapshot? saved = null;
            Exception? saveError = null;
            try
            {
                saved = await saving;
            }
            catch (Exception error)
            {
                saveError = error;
            }
            await reuse;

            Assert.False(savingCompletedBeforeRelease);
            Assert.False(reuseCompletedBeforeRelease);
            Assert.Equal(VisioSessionState.Saving, stateBeforeRelease);
            Assert.True(temporaryPathExistedBeforeRelease);
            Assert.Null(saveError);
            Assert.Equal(VisioSessionState.Open, saved!.State);
            Assert.False(File.Exists(temporaryPath));
        }
        finally
        {
            if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
        }
    }

    [Fact]
    public async Task Session_backend_serializes_allowlisted_operations_and_manager_replay_does_not_open_or_close_a_second_canvas()
    {
        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-session-backend-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputRoot);
        try
        {
            var operations = new RecordingComOperations();
            await using var backend = new VisioComSessionBackend(
                new VisioComEngineOptions(OutputRoot: outputRoot),
                operations);
            var manager = new VisioSessionManager(backend);
            var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
            var plan = new DiagramDocument("diagram", [], [], []);
            var operation = new VisioSessionOperation("operation-one", new string('a', 64));

            await manager.ApplyPlanAsync(key, operation, plan);
            await manager.ApplyPlanAsync(key, operation, plan);

            Assert.Equal(1, operations.OpenOrCreateCalls);
            Assert.Equal(1, operations.ApplyPlanCalls);
            Assert.Equal(0, operations.CloseCalls);
            Assert.Single(operations.ThreadIds);
            Assert.Collection(operations.ApartmentStates, state => Assert.Equal(ApartmentState.STA, state));

            var outputPath = Path.Combine(outputRoot, "session.vsdx");
            await manager.SaveAsAsync(key, outputPath);
            await manager.CloseAsync(key);

            Assert.Equal(1, operations.SaveCalls);
            Assert.Equal(1, operations.CloseCalls);
            Assert.Equal(outputPath, operations.FinalPaths.Single());
            Assert.StartsWith(outputPath + ".", operations.TemporaryPaths.Single(), StringComparison.Ordinal);
            Assert.Single(operations.ThreadIds);
            Assert.Collection(operations.ApartmentStates, state => Assert.Equal(ApartmentState.STA, state));
        }
        finally
        {
            if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
        }
    }

    [Fact]
    public async Task Session_backend_uses_the_fixed_recovery_operation_and_rejects_paths_outside_the_output_root()
    {
        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-session-backend-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputRoot);
        try
        {
            var operations = new RecordingComOperations();
            await using var backend = new VisioComSessionBackend(
                new VisioComEngineOptions(OutputRoot: outputRoot),
                operations);
            var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
            var document = new VisioSessionDocument("document-one", "page-one");
            var safePath = Path.Combine(outputRoot, "session.vsdx");

            var recoveryManifest = new VisioSessionRecoveryManifest(key, safePath, new VisioSessionDocument("recovered-document", "recovered-page"), null, []);
            var recovered = await backend.RecoverAsync(key, recoveryManifest);
            var error = await Assert.ThrowsAsync<WorkerProtocolException>(async () =>
                await backend.SaveAsAsync(document, Path.Combine(Path.GetTempPath(), "outside.vsdx")));

            Assert.Equal("recovered-document", recovered.DocumentHandle);
            Assert.Equal(1, operations.RecoverCalls);
            Assert.Equal(0, operations.SaveCalls);
            Assert.Contains("remain inside the configured output root", error.Message, StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
        }
    }

    private sealed class RecordingComOperations : IVisioComSessionOperations, IDisposable
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyPlanCalls { get; private set; }
        public int ApplyPlanDiffCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int RecoverCalls { get; private set; }
        public HashSet<int> ThreadIds { get; } = [];
        public HashSet<ApartmentState> ApartmentStates { get; } = [];
        public List<string> TemporaryPaths { get; } = [];
        public List<string> FinalPaths { get; } = [];
        public List<VisioSessionDocument> OperatedDocuments { get; } = [];
        public bool FailFirstDispose { get; init; }
        public int DisposeCalls { get; private set; }
        public bool BlockFirstApply { get; init; }
        public TaskCompletionSource FirstApplyStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource AllowFirstApply { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool BlockSave { get; init; }
        public TaskCompletionSource SaveStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource AllowSave { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey)
        {
            TrackThread();
            OpenOrCreateCalls++;
            return new VisioSessionDocument("document-one", "page-one");
        }

        public void ApplyPlan(VisioSessionDocument document, DiagramDocument plan)
        {
            TrackThread();
            ApplyPlanCalls++;
            OperatedDocuments.Add(document);
            if (BlockFirstApply && ApplyPlanCalls == 1)
            {
                FirstApplyStarted.TrySetResult();
                AllowFirstApply.Task.GetAwaiter().GetResult();
            }
        }

        public void ApplyPlanDiff(VisioSessionDocument document, DiagramDocument plan)
        {
            TrackThread();
            ApplyPlanDiffCalls++;
            OperatedDocuments.Add(document);
        }

        public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath)
        {
            TrackThread();
            SaveCalls++;
            TemporaryPaths.Add(temporaryPath);
            FinalPaths.Add(finalPath);
            File.WriteAllText(temporaryPath, "partial");
            if (BlockSave)
            {
                SaveStarted.TrySetResult();
                AllowSave.Task.GetAwaiter().GetResult();
            }

            return document;
        }

        public void Close(VisioSessionDocument document)
        {
            TrackThread();
            CloseCalls++;
            OperatedDocuments.Add(document);
        }

        public VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest)
        {
            TrackThread();
            RecoverCalls++;
            return manifest.Document;
        }

        public void Dispose()
        {
            TrackThread();
            DisposeCalls++;
            if (FailFirstDispose && DisposeCalls == 1)
            {
                throw new WorkerProtocolException("simulated lifecycle exit failure");
            }
        }

        private void TrackThread()
        {
            ThreadIds.Add(Environment.CurrentManagedThreadId);
            ApartmentStates.Add(Thread.CurrentThread.GetApartmentState());
        }
    }
}
