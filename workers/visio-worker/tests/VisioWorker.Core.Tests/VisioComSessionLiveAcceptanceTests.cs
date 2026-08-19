using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;
using Xunit.Sdk;

namespace VisioWorker.Core.Tests;

[Trait("Category", "LiveVisio")]
public sealed class VisioComSessionLiveAcceptanceTests
{
    private const string EnableEnvironmentVariable = "SYNAPSE_ENABLE_LIVE_VISIO_ACCEPTANCE";
    private static readonly TimeSpan VisioExitTimeout = TimeSpan.FromMinutes(1);

    [LiveVisioFact]
    public async Task Idle_checkpoint_and_fresh_runtime_recover_keep_one_editable_vsdx_page_without_duplicate_agent_shapes()
    {
        AssertNoVisioProcesses();

        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-live-visio-session-" + Guid.NewGuid().ToString("N"));
        var outputPath = Path.Combine(outputRoot, "session.vsdx");
        Directory.CreateDirectory(outputRoot);
        var succeeded = false;
        Exception? primaryFailure = null;

        try
        {
            var clock = new LiveWorkerClock(DateTimeOffset.Parse("2026-08-19T00:00:00Z"));
            var session = new WorkerV2Session("live-tenant", "live-user", "live-device", "live-workflow");
            var key = session.ToKey();
            var store = new SessionRecoveryManifestStore(outputRoot);

            StoredSessionRecoveryManifest stored;
            await using (var firstEngine = new VisioComEngine(new VisioComEngineOptions(OutputRoot: outputRoot)))
            await using (var firstBackend = firstEngine.CreateSessionBackend())
            await using (var first = new LongLivedWorkerRuntime(firstBackend, store, clock, TimeSpan.FromMinutes(15), capacity: 1))
            {
                Assert.Equal("succeeded", (await first.ProcessAsync(Open("open-first", session, outputPath))).Status);
                Assert.Equal("succeeded", (await first.ProcessAsync(Apply("apply-encoder", session, "encoder-op", Network("encoder", "Encoder"), WorkerV2Command.Apply))).Status);
                Assert.Equal("succeeded", (await first.ProcessAsync(Apply("apply-decoder", session, "decoder-op", Network("decoder", "Decoder"), WorkerV2Command.ApplyDiff))).Status);

                clock.Advance(TimeSpan.FromMinutes(15));
                await first.CheckpointIdleSessionsAsync();

                stored = Assert.IsType<StoredSessionRecoveryManifest>(await store.LoadAsync(key));
                Assert.Equal(Path.GetFullPath(outputPath), stored.Manifest.OutputPath);
                Assert.True(File.Exists(outputPath));
            }

            AddUnmarkedUserShape(outputPath);

            await using (var secondEngine = new VisioComEngine(new VisioComEngineOptions(OutputRoot: outputRoot)))
            await using (var secondBackend = secondEngine.CreateSessionBackend())
            await using (var second = new LongLivedWorkerRuntime(secondBackend, store, clock, TimeSpan.FromMinutes(15), capacity: 1))
            {
                Assert.Equal("succeeded", (await second.ProcessAsync(Recover("recover-fresh", session))).Status);
                Assert.Equal("succeeded", (await second.ProcessAsync(Apply("apply-classifier", session, "classifier-op", Network("classifier", "Classifier"), WorkerV2Command.ApplyDiff))).Status);
                Assert.Equal("succeeded", (await second.ProcessAsync(Save("save-final", session, outputPath))).Status);
                Assert.Equal("succeeded", (await second.ProcessAsync(Close("close-final", session, "save"))).Status);
            }

            AssertIndependentVsdxReadback(outputPath, stored.Manifest.Document, session);
            await AssertNoVisioProcessesAsync();
            succeeded = true;
        }
        catch (Exception error)
        {
            primaryFailure = error;
            Console.Error.WriteLine($"Live Visio acceptance failed; preserving VSDX evidence at: {outputRoot}");
            throw new XunitException($"Live Visio acceptance failed; VSDX evidence was preserved at '{outputRoot}'. {error}");
        }
        finally
        {
            try
            {
                await AssertNoVisioProcessesAsync();
            }
            catch (Exception cleanupError) when (primaryFailure is not null)
            {
                Console.Error.WriteLine($"Live Visio acceptance also left a process after its primary failure: {cleanupError.Message}");
            }
            if (succeeded) await DeleteOutputDirectoryAsync(outputRoot);
        }
    }

    [LiveVisioFact]
    public async Task Visible_session_keeps_one_vsdx_page_open_through_apply_diff_until_explicit_close()
    {
        AssertNoVisioProcesses();

        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-live-visible-visio-session-" + Guid.NewGuid().ToString("N"));
        var outputPath = Path.Combine(outputRoot, "visible-session.vsdx");
        Directory.CreateDirectory(outputRoot);
        var succeeded = false;
        Exception? primaryFailure = null;

        try
        {
            var clock = new LiveWorkerClock(DateTimeOffset.Parse("2026-08-19T00:00:00Z"));
            var session = new WorkerV2Session("visible-tenant", "visible-user", "visible-device", "visible-workflow");
            var key = session.ToKey();
            var store = new SessionRecoveryManifestStore(outputRoot);

            await using (var engine = new VisioComEngine(new VisioComEngineOptions(Visible: true, OutputRoot: outputRoot)))
            await using (var backend = engine.CreateSessionBackend())
            await using (var runtime = new LongLivedWorkerRuntime(backend, store, clock, TimeSpan.FromMinutes(15), capacity: 1))
            {
                Assert.Equal("succeeded", (await runtime.ProcessAsync(Open("visible-open", session, outputPath))).Status);
                Assert.Equal("succeeded", (await runtime.ProcessAsync(Apply("visible-apply", session, "visible-encoder-op", Network("visible-encoder", "Visible Encoder"), WorkerV2Command.Apply))).Status);
                Assert.Equal("succeeded", (await runtime.ProcessAsync(Save("visible-save", session, outputPath))).Status);

                var beforeDiff = Assert.IsType<StoredSessionRecoveryManifest>(await store.LoadAsync(key)).Manifest.Document;
                await AssertVisibleVisioWindowAsync();

                Assert.Equal("succeeded", (await runtime.ProcessAsync(Apply("visible-diff", session, "visible-classifier-op", Network("visible-classifier", "Visible Classifier"), WorkerV2Command.ApplyDiff))).Status);
                Assert.Equal("succeeded", (await runtime.ProcessAsync(Save("visible-save-after-diff", session, outputPath))).Status);

                var afterDiff = Assert.IsType<StoredSessionRecoveryManifest>(await store.LoadAsync(key)).Manifest.Document;
                Assert.Equal(beforeDiff.NativeDocumentIdentity, afterDiff.NativeDocumentIdentity);
                Assert.Equal(beforeDiff.NativePageIdentity, afterDiff.NativePageIdentity);
                Assert.True(File.Exists(outputPath));
                await AssertVisibleVisioWindowAsync();

                Assert.Equal("succeeded", (await runtime.ProcessAsync(Close("visible-close", session, "save"))).Status);
            }

            await AssertNoVisioProcessesAsync();
            succeeded = true;
        }
        catch (Exception error)
        {
            primaryFailure = error;
            Console.Error.WriteLine($"Visible live Visio acceptance failed; preserving VSDX evidence at: {outputRoot}");
            throw new XunitException($"Visible live Visio acceptance failed; VSDX evidence was preserved at '{outputRoot}'. {error}");
        }
        finally
        {
            try
            {
                await AssertNoVisioProcessesAsync();
            }
            catch (Exception cleanupError) when (primaryFailure is not null)
            {
                Console.Error.WriteLine($"Visible live Visio acceptance also left a process after its primary failure: {cleanupError.Message}");
            }
            if (succeeded) await DeleteOutputDirectoryAsync(outputRoot);
        }
    }

    private static WorkerV2Request Open(string requestId, WorkerV2Session session, string outputPath) =>
        new(requestId, WorkerV2Command.Open, session, outputPath, null, null, null, null);

    private static WorkerV2Request Apply(string requestId, WorkerV2Session session, string operationId, DiagramEnvelope diagram, WorkerV2Command command) =>
        new(requestId, command, session, null, operationId, DiagramPlanDigest.Compute(DiagramMapper.Map(diagram)), diagram, null);

    private static WorkerV2Request Recover(string requestId, WorkerV2Session session) =>
        new(requestId, WorkerV2Command.Recover, session, null, null, null, null, null);

    private static WorkerV2Request Save(string requestId, WorkerV2Session session, string outputPath) =>
        new(requestId, WorkerV2Command.Save, session, outputPath, null, null, null, null);

    private static WorkerV2Request Close(string requestId, WorkerV2Session session, string disposition) =>
        new(requestId, WorkerV2Command.Close, session, null, null, null, null, disposition);

    private static DiagramEnvelope Network(string prefix, string label)
    {
        var outputId = prefix + "-output";
        return new DiagramEnvelope
        {
            Figure = new DiagramFigure { Title = "Live " + label + " network", StageLabels = [label, "Output"] },
            Nodes =
            [
                new DiagramNode { Id = prefix, Kind = "conv", Label = label, Stage = 0, X = 80, Y = 220, Width = 130, Height = 90, TensorShape = "64×56×56", VisualRole = "standard", LayerRole = "network-node", RepeatCount = 1, Depth = 1, Color = "#4f86c6" },
                new DiagramNode { Id = outputId, Kind = "linear", Label = label + " Output", Stage = 1, X = 330, Y = 220, Width = 130, Height = 90, TensorShape = "10", VisualRole = "standard", LayerRole = "network-node", RepeatCount = 1, Depth = 1, Color = "#6a9f8d" },
            ],
            Edges =
            [
                new DiagramEdge { Id = prefix + "-edge", Source = prefix, Target = outputId, Kind = "signal", Points = [new DiagramPoint(210, 265), new DiagramPoint(330, 265)] },
            ],
        };
    }

    private static void AddUnmarkedUserShape(string outputPath)
    {
        dynamic? application = null;
        dynamic? documents = null;
        dynamic? document = null;
        dynamic? page = null;
        dynamic? shape = null;
        try
        {
            application = CreateIsolatedVisioApplication();
            documents = application.Documents;
            document = documents.Open(outputPath);
            page = document.Pages.Item(1);
            shape = page.DrawRectangle(0.4, 0.4, 1.8, 0.9);
            shape.NameU = "user.shape.keep";
            shape.Text = "User-authored shape must survive";
            document.Save();
            document.Close();
            document = null;
        }
        finally
        {
            TryClose(document);
            TryQuit(application);
            ReleaseCom(shape);
            ReleaseCom(page);
            ReleaseCom(document);
            ReleaseCom(documents);
            ReleaseCom(application);
        }
    }

    private static void AssertIndependentVsdxReadback(string outputPath, VisioSessionDocument expectedDocument, WorkerV2Session session)
    {
        dynamic? application = null;
        dynamic? documents = null;
        dynamic? document = null;
        dynamic? page = null;
        dynamic? documentSheet = null;
        dynamic? pageSheet = null;
        dynamic? shapes = null;
        try
        {
            application = CreateIsolatedVisioApplication();
            documents = application.Documents;
            document = documents.Open(outputPath);
            page = document.Pages.Item(1);
            documentSheet = document.DocumentSheet;
            pageSheet = page.PageSheet;
            shapes = page.Shapes;

            Assert.Equal(Path.GetFullPath(outputPath), Path.GetFullPath(Convert.ToString(document.FullName)!));
            Assert.Equal(expectedDocument.NativeDocumentIdentity, ReadShapeData(documentSheet, "synapse.workerDocumentIdentity"));
            Assert.Equal(expectedDocument.NativePageIdentity, ReadShapeData(pageSheet, "synapse.workerPageIdentity"));

            var namedShapes = new Dictionary<string, List<ShapeReadback>>(StringComparer.OrdinalIgnoreCase);
            var count = Convert.ToInt32(shapes.Count);
            for (var index = 1; index <= count; index++)
            {
                dynamic? shape = null;
                try
                {
                    shape = shapes.Item(index);
                    var name = Convert.ToString(shape.NameU) ?? "";
                    if (!namedShapes.TryGetValue(name, out List<ShapeReadback> values))
                    {
                        values = [];
                        namedShapes.Add(name, values);
                    }
                    values.Add(new ShapeReadback(Convert.ToString(shape.Text) ?? "", ReadShapeData(shape, "synapse.sessionOwner"), ReadShapeData(shape, "synapse.nodeId"), ReadShapeData(shape, "synapse.layerRole")));
                }
                finally
                {
                    ReleaseCom(shape);
                }
            }

            var owner = SessionOwner(session);
            var classifier = SingleShape(namedShapes, "synapse.node.classifier");
            Assert.Equal("classifier", classifier.NodeId);
            Assert.Equal("network-node", classifier.LayerRole);
            Assert.Equal(owner, classifier.SessionOwner);
            Assert.Contains("Classifier", SingleShape(namedShapes, "synapse.label.classifier").Text, StringComparison.Ordinal);
            Assert.Equal(owner, SingleShape(namedShapes, "synapse.edge.classifier_edge").SessionOwner);
            Assert.Equal("User-authored shape must survive", SingleShape(namedShapes, "user.shape.keep").Text);
            Assert.Null(SingleShape(namedShapes, "user.shape.keep").SessionOwner);
            Assert.False(namedShapes.ContainsKey("synapse.node.encoder"));
            Assert.False(namedShapes.ContainsKey("synapse.node.decoder"));
            Assert.False(namedShapes.ContainsKey("synapse.edge.encoder-edge"));
            Assert.False(namedShapes.ContainsKey("synapse.edge.decoder-edge"));
        }
        finally
        {
            TryClose(document);
            TryQuit(application);
            ReleaseCom(shapes);
            ReleaseCom(pageSheet);
            ReleaseCom(documentSheet);
            ReleaseCom(page);
            ReleaseCom(document);
            ReleaseCom(documents);
            ReleaseCom(application);
        }
    }

    private static ShapeReadback SingleShape(IReadOnlyDictionary<string, List<ShapeReadback>> namedShapes, string name)
    {
        Assert.True(namedShapes.TryGetValue(name, out var shapes), $"Independent VSDX readback did not find '{name}'.");
        return Assert.Single(shapes!);
    }

    private static dynamic CreateIsolatedVisioApplication()
    {
        var type = Type.GetTypeFromProgID("Visio.Application", throwOnError: false) ?? throw new XunitException("Visio.Application is not registered on this host.");
        dynamic application = Activator.CreateInstance(type) ?? throw new XunitException("Visio.Application could not be created for independent VSDX readback.");
        application.Visible = false;
        application.AlertResponse = 1;
        return application;
    }

    private static string? ReadShapeData(dynamic shape, string key)
    {
        dynamic? cell = null;
        try
        {
            var rowName = new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
            if (Convert.ToInt32(shape.CellExistsU($"Prop.{rowName}", 0)) == 0) return null;
            cell = shape.CellsU($"Prop.{rowName}");
            return Convert.ToString(cell.ResultStr[0]);
        }
        finally
        {
            ReleaseCom(cell);
        }
    }

    private static string SessionOwner(WorkerV2Session session)
    {
        var identity = string.Join("\n", session.TenantId, session.UserId, session.DeviceId, session.WorkflowId);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
    }

    private static void AssertNoVisioProcesses()
    {
        var processes = Process.GetProcessesByName("VISIO");
        try
        {
            Assert.Empty(processes);
        }
        finally
        {
            foreach (var process in processes) process.Dispose();
        }
    }

    private static async Task AssertNoVisioProcessesAsync()
    {
        var deadline = DateTime.UtcNow + VisioExitTimeout;
        do
        {
            var processes = Process.GetProcessesByName("VISIO");
            try
            {
                if (processes.Length == 0) return;
            }
            finally
            {
                foreach (var process in processes) process.Dispose();
            }
            await Task.Delay(TimeSpan.FromMilliseconds(500));
        }
        while (DateTime.UtcNow < deadline);
        AssertNoVisioProcesses();
    }

    private static async Task AssertVisibleVisioWindowAsync()
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var processes = Process.GetProcessesByName("VISIO");
            try
            {
                if (processes.Length == 1
                    && processes[0].MainWindowHandle != IntPtr.Zero
                    && IsWindowVisible(processes[0].MainWindowHandle)) return;
            }
            finally
            {
                foreach (var process in processes) process.Dispose();
            }

            await Task.Delay(TimeSpan.FromMilliseconds(250));
        }

        throw new XunitException("Visible Worker session did not expose exactly one visible Visio window.");
    }

    private static async Task DeleteOutputDirectoryAsync(string outputRoot)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
                return;
            }
            catch (IOException) when (attempt < 8)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250));
            }
        }
    }

    private static void TryClose(dynamic? document)
    {
        if (document is null) return;
        try { document.Close(); }
        catch { }
    }

    private static void TryQuit(dynamic? application)
    {
        if (application is null) return;
        try { application.Quit(); }
        catch { }
    }

    private static void ReleaseCom(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    private sealed class LiveWorkerClock(DateTimeOffset utcNow) : IWorkerClock
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan elapsed) => UtcNow = UtcNow.Add(elapsed);
    }

    private sealed record ShapeReadback(string Text, string? SessionOwner, string? NodeId, string? LayerRole);

    private sealed class LiveVisioFactAttribute : FactAttribute
    {
        public LiveVisioFactAttribute()
        {
            if (!string.Equals(Environment.GetEnvironmentVariable(EnableEnvironmentVariable), "1", StringComparison.Ordinal))
            {
                Skip = $"Set {EnableEnvironmentVariable}=1 to run this controlled installed-Visio acceptance test.";
            }
        }
    }
}
