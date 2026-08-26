using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageSessionManagerTests
{
    private const string OwnershipNamespace = "agent-region-1";
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

        var result = await manager.AttachAsync(Target, OwnershipNamespace);

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
        await manager.AttachAsync(Target, OwnershipNamespace);

        await manager.ApplyOwnedRegionAsync(OwnershipNamespace, Plan());

        Assert.Equal(1, backend.AttachActiveSelectionCalls);
        Assert.Equal(1, backend.RevalidateAttachedTargetCalls);
        Assert.Equal(1, backend.ApplyCalls);
        Assert.Equal(OwnershipNamespace, backend.LastOwnershipNamespace);
        Assert.Equal(3, backend.UserShapeCount);
        Assert.Equal(4, backend.ExistingOwnedShapeCount);
    }

    [Fact]
    public async Task Apply_rejects_a_changed_selected_page_before_the_owned_region_is_touched()
    {
        var backend = new RecordingBackend { ActiveTarget = Target };
        var manager = new SelectedPageSessionManager(backend);
        await manager.AttachAsync(Target, OwnershipNamespace);
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
        await manager.AttachAsync(Target, OwnershipNamespace);

        await manager.SaveSelectedDocumentAsync();
        var readback = await manager.ReadSelectedPageAsync(OwnershipNamespace);

        Assert.Equal(1, backend.SaveCalls);
        Assert.Equal(Target, backend.LastSavedTarget);
        Assert.Equal(Target.DocumentId, readback.DocumentId);
        Assert.Equal(2, readback.UserOwnedShapeCount);
        Assert.Equal(OwnershipNamespace, backend.LastReadOwnershipNamespace);
    }

    [Fact]
    public async Task Composed_runtime_preserves_verification_state_across_revalidation_and_releases_once()
    {
        var document = new StatefulDocument("101", "drawing.vsdx");
        var page = new StatefulPage("1", "Architecture", document, width: 10, height: 6);
        var application = new StatefulApplication(page);
        using var native = new SelectedPageVisioComNative(new VisioComEngineOptions());
        SetPrivateField(native, "_application", application);
        var target = TargetFor(document, page);
        await using var liveBackend = new SelectedPageVisioComBackend(native);
        var backend = new ReleaseCountingBackend(liveBackend);
        await using var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier("composed-lifecycle-secret"));
        var binding = BindingFor(target);

        await runtime.ProcessAsync(Request("attach", SelectedPageWorkerCommand.AttachSelectedPage, binding));
        await runtime.ProcessAsync(ApplyRequest(binding));
        var preSave = await runtime.ProcessAsync(Request("read-before-save", SelectedPageWorkerCommand.ReadSelectedPage, binding));
        await runtime.ProcessAsync(Request("save", SelectedPageWorkerCommand.SaveSelectedDocument, binding));
        var postSave = await runtime.ProcessAsync(Request("read-after-save", SelectedPageWorkerCommand.ReadSelectedPage, binding));
        await runtime.ProcessAsync(Request("close", SelectedPageWorkerCommand.CloseSession, binding));

        Assert.Equal("succeeded", preSave.Status);
        Assert.Equal("succeeded", postSave.Status);
        Assert.NotNull(preSave.Readback);
        Assert.Equal(preSave.Readback! with { AgentOwnedShapes = [] }, postSave.Readback! with { AgentOwnedShapes = [] });
        Assert.Equal(
            preSave.Readback.AgentOwnedShapes.Select(shape => (shape.NativeShapeId, shape.OwnershipNamespace, Semantics: string.Join(',', shape.SourceMappingSemanticIds))),
            postSave.Readback.AgentOwnedShapes.Select(shape => (shape.NativeShapeId, shape.OwnershipNamespace, Semantics: string.Join(',', shape.SourceMappingSemanticIds))));
        Assert.NotEmpty(postSave.Readback!.AgentOwnedShapes);
        Assert.Equal(1, document.SaveCalls);
        Assert.Equal(1, backend.ReleaseSessionCalls);
    }

    [Fact]
    public async Task Parsed_bad_hmac_apply_attempt_revokes_prior_composed_pre_save_authorization()
    {
        await using var fixture = await CreatePreSaveAuthorizedRuntimeAsync();
        var invalidApply = ParsedApplyRequest(
            fixture.Binding,
            CanonicalPlan(fixture.Binding),
            "wrong-composed-lifecycle-secret",
            "bad-hmac-apply");

        await Assert.ThrowsAsync<WorkerProtocolException>(() => fixture.Runtime.ProcessAsync(invalidApply));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => fixture.Runtime.ProcessAsync(
            Request("save-after-bad-hmac", SelectedPageWorkerCommand.SaveSelectedDocument, fixture.Binding)));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public async Task Parsed_native_intent_mapping_failure_revokes_prior_composed_pre_save_authorization()
    {
        await using var fixture = await CreatePreSaveAuthorizedRuntimeAsync();
        var invalidPlan = CanonicalPlan(fixture.Binding)
            .Replace("pvp-native-intent-1", "pvp-native-intent-invalid", StringComparison.Ordinal);
        var invalidApply = ParsedApplyRequest(
            fixture.Binding,
            invalidPlan,
            "composed-lifecycle-secret",
            "invalid-native-intent-apply");

        await Assert.ThrowsAsync<WorkerProtocolException>(() => fixture.Runtime.ProcessAsync(invalidApply));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => fixture.Runtime.ProcessAsync(
            Request("save-after-invalid-native-intent", SelectedPageWorkerCommand.SaveSelectedDocument, fixture.Binding)));
        Assert.Equal(0, fixture.Document.SaveCalls);
    }

    [Fact]
    public async Task Blank_namespace_read_attempt_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => manager.ReadSelectedPageAsync(" "));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.False(backend.PreSaveAuthorized);
    }

    [Fact]
    public async Task Mismatched_namespace_read_attempt_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.ReadSelectedPageAsync("agent-region-other"));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.False(backend.PreSaveAuthorized);
    }

    [Fact]
    public async Task Pre_cancelled_read_attempt_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            manager.ReadSelectedPageAsync(OwnershipNamespace, cancellation.Token));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.False(backend.PreSaveAuthorized);
    }

    [Fact]
    public async Task Invalid_apply_attempt_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => manager.ApplyOwnedRegionAsync(" ", Plan()));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.False(backend.PreSaveAuthorized);
    }

    [Fact]
    public async Task Pre_cancelled_apply_attempt_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            manager.ApplyOwnedRegionAsync(OwnershipNamespace, Plan(), cancellation.Token));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.False(backend.PreSaveAuthorized);
    }

    [Fact]
    public async Task Null_target_explicit_reattach_revokes_prior_pre_save_authorization_before_validation()
    {
        var (manager, backend) = await AuthorizedManagerAsync();

        await Assert.ThrowsAsync<ArgumentNullException>(() => manager.AttachAsync(null!, OwnershipNamespace));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Blank_namespace_explicit_reattach_revokes_prior_pre_save_authorization_before_validation()
    {
        var (manager, backend) = await AuthorizedManagerAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => manager.AttachAsync(Target, " "));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Pre_cancelled_explicit_reattach_revokes_prior_pre_save_authorization_before_cancellation()
    {
        var (manager, backend) = await AuthorizedManagerAsync();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            manager.AttachAsync(Target, OwnershipNamespace, cancellation.Token));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Visibility_failure_during_explicit_reattach_revokes_prior_pre_save_authorization()
    {
        var (manager, backend) = await AuthorizedManagerAsync();
        backend.VisibilityError = new InvalidOperationException("Visio visibility failed");

        await Assert.ThrowsAsync<InvalidOperationException>(() => manager.AttachAsync(Target, OwnershipNamespace));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.Equal(0, backend.SaveCalls);
    }

    [Fact]
    public async Task Pre_cancelled_capture_revokes_prior_pre_save_authorization_on_a_retained_backend()
    {
        var (manager, backend) = await AuthorizedManagerAsync();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => manager.CaptureActiveSelectionAsync(cancellation.Token));

        await Assert.ThrowsAsync<WorkerProtocolException>(() => manager.SaveSelectedDocumentAsync());
        Assert.Equal(0, backend.SaveCalls);
    }

    private static DiagramDocument Plan() => new("Current page test", [], [], []);

    private static async Task<(SelectedPageSessionManager Manager, AuthorizationTrackingBackend Backend)> AuthorizedManagerAsync()
    {
        var backend = new AuthorizationTrackingBackend();
        var manager = new SelectedPageSessionManager(backend);
        await manager.AttachAsync(Target, OwnershipNamespace);
        await manager.ReadSelectedPageAsync(OwnershipNamespace);
        Assert.True(backend.PreSaveAuthorized);
        return (manager, backend);
    }

    private static SelectedPageWorkerBinding BindingFor(SelectedPageTarget target) => new(
        "job-1",
        "tenant-1",
        "user-1",
        "device-1",
        "workflow-1",
        target.DocumentId,
        target.PageId,
        target.DocumentFingerprint,
        target.PageFingerprint,
        target.ExpectedRevision,
        OwnershipNamespace);

    private static SelectedPageWorkerRequest Request(
        string requestId,
        SelectedPageWorkerCommand command,
        SelectedPageWorkerBinding binding) =>
        new(requestId, command, binding);

    private static SelectedPageWorkerRequest ApplyRequest(SelectedPageWorkerBinding binding) =>
        ParsedApplyRequest(binding, CanonicalPlan(binding), "composed-lifecycle-secret", "apply");

    private static string CanonicalPlan(SelectedPageWorkerBinding binding) =>
        """
        {"protocolVersion":"pvp-native-intent-1","planId":"plan-1","planHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","updateIdentity":{"ownerId":"__OWNER__","deviceId":"__DEVICE__","workflowId":"__WORKFLOW__","documentId":"__DOCUMENT__","pageId":"__PAGE__","expectedRevision":__REVISION__},"coordinateSpace":{"id":"pvp-du-1","unit":"du","duPerInch":1000,"page":{"x":0,"y":0,"width":1000,"height":600}},"primitives":[{"primitiveId":"primitive-1","componentId":"component-1","nativeKind":"terminal","label":"Input","bounds":{"x":100,"y":100,"width":300,"height":200},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","pvp.primitiveId":"primitive-1","pvp.componentId":"component-1","pvp.ownership":"agent"}}],"connectors":[]}
        """
        .Replace("__OWNER__", binding.UserId, StringComparison.Ordinal)
        .Replace("__DEVICE__", binding.DeviceId, StringComparison.Ordinal)
        .Replace("__WORKFLOW__", binding.WorkflowId, StringComparison.Ordinal)
        .Replace("__DOCUMENT__", binding.DocumentId, StringComparison.Ordinal)
        .Replace("__PAGE__", binding.PageId, StringComparison.Ordinal)
        .Replace("__REVISION__", binding.ExpectedRevision.ToString(), StringComparison.Ordinal);

    private static SelectedPageWorkerRequest ParsedApplyRequest(
        SelectedPageWorkerBinding binding,
        string canonicalPlan,
        string signingSecret,
        string requestId)
    {
        var canonicalBytes = Encoding.UTF8.GetBytes(canonicalPlan);
        var envelope = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["version"] = 2,
            ["jobId"] = binding.JobId,
            ["tenantId"] = binding.TenantId,
            ["userId"] = binding.UserId,
            ["deviceId"] = binding.DeviceId,
            ["workflowId"] = binding.WorkflowId,
            ["documentId"] = binding.DocumentId,
            ["pageId"] = binding.PageId,
            ["documentFingerprint"] = binding.DocumentFingerprint,
            ["pageFingerprint"] = binding.PageFingerprint,
            ["expectedRevision"] = binding.ExpectedRevision,
            ["ownershipNamespace"] = binding.OwnershipNamespace,
            ["planId"] = "plan-1",
            ["planHash"] = Convert.ToHexString(SHA256.HashData(canonicalBytes)).ToLowerInvariant(),
            ["expiresAt"] = "2030-01-01T00:00:00.000Z",
            ["canonicalPlanBase64"] = Base64Url(canonicalBytes),
        };
        var unsignedEnvelope = JsonSerializer.SerializeToUtf8Bytes(envelope);
        envelope["signature"] = Base64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(signingSecret), unsignedEnvelope));
        var line = JsonSerializer.Serialize(new
        {
            protocolVersion = 3,
            requestId,
            command = "applyOwnedRegion",
            binding = new
            {
                jobId = binding.JobId,
                tenantId = binding.TenantId,
                userId = binding.UserId,
                deviceId = binding.DeviceId,
                workflowId = binding.WorkflowId,
                documentId = binding.DocumentId,
                pageId = binding.PageId,
                documentFingerprint = binding.DocumentFingerprint,
                pageFingerprint = binding.PageFingerprint,
                expectedRevision = binding.ExpectedRevision,
                ownershipNamespace = binding.OwnershipNamespace,
            },
            ownershipNamespace = binding.OwnershipNamespace,
            sealedNativeIntent = envelope,
        });
        return SelectedPageWorkerRequestParser.Parse(line);
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static SelectedPageTarget TargetFor(StatefulDocument document, StatefulPage page)
    {
        var documentId = StableIdentifier("document", document.ID);
        var pageId = StableIdentifier("page", page.ID);
        return new SelectedPageTarget(
            documentId,
            pageId,
            Hash(documentId, document.Name, document.Pages.Count.ToString()),
            Hash(documentId, pageId, page.Name, page.Width.ToString("R"), page.Height.ToString("R")),
            int.Parse(page.ID));
    }

    private static string StableIdentifier(string prefix, string value) =>
        prefix + "-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..32];

    private static string Hash(params string[] values) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\0", values)))).ToLowerInvariant();

    private static void SetPrivateField(object target, string name, object value)
    {
        var field = target.GetType().GetField(name, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(field);
        field.SetValue(target, value);
    }

    private static async Task<StatefulRuntimeFixture> CreatePreSaveAuthorizedRuntimeAsync()
    {
        var document = new StatefulDocument("101", "drawing.vsdx");
        var page = new StatefulPage("1", "Architecture", document, width: 10, height: 6);
        var application = new StatefulApplication(page);
        var native = new SelectedPageVisioComNative(new VisioComEngineOptions());
        SetPrivateField(native, "_application", application);
        var target = TargetFor(document, page);
        var backend = new SelectedPageVisioComBackend(native);
        var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier("composed-lifecycle-secret"));
        var fixture = new StatefulRuntimeFixture(runtime, backend, native, document, BindingFor(target));
        try
        {
            await runtime.ProcessAsync(Request("attach", SelectedPageWorkerCommand.AttachSelectedPage, fixture.Binding));
            await runtime.ProcessAsync(ApplyRequest(fixture.Binding));
            await runtime.ProcessAsync(Request("read-before-failed-apply", SelectedPageWorkerCommand.ReadSelectedPage, fixture.Binding));
            return fixture;
        }
        catch
        {
            await fixture.DisposeAsync();
            throw;
        }
    }

    private sealed class StatefulRuntimeFixture(
        SelectedPageWorkerRuntime runtime,
        SelectedPageVisioComBackend backend,
        SelectedPageVisioComNative native,
        StatefulDocument document,
        SelectedPageWorkerBinding binding) : IAsyncDisposable
    {
        public SelectedPageWorkerRuntime Runtime { get; } = runtime;
        public StatefulDocument Document { get; } = document;
        public SelectedPageWorkerBinding Binding { get; } = binding;

        public async ValueTask DisposeAsync()
        {
            await Runtime.DisposeAsync();
            await backend.DisposeAsync();
            native.Dispose();
        }
    }

    private sealed class ReleaseCountingBackend(ISelectedPageSessionBackend inner) : ISelectedPageSessionBackend
    {
        public int ReleaseSessionCalls { get; private set; }

        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default) => inner.EnsureVisibleApplicationAsync(cancellationToken);
        public Task BeginAttachAttemptAsync() => inner.BeginAttachAttemptAsync();
        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default) => inner.AttachActiveSelectionAsync(cancellationToken);
        public Task RevalidateAttachedTargetAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => inner.RevalidateAttachedTargetAsync(target, cancellationToken);
        public Task BeginApplyAttemptAsync(SelectedPageTarget target) => inner.BeginApplyAttemptAsync(target);
        public Task BeginReadAttemptAsync(SelectedPageTarget target) => inner.BeginReadAttemptAsync(target);
        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default) => inner.ApplyOwnedRegionAsync(target, ownershipNamespace, plan, cancellationToken);
        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => inner.SaveSelectedDocumentAsync(target, cancellationToken);
        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default) => inner.ReadSelectedPageAsync(target, ownershipNamespace, cancellationToken);
        public async Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            ReleaseSessionCalls++;
            await inner.ReleaseSessionAsync(target, cancellationToken);
        }
    }

    public sealed class StatefulApplication(StatefulPage page)
    {
        public bool Visible { get; set; }
        public StatefulWindow ActiveWindow { get; } = new(page);
    }

    public sealed class StatefulWindow(StatefulPage page)
    {
        public StatefulPage Page { get; } = page;
    }

    public sealed class StatefulDocument(string id, string name)
    {
        public string ID { get; } = id;
        public string Name { get; } = name;
        public StatefulPages Pages { get; } = new();
        public int SaveCalls { get; private set; }
        public void Save() => SaveCalls++;
    }

    public sealed class StatefulPages
    {
        public int Count => 1;
    }

    public sealed class StatefulPage(string id, string name, StatefulDocument document, double width, double height)
    {
        private int _nextShapeId = 100;

        public string ID { get; } = id;
        public string Name { get; } = name;
        public StatefulDocument Document { get; } = document;
        public double Width { get; } = width;
        public double Height { get; } = height;
        public StatefulPageSheet PageSheet { get; } = new(width, height);
        public StatefulShapes Shapes { get; } = new();

        public StatefulShape DrawRectangle(double x1, double y1, double x2, double y2)
        {
            var shape = new StatefulShape(_nextShapeId++);
            Shapes.Add(shape);
            return shape;
        }
    }

    public sealed class StatefulPageSheet(double width, double height)
    {
        public StatefulPageCells CellsU { get; } = new(width, height);
    }

    public sealed class StatefulPageCells(double width, double height)
    {
        public StatefulPageCell this[string name] => new(name == "PageWidth" ? width : height);
    }

    public sealed class StatefulPageCell(double result)
    {
        public double ResultIU { get; } = result;
    }

    public sealed class StatefulShapes
    {
        private readonly List<StatefulShape> _shapes = [];
        public int Count => _shapes.Count;
        public void Add(StatefulShape shape)
        {
            shape.Attach(_shapes);
            _shapes.Add(shape);
        }
        public StatefulShape Item(int index) => _shapes[index - 1];
    }

    public sealed class StatefulShape(int id)
    {
        private readonly Dictionary<string, string> _cells = new(StringComparer.Ordinal);
        private List<StatefulShape>? _owner;

        public int ID { get; } = id;
        public string NameU { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public void Attach(List<StatefulShape> owner) => _owner = owner;
        public void Delete() => _owner!.Remove(this);
        public void AddNamedRow(int section, string rowName, int rowTag) => _cells.TryAdd($"Prop.{rowName}", string.Empty);
        public int CellExistsU(string name, int section) => _cells.ContainsKey(name) ? 1 : 0;
        public StatefulShapeCell CellsU(string name) => new(_cells, name);
    }

    public sealed class StatefulShapeCell(Dictionary<string, string> cells, string name)
    {
        public string FormulaU
        {
            get => cells.TryGetValue(name, out var value) ? value : string.Empty;
            set => cells[name] = value.Length >= 2 && value[0] == '"' && value[^1] == '"'
                ? value[1..^1].Replace("\"\"", "\"")
                : value;
        }

        public string[] ResultStr => [cells.TryGetValue(name, out var value) ? value : string.Empty];
    }

    private sealed class AuthorizationTrackingBackend : ISelectedPageSessionBackend
    {
        public bool PreSaveAuthorized { get; private set; }
        public Exception? VisibilityError { get; set; }
        public int SaveCalls { get; private set; }

        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default) =>
            VisibilityError is null ? Task.CompletedTask : Task.FromException(VisibilityError);
        public Task BeginAttachAttemptAsync()
        {
            PreSaveAuthorized = false;
            return Task.CompletedTask;
        }
        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default) => Task.FromResult<SelectedPageTarget?>(Target);
        public Task RevalidateAttachedTargetAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task BeginApplyAttemptAsync(SelectedPageTarget target)
        {
            PreSaveAuthorized = false;
            return Task.CompletedTask;
        }
        public Task BeginReadAttemptAsync(SelectedPageTarget target)
        {
            PreSaveAuthorized = false;
            return Task.CompletedTask;
        }
        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            if (!PreSaveAuthorized) throw new WorkerProtocolException("Pre-save verification is required.");
            PreSaveAuthorized = false;
            SaveCalls++;
            return Task.CompletedTask;
        }
        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default)
        {
            PreSaveAuthorized = true;
            return Task.FromResult(new SelectedPageReadback(
                true,
                target.DocumentId,
                target.PageId,
                target.DocumentFingerprint,
                target.PageFingerprint,
                target.ExpectedRevision,
                ownershipNamespace,
                0,
                [new SelectedPageReadbackShape("shape-1", ownershipNamespace, ["semantic-1"])],
                0));
        }
        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class RecordingBackend : ISelectedPageSessionBackend
    {
        public SelectedPageTarget? ActiveTarget { get; set; }
        public int EnsureVisibleApplicationCalls { get; private set; }
        public int AttachActiveSelectionCalls { get; private set; }
        public int RevalidateAttachedTargetCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int ReleaseSessionCalls { get; private set; }
        public int UserShapeCount { get; set; }
        public int ExistingOwnedShapeCount { get; set; }
        public string? LastOwnershipNamespace { get; private set; }
        public string? LastReadOwnershipNamespace { get; private set; }
        public SelectedPageTarget? LastSavedTarget { get; private set; }

        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default)
        {
            EnsureVisibleApplicationCalls++;
            return Task.CompletedTask;
        }

        public Task BeginAttachAttemptAsync() => Task.CompletedTask;

        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default)
        {
            AttachActiveSelectionCalls++;
            return Task.FromResult(ActiveTarget);
        }

        public Task RevalidateAttachedTargetAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            RevalidateAttachedTargetCalls++;
            if (!EqualityComparer<SelectedPageTarget?>.Default.Equals(target, ActiveTarget))
            {
                throw new InvalidOperationException("The selected Visio document or page changed before the operation could run.");
            }
            return Task.CompletedTask;
        }

        public Task BeginApplyAttemptAsync(SelectedPageTarget target) => Task.CompletedTask;
        public Task BeginReadAttemptAsync(SelectedPageTarget target) => Task.CompletedTask;

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

        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default)
        {
            LastReadOwnershipNamespace = ownershipNamespace;
            return Task.FromResult(new SelectedPageReadback(
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
                0));
        }

        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default)
        {
            ReleaseSessionCalls++;
            return Task.CompletedTask;
        }
    }
}
