using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Host;

namespace VisioWorker.Core.Tests;

public sealed class WorkerHostLineProcessorTests
{
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

        public HostFixture() => Directory.CreateDirectory(_root);

        public RecordingSessionBackend Backend { get; } = new();

        public WorkerHostLineProcessor CreateLineProcessor() => new(new WorkerHostLineProcessorOptions
        {
            OutputRoot = _root,
            Mode = "mock",
            SessionBackend = Backend,
            ManifestStore = new EmptyManifestStore(),
            Clock = new SystemWorkerClock(),
            CheckpointInterval = TimeSpan.FromMinutes(15),
            Capacity = 4,
        });

        public string OpenJson() => JsonSerializer.Serialize(new
        {
            protocolVersion = 2,
            requestId = "open-request",
            command = "open",
            session = Session(),
            outputPath = Path.Combine(_root, "session.vsdx"),
        }, JsonOptions);

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
}
