using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageVisioComBackendTests
{
    private const string OwnershipNamespace = "agent.region.one";
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
        await backend.ApplyOwnedRegionAsync(attached!, OwnershipNamespace, Plan());
        var readback = await backend.ReadSelectedPageAsync(Target, OwnershipNamespace);

        Assert.Equal(Target, attached);
        Assert.Equal(["prepare", "apply"], operations.ApplyEvents);
        Assert.Equal(1, operations.PrepareOwnedRegionCalls);
        Assert.Equal(1, operations.ApplyOwnedRegionCalls);
        Assert.Equal(OwnershipNamespace, operations.LastOwnershipNamespace);
        Assert.Equal(3, readback.UserOwnedShapeCount);
        Assert.Equal(4, readback.AgentOwnedShapes.Count);
        Assert.Equal(0, operations.DocumentsAddCalls);
        Assert.Equal(0, operations.PagesAddCalls);
        Assert.Equal(0, operations.SaveAsCalls);
    }

    [Fact]
    public async Task Preparation_failure_never_enters_native_reconciliation()
    {
        var operations = new RecordingOperations
        {
            ActiveTarget = Target,
            PreparationError = new WorkerProtocolException("Selected page cannot preserve readable labels."),
        };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        var error = await Assert.ThrowsAsync<WorkerProtocolException>(
            () => backend.ApplyOwnedRegionAsync(Target, OwnershipNamespace, Plan()));

        Assert.Contains("readable", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(["prepare"], operations.ApplyEvents);
        Assert.Equal(1, operations.PrepareOwnedRegionCalls);
        Assert.Equal(0, operations.ApplyOwnedRegionCalls);
    }

    [Fact]
    public async Task Prepared_region_for_a_different_target_is_rejected_before_native_reconciliation()
    {
        var operations = new RecordingOperations
        {
            ActiveTarget = Target,
            PreparedTarget = Target with { PageFingerprint = new string('c', 64) },
        };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => backend.ApplyOwnedRegionAsync(Target, OwnershipNamespace, Plan()));

        Assert.Contains("prepared", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(["prepare"], operations.ApplyEvents);
        Assert.Equal(1, operations.PrepareOwnedRegionCalls);
        Assert.Equal(0, operations.ApplyOwnedRegionCalls);
    }

    [Fact]
    public async Task Active_selection_changed_during_preparation_is_rechecked_before_native_reconciliation()
    {
        var changedTarget = Target with { PageId = "page-2", PageFingerprint = new string('d', 64) };
        var operations = new RecordingOperations
        {
            ActiveTarget = Target,
            ActiveTargetAfterPrepare = changedTarget,
        };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => backend.ApplyOwnedRegionAsync(Target, OwnershipNamespace, Plan()));

        Assert.Contains("changed", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(["prepare"], operations.ApplyEvents);
        Assert.Equal(3, operations.AttachActiveSelectionCalls);
        Assert.Equal(0, operations.ApplyOwnedRegionCalls);
    }

    [Fact]
    public async Task Readback_requests_only_the_attached_ownership_namespace()
    {
        var operations = new RecordingOperations { ActiveTarget = Target };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();

        await backend.ReadSelectedPageAsync(Target, OwnershipNamespace);

        Assert.Equal(OwnershipNamespace, operations.LastReadOwnershipNamespace);
    }

    [Fact]
    public async Task Changed_document_page_or_fingerprint_is_rejected_before_native_reconciliation()
    {
        var operations = new RecordingOperations { ActiveTarget = Target };
        await using var backend = new SelectedPageVisioComBackend(operations);
        await backend.AttachActiveSelectionAsync();
        operations.ActiveTarget = Target with { PageFingerprint = new string('c', 64) };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => backend.ApplyOwnedRegionAsync(Target, OwnershipNamespace, Plan()));

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

    [Fact]
    public void Native_selected_page_operations_use_the_exact_shape_mutation_contract()
    {
        Assert.True(typeof(ISelectedPageShapeMutation).IsAssignableFrom(typeof(SelectedPageVisioComNative)));

        var methods = typeof(ISelectedPageShapeMutation).GetMethods();
        Assert.DoesNotContain(methods, method => method.Name == "ReadShapeIds");
        var draw = Assert.Single(methods, method => method.Name == "DrawPrepared");
        Assert.True(draw.IsAbstract);
        Assert.Equal(
            [typeof(PreparedSelectedPageRegion), typeof(SelectedPageShapeCreationJournal)],
            draw.GetParameters().Select(parameter => parameter.ParameterType));
        var revalidate = Assert.Single(methods, method => method.Name == "RevalidateActiveTarget");
        Assert.Equal([typeof(SelectedPageTarget)], revalidate.GetParameters().Select(parameter => parameter.ParameterType));
        var delete = Assert.Single(methods, method => method.Name == "DeleteShapes");
        Assert.Equal(typeof(SelectedPageShapeDeletionOutcome), delete.ReturnType);
    }

    [Fact]
    public void Native_selected_page_source_mapping_uses_the_creation_manifest_not_shape_names_or_all_nodes()
    {
        var sourcePath = Path.Combine(
            RepositoryRoot(),
            "workers",
            "visio-worker",
            "src",
            "VisioWorker.Live",
            "SelectedPageVisioComBackend.cs");
        var source = File.ReadAllText(sourcePath);

        Assert.Contains("synapse.rendererRole", source, StringComparison.Ordinal);
        Assert.DoesNotContain("return plan.Nodes", source, StringComparison.Ordinal);
        Assert.DoesNotContain("SourceMappingSemanticIds(object shape, DiagramDocument plan)", source, StringComparison.Ordinal);
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, ".git"))
                || Directory.Exists(Path.Combine(directory.FullName, ".git")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("The test assembly is not running beneath a Git worktree.");
    }

    [Fact]
    public void Native_target_revalidation_reads_the_active_window_page_afresh()
    {
        var document = new FakeDocument("101", "drawing.vsdx");
        var originalPage = new FakePage("1", "Architecture", document);
        var changedPage = new FakePage("2", "Other", document);
        var application = new FakeApplication(originalPage);
        using var native = new SelectedPageVisioComNative(new VisioComEngineOptions());
        SetPrivateField(native, "_application", application);
        var attached = Assert.IsType<SelectedPageTarget>(native.AttachActiveSelection());
        application.ActiveWindow.Page = changedPage;

        var error = Assert.Throws<WorkerProtocolException>(() =>
            ((ISelectedPageShapeMutation)native).RevalidateActiveTarget(attached));

        Assert.Contains("changed", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Same(originalPage, GetPrivateField(native, "_page"));
        Assert.Same(document, GetPrivateField(native, "_document"));
    }

    [Fact]
    public void Native_exact_id_deletion_continues_after_failure_and_classifies_missing_ids()
    {
        var shapes = new FakeShapes(
            new FakeShape(10),
            new FakeShape(11, deleteError: new InvalidOperationException("locked")));
        var page = new FakeDeletionPage(shapes);
        var method = typeof(SelectedPageVisioComNative).GetMethod(
            "DeleteShapes",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(method);
        var outcome = Assert.IsType<SelectedPageShapeDeletionOutcome>(
            method.Invoke(null, [page, new HashSet<int> { 10, 11, 12 }]));

        Assert.Equal([10, 11, 12], outcome.RequestedShapeIds.Order());
        Assert.Equal([10], outcome.DeletedShapeIds.Order());
        Assert.Equal([12], outcome.MissingShapeIds.Order());
        Assert.Equal([11], outcome.FailedShapeIds.Order());
        Assert.Equal([11], shapes.ShapeIds.Order());
    }

    [Fact]
    public void Native_exact_id_deletion_classifies_all_uncertain_ids_as_failed_after_incomplete_enumeration()
    {
        var shapes = new FakeShapes(
            new FakeShape(99),
            new FakeShape(11),
            new FakeShape(10))
        {
            ThrowOnItemIndex = 2,
        };
        var page = new FakeDeletionPage(shapes);
        var method = typeof(SelectedPageVisioComNative).GetMethod(
            "DeleteShapes",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(method);
        var outcome = Assert.IsType<SelectedPageShapeDeletionOutcome>(
            method.Invoke(null, [page, new HashSet<int> { 10, 11, 12 }]));

        Assert.Equal([10], outcome.DeletedShapeIds.Order());
        Assert.Empty(outcome.MissingShapeIds);
        Assert.Equal([11, 12], outcome.FailedShapeIds.Order());
        Assert.Equal([3, 2, 1], shapes.VisitedIndices);
    }

    [Fact]
    public void Staging_namespace_is_stable_target_bound_and_distinct_from_the_final_namespace()
    {
        var method = typeof(SelectedPageVisioComNative).GetMethod("StagingNamespace", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(method);
        var first = Assert.IsType<string>(method.Invoke(null, [Target, OwnershipNamespace]));
        var second = Assert.IsType<string>(method.Invoke(null, [Target, OwnershipNamespace]));
        var changed = Assert.IsType<string>(method.Invoke(null, [Target with { PageId = "page-2" }, OwnershipNamespace]));

        Assert.Matches("^[A-F0-9]{64}$", first);
        Assert.Equal(first, second);
        Assert.NotEqual(OwnershipNamespace, first);
        Assert.NotEqual(first, changed);
    }

    private static DiagramDocument Plan() => new("Selected page test", [], [], []);

    private static void SetPrivateField(object target, string name, object value)
    {
        var field = target.GetType().GetField(name, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(field);
        field.SetValue(target, value);
    }

    private static object? GetPrivateField(object target, string name)
    {
        var field = target.GetType().GetField(name, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(field);
        return field.GetValue(target);
    }

    public sealed class FakeApplication(FakePage page)
    {
        public bool Visible { get; set; }
        public FakeWindow ActiveWindow { get; } = new(page);
    }

    public sealed class FakeWindow(FakePage page)
    {
        public FakePage Page { get; set; } = page;
    }

    public sealed class FakeDocument(string id, string name)
    {
        public string ID { get; } = id;
        public string Name { get; } = name;
        public FakePages Pages { get; } = new();
    }

    public sealed class FakePages
    {
        public int Count => 2;
    }

    public sealed class FakePage(string id, string name, FakeDocument document)
    {
        public string ID { get; } = id;
        public string Name { get; } = name;
        public FakeDocument Document { get; } = document;
    }

    public sealed class FakeDeletionPage(FakeShapes shapes)
    {
        public FakeShapes Shapes { get; } = shapes;
    }

    public sealed class FakeShapes(params FakeShape[] shapes)
    {
        private readonly List<FakeShape> _shapes = [.. shapes];

        public int Count => _shapes.Count;

        public int? ThrowOnItemIndex { get; init; }

        public List<int> VisitedIndices { get; } = [];

        public IReadOnlyList<int> ShapeIds => _shapes.Select(shape => shape.ID).ToArray();

        public FakeShape Item(int index)
        {
            VisitedIndices.Add(index);
            if (index == ThrowOnItemIndex) throw new InvalidOperationException("enumeration interrupted");
            var shape = _shapes[index - 1];
            shape.Attach(_shapes);
            return shape;
        }
    }

    public sealed class FakeShape(int id, Exception? deleteError = null)
    {
        private List<FakeShape>? _owner;

        public int ID { get; } = id;

        public void Attach(List<FakeShape> owner) => _owner = owner;

        public void Delete()
        {
            if (deleteError is not null) throw deleteError;
            _owner!.Remove(this);
        }
    }

    private sealed class RecordingOperations : ISelectedPageVisioComOperations
    {
        public SelectedPageTarget? ActiveTarget { get; set; }
        public int EnsureVisibleApplicationCalls { get; private set; }
        public int AttachActiveSelectionCalls { get; private set; }
        public int PrepareOwnedRegionCalls { get; private set; }
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
        public string? LastReadOwnershipNamespace { get; private set; }
        public Exception? PreparationError { get; set; }
        public SelectedPageTarget? PreparedTarget { get; set; }
        public SelectedPageTarget? ActiveTargetAfterPrepare { get; set; }
        public List<string> ApplyEvents { get; } = [];

        public void EnsureVisibleApplication() => EnsureVisibleApplicationCalls++;

        public SelectedPageTarget? AttachActiveSelection()
        {
            AttachActiveSelectionCalls++;
            return ActiveTarget;
        }

        public PreparedSelectedPageRegion PrepareOwnedRegion(SelectedPageTarget target, DiagramDocument plan)
        {
            PrepareOwnedRegionCalls++;
            ApplyEvents.Add("prepare");
            if (PreparationError is not null) throw PreparationError;
            if (ActiveTargetAfterPrepare is not null) ActiveTarget = ActiveTargetAfterPrepare;
            return new PreparedSelectedPageRegion(PreparedTarget ?? target, plan);
        }

        public void ApplyOwnedRegion(SelectedPageTarget target, string ownershipNamespace, PreparedSelectedPageRegion preparedRegion)
        {
            ApplyOwnedRegionCalls++;
            ApplyEvents.Add("apply");
            LastOwnershipNamespace = ownershipNamespace;
        }

        public void SaveSelectedDocument(SelectedPageTarget target) => SaveCalls++;

        public SelectedPageReadback ReadSelectedPage(SelectedPageTarget target, string ownershipNamespace)
        {
            LastReadOwnershipNamespace = ownershipNamespace;
            return new SelectedPageReadback(
                true,
                target.DocumentId,
                target.PageId,
                target.DocumentFingerprint,
                target.PageFingerprint,
                target.ExpectedRevision,
                ownershipNamespace,
                UserShapeCount,
                Enumerable.Range(1, ExistingOwnedShapeCount)
                    .Select(index => new SelectedPageReadbackShape($"shape-{index}", ownershipNamespace, ["semantic-1"]))
                    .ToArray(),
                0);
        }

        public void ReleaseSession(SelectedPageTarget target) => ReleaseSessionCalls++;

        public void Dispose()
        {
        }
    }
}
