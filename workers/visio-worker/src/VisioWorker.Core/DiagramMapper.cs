namespace VisioWorker.Core;

public static class DiagramMapper
{
    public const double PixelsPerInch = 100.0;

    public static DiagramDocument Map(DiagramEnvelope diagram)
    {
        ArgumentNullException.ThrowIfNull(diagram);

        var nodes = new List<VisioNode>(diagram.Nodes.Count);
        var nodeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in diagram.Nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Id) || !nodeIds.Add(node.Id))
                throw new InvalidOperationException($"Diagram contains a duplicate or empty node id: {node.Id}");
            if (node.Width < 1 || node.Height < 1)
                throw new InvalidOperationException($"Diagram node {node.Id} has invalid dimensions.");

            nodes.Add(new VisioNode(
                node.Id,
                node.Kind,
                node.Label,
                node.Subtitle,
                node.Stage,
                ToInches(node.X),
                ToInches(node.Y),
                ToInches(node.Width),
                ToInches(node.Height),
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["synapse.nodeId"] = node.Id,
                    ["synapse.kind"] = node.Kind,
                    ["synapse.label"] = node.Label,
                    ["synapse.stage"] = node.Stage.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["synapse.subtitle"] = node.Subtitle ?? "",
                }));
        }

        var connectors = new List<VisioConnector>(diagram.Edges.Count);
        foreach (var edge in diagram.Edges)
        {
            if (!nodeIds.Contains(edge.Source) || !nodeIds.Contains(edge.Target))
                throw new InvalidOperationException($"Diagram edge {edge.Id} references a missing node.");
            if (edge.Points.Count < 2)
                throw new InvalidOperationException($"Diagram edge {edge.Id} has fewer than two route points.");

            connectors.Add(new VisioConnector(
                edge.Id,
                edge.Source,
                edge.Target,
                edge.Kind,
                edge.Points.Select(point => new DiagramPoint(ToInches(point.X), ToInches(point.Y))).ToArray()));
        }

        return new DiagramDocument(
            diagram.Figure.Title,
            diagram.Figure.StageLabels.ToArray(),
            nodes,
            connectors);
    }

    private static double ToInches(double pixels) => Math.Round(pixels / PixelsPerInch, 4, MidpointRounding.AwayFromZero);
}
