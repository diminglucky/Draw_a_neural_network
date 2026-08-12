using VisioWorker.Core;
using VisioWorker.Host;

namespace VisioWorker.Core.Tests;

public sealed class ProtocolRoundTripTests
{
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
