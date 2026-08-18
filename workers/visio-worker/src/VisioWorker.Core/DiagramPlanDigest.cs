using System.Buffers;
using System.Security.Cryptography;
using System.Text.Json;

namespace VisioWorker.Core;

/// <summary>Canonical SHA-256 identity for a fully mapped, typed drawing plan.</summary>
public static class DiagramPlanDigest
{
    public static string Compute(DiagramDocument plan)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var bytes = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(bytes))
        {
            WriteDocument(writer, plan);
        }

        return Convert.ToHexString(SHA256.HashData(bytes.WrittenSpan)).ToLowerInvariant();
    }

    private static void WriteDocument(Utf8JsonWriter writer, DiagramDocument plan)
    {
        writer.WriteStartObject();
        writer.WriteString("title", plan.Title);
        WriteStrings(writer, "stageLabels", plan.StageLabels);
        writer.WritePropertyName("nodes");
        writer.WriteStartArray();
        foreach (var node in plan.Nodes) WriteNode(writer, node);
        writer.WriteEndArray();
        WriteConnectors(writer, "connectors", plan.Connectors);
        writer.WritePropertyName("figurePlan");
        if (plan.FigurePlan is null) writer.WriteNullValue(); else WriteFigurePlan(writer, plan.FigurePlan);
        writer.WriteEndObject();
    }

    private static void WriteNode(Utf8JsonWriter writer, VisioNode node)
    {
        writer.WriteStartObject();
        writer.WriteString("id", node.Id); writer.WriteString("kind", node.Kind); writer.WriteString("label", node.Label);
        writer.WriteString("subtitle", node.Subtitle); writer.WriteNumber("stage", node.Stage);
        writer.WriteNumber("x", node.XInches); writer.WriteNumber("y", node.YInches); writer.WriteNumber("width", node.WidthInches); writer.WriteNumber("height", node.HeightInches);
        writer.WriteString("tensorShape", node.TensorShape); writer.WriteString("visualRole", node.VisualRole); writer.WriteString("layerRole", node.LayerRole);
        writer.WriteNumber("repeatCount", node.RepeatCount); writer.WriteNumber("depth", node.Depth); writer.WriteBoolean("perspective", node.Perspective); writer.WriteString("color", node.Color);
        WriteStrings(writer, "shapeData", node.ShapeData.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => pair.Key + "\u001f" + pair.Value));
        writer.WriteEndObject();
    }

    private static void WriteFigurePlan(Utf8JsonWriter writer, VisioFigurePlan plan)
    {
        writer.WriteStartObject();
        writer.WriteNumber("pageWidth", plan.PageWidthInches); writer.WriteNumber("pageHeight", plan.PageHeightInches);
        writer.WritePropertyName("groups"); writer.WriteStartArray();
        foreach (var group in plan.PrimitiveGroups)
        {
            writer.WriteStartObject(); writer.WriteString("id", group.Id); writer.WriteString("kind", group.Kind);
            writer.WriteNumber("x", group.Bounds.XInches); writer.WriteNumber("y", group.Bounds.YInches); writer.WriteNumber("width", group.Bounds.WidthInches); writer.WriteNumber("height", group.Bounds.HeightInches);
            writer.WriteNumber("extrusion", group.ExtrusionDepthInches); writer.WriteNumber("skewX", group.SkewXInches); writer.WriteNumber("skewY", group.SkewYInches);
            WriteStrings(writer, "primitiveIds", group.PrimitiveIds);
            WriteStrings(writer, "shapeData", group.ShapeData.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => pair.Key + "\u001f" + pair.Value));
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
        WriteConnectors(writer, "connectors", plan.Connectors);
        writer.WritePropertyName("labels"); writer.WriteStartArray();
        foreach (var label in plan.Labels ?? [])
        {
            writer.WriteStartObject(); writer.WriteString("id", label.Id); writer.WriteString("groupId", label.GroupId); writer.WriteString("text", label.Text);
            writer.WriteNumber("x", label.XInches); writer.WriteNumber("y", label.YInches); writer.WriteNumber("width", label.WidthInches); writer.WriteNumber("height", label.HeightInches); writer.WriteNumber("font", label.FontSizePt); writer.WriteEndObject();
        }
        writer.WriteEndArray(); writer.WriteEndObject();
    }

    private static void WriteConnectors(Utf8JsonWriter writer, string name, IReadOnlyList<VisioConnector> connectors)
    {
        writer.WritePropertyName(name); writer.WriteStartArray();
        foreach (var connector in connectors)
        {
            writer.WriteStartObject(); writer.WriteString("id", connector.Id); writer.WriteString("source", connector.Source); writer.WriteString("target", connector.Target); writer.WriteString("kind", connector.Kind);
            writer.WritePropertyName("points"); writer.WriteStartArray();
            foreach (var point in connector.Points) { writer.WriteStartArray(); writer.WriteNumberValue(point.X); writer.WriteNumberValue(point.Y); writer.WriteEndArray(); }
            writer.WriteEndArray(); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteStrings(Utf8JsonWriter writer, string name, IEnumerable<string> values)
    {
        writer.WritePropertyName(name); writer.WriteStartArray();
        foreach (var value in values) writer.WriteStringValue(value);
        writer.WriteEndArray();
    }
}
