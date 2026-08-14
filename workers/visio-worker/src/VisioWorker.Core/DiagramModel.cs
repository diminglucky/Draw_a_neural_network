namespace VisioWorker.Core;

public sealed class DiagramEnvelope
{
    public DiagramFigure Figure { get; init; } = new();
    public IReadOnlyList<DiagramNode> Nodes { get; init; } = [];
    public IReadOnlyList<DiagramEdge> Edges { get; init; } = [];
    public DiagramFigurePlan? FigurePlan { get; init; }
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
    public string TensorShape { get; init; } = "";
    public string VisualRole { get; init; } = "standard";
    public string LayerRole { get; init; } = "network-node";
    public int RepeatCount { get; init; } = 1;
    public int Depth { get; init; } = 1;
    public bool Perspective { get; init; }
    public string? Color { get; init; }
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

public sealed class DiagramFigurePlan
{
    public DiagramCoordinateSpace CoordinateSpace { get; init; } = new();
    public IReadOnlyList<DiagramPrimitiveGroup> PrimitiveGroups { get; init; } = [];
    public IReadOnlyList<DiagramFigureConnector> Connectors { get; init; } = [];
    public IReadOnlyList<DiagramFigureLabel> Labels { get; init; } = [];
}

public sealed class DiagramCoordinateSpace
{
    public string Unit { get; init; } = "";
    public double FigureUnitInches { get; init; }
    public string Origin { get; init; } = "";
    public double Width { get; init; }
    public double Height { get; init; }
}

public sealed class DiagramPrimitiveGroup
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public IReadOnlyList<string> PrimitiveIds { get; init; } = [];
    public DiagramBounds Bounds { get; init; } = new();
    public double ExtrusionDepthFu { get; init; }
    public double SkewXFu { get; init; }
    public double SkewYFu { get; init; }
    public DiagramPrimitiveSemantic Semantic { get; init; } = new();
}

public sealed class DiagramBounds
{
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
}

public sealed class DiagramPrimitiveSemantic
{
    public string SourceNodeId { get; init; } = "";
    public int Stage { get; init; }
    public string VisualRole { get; init; } = "standard";
    public string LayerRole { get; init; } = "network-node";
    public int RepeatCount { get; init; } = 1;
    public int? ChannelCount { get; init; }
    public IReadOnlyList<object> TensorShape { get; init; } = [];
    public int? InputSpatialSize { get; init; }
    public int? OutputSpatialSize { get; init; }
}

public sealed class DiagramFigureConnector
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "forward";
    public string SourceGroupId { get; init; } = "";
    public string TargetGroupId { get; init; } = "";
    public string SourcePrimitiveId { get; init; } = "";
    public string TargetPrimitiveId { get; init; } = "";
    public IReadOnlyList<DiagramPoint> Points { get; init; } = [];
}

public sealed class DiagramFigureLabel
{
    public string Id { get; init; } = "";
    public string GroupId { get; init; } = "";
    public string Text { get; init; } = "";
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public double FontSizePt { get; init; }
}

public sealed record DiagramDocument(
    string Title,
    IReadOnlyList<string> StageLabels,
    IReadOnlyList<VisioNode> Nodes,
    IReadOnlyList<VisioConnector> Connectors,
    VisioFigurePlan? FigurePlan = null);

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
    string TensorShape,
    string VisualRole,
    string LayerRole,
    int RepeatCount,
    int Depth,
    bool Perspective,
    string? Color,
    IReadOnlyDictionary<string, string> ShapeData);

public sealed record VisioConnector(
    string Id,
    string Source,
    string Target,
    string Kind,
    IReadOnlyList<DiagramPoint> Points);

public sealed record VisioFigurePlan(
    double PageWidthInches,
    double PageHeightInches,
    IReadOnlyList<VisioPrimitiveGroup> PrimitiveGroups,
    IReadOnlyList<VisioConnector> Connectors,
    IReadOnlyList<VisioFigureLabel>? Labels = null);

public sealed record VisioPrimitiveGroup(
    string Id,
    string Kind,
    VisioBounds Bounds,
    double ExtrusionDepthInches,
    double SkewXInches,
    double SkewYInches,
    IReadOnlyList<string> PrimitiveIds,
    IReadOnlyDictionary<string, string> ShapeData);

public readonly record struct VisioBounds(double XInches, double YInches, double WidthInches, double HeightInches);

public sealed record VisioFigureLabel(
    string Id,
    string GroupId,
    string Text,
    double XInches,
    double YInches,
    double WidthInches,
    double HeightInches,
    double FontSizePt);

public sealed record ReadbackPrimitive(string Id, IReadOnlyDictionary<string, string> ShapeData);

public sealed record ReadbackResult(
    bool Valid,
    int ShapeCount,
    int ConnectorCount,
    IReadOnlyList<string> ExpectedPrimitiveIds,
    IReadOnlyList<string> ActualPrimitiveIds,
    IReadOnlyList<string> MissingPrimitiveIds,
    IReadOnlyList<string> ExpectedConnectorIds,
    IReadOnlyList<string> ActualConnectorIds,
    IReadOnlyList<string> MissingConnectorIds,
    IReadOnlyList<string> ShapeDataFailures,
    string? DiagnosticPath = null);

public interface IVisioEngine
{
    Task<ReadbackResult> RenderAsync(DiagramDocument document, string outputPath, CancellationToken cancellationToken = default);
}
