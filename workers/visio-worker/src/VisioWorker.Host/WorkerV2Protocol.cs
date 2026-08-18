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

    public static WorkerV2Request Parse(string json)
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

            var outputPath = properties.TryGetValue("outputPath", out var output) ? RequiredPath(output, "outputPath") : null;
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
                diagram = JsonSerializer.Deserialize<DiagramEnvelope>(diagramElement.GetRawText())
                    ?? throw new WorkerProtocolException("diagram is required");
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

    private static string RequiredPath(JsonElement element, string name)
    {
        var path = RequiredString(element, name);
        if (path.Length > 4096 || path.Any(char.IsControl)) throw new WorkerProtocolException($"{name} is invalid");
        if (!path.EndsWith(".vsdx", StringComparison.OrdinalIgnoreCase)) throw new WorkerProtocolException($"{name} must end with .vsdx");
        return path;
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

    private static IReadOnlySet<string> Set(params string[] values) => new HashSet<string>(values, StringComparer.Ordinal);
}
