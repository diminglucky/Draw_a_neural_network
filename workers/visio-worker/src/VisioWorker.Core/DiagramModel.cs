namespace VisioWorker.Core;

public sealed class DiagramEnvelope
{
    public DiagramFigure Figure { get; init; } = new();
    public IReadOnlyList<DiagramNode> Nodes { get; init; } = [];
    public IReadOnlyList<DiagramEdge> Edges { get; init; } = [];
}

public sealed class DiagramFigure
{
    public string Title { get; init; } = "Neural Network Architecture";
    public IReadOnlyList<string> StageLabels { get; init; } = [];
}

public sealed class DiagramNode
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "default";
    public string Label { get; init; } = "Node";
    public string? Subtitle { get; init; }
    public int Stage { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
}

public sealed class DiagramEdge
{
    public string Id { get; init; } = "";
    public string Source { get; init; } = "";
    public string Target { get; init; } = "";
    public string Kind { get; init; } = "signal";
    public IReadOnlyList<DiagramPoint> Points { get; init; } = [];
}

public readonly record struct DiagramPoint(double X, double Y);

public sealed record DiagramDocument(
    string Title,
    IReadOnlyList<string> StageLabels,
    IReadOnlyList<VisioNode> Nodes,
    IReadOnlyList<VisioConnector> Connectors);

public sealed record VisioNode(
    string Id,
    string Kind,
    string Label,
    string? Subtitle,
    int Stage,
    double XInches,
    double YInches,
    double WidthInches,
    double HeightInches,
    IReadOnlyDictionary<string, string> ShapeData);

public sealed record VisioConnector(
    string Id,
    string Source,
    string Target,
    string Kind,
    IReadOnlyList<DiagramPoint> Points);

public sealed record ReadbackResult(bool Valid, int ShapeCount, int ConnectorCount, string? DiagnosticPath = null);

public interface IVisioEngine
{
    Task<ReadbackResult> RenderAsync(DiagramDocument document, string outputPath, CancellationToken cancellationToken = default);
}
