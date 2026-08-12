using VisioWorker.Core;

namespace VisioWorker.Core.Tests;

public sealed class DiagramMapperTests
{
    [Fact]
    public void Maps_canvas_nodes_to_stable_page_coordinates_and_shape_data()
    {
        var document = DiagramMapper.Map(Fixtures.CnnDiagram());

        var node = Assert.Single(document.Nodes, item => item.Id == "input");
        Assert.Equal("input", node.ShapeData["synapse.nodeId"]);
        Assert.Equal("tensor", node.ShapeData["synapse.kind"]);
        Assert.Equal(1.0, node.XInches);
        Assert.Equal(1.0, node.YInches);
    }

    [Fact]
    public void Preserves_skip_route_points_and_stage_labels()
    {
        var document = DiagramMapper.Map(Fixtures.CnnDiagram());

        Assert.Equal(new[] { "Input", "Output" }, document.StageLabels);
        var connector = Assert.Single(document.Connectors, item => item.Kind == "skip");
        Assert.Equal(4, connector.Points.Count);
    }
}

internal static class Fixtures
{
    public static DiagramEnvelope CnnDiagram() => new()
    {
        Figure = new DiagramFigure { Title = "CNN", StageLabels = ["Input", "Output"] },
        Nodes =
        [
            new DiagramNode { Id = "input", Kind = "tensor", Label = "Input", Stage = 0, X = 100, Y = 100, Width = 100, Height = 100 },
            new DiagramNode { Id = "conv", Kind = "conv", Label = "Conv", Stage = 0, X = 100, Y = 300, Width = 100, Height = 100 },
            new DiagramNode { Id = "output", Kind = "output", Label = "Output", Stage = 1, X = 700, Y = 200, Width = 100, Height = 100 },
        ],
        Edges =
        [
            new DiagramEdge { Id = "edge-signal", Source = "conv", Target = "output", Kind = "signal", Points = [new DiagramPoint(200, 350), new DiagramPoint(700, 250)] },
            new DiagramEdge { Id = "edge-skip", Source = "input", Target = "output", Kind = "skip", Points = [new DiagramPoint(200, 150), new DiagramPoint(300, 50), new DiagramPoint(600, 50), new DiagramPoint(700, 250)] },
        ],
    };
}
