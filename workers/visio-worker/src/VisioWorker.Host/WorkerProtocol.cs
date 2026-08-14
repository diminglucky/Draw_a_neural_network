using System.Text.Json.Serialization;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

public sealed class WorkerRequest
{
    public int ProtocolVersion { get; init; }
    public string RequestId { get; init; } = "";
    public string JobId { get; init; } = "";
    public string Mode { get; init; } = "mock";
    public string OutputPath { get; init; } = "";
    public DiagramEnvelope Diagram { get; init; } = new();
}

public sealed class WorkerResponse
{
    public int ProtocolVersion { get; init; } = 1;
    public string RequestId { get; init; } = "unknown";
    public string JobId { get; init; } = "unknown";
    public string Status { get; init; } = "failed";
    public string? Path { get; init; }
    public WorkerReadback? Readback { get; init; }
    public WorkerError? Error { get; init; }
}

public sealed class WorkerReadback
{
    public bool Valid { get; init; }
    public int ShapeCount { get; init; }
    public int ConnectorCount { get; init; }
    public IReadOnlyList<string> ExpectedPrimitiveIds { get; init; } = [];
    public IReadOnlyList<string> ActualPrimitiveIds { get; init; } = [];
    public IReadOnlyList<string> MissingPrimitiveIds { get; init; } = [];
    public IReadOnlyList<string> ExpectedConnectorIds { get; init; } = [];
    public IReadOnlyList<string> ActualConnectorIds { get; init; } = [];
    public IReadOnlyList<string> MissingConnectorIds { get; init; } = [];
    public IReadOnlyList<string> ShapeDataFailures { get; init; } = [];
}

public sealed class WorkerError
{
    public string Code { get; init; } = "VISIO_WORKER_ERROR";
    public string Message { get; init; } = "Visio Worker failed";
}

public sealed class WorkerRequestProcessor
{
    private readonly string _outputRoot;
    private readonly bool _visible;
    private readonly bool _attachToRunning;

    public WorkerRequestProcessor(string outputRoot, bool visible = false, bool attachToRunning = false)
    {
        _outputRoot = outputRoot;
        _visible = visible;
        _attachToRunning = attachToRunning;
    }

    public async Task<WorkerResponse> ProcessAsync(WorkerRequest request, CancellationToken cancellationToken = default)
    {
        try
        {
            ValidateEnvelope(request);
            var outputPath = VisioWorker.Live.PathPolicy.ValidateOutputPath(request.OutputPath, _outputRoot);
            var document = DiagramMapper.Map(request.Diagram);
            IVisioEngine engine = request.Mode.Equals("mock", StringComparison.OrdinalIgnoreCase)
                ? new MockVisioEngine()
                : request.Mode.Equals("live", StringComparison.OrdinalIgnoreCase)
                    ? new VisioWorker.Live.VisioComEngine(new VisioWorker.Live.VisioComEngineOptions(AttachToRunning: _attachToRunning, Visible: _visible, OutputRoot: _outputRoot))
                    : throw new WorkerProtocolException($"Unsupported Worker mode: {request.Mode}");
            try
            {
                var readback = await engine.RenderAsync(document, outputPath, cancellationToken).ConfigureAwait(false);
                if (!readback.Valid || !File.Exists(outputPath)) throw new WorkerProtocolException("Visio output readback was not valid");
                return new WorkerResponse
                {
                    RequestId = request.RequestId,
                    JobId = request.JobId,
                    Status = "succeeded",
                    Path = outputPath,
                    Readback = new WorkerReadback
                    {
                        Valid = readback.Valid,
                        ShapeCount = readback.ShapeCount,
                        ConnectorCount = readback.ConnectorCount,
                        ExpectedPrimitiveIds = readback.ExpectedPrimitiveIds,
                        ActualPrimitiveIds = readback.ActualPrimitiveIds,
                        MissingPrimitiveIds = readback.MissingPrimitiveIds,
                        ExpectedConnectorIds = readback.ExpectedConnectorIds,
                        ActualConnectorIds = readback.ActualConnectorIds,
                        MissingConnectorIds = readback.MissingConnectorIds,
                        ShapeDataFailures = readback.ShapeDataFailures,
                    },
                    Error = null,
                };
            }
            finally
            {
                if (engine is IAsyncDisposable disposable) await disposable.DisposeAsync().ConfigureAwait(false);
            }
        }
        catch (Exception error)
        {
            return new WorkerResponse
            {
                RequestId = request?.RequestId ?? "unknown",
                JobId = request?.JobId ?? "unknown",
                Status = "failed",
                Path = null,
                Readback = null,
                Error = new WorkerError { Code = error is VisioWorker.Live.WorkerProtocolException ? "VISIO_WORKER_ERROR" : "VISIO_WORKER_ERROR", Message = error.Message },
            };
        }
    }

    private static void ValidateEnvelope(WorkerRequest request)
    {
        if (request is null) throw new WorkerProtocolException("Worker request is required");
        if (request.ProtocolVersion != 1) throw new WorkerProtocolException($"Unsupported protocol version: {request.ProtocolVersion}");
        if (string.IsNullOrWhiteSpace(request.RequestId) || string.IsNullOrWhiteSpace(request.JobId)) throw new WorkerProtocolException("requestId and jobId are required");
        if (request.Diagram is null) throw new WorkerProtocolException("diagram is required");
    }
}
