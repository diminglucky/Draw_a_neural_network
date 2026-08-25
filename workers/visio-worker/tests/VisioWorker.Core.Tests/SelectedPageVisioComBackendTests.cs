using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageVisioComBackendTests
{
    private static readonly SelectedPageTarget Target = new(
        "document-1",
        "page-1",
        new string('a', 64),
        new string('b', 64),
        ExpectedRevision: 7);

    [Fact]
    public async Task Missing_Visio_selection_starts_a_visible_application_without_creating_a_document_or_page()
    {
        var operations = new RecordingOperations { ActiveTarget = null };
        await using var backend = new SelectedPageVisioComBackend(operations);

        await backend.EnsureVisibleApplicationAsync();
        var attached = await backend.AttachActiveSelectionAsync();

        Assert.Null(attached);
        Assert.Equal(1, operations.EnsureVisibleApplicationCalls);
        Assert.Equal(1, operations.AttachActiveSelectionCalls);
        Assert.Equal(0, operations.DocumentsAddCalls);
        Assert.Equal(0, operations.PagesAddCalls);
        Assert.Equal(0, operations.SaveAsCalls);
    }

    [Fact]
    public async Task Attached_page_reconciles_only_the_exact_agent_namespace_and_preserves_user_shapes()
    {
        var operations = new RecordingOperations
        {
            ActiveTarget = Target,
            UserShapeCount = 3,
            ExistingOwnedShapeCount = 4,
        };
        await using var backend = new SelectedPageVisioComBackend(operations);

        var attached = await backend.AttachActiveSelectionAsync();
        await backend.ApplyOwnedRegionAsync(attached!, "agent.region.one", Plan());
        var readback = await backend.ReadSelectedPageAsync(Target);

        Assert.Equal(Target, attached);
        Assert.Equal(1, operations.ApplyOwnedRegionCalls);
        Assert.Equal("agent.region.one", operations.LastOwnershipNamespace);
        Assert.Equal(3, readback.UserShapeCount);
        Assert.Equal(4, readback.AgentOwnedShapeCount);
        Assert.Equal(0, operations.DocumentsAddCalls);
        Assert.Equal(0, operations.PagesAddCalls);
        Assert.Equal(0, operations.SaveAsCalls);
    }

    [Fact]
    public async Task Changed_document_page_or_fingerprint_is_rejected_before_native_reconciliation()
    {
        var operations = new RecordingOperations { ActiveTarget = Target };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();
        operations.ActiveTarget = Target with { PageFingerprint = new string('c', 64) };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => backend.ApplyOwnedRegionAsync(Target, "agent.region.one", Plan()));

        Assert.Contains("changed", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, operations.ApplyOwnedRegionCalls);
        Assert.Equal(0, operations.DocumentsAddCalls);
        Assert.Equal(0, operations.PagesAddCalls);
    }

    [Fact]
    public async Task Save_uses_the_selected_documents_Save_and_never_SaveAs()
    {
        var operations = new RecordingOperations { ActiveTarget = Target };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        await backend.SaveSelectedDocumentAsync(Target);

        Assert.Equal(1, operations.SaveCalls);
        Assert.Equal(0, operations.SaveAsCalls);
        Assert.Equal(0, operations.DocumentsAddCalls);
        Assert.Equal(0, operations.PagesAddCalls);
    }

    [Fact]
    public async Task Releasing_the_session_only_releases_COM_handles_and_never_closes_the_users_document()
    {
        var operations = new RecordingOperations { ActiveTarget = Target };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        await backend.ReleaseSessionAsync(Target);

        Assert.Equal(1, operations.ReleaseSessionCalls);
        Assert.Equal(0, operations.CloseDocumentCalls);
        Assert.Equal(0, operations.QuitApplicationCalls);
    }

    private static DiagramDocument Plan() => new("Selected page test", [], [], []);

    private sealed class RecordingOperations : ISelectedPageVisioComOperations
    {
        public SelectedPageTarget? ActiveTarget { get; set; }
        public int EnsureVisibleApplicationCalls { get; private set; }
        public int AttachActiveSelectionCalls { get; private set; }
        public int ApplyOwnedRegionCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int SaveAsCalls { get; private set; }
        public int DocumentsAddCalls { get; private set; }
        public int PagesAddCalls { get; private set; }
        public int CloseDocumentCalls { get; private set; }
        public int QuitApplicationCalls { get; private set; }
        public int ReleaseSessionCalls { get; private set; }
        public int UserShapeCount { get; set; }
        public int ExistingOwnedShapeCount { get; set; }
        public string? LastOwnershipNamespace { get; private set; }

        public void EnsureVisibleApplication() => EnsureVisibleApplicationCalls++;

        public SelectedPageTarget? AttachActiveSelection()
        {
            AttachActiveSelectionCalls++;
            return ActiveTarget;
        }

        public void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan)
        {
            ApplyOwnedRegionCalls++;
            LastOwnershipNamespace = ownershipNamespace;
        }

        public void SaveSelectedDocument(SelectedPageTarget target) => SaveCalls++;

        public SelectedPageReadback ReadSelectedPage(SelectedPageTarget target) =>
            new(target, UserShapeCount, ExistingOwnedShapeCount, []);

        public void ReleaseSession(SelectedPageTarget target) => ReleaseSessionCalls++;

        public void Dispose()
        {
        }
    }
}
