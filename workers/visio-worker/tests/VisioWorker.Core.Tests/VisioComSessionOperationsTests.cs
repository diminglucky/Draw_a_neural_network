using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class VisioComSessionOperationsTests
{
    [Fact]
    public async Task Concurrent_engine_session_backend_requests_share_one_adapter()
    {
        await using var engine = new VisioComEngine(new VisioComEngineOptions(OutputRoot: Path.GetTempPath()));
        using var start = new ManualResetEventSlim(false);
        var requests = Enumerable.Range(0, 32)
            .Select(_ => Task.Run(() =>
            {
                start.Wait();
                return engine.CreateSessionBackend();
            }))
            .ToArray();

        start.Set();
        var backends = await Task.WhenAll(requests);

        Assert.All(backends, backend => Assert.Same(backends[0], backend));
    }

    [Fact]
    public void Explicit_session_close_discards_unsaved_native_changes_instead_of_leaving_a_hidden_prompt()
    {
        Assert.True(VisioDocumentLifecycle.ShouldDiscardUnsavedChangesOnExplicitClose());
    }

    [Fact]
    public void Reuses_one_native_document_and_reconciles_only_previously_owned_semantic_shapes_on_the_same_page()
    {
        var native = new RecordingNativeSessionOperations();
        var operations = new VisioComSessionOperations(native);
        var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
        var first = LegacyPlan("encoder");
        var second = LegacyPlan("decoder");

        var document = operations.OpenOrCreate(key);
        var reused = operations.OpenOrCreate(key);
        operations.ApplyPlan(document, first);
        operations.ApplyPlanDiff(document, second);

        Assert.Equal(document, reused);
        Assert.Equal(1, native.OpenOrCreateCalls);
        Assert.Equal(2, native.ReplaceCalls);
        Assert.All(native.OwnershipMarkers, marker => Assert.Matches("^[A-F0-9]{64}$", marker));
        Assert.Single(native.OwnershipMarkers.Distinct(StringComparer.Ordinal));
        Assert.All(native.Documents, recorded => Assert.Equal(document, recorded));
    }

    [Fact]
    public void Save_close_and_recover_are_explicit_lifecycle_operations()
    {
        var native = new RecordingNativeSessionOperations();
        var operations = new VisioComSessionOperations(native);
        var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
        var document = operations.OpenOrCreate(key);

        var saved = operations.SaveAs(document, "C:\\exports\\session.partial.vsdx", "C:\\exports\\session.vsdx");
        operations.Close(saved);
        var recovered = operations.Recover(key, new VisioSessionRecoveryManifest(key, "C:\\exports\\session.vsdx", saved, null, []));
        operations.ApplyPlanDiff(recovered, LegacyPlan("recovered"));

        Assert.Equal(1, native.SaveCalls);
        Assert.Equal(("C:\\exports\\session.partial.vsdx", "C:\\exports\\session.vsdx"), native.SaveArguments.Single());
        Assert.Equal(1, native.CloseCalls);
        Assert.Equal(1, native.RecoverCalls);
        Assert.Single(native.OwnershipMarkers);
        Assert.Matches("^[A-F0-9]{64}$", native.OwnershipMarkers.Single());
        Assert.Equal(saved, recovered);
    }

    private static DiagramDocument LegacyPlan(string nodeId) => new(
        "Publication diagram",
        ["Encoder"],
        [new VisioNode(nodeId, "conv", "Encoder", null, 0, 1, 1, 1, 1, "", "standard", "network-node", 1, 1, false, null, new Dictionary<string, string>())],
        [new VisioConnector(nodeId + "-to-output", nodeId, "output", "signal", [new DiagramPoint(1, 1), new DiagramPoint(2, 1)])]);

    private sealed class RecordingNativeSessionOperations : IVisioComSessionNative
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ReplaceCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int RecoverCalls { get; private set; }
        public List<string> OwnershipMarkers { get; } = [];
        public List<VisioSessionDocument> Documents { get; } = [];
        public List<(string TemporaryPath, string FinalPath)> SaveArguments { get; } = [];

        public VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey)
        {
            OpenOrCreateCalls++;
            return new VisioSessionDocument("document-one", "page-one");
        }

        public void ReplaceOwnedShapes(VisioSessionDocument document, string ownershipMarker, DiagramDocument plan)
        {
            ReplaceCalls++;
            Documents.Add(document);
            OwnershipMarkers.Add(ownershipMarker);
        }

        public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath)
        {
            SaveCalls++;
            SaveArguments.Add((temporaryPath, finalPath));
            return document;
        }

        public void Close(VisioSessionDocument document) => CloseCalls++;

        public VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest)
        {
            RecoverCalls++;
            return manifest.Document;
        }
    }
}
