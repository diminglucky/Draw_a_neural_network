using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

/// <summary>Maps only the finite, exact pvp-native-intent-1 vocabulary into Visio nodes.</summary>
public static class SelectedPageNativeIntentMapper
{
    private static readonly HashSet<string> PrimitiveKinds = ["terminal", "module", "split", "merge-add", "merge-concat", "repeat-badge"];
    private static readonly HashSet<string> ConnectorKinds = ["flow", "skip", "merge", "condition"];
    private static readonly string[] RootProperties = ["protocolVersion", "planId", "planHash", "updateIdentity", "coordinateSpace", "primitives", "connectors"];
    private static readonly string[] UpdateIdentityProperties = ["ownerId", "deviceId", "workflowId", "documentId", "pageId", "expectedRevision"];
    private static readonly string[] CoordinateProperties = ["id", "unit", "duPerInch", "page"];
    private static readonly string[] BoundsProperties = ["x", "y", "width", "height"];
    private static readonly string[] PrimitiveProperties = ["primitiveId", "componentId", "nativeKind", "label", "bounds", "styleTokenIds", "shapeData"];
    private static readonly string[] RichPrimitiveProperties = ["visualKind", "zIndex", "style", "visual"];
    private static readonly string[] PrimitiveShapeDataProperties = ["pvp.planId", "pvp.planHash", "pvp.primitiveId", "pvp.componentId", "pvp.ownership"];
    private static readonly string[] ConnectorProperties = ["connectorId", "nativeKind", "sourcePrimitiveId", "sourcePortId", "targetPrimitiveId", "targetPortId", "route", "styleTokenIds", "shapeData"];
    private static readonly string[] RichConnectorProperties = ["zIndex", "style"];
    private static readonly string[] ConnectorShapeDataProperties = ["pvp.planId", "pvp.planHash", "pvp.connectorId", "pvp.ownership"];
    private static readonly string[] PointProperties = ["x", "y"];

    public static DiagramDocument Map(JsonElement intent, SelectedPageWorkerRequest? sealedRequest = null)
    {
        var root = Properties(intent, "selected-page native intent", RootProperties);
        if (String(root, "protocolVersion", "selected-page native intent") != "pvp-native-intent-1")
            throw new WorkerProtocolException("Selected-page native intent protocol is invalid.");

        var planId = Id(root, "planId", "selected-page native intent");
        var planHash = Hash(root, "planHash", "selected-page native intent");
        var updateIdentity = ValidateUpdateIdentity(root["updateIdentity"]);
        if (sealedRequest is not null) ValidateSealedRequestBinding(sealedRequest, planId, updateIdentity);
        var page = CoordinateSpace(root["coordinateSpace"]);

        var nodes = new List<VisioNode>();
        var groups = new List<(int ZIndex, VisioPrimitiveGroup Group)>();
        var labels = new List<VisioFigureLabel>();
        var primitiveIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var primitive in Array(root, "primitives", "selected-page native intent"))
        {
            var properties = Properties(primitive, "selected-page native primitive", PrimitiveProperties, RichPrimitiveProperties);
            var primitiveId = Id(properties, "primitiveId", "selected-page native primitive");
            var componentId = Id(properties, "componentId", "selected-page native primitive");
            var kind = String(properties, "nativeKind", "selected-page native primitive");
            if (!PrimitiveKinds.Contains(kind) || !primitiveIds.Add(primitiveId))
                throw new WorkerProtocolException("Selected-page native primitive is unsupported or duplicated.");
            var label = String(properties, "label", "selected-page native primitive");
            if (label.Length > 512) throw new WorkerProtocolException("Selected-page native primitive label is invalid.");
            var bounds = Bounds(properties["bounds"], "selected-page native primitive bounds", positiveSize: true);
            RequireWithinPage(bounds, page, "Selected-page native primitive bounds are outside the declared page.");
            ValidateStyleTokenIds(properties["styleTokenIds"]);
            var visualKind = properties.TryGetValue("visualKind", out var visualKindValue)
                ? String(visualKindValue, "visualKind", "selected-page native primitive")
                : LegacyVisualKind(kind);
            var zIndex = properties.TryGetValue("zIndex", out var zIndexValue)
                ? NonNegativeInteger(zIndexValue, "zIndex", "selected-page native primitive")
                : 0;
            var style = properties.TryGetValue("style", out var styleValue)
                ? Style(styleValue, requireFill: true, "selected-page native primitive style")
                : new VisioPrimitiveStyle("#ffffff", "#1e293b", 1.2);
            var primitiveIdsForFigure = properties.TryGetValue("visual", out var visual)
                ? ValidateVisualAndCreatePrimitiveIds(visual, visualKind, primitiveId, page)
                : [primitiveId];
            ValidateShapeData(properties["shapeData"], PrimitiveShapeDataProperties, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["pvp.planId"] = planId,
                ["pvp.planHash"] = planHash,
                ["pvp.primitiveId"] = primitiveId,
                ["pvp.componentId"] = componentId,
                ["pvp.ownership"] = "agent",
            }, "selected-page native primitive shapeData");

            var shapeData = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["pvp.planId"] = planId,
                    ["pvp.planHash"] = planHash,
                    ["pvp.primitiveId"] = primitiveId,
                    ["pvp.componentId"] = componentId,
                    ["pvp.ownership"] = "agent",
                    ["pvp.visualKind"] = visualKind,
                };
            nodes.Add(new VisioNode(primitiveId, kind, label, null, 0, bounds.X / 1000d, bounds.Y / 1000d, bounds.Width / 1000d, bounds.Height / 1000d, "", Role(kind), kind, 1, 1, false, style.FillColor, shapeData));
            var figureKind = FigureKind(visualKind);
            groups.Add((zIndex, new VisioPrimitiveGroup(
                primitiveId,
                figureKind,
                new VisioBounds(bounds.X / 1000d, bounds.Y / 1000d, bounds.Width / 1000d, bounds.Height / 1000d),
                Math.Clamp(Math.Min(bounds.Width, bounds.Height) / 8000d, 0.04, 0.14),
                0.06,
                0.05,
                primitiveIdsForFigure,
                shapeData,
                style,
                InlineLabel(figureKind, label))));
            if (UsesExternalLabel(figureKind)) labels.Add(CreateLabel(primitiveId, label, bounds, page));
        }

        var edges = new List<VisioConnector>();
        var connectorIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var connector in Array(root, "connectors", "selected-page native intent"))
        {
            var properties = Properties(connector, "selected-page native connector", ConnectorProperties, RichConnectorProperties);
            var connectorId = Id(properties, "connectorId", "selected-page native connector");
            var kind = String(properties, "nativeKind", "selected-page native connector");
            var source = Id(properties, "sourcePrimitiveId", "selected-page native connector");
            var target = Id(properties, "targetPrimitiveId", "selected-page native connector");
            _ = Id(properties, "sourcePortId", "selected-page native connector");
            _ = Id(properties, "targetPortId", "selected-page native connector");
            if (!ConnectorKinds.Contains(kind) || !connectorIds.Add(connectorId) || !primitiveIds.Contains(source) || !primitiveIds.Contains(target) || source == target)
                throw new WorkerProtocolException("Selected-page native connector is invalid.");
            var route = Array(properties, "route", "selected-page native connector").Select(point => Point(point, page)).ToArray();
            if (route.Length < 2) throw new WorkerProtocolException("Selected-page native connector route is invalid.");
            ValidateStyleTokenIds(properties["styleTokenIds"]);
            var style = properties.TryGetValue("style", out var styleValue)
                ? LineStyle(styleValue, "selected-page native connector style")
                : new VisioLineStyle("#475569", 1.2);
            ValidateShapeData(properties["shapeData"], ConnectorShapeDataProperties, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["pvp.planId"] = planId,
                ["pvp.planHash"] = planHash,
                ["pvp.connectorId"] = connectorId,
                ["pvp.ownership"] = "agent",
            }, "selected-page native connector shapeData");
            edges.Add(new VisioConnector(connectorId, source, target, kind, route, style));
        }
        var figurePlan = new VisioFigurePlan(
            page.Width / 1000d,
            page.Height / 1000d,
            groups.OrderBy(item => item.ZIndex).ThenBy(item => item.Group.Id, StringComparer.Ordinal).Select(item => item.Group).ToArray(),
            edges,
            labels);
        return new DiagramDocument(string.Empty, [], nodes, edges, figurePlan);
    }

    private static VisioFigureLabel CreateLabel(string primitiveId, string label, NativeBounds bounds, NativeBounds page)
    {
        var pageWidth = page.Width / 1000d;
        var primitiveX = bounds.X / 1000d;
        var primitiveWidth = bounds.Width / 1000d;
        var estimatedTextWidth = Math.Clamp(label.Length * 0.085, 1.2, 2.4);
        var width = Math.Min(pageWidth, Math.Max(primitiveWidth, estimatedTextWidth));
        var x = Math.Clamp(primitiveX + (primitiveWidth - width) / 2, 0, Math.Max(0, pageWidth - width));
        var height = 0.24;
        var preferredY = (bounds.Y + bounds.Height) / 1000d + 0.05;
        var y = Math.Min(preferredY, Math.Max(0, page.Height / 1000d - height - 0.02));
        var fontSize = bounds.Height >= 180 ? 9d : 8d;
        return new VisioFigureLabel(primitiveId + ".label", primitiveId, label, x, y, width, height, fontSize);
    }

    private static string? InlineLabel(string figureKind, string label) => figureKind switch
    {
        "pvp-input-terminal" or "pvp-output-terminal" or "pvp-tensor-stage"
            or "pvp-operator-frame" or "pvp-module-frame" or "pvp-repeat-badge" => label,
        _ => null,
    };

    private static bool UsesExternalLabel(string figureKind) => figureKind is
        "pvp-tensor-volume" or "pvp-attention-token-strip";

    private static string FigureKind(string visualKind) => visualKind switch
    {
        "InputTerminal" or "Input" => "pvp-input-terminal",
        "OutputTerminal" or "Output" => "pvp-output-terminal",
        "TensorStage" => "pvp-tensor-stage",
        "TensorVolume" => "pvp-tensor-volume",
        "OperatorFrame" or "CustomOperator" => "pvp-operator-frame",
        "ModuleFrame" or "GenericModule" or "CustomModule" => "pvp-module-frame",
        "RepeatBadge" => "pvp-repeat-badge",
        "SplitMarker" or "Split" => "pvp-split-marker",
        "AddMarker" or "MergeAdd" => "pvp-add-marker",
        "ConcatMarker" or "MergeConcat" or "CustomFusion" => "pvp-concat-marker",
        "AttentionTokenStrip" => "pvp-attention-token-strip",
        "AttentionRelation" => "pvp-attention-relation",
        _ => throw new WorkerProtocolException($"Selected-page native visual kind is unsupported: {visualKind}.")
    };

    private static string LegacyVisualKind(string nativeKind) => nativeKind switch
    {
        "terminal" => "InputTerminal",
        "module" => "ModuleFrame",
        "split" => "SplitMarker",
        "merge-add" => "AddMarker",
        "merge-concat" => "ConcatMarker",
        "repeat-badge" => "RepeatBadge",
        _ => throw new WorkerProtocolException("Selected-page native primitive kind is unsupported.")
    };

    private static IReadOnlyList<string> ValidateVisualAndCreatePrimitiveIds(JsonElement value, string visualKind, string primitiveId, NativeBounds page)
    {
        var properties = Properties(value, "selected-page native primitive visual", ["regionRole", "nativeSupport", "geometry"]);
        _ = String(properties, "regionRole", "selected-page native primitive visual");
        if (String(properties, "nativeSupport", "selected-page native primitive visual") != "supported")
            throw new WorkerProtocolException("Selected-page native primitive is not supported by the native renderer.");
        var geometry = Properties(properties["geometry"], "selected-page native primitive geometry", visualKind switch
        {
            "TensorVolume" => ["kind", "frontFace", "depthFace"],
            "AttentionTokenStrip" => ["kind", "orderedCells"],
            _ => ["kind"],
        });
        var geometryKind = String(geometry, "kind", "selected-page native primitive geometry");
        if (visualKind == "TensorVolume")
        {
            if (geometryKind != "tensor_volume") throw new WorkerProtocolException("Selected-page tensor-volume geometry is invalid.");
            ValidateFace(geometry["frontFace"], page);
            ValidateFace(geometry["depthFace"], page);
            return [primitiveId + ".front", primitiveId + ".top", primitiveId + ".side"];
        }
        if (visualKind == "AttentionTokenStrip")
        {
            if (geometryKind != "ordered_cells") throw new WorkerProtocolException("Selected-page token-strip geometry is invalid.");
            var cells = Array(geometry, "orderedCells", "selected-page token-strip geometry");
            if (cells.Length < 2) throw new WorkerProtocolException("Selected-page token-strip geometry is invalid.");
            return cells.Select((cell, expectedOrder) =>
            {
                var item = Properties(cell, "selected-page token cell", ["cellId", "order", "bounds"]);
                var cellId = Id(item, "cellId", "selected-page token cell");
                if (NonNegativeInteger(item["order"], "order", "selected-page token cell") != expectedOrder)
                    throw new WorkerProtocolException("Selected-page token cells are unordered.");
                RequireWithinPage(Bounds(item["bounds"], "selected-page token cell bounds", positiveSize: true), page, "Selected-page token cell is outside the declared page.");
                return cellId;
            }).ToArray();
        }
        if (geometryKind != "none") throw new WorkerProtocolException("Selected-page native primitive geometry is invalid.");
        return [primitiveId];
    }

    private static void ValidateFace(JsonElement value, NativeBounds page)
    {
        var points = Array(value, "face", "selected-page tensor-volume geometry");
        if (points.Length != 4) throw new WorkerProtocolException("Selected-page tensor-volume face is invalid.");
        foreach (var point in points) _ = Point(point, page);
    }

    private static VisioPrimitiveStyle Style(JsonElement value, bool requireFill, string context)
    {
        var properties = Properties(value, context, requireFill ? ["fill", "stroke", "strokeWidthPt"] : ["stroke", "strokeWidthPt"]);
        return new VisioPrimitiveStyle(
            requireFill ? Color(properties, "fill", context) : "#ffffff",
            Color(properties, "stroke", context),
            PositiveNumber(properties, "strokeWidthPt", context));
    }

    private static VisioLineStyle LineStyle(JsonElement value, string context)
    {
        var style = Style(value, requireFill: false, context);
        return new VisioLineStyle(style.StrokeColor, style.StrokeWidthPoints);
    }

    private static string Color(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        var color = String(properties, name, context);
        if (color.Length != 7 || color[0] != '#' || color[1..].Any(character => !Uri.IsHexDigit(character)))
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return color.ToLowerInvariant();
    }

    private static double PositiveNumber(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var result) || !double.IsFinite(result) || result <= 0 || result > 20)
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return result;
    }

    private static int NonNegativeInteger(JsonElement value, string name, string context)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var result) || result < 0)
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return result;
    }

    private static NativeUpdateIdentity ValidateUpdateIdentity(JsonElement value)
    {
        var properties = Properties(value, "selected-page native update identity", UpdateIdentityProperties);
        var expectedRevision = Integer(properties, "expectedRevision", "selected-page native update identity");
        if (expectedRevision < 1)
            throw new WorkerProtocolException("Selected-page native update identity revision is invalid.");
        return new NativeUpdateIdentity(
            Id(properties, "ownerId", "selected-page native update identity"),
            Id(properties, "deviceId", "selected-page native update identity"),
            Id(properties, "workflowId", "selected-page native update identity"),
            Id(properties, "documentId", "selected-page native update identity"),
            Id(properties, "pageId", "selected-page native update identity"),
            expectedRevision);
    }

    private static void ValidateSealedRequestBinding(SelectedPageWorkerRequest request, string planId, NativeUpdateIdentity updateIdentity)
    {
        if (request.Command != SelectedPageWorkerCommand.ApplyOwnedRegion || request.SealedNativeIntent is not JsonElement sealedIntent)
            throw new WorkerProtocolException("Selected-page native intent must be mapped from a sealed apply request.");
        var binding = request.Binding ?? throw new WorkerProtocolException("Selected-page native intent requires a page binding.");
        if (!sealedIntent.TryGetProperty("planId", out var sealedPlanId)
            || !string.Equals(String(sealedPlanId, "planId", "selected-page sealed native intent"), planId, StringComparison.Ordinal)
            || !string.Equals(updateIdentity.OwnerId, binding.UserId, StringComparison.Ordinal)
            || !string.Equals(updateIdentity.DeviceId, binding.DeviceId, StringComparison.Ordinal)
            || !string.Equals(updateIdentity.WorkflowId, binding.WorkflowId, StringComparison.Ordinal)
            || !string.Equals(updateIdentity.DocumentId, binding.DocumentId, StringComparison.Ordinal)
            || !string.Equals(updateIdentity.PageId, binding.PageId, StringComparison.Ordinal)
            || updateIdentity.ExpectedRevision != binding.ExpectedRevision)
            throw new WorkerProtocolException("Selected-page native intent does not match the sealed selected-page binding.");
    }

    private static NativeBounds CoordinateSpace(JsonElement value)
    {
        var properties = Properties(value, "selected-page native coordinate space", CoordinateProperties);
        if (String(properties, "id", "selected-page native coordinate space") != "pvp-du-1"
            || String(properties, "unit", "selected-page native coordinate space") != "du"
            || Integer(properties, "duPerInch", "selected-page native coordinate space") != 1000)
            throw new WorkerProtocolException("Selected-page native coordinate space is invalid.");
        var page = Bounds(properties["page"], "selected-page native page", positiveSize: true);
        if (page.X != 0 || page.Y != 0) throw new WorkerProtocolException("Selected-page native page origin is invalid.");
        return page;
    }

    private static void ValidateStyleTokenIds(JsonElement value)
    {
        var ids = Array(value, "styleTokenIds", "selected-page native").Select((item, index) => Id(item, $"styleTokenIds[{index}]", "selected-page native")).ToArray();
        if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Length)
            throw new WorkerProtocolException("Selected-page native style token IDs are duplicated.");
    }

    private static void ValidateShapeData(JsonElement value, IReadOnlyCollection<string> expectedKeys, IReadOnlyDictionary<string, string> expectedValues, string context)
    {
        var properties = Properties(value, context, expectedKeys);
        foreach (var (key, expected) in expectedValues)
        {
            if (!string.Equals(String(properties, key, context), expected, StringComparison.Ordinal))
                throw new WorkerProtocolException($"{context} does not match the sealed native plan.");
        }
    }

    private static NativeBounds Bounds(JsonElement value, string context, bool positiveSize)
    {
        var properties = Properties(value, context, BoundsProperties);
        var bounds = new NativeBounds(
            Integer(properties, "x", context),
            Integer(properties, "y", context),
            Integer(properties, "width", context),
            Integer(properties, "height", context));
        if (bounds.X < 0 || bounds.Y < 0 || (positiveSize && (bounds.Width <= 0 || bounds.Height <= 0)) || (!positiveSize && (bounds.Width < 0 || bounds.Height < 0)))
            throw new WorkerProtocolException($"{context} is invalid.");
        return bounds;
    }

    private static void RequireWithinPage(NativeBounds bounds, NativeBounds page, string error)
    {
        if (bounds.X > page.Width || bounds.Y > page.Height || bounds.Width > page.Width - bounds.X || bounds.Height > page.Height - bounds.Y)
            throw new WorkerProtocolException(error);
    }

    private static DiagramPoint Point(JsonElement value, NativeBounds page)
    {
        var properties = Properties(value, "selected-page native connector route point", PointProperties);
        var x = Integer(properties, "x", "selected-page native connector route point");
        var y = Integer(properties, "y", "selected-page native connector route point");
        if (x < 0 || y < 0 || x > page.Width || y > page.Height)
            throw new WorkerProtocolException("Selected-page native connector route point is outside the declared page.");
        return new DiagramPoint(x / 1000d, y / 1000d);
    }

    private static Dictionary<string, JsonElement> Properties(JsonElement value, string context, IReadOnlyCollection<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException($"{context} must be an object.");
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!result.TryAdd(property.Name, property.Value)) throw new WorkerProtocolException($"{context} contains a duplicate property.");
        }
        if (result.Count != expected.Count || expected.Any(name => !result.ContainsKey(name)) || result.Keys.Any(name => !expected.Contains(name, StringComparer.Ordinal)))
            throw new WorkerProtocolException($"{context} contains unknown or missing properties.");
        return result;
    }

    private static Dictionary<string, JsonElement> Properties(JsonElement value, string context, IReadOnlyCollection<string> required, IReadOnlyCollection<string> optional)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException($"{context} must be an object.");
        var allowed = required.Concat(optional).ToHashSet(StringComparer.Ordinal);
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!allowed.Contains(property.Name) || !result.TryAdd(property.Name, property.Value))
                throw new WorkerProtocolException($"{context} contains unknown or duplicate properties.");
        }
        if (required.Any(name => !result.ContainsKey(name)))
            throw new WorkerProtocolException($"{context} contains unknown or missing properties.");
        return result;
    }

    private static JsonElement[] Array(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value)) throw new WorkerProtocolException($"{context} {name} is required.");
        return Array(value, name, context);
    }

    private static JsonElement[] Array(JsonElement value, string name, string context)
    {
        if (value.ValueKind != JsonValueKind.Array) throw new WorkerProtocolException($"{context} {name} is invalid.");
        return value.EnumerateArray().ToArray();
    }

    private static string String(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value)) throw new WorkerProtocolException($"{context} {name} is required.");
        return String(value, name, context);
    }

    private static string String(JsonElement value, string name, string context) => value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
        ? value.GetString()!
        : throw new WorkerProtocolException($"{context} {name} is invalid.");

    private static string Id(IReadOnlyDictionary<string, JsonElement> properties, string name, string context) => Id(properties.TryGetValue(name, out var value) ? value : default, name, context);
    private static string Id(JsonElement value, string name, string context)
    {
        var result = String(value, name, context);
        if (result.Length > 192 || !char.IsAsciiLetter(result[0]) || result.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '.' and not '_' and not ':' and not '-'))
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return result;
    }

    private static string Hash(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        var result = String(properties, name, context);
        if (result.Length != 64 || result.Any(character => !(character is >= 'a' and <= 'f' or >= '0' and <= '9')))
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return result;
    }

    private static long Integer(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var result))
            throw new WorkerProtocolException($"{context} {name} is invalid.");
        return result;
    }

    private static string Role(string kind) => kind is "terminal" ? "standard" : kind is "repeat-badge" ? "fully-connected" : "standard";

    private readonly record struct NativeBounds(long X, long Y, long Width, long Height);
    private readonly record struct NativeUpdateIdentity(string OwnerId, string DeviceId, string WorkflowId, string DocumentId, string PageId, long ExpectedRevision);
}
