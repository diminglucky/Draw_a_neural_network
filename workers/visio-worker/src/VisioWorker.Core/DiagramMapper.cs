namespace VisioWorker.Core;

public static class DiagramMapper
{
    public const double PixelsPerInch = 100.0;
    public const double FigureUnitInches = 0.01;

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
            if (node.RepeatCount < 1 || node.Depth < 1)
                throw new InvalidOperationException($"Diagram node {node.Id} has invalid visual depth metadata.");

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
                node.TensorShape,
                node.VisualRole,
                node.LayerRole,
                node.RepeatCount,
                node.Depth,
                node.Perspective,
                node.Color,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["synapse.nodeId"] = node.Id,
                    ["synapse.kind"] = node.Kind,
                    ["synapse.label"] = node.Label,
                    ["synapse.stage"] = node.Stage.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["synapse.subtitle"] = node.Subtitle ?? "",
                    ["synapse.tensorShape"] = node.TensorShape,
                    ["synapse.visualRole"] = node.VisualRole,
                    ["synapse.layerRole"] = node.LayerRole,
                    ["synapse.repeatCount"] = node.RepeatCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["synapse.depth"] = node.Depth.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["synapse.perspective"] = node.Perspective.ToString().ToLowerInvariant(),
                    ["synapse.color"] = node.Color ?? "",
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

        var figurePlan = diagram.FigurePlan is null ? null : MapFigurePlan(diagram.FigurePlan);

        return new DiagramDocument(
            diagram.Figure.Title,
            diagram.Figure.StageLabels.ToArray(),
            nodes,
            connectors,
            figurePlan);
    }

    private static double ToInches(double pixels) => Math.Round(pixels / PixelsPerInch, 4, MidpointRounding.AwayFromZero);

    private static VisioFigurePlan MapFigurePlan(DiagramFigurePlan plan)
    {
        if (!string.Equals(plan.CoordinateSpace.Unit, "figure-unit", StringComparison.Ordinal)
            || !string.Equals(plan.CoordinateSpace.Origin, "top-left", StringComparison.Ordinal)
            || Math.Abs(plan.CoordinateSpace.FigureUnitInches - FigureUnitInches) > 0.000001
            || plan.CoordinateSpace.Width <= 0
            || plan.CoordinateSpace.Height <= 0)
        {
            throw new InvalidOperationException("Figure Plan must use top-left figure-unit coordinates with a 0.01 inch unit.");
        }

        var groupIds = new HashSet<string>(StringComparer.Ordinal);
        var primitiveIds = new HashSet<string>(StringComparer.Ordinal);
        var groups = new List<VisioPrimitiveGroup>(plan.PrimitiveGroups.Count);
        foreach (var group in plan.PrimitiveGroups)
        {
            if (string.IsNullOrWhiteSpace(group.Id) || !groupIds.Add(group.Id))
                throw new InvalidOperationException($"Figure Plan contains a duplicate or empty primitive group id: {group.Id}");
            if (group.Bounds.Width <= 0 || group.Bounds.Height <= 0
                || group.Bounds.X < 0 || group.Bounds.Y < 0
                || group.Bounds.X + group.Bounds.Width > plan.CoordinateSpace.Width
                || group.Bounds.Y + group.Bounds.Height > plan.CoordinateSpace.Height)
            {
                throw new InvalidOperationException($"Figure Plan primitive group {group.Id} has invalid bounds.");
            }
            if (group.PrimitiveIds.Count == 0 || group.PrimitiveIds.Any(string.IsNullOrWhiteSpace)
                || group.PrimitiveIds.Any(id => !primitiveIds.Add(id)))
            {
                throw new InvalidOperationException($"Figure Plan primitive group {group.Id} has duplicate or empty primitive ids.");
            }
            if (string.Equals(group.Kind, "feature-map-prism", StringComparison.Ordinal)
                && !new[] { group.Id + ".front", group.Id + ".top", group.Id + ".side" }.All(group.PrimitiveIds.Contains))
            {
                throw new InvalidOperationException($"Feature-map prism {group.Id} must contain front, top, and side primitive ids.");
            }
            if (group.Semantic.RepeatCount < 1)
                throw new InvalidOperationException($"Figure Plan primitive group {group.Id} has an invalid repeat count.");

            var shapeData = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["synapse.planId"] = group.Id,
                ["synapse.sourceNodeId"] = group.Semantic.SourceNodeId,
                ["synapse.visualRole"] = group.Semantic.VisualRole,
                ["synapse.layerRole"] = group.Semantic.LayerRole,
                ["synapse.repeatCount"] = group.Semantic.RepeatCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["synapse.channelCount"] = group.Semantic.ChannelCount?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
                ["synapse.tensorShape"] = string.Join(" x ", group.Semantic.TensorShape.Select(value => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture))),
                ["synapse.inputSpatialSize"] = group.Semantic.InputSpatialSize?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
                ["synapse.outputSpatialSize"] = group.Semantic.OutputSpatialSize?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
                ["synapse.primitiveKind"] = group.Kind,
            };
            groups.Add(new VisioPrimitiveGroup(
                group.Id,
                group.Kind,
                new VisioBounds(
                    ToFigureInches(group.Bounds.X),
                    ToFigureInches(group.Bounds.Y),
                    ToFigureInches(group.Bounds.Width),
                    ToFigureInches(group.Bounds.Height)),
                ToFigureInches(group.ExtrusionDepthFu),
                ToFigureInches(group.SkewXFu),
                ToFigureInches(group.SkewYFu),
                group.PrimitiveIds.ToArray(),
                shapeData));
        }

        var connectors = new List<VisioConnector>(plan.Connectors.Count);
        foreach (var connector in plan.Connectors)
        {
            if (string.IsNullOrWhiteSpace(connector.Id)
                || !groupIds.Contains(connector.SourceGroupId)
                || !groupIds.Contains(connector.TargetGroupId)
                || connector.Points.Count < 2)
            {
                throw new InvalidOperationException($"Figure Plan connector {connector.Id} is invalid.");
            }
            connectors.Add(new VisioConnector(
                connector.Id,
                connector.SourceGroupId,
                connector.TargetGroupId,
                connector.Kind,
                connector.Points.Select(point => new DiagramPoint(ToFigureInches(point.X), ToFigureInches(point.Y))).ToArray()));
        }

        var labelIds = new HashSet<string>(StringComparer.Ordinal);
        var labels = new List<VisioFigureLabel>(plan.Labels.Count);
        foreach (var label in plan.Labels)
        {
            if (string.IsNullOrWhiteSpace(label.Id) || !labelIds.Add(label.Id)
                || !groupIds.Contains(label.GroupId)
                || string.IsNullOrWhiteSpace(label.Text)
                || label.Width <= 0 || label.Height <= 0
                || label.X < 0 || label.Y < 0
                || label.X + label.Width > plan.CoordinateSpace.Width
                || label.Y + label.Height > plan.CoordinateSpace.Height
                || label.FontSizePt < 7 || label.FontSizePt > 24)
            {
                throw new InvalidOperationException($"Figure Plan label {label.Id} is invalid.");
            }
            labels.Add(new VisioFigureLabel(
                label.Id,
                label.GroupId,
                label.Text,
                ToFigureInches(label.X),
                ToFigureInches(label.Y),
                ToFigureInches(label.Width),
                ToFigureInches(label.Height),
                label.FontSizePt));
        }

        return new VisioFigurePlan(
            ToFigureInches(plan.CoordinateSpace.Width),
            ToFigureInches(plan.CoordinateSpace.Height),
            groups,
            connectors,
            labels);
    }

    private static double ToFigureInches(double value) => Math.Round(value * FigureUnitInches, 4, MidpointRounding.AwayFromZero);
}
