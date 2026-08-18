using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

public enum WorkerV2Command
{
    Open,
    Apply,
    ApplyDiff,
    Save,
    Snapshot,
    Close,
    Recover,
}

public sealed record WorkerV2Session(string TenantId, string UserId, string DeviceId, string WorkflowId)
{
    public VisioSessionKey ToKey() => new(TenantId, UserId, DeviceId, WorkflowId);
}

public sealed record WorkerV2Request(
    string RequestId,
    WorkerV2Command Command,
    WorkerV2Session Session,
    string? OutputPath,
    string? OperationId,
    string? PlanHash,
    DiagramEnvelope? Diagram,
    string? CloseDisposition);

public sealed record WorkerV2Response(
    string RequestId,
    string Status,
    string? OutputPath = null,
    string? Error = null);

public static class WorkerV2RequestParser
{
    private static readonly JsonSerializerOptions DiagramJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
    };

    private static readonly IReadOnlyDictionary<WorkerV2Command, IReadOnlySet<string>> AllowedProperties =
        new Dictionary<WorkerV2Command, IReadOnlySet<string>>
        {
            [WorkerV2Command.Open] = Set("protocolVersion", "requestId", "command", "session", "outputPath"),
            [WorkerV2Command.Apply] = Set("protocolVersion", "requestId", "command", "session", "operationId", "planHash", "diagram"),
            [WorkerV2Command.ApplyDiff] = Set("protocolVersion", "requestId", "command", "session", "operationId", "planHash", "diagram"),
            [WorkerV2Command.Save] = Set("protocolVersion", "requestId", "command", "session", "outputPath"),
            [WorkerV2Command.Snapshot] = Set("protocolVersion", "requestId", "command", "session"),
            [WorkerV2Command.Close] = Set("protocolVersion", "requestId", "command", "session", "closeDisposition"),
            [WorkerV2Command.Recover] = Set("protocolVersion", "requestId", "command", "session"),
        };

    public static WorkerV2Request Parse(string json) => ParseCore(json, outputRoot: null);

    public static WorkerV2Request Parse(string json, string outputRoot)
    {
        if (string.IsNullOrWhiteSpace(outputRoot)) throw new WorkerProtocolException("output root is required");
        return ParseCore(json, outputRoot);
    }

    private static WorkerV2Request ParseCore(string json, string? outputRoot)
    {
        if (string.IsNullOrWhiteSpace(json)) throw new WorkerProtocolException("JSON request is required");

        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("Request must be a JSON object");

            var properties = ReadProperties(root, "request");
            RequireProperties(properties, "protocolVersion", "requestId", "command", "session");
            var protocolVersion = RequiredInt(properties, "protocolVersion");
            if (protocolVersion != 2) throw new WorkerProtocolException($"Unsupported protocol version: {protocolVersion}");

            var requestId = RequiredString(properties, "requestId");
            ValidateIdentifier(requestId, "requestId");
            var command = ParseCommand(RequiredString(properties, "command"));
            if (!AllowedProperties[command].SetEquals(properties.Keys))
            {
                var unknown = properties.Keys.Except(AllowedProperties[command], StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).FirstOrDefault();
                if (unknown is not null) throw new WorkerProtocolException($"Unknown property '{unknown}' for command '{command}'.");
                var missing = AllowedProperties[command].Except(properties.Keys, StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).First();
                throw new WorkerProtocolException($"Required property '{missing}' is missing for command '{command}'.");
            }

            var session = ParseSession(properties["session"]);
            _ = session.ToKey();

            var outputPath = properties.TryGetValue("outputPath", out var output)
                ? NormalizeOutputPath(output, outputRoot)
                : null;
            var operationId = properties.TryGetValue("operationId", out var operation) ? RequiredString(operation, "operationId") : null;
            var planHash = properties.TryGetValue("planHash", out var hash) ? RequiredString(hash, "planHash") : null;
            if (operationId is not null && planHash is not null)
            {
                var validatedOperation = new VisioSessionOperation(operationId, planHash);
                operationId = validatedOperation.OperationId;
                planHash = validatedOperation.PlanHash;
            }

            DiagramEnvelope? diagram = null;
            if (properties.TryGetValue("diagram", out var diagramElement))
            {
                if (diagramElement.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("diagram must be an object");
                ValidateDiagram(diagramElement);
                diagram = JsonSerializer.Deserialize<DiagramEnvelope>(diagramElement.GetRawText(), DiagramJsonOptions)
                    ?? throw new WorkerProtocolException("diagram is required");
                if (command is WorkerV2Command.Apply or WorkerV2Command.ApplyDiff)
                {
                    try
                    {
                        _ = DiagramMapper.Map(diagram);
                    }
                    catch (InvalidOperationException error)
                    {
                        throw new WorkerProtocolException(error.Message, error);
                    }
                }
            }

            var closeDisposition = properties.TryGetValue("closeDisposition", out var disposition)
                ? RequiredString(disposition, "closeDisposition")
                : null;
            if (closeDisposition is not null && closeDisposition is not ("save" or "discard"))
                throw new WorkerProtocolException("closeDisposition must be 'save' or 'discard'");

            return new WorkerV2Request(requestId, command, session, outputPath, operationId, planHash, diagram, closeDisposition);
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (JsonException error)
        {
            throw new WorkerProtocolException("Invalid JSON request", error);
        }
        catch (ArgumentException error)
        {
            throw new WorkerProtocolException(error.Message, error);
        }
    }

    private static Dictionary<string, JsonElement> ReadProperties(JsonElement element, string context)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!result.TryAdd(property.Name, property.Value))
                throw new WorkerProtocolException($"Duplicate property '{property.Name}' in {context}");
        }

        return result;
    }

    private static WorkerV2Session ParseSession(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("session must be an object");
        var properties = ReadProperties(element, "session");
        RequireExactProperties(properties, "tenantId", "userId", "deviceId", "workflowId");
        return new WorkerV2Session(
            RequiredString(properties, "tenantId"),
            RequiredString(properties, "userId"),
            RequiredString(properties, "deviceId"),
            RequiredString(properties, "workflowId"));
    }

    private static WorkerV2Command ParseCommand(string value) => value switch
    {
        "open" => WorkerV2Command.Open,
        "apply" => WorkerV2Command.Apply,
        "applyDiff" => WorkerV2Command.ApplyDiff,
        "save" => WorkerV2Command.Save,
        "snapshot" => WorkerV2Command.Snapshot,
        "close" => WorkerV2Command.Close,
        "recover" => WorkerV2Command.Recover,
        _ => throw new WorkerProtocolException($"Invalid command '{value}'"),
    };

    private static string RequiredString(IReadOnlyDictionary<string, JsonElement> properties, string name) =>
        RequiredString(properties[name], name);

    private static string RequiredString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(element.GetString()))
            throw new WorkerProtocolException($"{name} must be a non-empty string");
        return element.GetString()!;
    }

    private static int RequiredInt(IReadOnlyDictionary<string, JsonElement> properties, string name)
    {
        if (properties[name].ValueKind != JsonValueKind.Number || !properties[name].TryGetInt32(out var value))
            throw new WorkerProtocolException($"{name} must be an integer");
        return value;
    }

    private static string NormalizeOutputPath(JsonElement element, string? outputRoot)
    {
        if (string.IsNullOrWhiteSpace(outputRoot)) throw new WorkerProtocolException("A trusted output root is required for outputPath");
        var path = RequiredString(element, "outputPath");
        if (path.Length > 4096 || path.Any(char.IsControl)) throw new WorkerProtocolException("outputPath is invalid");
        return PathPolicy.ValidateOutputPath(path, outputRoot);
    }

    private static void ValidateIdentifier(string value, string name)
    {
        if (value.Length > 128 || value.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('.' or '_' or '-')))
            throw new WorkerProtocolException($"{name} is invalid");
    }

    private static void RequireProperties(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (!properties.ContainsKey(name)) throw new WorkerProtocolException($"Required property '{name}' is missing");
    }

    private static void RequireExactProperties(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        var expected = Set(names);
        if (!expected.SetEquals(properties.Keys))
        {
            var unexpected = properties.Keys.Except(expected, StringComparer.Ordinal).FirstOrDefault();
            if (unexpected is not null) throw new WorkerProtocolException($"Unknown session property '{unexpected}'");
            throw new WorkerProtocolException("Session is missing a required property");
        }
    }

    private static void ValidateDiagram(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram", "figure", "nodes", "edges", "figurePlan");
        ValidateIfPresent(properties, "figure", ValidateFigure);
        ValidateArrayIfPresent(properties, "nodes", ValidateNode);
        ValidateArrayIfPresent(properties, "edges", ValidateEdge);
        if (properties.TryGetValue("figurePlan", out var figurePlan) && figurePlan.ValueKind != JsonValueKind.Null)
            ValidateFigurePlan(figurePlan);
    }

    private static void ValidateFigure(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figure", "title", "stageLabels");
        ValidateStringIfPresent(properties, "title");
        ValidateStringArrayIfPresent(properties, "stageLabels");
    }

    private static void ValidateNode(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.nodes[]", "id", "kind", "label", "subtitle", "stage", "x", "y", "width", "height", "tensorShape", "visualRole", "layerRole", "repeatCount", "depth", "perspective", "color");
        ValidateStringIfPresent(properties, "id", "kind", "label", "tensorShape", "visualRole", "layerRole");
        ValidateNullableStringIfPresent(properties, "subtitle", "color");
        ValidateIntegerIfPresent(properties, "stage", "repeatCount", "depth");
        ValidateNumberIfPresent(properties, "x", "y", "width", "height");
        ValidateBooleanIfPresent(properties, "perspective");
    }

    private static void ValidateEdge(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.edges[]", "id", "source", "target", "kind", "points");
        ValidateStringIfPresent(properties, "id", "source", "target", "kind");
        ValidateArrayIfPresent(properties, "points", ValidatePoint);
    }

    private static void ValidatePoint(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.points[]", "x", "y");
        ValidateNumberIfPresent(properties, "x", "y");
    }

    private static void ValidateFigurePlan(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan", "coordinateSpace", "primitiveGroups", "connectors", "labels");
        ValidateIfPresent(properties, "coordinateSpace", ValidateCoordinateSpace);
        ValidateArrayIfPresent(properties, "primitiveGroups", ValidatePrimitiveGroup);
        ValidateArrayIfPresent(properties, "connectors", ValidateFigureConnector);
        ValidateArrayIfPresent(properties, "labels", ValidateFigureLabel);
    }

    private static void ValidateCoordinateSpace(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.coordinateSpace", "unit", "figureUnitInches", "origin", "width", "height");
        ValidateStringIfPresent(properties, "unit", "origin");
        ValidateNumberIfPresent(properties, "figureUnitInches", "width", "height");
    }

    private static void ValidatePrimitiveGroup(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.primitiveGroups[]", "id", "kind", "primitiveIds", "bounds", "extrusionDepthFu", "skewXFu", "skewYFu", "semantic");
        ValidateStringIfPresent(properties, "id", "kind");
        ValidateStringArrayIfPresent(properties, "primitiveIds");
        ValidateIfPresent(properties, "bounds", ValidateBounds);
        ValidateNumberIfPresent(properties, "extrusionDepthFu", "skewXFu", "skewYFu");
        ValidateIfPresent(properties, "semantic", ValidatePrimitiveSemantic);
    }

    private static void ValidateBounds(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.primitiveGroups[].bounds", "x", "y", "width", "height");
        ValidateNumberIfPresent(properties, "x", "y", "width", "height");
    }

    private static void ValidatePrimitiveSemantic(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.primitiveGroups[].semantic", "sourceNodeId", "stage", "visualRole", "layerRole", "repeatCount", "channelCount", "tensorShape", "inputSpatialSize", "outputSpatialSize");
        ValidateStringIfPresent(properties, "sourceNodeId", "visualRole", "layerRole");
        ValidateIntegerIfPresent(properties, "stage", "repeatCount");
        ValidateNullableIntegerIfPresent(properties, "channelCount", "inputSpatialSize", "outputSpatialSize");
        if (properties.TryGetValue("tensorShape", out var tensorShape)) ValidateScalarArray(tensorShape, "diagram.figurePlan.primitiveGroups[].semantic.tensorShape");
    }

    private static void ValidateFigureConnector(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.connectors[]", "id", "kind", "sourceGroupId", "targetGroupId", "sourcePrimitiveId", "targetPrimitiveId", "points");
        ValidateStringIfPresent(properties, "id", "kind", "sourceGroupId", "targetGroupId", "sourcePrimitiveId", "targetPrimitiveId");
        ValidateArrayIfPresent(properties, "points", ValidatePoint);
    }

    private static void ValidateFigureLabel(JsonElement element)
    {
        var properties = ValidateObject(element, "diagram.figurePlan.labels[]", "id", "groupId", "text", "x", "y", "width", "height", "fontSizePt");
        ValidateStringIfPresent(properties, "id", "groupId", "text");
        ValidateNumberIfPresent(properties, "x", "y", "width", "height", "fontSizePt");
    }

    private static Dictionary<string, JsonElement> ValidateObject(JsonElement element, string context, params string[] allowedProperties)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException($"{context} must be an object");
        var properties = ReadProperties(element, context);
        var allowed = Set(allowedProperties);
        var unknown = properties.Keys.Except(allowed, StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).FirstOrDefault();
        if (unknown is not null) throw new WorkerProtocolException($"Unknown property '{unknown}' in {context}");
        return properties;
    }

    private static void ValidateIfPresent(IReadOnlyDictionary<string, JsonElement> properties, string name, Action<JsonElement> validator)
    {
        if (properties.TryGetValue(name, out var element)) validator(element);
    }

    private static void ValidateArrayIfPresent(IReadOnlyDictionary<string, JsonElement> properties, string name, Action<JsonElement> itemValidator)
    {
        if (!properties.TryGetValue(name, out var element)) return;
        if (element.ValueKind != JsonValueKind.Array) throw new WorkerProtocolException($"{name} must be an array");
        foreach (var item in element.EnumerateArray()) itemValidator(item);
    }

    private static void ValidateStringArrayIfPresent(IReadOnlyDictionary<string, JsonElement> properties, string name)
    {
        if (!properties.TryGetValue(name, out var element)) return;
        if (element.ValueKind != JsonValueKind.Array || element.EnumerateArray().Any(item => item.ValueKind != JsonValueKind.String))
            throw new WorkerProtocolException($"{name} must be an array of strings");
    }

    private static void ValidateScalarArray(JsonElement element, string context)
    {
        if (element.ValueKind != JsonValueKind.Array || element.EnumerateArray().Any(item => item.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null)))
            throw new WorkerProtocolException($"{context} must be an array of scalar values");
    }

    private static void ValidateStringIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (properties.TryGetValue(name, out var element) && element.ValueKind != JsonValueKind.String)
                throw new WorkerProtocolException($"{name} must be a string");
    }

    private static void ValidateNullableStringIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (properties.TryGetValue(name, out var element) && element.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                throw new WorkerProtocolException($"{name} must be a string or null");
    }

    private static void ValidateIntegerIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (properties.TryGetValue(name, out var element) && (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out _)))
                throw new WorkerProtocolException($"{name} must be an integer");
    }

    private static void ValidateNullableIntegerIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (properties.TryGetValue(name, out var element) && element.ValueKind != JsonValueKind.Null && (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out _)))
                throw new WorkerProtocolException($"{name} must be an integer or null");
    }

    private static void ValidateNumberIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
        {
            if (!properties.TryGetValue(name, out var element)) continue;
            if (element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out var value) || !double.IsFinite(value))
                throw new WorkerProtocolException($"{name} must be a finite number");
        }
    }

    private static void ValidateBooleanIfPresent(IReadOnlyDictionary<string, JsonElement> properties, params string[] names)
    {
        foreach (var name in names)
            if (properties.TryGetValue(name, out var element) && element.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new WorkerProtocolException($"{name} must be a boolean");
    }

    private static IReadOnlySet<string> Set(params string[] values) => new HashSet<string>(values, StringComparer.Ordinal);
}
