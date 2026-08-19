using System.Text.Json;
using System.Reflection;
using System.Text;
using VisioWorker.Core;
using VisioWorker.Host;

namespace VisioWorker.Core.Tests;

public sealed class WorkerHostLineProcessorTests
{
    [Fact]
    public async Task V1_protocol_discriminator_is_case_insensitive_but_case_variant_duplicates_fail_closed()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var accepted = Assert.IsType<WorkerResponse>(await processor.ProcessLineAsync(fixture.V1Json("ProtocolVersion")));
        var rejected = Assert.IsType<WorkerResponse>(await processor.ProcessLineAsync(fixture.V1Json("protocolVersion", "ProtocolVersion")));

        Assert.Equal("succeeded", accepted.Status);
        Assert.Equal("failed", rejected.Status);
    }

    [Fact]
    public async Task V2_runtime_failure_after_strict_parse_retains_validated_request_id()
    {
        using var fixture = new HostFixture(manifestStore: new ThrowingManifestStore());
        await using var processor = fixture.CreateLineProcessor();

        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson("runtime-failure")));

        Assert.Equal("runtime-failure", response.RequestId);
        Assert.Equal("failed", response.Status);
    }

    [Fact]
    public async Task Host_loop_returns_legacy_v1_exit_codes_but_keeps_v2_failures_per_line()
    {
        using var fixture = new HostFixture();

        var noRequestExit = await RunHostLoopAsync(new StringReader(" \r\n\t\r\n"), new TrackingTextWriter(), fixture.CreateOptions());
        var v1FailureExit = await RunHostLoopAsync(new StringReader("{\"protocolVersion\":1}\r\n"), new TrackingTextWriter(), fixture.CreateOptions());
        var v2FailureExit = await RunHostLoopAsync(new StringReader(fixture.OpenJson("v2-failure") + "\r\n"), new TrackingTextWriter(), fixture.CreateOptions());

        Assert.Equal(2, noRequestExit);
        Assert.Equal(1, v1FailureExit);
        Assert.Equal(0, v2FailureExit);
    }

    [Fact]
    public async Task Host_loop_flushes_each_nonblank_response_continues_after_malformed_v2_and_disposes_at_eof()
    {
        using var fixture = new HostFixture();
        var output = new TrackingTextWriter();
        var input = new StringReader(string.Join(Environment.NewLine,
            " ",
            """{"protocolVersion":2,"requestId":"bad-request","command":"launchShell","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}""",
            fixture.OpenJson("valid-v2"),
            fixture.V1Json(),
            ""));

        var exitCode = await RunHostLoopAsync(input, output, fixture.CreateOptions());
        var responses = output.Lines.Select(line => JsonDocument.Parse(line).RootElement.Clone()).ToArray();

        Assert.Equal(0, exitCode);
        Assert.Equal(3, responses.Length);
        Assert.Equal(3, output.FlushCount);
        Assert.Equal("unknown", responses[0].GetProperty("requestId").GetString());
        Assert.Equal("failed", responses[0].GetProperty("status").GetString());
        Assert.Equal("valid-v2", responses[1].GetProperty("requestId").GetString());
        Assert.Equal("succeeded", responses[1].GetProperty("status").GetString());
        Assert.Equal("succeeded", responses[2].GetProperty("status").GetString());
        Assert.Equal(1, fixture.Backend.CloseCalls);
    }

    [Fact]
    public async Task Two_v2_apply_lines_share_one_runtime_backend_open()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var open = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson()));
        var apply = fixture.ApplyJson("operation-1");
        var first = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(apply));
        var replay = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(apply));

        Assert.Equal("succeeded", open.Status);
        Assert.Equal("succeeded", first.Status);
        Assert.Equal(first, replay);
        Assert.Equal(1, fixture.Backend.OpenOrCreateCalls);
        Assert.Equal(1, fixture.Backend.ApplyPlanCalls);
    }

    [Fact]
    public async Task Malformed_v2_line_returns_one_failure_and_later_v2_line_succeeds()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var malformed = await processor.ProcessLineAsync(
            """{"protocolVersion":2,"requestId":"bad-request","command":"launchShell","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}""");
        var valid = await processor.ProcessLineAsync(fixture.OpenJson());

        var failure = Assert.IsType<WorkerV2Response>(malformed);
        Assert.Equal("failed", failure.Status);
        Assert.NotNull(failure.Error);
        Assert.Equal("succeeded", Assert.IsType<WorkerV2Response>(valid).Status);
        Assert.Equal(1, fixture.Backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Disposal_releases_the_runtime_session_at_end_of_input()
    {
        using var fixture = new HostFixture();
        var processor = fixture.CreateLineProcessor();
        await processor.ProcessLineAsync(fixture.OpenJson());

        await processor.DisposeAsync();

        Assert.Equal(1, fixture.Backend.CloseCalls);
    }

    private sealed class HostFixture : IDisposable
    {
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"visio-worker-host-{Guid.NewGuid():N}");
        private readonly DiagramEnvelope _diagram = Fixtures.CnnDiagram();
        private readonly IVisioSessionBackend _sessionBackend;
        private readonly ISessionRecoveryManifestStore _manifestStore;

        public HostFixture(IVisioSessionBackend? sessionBackend = null, ISessionRecoveryManifestStore? manifestStore = null)
        {
            Directory.CreateDirectory(_root);
            _sessionBackend = sessionBackend ?? Backend;
            _manifestStore = manifestStore ?? new EmptyManifestStore();
        }

        public RecordingSessionBackend Backend { get; } = new();

        public WorkerHostLineProcessor CreateLineProcessor() => new(CreateOptions());

        public WorkerHostLineProcessorOptions CreateOptions() => new()
        {
            OutputRoot = _root,
            Mode = "mock",
            SessionBackend = _sessionBackend,
            ManifestStore = _manifestStore,
            Clock = new SystemWorkerClock(),
            CheckpointInterval = TimeSpan.FromMinutes(15),
            Capacity = 4,
        };

        public string OpenJson(string requestId = "open-request") => JsonSerializer.Serialize(new
        {
            protocolVersion = 2,
            requestId,
            command = "open",
            session = Session(),
            outputPath = Path.Combine(_root, "session.vsdx"),
        }, JsonOptions);

        public string V1Json(params string[] protocolPropertyNames)
        {
            var names = protocolPropertyNames.Length == 0 ? ["protocolVersion"] : protocolPropertyNames;
            var protocolProperties = string.Join(",", names.Select(name => $"\"{name}\":1"));
            return $$"""{ {{protocolProperties}},"requestId":"v1-request","jobId":"v1-job","mode":"mock","outputPath":{{JsonSerializer.Serialize(Path.Combine(_root, "v1.vsdx"))}},"diagram":{{JsonSerializer.Serialize(_diagram, JsonOptions)}} }""";
        }

        public string ApplyJson(string operationId)
        {
            var planHash = DiagramPlanDigest.Compute(DiagramMapper.Map(_diagram));
            return JsonSerializer.Serialize(new
            {
                protocolVersion = 2,
                requestId = $"request-{operationId}",
                command = "apply",
                session = Session(),
                operationId,
                planHash,
                diagram = _diagram,
            }, JsonOptions);
        }

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        }

        private static object Session() => new
        {
            tenantId = "tenant",
            userId = "user",
            deviceId = "device",
            workflowId = "workflow",
        };
    }

    private sealed class EmptyManifestStore : ISessionRecoveryManifestStore
    {
        public Task SaveAsync(
            VisioSessionRecoveryManifest manifest,
            DateTimeOffset savedAt,
            DateTimeOffset lastActivity,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<StoredSessionRecoveryManifest?> LoadAsync(
            VisioSessionKey key,
            CancellationToken cancellationToken = default) => Task.FromResult<StoredSessionRecoveryManifest?>(null);
    }

    private sealed class RecordingSessionBackend : IVisioSessionBackend
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyPlanCalls { get; private set; }
        public int CloseCalls { get; private set; }

        public string NormalizeOutputPath(string outputPath) => Path.GetFullPath(outputPath);

        public Task<VisioSessionDocument> OpenOrCreateAsync(
            VisioSessionKey sessionKey,
            CancellationToken cancellationToken = default)
        {
            OpenOrCreateCalls++;
            return Task.FromResult(new VisioSessionDocument("document-1", "page-1"));
        }

        public Task ApplyPlanAsync(
            VisioSessionDocument document,
            DiagramDocument plan,
            CancellationToken cancellationToken = default)
        {
            ApplyPlanCalls++;
            return Task.CompletedTask;
        }

        public Task ApplyPlanDiffAsync(
            VisioSessionDocument document,
            DiagramDocument plan,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<VisioSessionDocument> SaveAsAsync(
            VisioSessionDocument document,
            string outputPath,
            CancellationToken cancellationToken = default) => Task.FromResult(document);

        public Task CloseAsync(
            VisioSessionDocument document,
            CancellationToken cancellationToken = default)
        {
            CloseCalls++;
            return Task.CompletedTask;
        }

        public Task<VisioSessionDocument> RecoverAsync(
            VisioSessionKey sessionKey,
            VisioSessionRecoveryManifest manifest,
            CancellationToken cancellationToken = default) => Task.FromResult(manifest.Document);
    }

    private sealed class ThrowingManifestStore : ISessionRecoveryManifestStore
    {
        public Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("injected runtime failure");
    }

    private static async Task<int> RunHostLoopAsync(TextReader input, TextWriter output, WorkerHostLineProcessorOptions options)
    {
        var loopType = typeof(WorkerHostLineProcessor).Assembly.GetType("VisioWorker.Host.WorkerHostLoop");
        Assert.True(loopType is not null, "The host loop must expose an integration seam.");
        if (loopType is null) return int.MinValue;

        var method = loopType.GetMethod("RunAsync", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, [typeof(TextReader), typeof(TextWriter), typeof(WorkerHostLineProcessorOptions), typeof(CancellationToken)]);
        Assert.True(method is not null, "The host loop must own processor lifetime and receive its input/output streams.");
        if (method is null) return int.MinValue;

        return await (Task<int>)method.Invoke(null, [input, output, options, CancellationToken.None])!;
    }

    private sealed class TrackingTextWriter : StringWriter
    {
        public int FlushCount { get; private set; }
        public IReadOnlyList<string> Lines => ToString().Split([Environment.NewLine], StringSplitOptions.RemoveEmptyEntries);

        public override Task FlushAsync()
        {
            FlushCount++;
            return base.FlushAsync();
        }
    }
}
