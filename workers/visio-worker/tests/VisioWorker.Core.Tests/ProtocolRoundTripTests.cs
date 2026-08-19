using VisioWorker.Core;
using VisioWorker.Host;
using System.Text.Json;

namespace VisioWorker.Core.Tests;

public sealed class ProtocolRoundTripTests
{
    [Fact]
    public async Task Host_line_processor_preserves_v1_mock_round_trip()
    {
        var root = Path.Combine(Path.GetTempPath(), $"visio-worker-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var request = new WorkerRequest
            {
                ProtocolVersion = 1,
                RequestId = "request-v1",
                JobId = "job-v1",
                Mode = "live",
                OutputPath = Path.Combine(root, "job-v1.vsdx"),
                Diagram = Fixtures.CnnDiagram(),
            };
            await using var processor = new WorkerHostLineProcessor(new WorkerHostLineProcessorOptions
            {
                OutputRoot = root,
                Mode = "mock",
            });

            var response = Assert.IsType<WorkerResponse>(await processor.ProcessLineAsync(
                JsonSerializer.Serialize(request, new JsonSerializerOptions(JsonSerializerDefaults.Web))));

            Assert.Equal(1, response.ProtocolVersion);
            Assert.Equal(request.RequestId, response.RequestId);
            Assert.Equal(request.JobId, response.JobId);
            Assert.Equal("succeeded", response.Status);
            Assert.True(response.Readback?.Valid);
            Assert.True(File.Exists(request.OutputPath));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Mock_processor_round_trip_returns_a_valid_readback()
    {
        var root = Path.Combine(Path.GetTempPath(), $"visio-worker-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var request = new WorkerRequest
            {
                ProtocolVersion = 1,
                RequestId = "request-1",
                JobId = "job-1",
                Mode = "mock",
                OutputPath = Path.Combine(root, "job-1.vsdx"),
                Diagram = Fixtures.CnnDiagram(),
            };

            var response = await new WorkerRequestProcessor(root).ProcessAsync(request);

            Assert.Equal("succeeded", response.Status);
            Assert.True(response.Readback?.Valid);
            Assert.Equal(3, response.Readback?.ShapeCount);
            Assert.Equal(2, response.Readback?.ConnectorCount);
            Assert.Empty(response.Readback?.ExpectedPrimitiveIds ?? ["unexpected"]);
            Assert.Empty(response.Readback?.MissingPrimitiveIds ?? ["unexpected"]);
            Assert.Empty(response.Readback?.ShapeDataFailures ?? ["unexpected"]);
            Assert.True(File.Exists(request.OutputPath));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Processor_returns_failed_response_for_output_path_escape()
    {
        var root = Path.Combine(Path.GetTempPath(), $"visio-worker-{Guid.NewGuid():N}");
        var request = new WorkerRequest
        {
            ProtocolVersion = 1,
            RequestId = "request-2",
            JobId = "job-2",
            Mode = "mock",
            OutputPath = Path.Combine(root, "..", "outside.vsdx"),
            Diagram = Fixtures.CnnDiagram(),
        };

        var response = await new WorkerRequestProcessor(root).ProcessAsync(request);

        Assert.Equal("failed", response.Status);
        Assert.Equal("VISIO_WORKER_ERROR", response.Error?.Code);
    }
}
