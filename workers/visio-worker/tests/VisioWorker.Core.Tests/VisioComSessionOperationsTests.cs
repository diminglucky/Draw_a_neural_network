using VisioWorker.Core;
using VisioWorker.Live;
using System.Reflection;

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
    public void Owned_application_with_a_window_handle_creates_a_verified_process_lease()
    {
        var startTimeUtc = new DateTime(2026, 8, 19, 1, 2, 3, DateTimeKind.Utc);
        var adapter = new RecordingProcessWindowAdapter
        {
            WindowProcessId = 4512,
            ProcessExecutableName = "VISIO.EXE",
            ProcessStartTimeUtc = startTimeUtc,
        };

        var lease = CreateOwnedApplicationLease(new FakeVisioApplication(0x1234), ownsApplication: true, adapter);

        Assert.NotNull(lease);
        Assert.Equal(4512, LeaseProperty<int>(lease, "ProcessId"));
        Assert.Equal(startTimeUtc, LeaseProperty<DateTime>(lease, "ProcessStartTimeUtc"));
        Assert.True(LeaseProperty<bool>(lease, "OwnsApplication"));
        Assert.Equal("VISIO.EXE", LeaseProperty<string>(lease, "ExecutableName"));
        Assert.Equal(1, adapter.WindowLookupCount);
        Assert.Equal([4512], adapter.ProcessIdentityLookups);
    }

    [Fact]
    public void Attached_or_unresolved_applications_do_not_receive_an_owned_process_lease()
    {
        var attachedAdapter = new RecordingProcessWindowAdapter
        {
            WindowProcessId = 4512,
            ProcessExecutableName = "VISIO.EXE",
            ProcessStartTimeUtc = new DateTime(2026, 8, 19, 1, 2, 3, DateTimeKind.Utc),
        };

        var attachedLease = CreateOwnedApplicationLease(new FakeVisioApplication(0x1234), ownsApplication: false, attachedAdapter);

        Assert.Null(attachedLease);
        Assert.Equal(0, attachedAdapter.WindowLookupCount);
        var unresolvedAdapter = new RecordingProcessWindowAdapter { ResolvesWindowProcess = false };

        var unresolvedLease = CreateOwnedApplicationLease(new FakeVisioApplication(0x1234), ownsApplication: true, unresolvedAdapter);

        Assert.Null(unresolvedLease);
        Assert.Equal(1, unresolvedAdapter.WindowLookupCount);
        Assert.Empty(unresolvedAdapter.ProcessIdentityLookups);
    }

    [Fact]
    public void Lease_rejects_a_process_when_its_executable_name_or_start_time_changes()
    {
        var startTimeUtc = new DateTime(2026, 8, 19, 1, 2, 3, DateTimeKind.Utc);
        var adapter = new RecordingProcessWindowAdapter
        {
            WindowProcessId = 4512,
            ProcessExecutableName = "VISIO.EXE",
            ProcessStartTimeUtc = startTimeUtc,
        };
        var lease = CreateOwnedApplicationLease(new FakeVisioApplication(0x1234), ownsApplication: true, adapter);

        Assert.NotNull(lease);
        adapter.ProcessExecutableName = "NOTEPAD.EXE";
        Assert.False(LeaseMatchesCurrentProcess(lease, adapter));
        adapter.ProcessExecutableName = "VISIO.EXE";
        adapter.ProcessStartTimeUtc = startTimeUtc.AddSeconds(1);

        Assert.False(LeaseMatchesCurrentProcess(lease, adapter));
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
        Assert.Equal(0, native.CloseCalls);

        operations.Close(document);

        Assert.Equal(1, native.CloseCalls);
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

    [Fact]
    public void Disposal_reports_native_close_failure_and_retains_the_failed_session_registration()
    {
        var native = new RecordingNativeSessionOperations();
        var operations = new VisioComSessionOperations(native);
        var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
        var document = operations.OpenOrCreate(key);
        native.FailClose = true;

        var error = Assert.Throws<AggregateException>(() => operations.Dispose());

        Assert.Contains("native Visio session", error.Message, StringComparison.Ordinal);
        Assert.Equal(1, native.CloseCalls);
        native.FailClose = false;
        operations.Close(document);
        Assert.Equal(2, native.CloseCalls);
        operations.Dispose();
    }

    [Fact]
    public void FindExpectedPage_skips_an_untagged_candidate_before_the_matching_native_identity_page()
    {
        var expectedPageIdentity = new string('a', 32);
        var untagged = new FakeNativePage(1, null);
        var matching = new FakeNativePage(2, expectedPageIdentity);
        var document = new FakeNativeDocument(untagged, matching);
        var expected = new VisioSessionDocument("document-one", "page-one", new string('b', 32), expectedPageIdentity);

        var actual = InvokeFindExpectedPage(document, expected);

        Assert.Same(matching, actual);
    }

    [Fact]
    public void FindExpectedPage_rejects_ambiguous_matching_native_identity_pages()
    {
        var expectedPageIdentity = new string('a', 32);
        var document = new FakeNativeDocument(
            new FakeNativePage(1, expectedPageIdentity),
            new FakeNativePage(2, expectedPageIdentity));
        var expected = new VisioSessionDocument("document-one", "page-one", new string('b', 32), expectedPageIdentity);

        var error = Assert.Throws<WorkerProtocolException>(() => InvokeFindExpectedPage(document, expected));

        Assert.Contains("more than one page", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void FindExpectedPage_releases_a_retained_match_when_a_later_page_identity_read_fails()
    {
        var expectedPageIdentity = new string('a', 32);
        var matching = new FakeNativePage(1, expectedPageIdentity);
        var malformed = new FakeNativePage(2, "not-a-native-page-identity");
        var document = new FakeNativeDocument(matching, malformed);
        var expected = new VisioSessionDocument("document-one", "page-one", new string('b', 32), expectedPageIdentity);
        var released = new List<object?>();

        var error = Assert.Throws<WorkerProtocolException>(() => InvokeFindExpectedPage(document, expected, released.Add));

        Assert.Contains("missing or invalid", error.Message, StringComparison.Ordinal);
        Assert.Contains(matching, released);
    }

    [Fact]
    public void SaveAs_reopen_identity_failure_removes_released_native_and_adapter_registrations_before_reconciliation()
    {
        var native = new RecordingNativeSessionOperations { FailSaveAsAfterOriginalClose = true };
        var operations = new VisioComSessionOperations(native);
        var key = new VisioSessionKey("tenant-one", "user-one", "device-one", "workflow-one");
        var original = operations.OpenOrCreate(key);

        Assert.Throws<WorkerProtocolException>(() => operations.SaveAs(original, "C:\\exports\\session.partial.vsdx", "C:\\exports\\session.vsdx"));

        Assert.False(native.HasRegistrationFor(original));
        Assert.Throws<InvalidOperationException>(() => operations.Close(original));

        native.FailSaveAsAfterOriginalClose = false;
        var replacement = operations.OpenOrCreate(key);
        operations.Close(replacement);
        operations.Dispose();

        Assert.Equal(1, native.CloseCalls);
        Assert.Equal(0, native.RegistrationCount);
    }

    private static object InvokeFindExpectedPage(object document, VisioSessionDocument expected)
    {
        var nativeType = typeof(VisioComSessionOperations).Assembly.GetType("VisioWorker.Live.VisioComSessionNative", throwOnError: true)!;
        var method = nativeType.GetMethod(
            "FindExpectedPage",
            BindingFlags.NonPublic | BindingFlags.Static,
            binder: null,
            types: [typeof(object), typeof(VisioSessionDocument)],
            modifiers: null)!;
        try
        {
            return method.Invoke(null, [document, expected])!;
        }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            throw error.InnerException;
        }
    }

    private static object InvokeFindExpectedPage(object document, VisioSessionDocument expected, Action<object?> release)
    {
        var nativeType = typeof(VisioComSessionOperations).Assembly.GetType("VisioWorker.Live.VisioComSessionNative", throwOnError: true)!;
        var method = nativeType.GetMethod(
            "FindExpectedPage",
            BindingFlags.NonPublic | BindingFlags.Static,
            binder: null,
            types: [typeof(object), typeof(VisioSessionDocument), typeof(Action<object?>)],
            modifiers: null);

        Assert.NotNull(method);
        try
        {
            return method.Invoke(null, [document, expected, release])!;
        }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            throw error.InnerException;
        }
    }

    private static DiagramDocument LegacyPlan(string nodeId) => new(
        "Publication diagram",
        ["Encoder"],
        [new VisioNode(nodeId, "conv", "Encoder", null, 0, 1, 1, 1, 1, "", "standard", "network-node", 1, 1, false, null, new Dictionary<string, string>())],
        [new VisioConnector(nodeId + "-to-output", nodeId, "output", "signal", [new DiagramPoint(1, 1), new DiagramPoint(2, 1)])]);

    private static object? CreateOwnedApplicationLease(FakeVisioApplication application, bool ownsApplication, RecordingProcessWindowAdapter adapter)
    {
        var assembly = typeof(VisioComEngine).Assembly;
        var leaseType = assembly.GetType("VisioWorker.Live.OwnedVisioApplicationLease", throwOnError: false);
        Assert.NotNull(leaseType);
        var adapterType = assembly.GetType("VisioWorker.Live.IVisioProcessWindowAdapter", throwOnError: false);
        Assert.NotNull(adapterType);
        var proxy = DispatchProxy.Create(adapterType, typeof(RecordingProcessWindowAdapter));
        ((RecordingProcessWindowAdapter)proxy).CopyFrom(adapter);
        adapter.Proxy = (RecordingProcessWindowAdapter)proxy;
        var factory = leaseType.GetMethod("TryCreate", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(factory);
        return factory.Invoke(null, [application, ownsApplication, proxy]);
    }

    private static T LeaseProperty<T>(object lease, string propertyName)
    {
        var property = lease.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(property);
        return Assert.IsType<T>(property.GetValue(lease));
    }

    private static bool LeaseMatchesCurrentProcess(object lease, RecordingProcessWindowAdapter adapter)
    {
        var method = lease.GetType().GetMethod("MatchesCurrentProcess", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        return Assert.IsType<bool>(method.Invoke(lease, [adapter.Proxy]));
    }

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
        public bool FailClose { get; set; }
        public bool FailSaveAsAfterOriginalClose { get; set; }
        private HashSet<VisioSessionDocument> RegisteredDocuments { get; } = [];

        public int RegistrationCount => RegisteredDocuments.Count;

        public bool HasRegistrationFor(VisioSessionDocument document) => RegisteredDocuments.Contains(document);

        public VisioSessionDocument OpenOrCreate(VisioSessionKey sessionKey)
        {
            OpenOrCreateCalls++;
            var document = new VisioSessionDocument($"document-{OpenOrCreateCalls}", $"page-{OpenOrCreateCalls}");
            RegisteredDocuments.Add(document);
            return document;
        }

        public void ReplaceOwnedShapes(VisioSessionDocument document, string ownershipMarker, DiagramDocument plan)
        {
            ReplaceCalls++;
            Documents.Add(document);
            OwnershipMarkers.Add(ownershipMarker);
        }

        public ReadbackResult Readback(VisioSessionDocument document, DiagramDocument plan) =>
            ReadbackValidator.Legacy(shapeCount: 1, connectorCount: 0);

        public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath, Action originalClosed)
        {
            SaveCalls++;
            SaveArguments.Add((temporaryPath, finalPath));
            RegisteredDocuments.Remove(document);
            originalClosed();
            if (FailSaveAsAfterOriginalClose)
            {
                throw new WorkerProtocolException("simulated reopened identity verification failure");
            }
            return document;
        }

        public VisioSessionDocument SaveAs(VisioSessionDocument document, string temporaryPath, string finalPath) =>
            SaveAs(document, temporaryPath, finalPath, static () => { });

        public void Close(VisioSessionDocument document)
        {
            CloseCalls++;
            if (FailClose) throw new InvalidOperationException("simulated native close failure");
            RegisteredDocuments.Remove(document);
        }

        public VisioSessionDocument Recover(VisioSessionKey sessionKey, VisioSessionRecoveryManifest manifest)
        {
            RecoverCalls++;
            return manifest.Document;
        }
    }

    public sealed class FakeNativeDocument(params FakeNativePage[] pages)
    {
        public FakeNativePageCollection Pages { get; } = new(pages);
    }

    public sealed class FakeNativePageCollection(FakeNativePage[] pages)
    {
        public int Count => pages.Length;

        public FakeNativePage Item(int index) => pages[index - 1];
    }

    public sealed class FakeNativePage(int id, string? identity)
    {
        public int ID { get; } = id;
        public FakeNativeShapeSheet PageSheet { get; } = new(identity);
    }

    public sealed class FakeNativeShapeSheet(string? identity)
    {
        public int CellExistsU(string cellName, int flags) => identity is null ? 0 : 1;

        public FakeNativeCell CellsU(string cellName) => identity is null
            ? throw new InvalidOperationException("The Worker marker is absent.")
            : new FakeNativeCell(identity);
    }

    public sealed class FakeNativeCell(string identity)
    {
        public string[] ResultStr { get; } = [identity];
    }

    public sealed class FakeVisioApplication(int windowHandle32)
    {
        public int WindowHandle32 { get; } = windowHandle32;
    }

    public class RecordingProcessWindowAdapter : DispatchProxy
    {
        public RecordingProcessWindowAdapter? Proxy { get; set; }
        private RecordingProcessWindowAdapter? Source { get; set; }
        public bool ResolvesWindowProcess { get; set; } = true;
        public int WindowProcessId { get; set; }
        public string ProcessExecutableName { get; set; } = "VISIO.EXE";
        public DateTime ProcessStartTimeUtc { get; set; }
        public int WindowLookupCount { get; private set; }
        public List<int> ProcessIdentityLookups { get; } = [];

        public void CopyFrom(RecordingProcessWindowAdapter source)
        {
            Source = source;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? arguments)
        {
            Assert.NotNull(targetMethod);
            Assert.NotNull(arguments);
            return targetMethod.Name switch
            {
                "TryGetWindowProcessId" => ResolveWindowProcess(arguments),
                "TryGetProcessIdentity" => ResolveProcessIdentity(targetMethod, arguments),
                _ => throw new InvalidOperationException($"Unexpected process/window adapter member '{targetMethod.Name}'."),
            };
        }

        private bool ResolveWindowProcess(object?[] arguments)
        {
            var source = Source ?? this;
            source.WindowLookupCount++;
            arguments[1] = source.WindowProcessId;
            return source.ResolvesWindowProcess;
        }

        private bool ResolveProcessIdentity(MethodInfo targetMethod, object?[] arguments)
        {
            var source = Source ?? this;
            source.ProcessIdentityLookups.Add(Assert.IsType<int>(arguments[0]));
            var identityType = targetMethod.GetParameters()[1].ParameterType.GetElementType();
            Assert.NotNull(identityType);
            arguments[1] = Activator.CreateInstance(identityType, source.ProcessExecutableName, source.ProcessStartTimeUtc);
            return true;
        }
    }
}
