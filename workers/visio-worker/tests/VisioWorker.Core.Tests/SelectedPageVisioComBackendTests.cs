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
        application.ActiveWindow!.Page = changedPage;

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

    [Fact]
    public void Native_readback_rejects_an_empty_final_namespace_when_a_promoted_entry_is_expected()
    {
        using var fixture = CreateNativeReadbackFixture(new FakeShape(10));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
        Assert.Equal([1], fixture.Page.Shapes.VisitedIndices);
    }

    [Fact]
    public void Native_readback_rejects_a_missing_expected_final_owned_shape()
    {
        using var fixture = CreateNativeReadbackFixture(OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary), Entry(11, ["semantic:b"], SelectedPageShapeRole.Label));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_rejects_an_unexpected_extra_final_owned_shape()
    {
        using var fixture = CreateNativeReadbackFixture(
            OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary),
            OwnedShape(11, ["semantic:b"], SelectedPageShapeRole.Label));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_rejects_duplicate_native_shape_ids_in_the_final_namespace()
    {
        using var fixture = CreateNativeReadbackFixture(
            OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary),
            OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_rejects_an_empty_semantic_mapping_in_the_final_namespace()
    {
        using var fixture = CreateNativeReadbackFixture(OwnedShape(10, [], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_rejects_a_wrong_semantic_mapping_in_the_final_namespace()
    {
        using var fixture = CreateNativeReadbackFixture(OwnedShape(10, ["semantic:other"], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_rejects_a_wrong_renderer_role_in_the_final_namespace()
    {
        using var fixture = CreateNativeReadbackFixture(OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Label));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
    }

    [Fact]
    public void Native_readback_ignores_and_counts_an_unrelated_user_shape()
    {
        using var fixture = CreateNativeReadbackFixture(
            new FakeShape(99),
            OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        var readback = fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace);

        Assert.True(readback.Valid);
        Assert.Equal(1, readback.UserOwnedShapeCount);
        Assert.Single(readback.AgentOwnedShapes);
    }

    [Fact]
    public void Native_readback_accepts_all_exact_promoted_entries()
    {
        using var fixture = CreateNativeReadbackFixture(
            OwnedShape(10, ["semantic:b", "semantic:a"], SelectedPageShapeRole.Primary),
            OwnedShape(11, ["semantic:c"], SelectedPageShapeRole.Label));
        SetExpectedPromotedManifest(
            fixture.Native,
            fixture.Target,
            Entry(10, ["semantic:a", "semantic:b"], SelectedPageShapeRole.Primary),
            Entry(11, ["semantic:c"], SelectedPageShapeRole.Label));

        var readback = fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace);

        Assert.True(readback.Valid);
        Assert.Equal(["10", "11"], readback.AgentOwnedShapes.Select(shape => shape.NativeShapeId));
        Assert.Equal(["semantic:a", "semantic:b"], readback.AgentOwnedShapes[0].SourceMappingSemanticIds);
    }

    [Fact]
    public void Native_save_requires_a_successful_pre_save_exact_readback()
    {
        using var fixture = CreateNativeReadbackFixture(OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);

        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace);
        fixture.Native.SaveSelectedDocument(fixture.Target);

        Assert.Equal(1, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_same_target_reattach_revokes_successful_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();

        var reattached = fixture.Native.AttachActiveSelection();

        Assert.Equal(fixture.Target, reattached);
        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_null_selection_attach_revokes_successful_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        fixture.Application.ActiveWindow = null;

        Assert.Null(fixture.Native.AttachActiveSelection());
        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_failed_attach_revokes_successful_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        fixture.Application.ActiveWindowError = new InvalidOperationException("Visio active window failed");

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.AttachActiveSelection());
        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_blank_namespace_apply_revokes_successful_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();

        Assert.Throws<ArgumentException>(() => fixture.Native.ApplyOwnedRegion(
            fixture.Target,
            " ",
            new PreparedSelectedPageRegion(fixture.Target, Plan())));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_prepared_target_mismatch_apply_revokes_successful_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        var differentTarget = fixture.Target with { PageId = "page-other" };

        Assert.Throws<InvalidOperationException>(() => fixture.Native.ApplyOwnedRegion(
            fixture.Target,
            OwnershipNamespace,
            new PreparedSelectedPageRegion(differentTarget, Plan())));

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_failed_pre_save_read_cannot_authorize_save()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        fixture.Shape!.SetShapeData("synapse.sourceMappingSemanticIds", "semantic:other");

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));
        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_pre_save_authorization_is_single_use()
    {
        using var fixture = CreatePreSaveVerifiedFixture();

        fixture.Native.SaveSelectedDocument(fixture.Target);

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(1, fixture.Document.SaveCalls);
    }

    [Fact]
    public void Native_failed_post_save_read_preserves_the_saved_manifest_hash()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        fixture.Native.SaveSelectedDocument(fixture.Target);
        fixture.Shape!.SetShapeData("synapse.sourceMappingSemanticIds", "semantic:other");

        Assert.Throws<WorkerProtocolException>(() => fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace));

        Assert.NotNull(GetPrivateField(fixture.Native, "_savedManifestHash"));
    }

    [Fact]
    public void Native_successful_post_save_read_does_not_create_new_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        fixture.Native.SaveSelectedDocument(fixture.Target);

        var readback = fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace);

        Assert.True(readback.Valid);
        Assert.Throws<WorkerProtocolException>(() => fixture.Native.SaveSelectedDocument(fixture.Target));
        Assert.Equal(1, fixture.Document.SaveCalls);
    }

    [Fact]
    public async Task Backend_active_target_revalidation_does_not_revoke_native_pre_save_authorization()
    {
        using var fixture = CreatePreSaveVerifiedFixture();
        await using var backend = new SelectedPageVisioComBackend(fixture.Native);

        await backend.SaveSelectedDocumentAsync(fixture.Target);

        Assert.Equal(1, fixture.Document.SaveCalls);
    }

    private static DiagramDocument Plan() => new("Selected page test", [], [], []);

    private static NativeReadbackFixture CreateNativeReadbackFixture(params FakeShape[] shapes)
    {
        var document = new FakeDocument("101", "drawing.vsdx");
        var page = new FakePage("1", "Architecture", document, new FakeShapes(shapes));
        var application = new FakeApplication(page);
        var native = new SelectedPageVisioComNative(new VisioComEngineOptions());
        SetPrivateField(native, "_application", application);
        var target = Assert.IsType<SelectedPageTarget>(native.AttachActiveSelection());
        return new NativeReadbackFixture(native, target, document, page, application, shapes.FirstOrDefault());
    }

    private static NativeReadbackFixture CreatePreSaveVerifiedFixture()
    {
        var fixture = CreateNativeReadbackFixture(OwnedShape(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        SetExpectedPromotedManifest(fixture.Native, fixture.Target, Entry(10, ["semantic:a"], SelectedPageShapeRole.Primary));
        fixture.Native.ReadSelectedPage(fixture.Target, OwnershipNamespace);
        return fixture;
    }

    private static FakeShape OwnedShape(int id, IReadOnlyList<string> semanticIds, SelectedPageShapeRole role) =>
        new(id, shapeData: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["synapse.sessionOwner"] = OwnershipNamespace,
            ["synapse.sourceMappingSemanticIds"] = string.Join(",", semanticIds),
            ["synapse.rendererRole"] = role.ToString(),
        });

    private static SelectedPageShapeCreationEntry Entry(int id, IReadOnlyList<string> semanticIds, SelectedPageShapeRole role) =>
        new(id, semanticIds, role);

    private static void SetExpectedPromotedManifest(
        SelectedPageVisioComNative native,
        SelectedPageTarget target,
        params SelectedPageShapeCreationEntry[] entries) =>
        SetPrivateField(native, "_expectedPromotedManifest", new SelectedPagePromotedRegionManifest(target, OwnershipNamespace, entries));

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
        private FakeWindow? _activeWindow = new(page);

        public bool Visible { get; set; }
        public Exception? ActiveWindowError { get; set; }

        public FakeWindow? ActiveWindow
        {
            get
            {
                if (ActiveWindowError is not null) throw ActiveWindowError;
                return _activeWindow;
            }
            set => _activeWindow = value;
        }
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
        public int SaveCalls { get; private set; }

        public void Save() => SaveCalls++;
    }

    public sealed class FakePages
    {
        public int Count => 2;
    }

    public sealed class FakePage(string id, string name, FakeDocument document, FakeShapes? shapes = null)
    {
        public string ID { get; } = id;
        public string Name { get; } = name;
        public FakeDocument Document { get; } = document;
        public FakeShapes Shapes { get; } = shapes ?? new FakeShapes();
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

    public sealed class FakeShape(int id, Exception? deleteError = null, IReadOnlyDictionary<string, string>? shapeData = null)
    {
        private List<FakeShape>? _owner;
        private readonly Dictionary<string, string> _shapeData = shapeData is null
            ? new Dictionary<string, string>(StringComparer.Ordinal)
            : new Dictionary<string, string>(shapeData, StringComparer.Ordinal);

        public int ID { get; } = id;

        public void Attach(List<FakeShape> owner) => _owner = owner;

        public void Delete()
        {
            if (deleteError is not null) throw deleteError;
            _owner!.Remove(this);
        }

        public void SetShapeData(string key, string value) => _shapeData[key] = value;

        public int CellExistsU(string name, int section) => FindShapeDataKey(name) is null ? 0 : 1;

        public FakeCell CellsU(string name) => new(_shapeData[ShapeDataKey(name)]);

        private string ShapeDataKey(string cellName) => FindShapeDataKey(cellName)
            ?? throw new InvalidOperationException("The requested shape-data cell does not exist.");

        private string? FindShapeDataKey(string cellName)
        {
            var rowName = cellName[5..];
            return _shapeData.Keys.SingleOrDefault(key => string.Equals(
                new string(key.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray()),
                rowName,
                StringComparison.Ordinal));
        }
    }

    public sealed class FakeCell(string value)
    {
        public string[] ResultStr { get; } = [value];
    }

    private sealed class NativeReadbackFixture(
        SelectedPageVisioComNative native,
        SelectedPageTarget target,
        FakeDocument document,
        FakePage page,
        FakeApplication application,
        FakeShape? shape) : IDisposable
    {
        public SelectedPageVisioComNative Native { get; } = native;
        public SelectedPageTarget Target { get; } = target;
        public FakeDocument Document { get; } = document;
        public FakePage Page { get; } = page;
        public FakeApplication Application { get; } = application;
        public FakeShape? Shape { get; } = shape;
        public void Dispose() => Native.Dispose();
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

        public void RevalidateActiveSelection(SelectedPageTarget target)
        {
            var actual = AttachActiveSelection()
                ?? throw new InvalidOperationException("The selected Visio page is no longer active.");
            if (!EqualityComparer<SelectedPageTarget>.Default.Equals(target, actual))
            {
                throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
            }
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
