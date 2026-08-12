using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class MockVisioEngineTests
{
    [Fact]
    public async Task Mock_engine_returns_counts_and_creates_the_requested_artifact()
    {
        var output = Path.Combine(Path.GetTempPath(), $"visio-mock-{Guid.NewGuid():N}.vsdx");
        try
        {
            var result = await new MockVisioEngine().RenderAsync(DiagramMapper.Map(Fixtures.CnnDiagram()), output);

            Assert.True(result.Valid);
            Assert.Equal(3, result.ShapeCount);
            Assert.Equal(2, result.ConnectorCount);
            Assert.True(File.Exists(output));
        }
        finally
        {
            if (File.Exists(output)) File.Delete(output);
        }
    }
}
