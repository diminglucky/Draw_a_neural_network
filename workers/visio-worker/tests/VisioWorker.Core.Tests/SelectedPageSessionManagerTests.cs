using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageSessionManagerTests
{
    private static readonly SelectedPageTarget Target = new(
        "document-1",
        "page-1",
        new string('a', 64),
        new string('b', 64),
        ExpectedRevision: 7);

    [Fact]
    public async Task Capture_reads_only_the_active_selected_page_and_releases_references_without_mutation()
    {
        var backend = new RecordingBackend { ActiveTarget = Target };
        var manager = new SelectedPageSessionManager(backend);

        var result = await manager.CaptureActiveSelectionAsync();

        Assert.Equal(SelectedPageSessionStatus.Attached, result.Status);
        Assert.Equal(Target, result.Target);
        Assert.Equal(1, backend.EnsureVisibleApplicationCalls);
        Assert.Equal(1, backend.AttachActiveSelectionCalls);
        Assert.Equal(1, backend.ReleaseSessionCalls);
        Assert.Equal(0, backend.ApplyCalls);
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Attach_without_an_open_selected_page_starts_visible_Visio_and_returns_waiting_without_creating_a_document()
    {
        var backend = new RecordingBackend { ActiveTarget = null };
        var manager = new SelectedPageSessionManager(backend);

        var result = await manager.AttachAsync(Target);

        Assert.Equal(SelectedPageSessionStatus.WaitingForSelection, result.Status);
        Assert.Null(result.Target);
        Assert.Equal(1, backend.EnsureVisibleApplicationCalls);
        Assert.Equal(1, backend.AttachActiveSelectionCalls);
        Assert.Equal(0, backend.ApplyCalls);
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Apply_replaces_only_the_requested_owned_region_after_revalidating_the_same_selected_page()
    {
        var backend = new RecordingBackend { ActiveTarget = Target, UserShapeCount = 3, ExistingOwnedShapeCount = 4 };
        var manager = new SelectedPageSessionManager(backend);
        await manager.AttachAsync(Target);

        await manager.ApplyOwnedRegionAsync("agent-region-1", Plan());

        Assert.Equal(2, backend.AttachActiveSelectionCalls);
        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal("agent-region-1", backend.LastOwnershipNamespace);
        Assert.Equal(3, backend.UserShapeCount);
        Assert.Equal(4, backend.ExistingOwnedShapeCount);
    }

    [Fact]
    public async Task Apply_rejects_a_changed_selected_page_before_the_owned_region_is_touched()
    {
        var backend = new RecordingBackend { ActiveTarget = Target };
        var manager = new SelectedPageSessionManager(backend);
        await manager.AttachAsync(Target);
        backend.ActiveTarget = Target with { PageFingerprint = new string('c', 64) };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => manager.ApplyOwnedRegionAsync("agent-region-1", Plan()));

        Assert.Contains("changed", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, backend.ApplyCalls);
    }

    [Fact]
    public async Task Save_and_readback_require_the_attached_target_and_never_use_an_output_path()
    {
        var backend = new RecordingBackend { ActiveTarget = Target, UserShapeCount = 2 };
        var manager = new SelectedPageSessionManager(backend);
        await manager.AttachAsync(Target);

        await manager.SaveSelectedDocumentAsync();
        var readback = await manager.ReadSelectedPageAsync();

        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(Target, backend.LastSavedTarget);
        Assert.Equal(Target, readback.Target);
        Assert.Equal(2, readback.UserShapeCount);
    }

    private static DiagramDocument Plan() => new("Current page test", [], [], []);

    private sealed class RecordingBackend : ISelectedPageSessionBackend
    {
        public SelectedPageTarget? ActiveTarget { get; set; }
        public int EnsureVisibleApplicationCalls { get; private set; }
        public int AttachActiveSelectionCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int ReleaseSessionCalls { get; private set; }
        public int UserShapeCount { get; set; }
        public int ExistingOwnedShapeCount { get; set; }
        public string? LastOwnershipNamespace { get; private set; }
        public SelectedPageTarget? LastSavedTarget { get; private set; }

        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default)
        {
            EnsureVisibleApplicationCalls++;
            return Task.CompletedTask;
        }

        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default)
        {
            AttachActiveSelectionCalls++;
            return Task.FromResult(ActiveTarget);
        }

        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default)
        {
            ApplyCalls++;
            LastOwnershipNamespace = ownershipNamespace;
            return Task.CompletedTask;
        }

        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            LastSavedTarget = target;
            return Task.CompletedTask;
        }

        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) =>
            Task.FromResult(new SelectedPageReadback(target, UserShapeCount, ExistingOwnedShapeCount, []));

        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            ReleaseSessionCalls++;
            return Task.CompletedTask;
        }
    }
}
