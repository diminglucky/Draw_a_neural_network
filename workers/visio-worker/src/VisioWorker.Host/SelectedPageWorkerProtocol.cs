using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using VisioWorker.Live;

namespace VisioWorker.Host;

public enum SelectedPageWorkerCommand
{
    CaptureSelectedPage,
    AttachSelectedPage,
    ApplyOwnedRegion,
    SaveSelectedDocument,
    ReadSelectedPage,
    CloseSession,
}

public sealed record SelectedPageWorkerBinding(
    string JobId,
    string TenantId,
    string UserId,
    string DeviceId,
    string WorkflowId,
    string DocumentId,
    string PageId,
    string DocumentFingerprint,
    string PageFingerprint,
    int ExpectedRevision,
    string OwnershipNamespace);

public sealed record SelectedPageWorkerRequest(
    string RequestId,
    SelectedPageWorkerCommand Command,
    SelectedPageWorkerBinding? Binding = null,
    string? OwnershipNamespace = null,
    JsonElement? SealedNativeIntent = null);

public static partial class SelectedPageWorkerRequestParser
{
    private const int ProtocolVersion = 3;
    private static readonly string[] BindingProperties =
    [
        "jobId", "tenantId", "userId", "deviceId", "workflowId", "documentId", "pageId",
        "documentFingerprint", "pageFingerprint", "expectedRevision", "ownershipNamespace",
    ];
    private static readonly string[] SealedIntentProperties =
    [
        "version", "jobId", "tenantId", "userId", "deviceId", "workflowId", "documentId", "pageId",
        "documentFingerprint", "pageFingerprint", "expectedRevision", "ownershipNamespace", "planId",
        "planHash", "canonicalPlanBase64", "expiresAt", "signature",
    ];

    public static SelectedPageWorkerRequest Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) throw new WorkerProtocolException("Selected-page request is required.");
        try
        {
            using var document = JsonDocument.Parse(json);
            var properties = Properties(document.RootElement, "selected-page request");
            RequireRequiredProperties(properties, "selected-page request", "protocolVersion", "requestId", "command");
            if (RequiredInt(properties, "protocolVersion", "selected-page request") != ProtocolVersion)
            {
                throw new WorkerProtocolException("Selected-page protocol version must be 3.");
            }

            var requestId = Identifier(RequiredString(properties, "requestId", "selected-page request"), "requestId");
            var command = Command(RequiredString(properties, "command", "selected-page request"));
            if (command == SelectedPageWorkerCommand.CaptureSelectedPage)
            {
                RequireExactProperties(properties, "selected-page request", "protocolVersion", "requestId", "command");
                return new SelectedPageWorkerRequest(requestId, command);
            }

            var allowed = command == SelectedPageWorkerCommand.ApplyOwnedRegion
                ? new[] { "protocolVersion", "requestId", "command", "binding", "ownershipNamespace", "sealedNativeIntent" }
                : new[] { "protocolVersion", "requestId", "command", "binding" };
            RequireExactProperties(properties, "selected-page request", allowed);
            if (!properties.ContainsKey("binding")) throw new WorkerProtocolException("selected-page request binding is required.");
            var binding = Binding(properties["binding"]);

            if (command != SelectedPageWorkerCommand.ApplyOwnedRegion)
            {
                return new SelectedPageWorkerRequest(requestId, command, binding);
            }

            var ownershipNamespace = Identifier(RequiredString(properties, "ownershipNamespace", "selected-page request"), "ownershipNamespace");
            if (!string.Equals(ownershipNamespace, binding.OwnershipNamespace, StringComparison.Ordinal))
            {
                throw new WorkerProtocolException("Selected-page ownership namespace does not match the binding.");
            }

            var sealedNativeIntent = properties["sealedNativeIntent"];
            if (sealedNativeIntent.ValueKind != JsonValueKind.Object)
            {
                throw new WorkerProtocolException("Selected-page apply requires a sealed native intent object.");
            }
            ValidateSealedIntent(sealedNativeIntent, binding, ownershipNamespace);
            return new SelectedPageWorkerRequest(requestId, command, binding, ownershipNamespace, sealedNativeIntent.Clone());
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (JsonException error)
        {
            throw new WorkerProtocolException("Selected-page request JSON is invalid.", error);
        }
    }

    private static SelectedPageWorkerBinding Binding(JsonElement value)
    {
        var properties = Properties(value, "selected-page binding");
        RequireExactProperties(properties, "selected-page binding", BindingProperties);
        return new SelectedPageWorkerBinding(
            Identifier(RequiredString(properties, "jobId", "selected-page binding"), "jobId"),
            Identifier(RequiredString(properties, "tenantId", "selected-page binding"), "tenantId"),
            Identifier(RequiredString(properties, "userId", "selected-page binding"), "userId"),
            Identifier(RequiredString(properties, "deviceId", "selected-page binding"), "deviceId"),
            Identifier(RequiredString(properties, "workflowId", "selected-page binding"), "workflowId"),
            Identifier(RequiredString(properties, "documentId", "selected-page binding"), "documentId"),
            Identifier(RequiredString(properties, "pageId", "selected-page binding"), "pageId"),
            Hash(RequiredString(properties, "documentFingerprint", "selected-page binding"), "documentFingerprint"),
            Hash(RequiredString(properties, "pageFingerprint", "selected-page binding"), "pageFingerprint"),
            NonNegativeInt(properties, "expectedRevision", "selected-page binding"),
            Identifier(RequiredString(properties, "ownershipNamespace", "selected-page binding"), "ownershipNamespace"));
    }

    private static void ValidateSealedIntent(JsonElement value, SelectedPageWorkerBinding binding, string ownershipNamespace)
    {
        var properties = Properties(value, "sealed native intent");
        RequireExactProperties(properties, "sealed native intent", SealedIntentProperties);
        if (RequiredInt(properties, "version", "sealed native intent") != 2)
        {
            throw new WorkerProtocolException("Selected-page sealed native intent version is invalid.");
        }
        if (!string.Equals(RequiredString(properties, "ownershipNamespace", "sealed native intent"), ownershipNamespace, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Selected-page sealed native intent ownership namespace does not match the binding.");
        }
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["jobId"] = binding.JobId,
            ["tenantId"] = binding.TenantId,
            ["userId"] = binding.UserId,
            ["deviceId"] = binding.DeviceId,
            ["workflowId"] = binding.WorkflowId,
            ["documentId"] = binding.DocumentId,
            ["pageId"] = binding.PageId,
            ["documentFingerprint"] = binding.DocumentFingerprint,
            ["pageFingerprint"] = binding.PageFingerprint,
        };
        foreach (var (name, expectedValue) in expected)
        {
            if (!string.Equals(RequiredString(properties, name, "sealed native intent"), expectedValue, StringComparison.Ordinal))
            {
                throw new WorkerProtocolException("Selected-page sealed native intent does not match the binding.");
            }
        }
        if (NonNegativeInt(properties, "expectedRevision", "sealed native intent") != binding.ExpectedRevision)
        {
            throw new WorkerProtocolException("Selected-page sealed native intent revision does not match the binding.");
        }
        var planHash = Hash(RequiredString(properties, "planHash", "sealed native intent"), "planHash");
        _ = Signature(RequiredString(properties, "signature", "sealed native intent"));
        var canonicalPlanBase64 = RequiredString(properties, "canonicalPlanBase64", "sealed native intent");
        if (string.IsNullOrWhiteSpace(canonicalPlanBase64))
        {
            throw new WorkerProtocolException("Selected-page sealed native intent canonical plan is required.");
        }
        byte[] canonicalPlan;
        try
        {
            canonicalPlan = Convert.FromBase64String(canonicalPlanBase64.Replace('-', '+').Replace('_', '/').PadRight(((canonicalPlanBase64.Length + 3) / 4) * 4, '='));
        }
        catch (FormatException error)
        {
            throw new WorkerProtocolException("Selected-page sealed native intent canonical plan is not valid base64url.", error);
        }
        if (canonicalPlan.Length == 0 || !string.Equals(Convert.ToHexString(SHA256.HashData(canonicalPlan)).ToLowerInvariant(), planHash, StringComparison.Ordinal))
        {
            throw new WorkerProtocolException("Selected-page sealed native intent plan hash does not match canonical bytes.");
        }
        if (!DateTimeOffset.TryParse(RequiredString(properties, "expiresAt", "sealed native intent"), out var expiresAt)
            || expiresAt <= DateTimeOffset.UtcNow)
        {
            throw new WorkerProtocolException("Selected-page sealed native intent expiration is invalid or expired.");
        }
    }

    private static SelectedPageWorkerCommand Command(string value) => value switch
    {
        "captureSelectedPage" => SelectedPageWorkerCommand.CaptureSelectedPage,
        "attachSelectedPage" => SelectedPageWorkerCommand.AttachSelectedPage,
        "applyOwnedRegion" => SelectedPageWorkerCommand.ApplyOwnedRegion,
        "saveSelectedDocument" => SelectedPageWorkerCommand.SaveSelectedDocument,
        "readSelectedPage" => SelectedPageWorkerCommand.ReadSelectedPage,
        "closeSession" => SelectedPageWorkerCommand.CloseSession,
        _ => throw new WorkerProtocolException("Selected-page command is invalid."),
    };

    private static Dictionary<string, JsonElement> Properties(JsonElement value, string context)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException($"{context} must be an object.");
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!result.TryAdd(property.Name, property.Value)) throw new WorkerProtocolException($"{context} contains a duplicate property.");
        }
        return result;
    }

    private static void RequireExactProperties(IReadOnlyDictionary<string, JsonElement> actual, string context, params string[] expected)
    {
        if (actual.Count != expected.Length || expected.Any(name => !actual.ContainsKey(name)) || actual.Keys.Any(name => !expected.Contains(name, StringComparer.Ordinal)))
        {
            throw new WorkerProtocolException($"{context} contains unknown or missing properties.");
        }
    }

    private static void RequireRequiredProperties(IReadOnlyDictionary<string, JsonElement> actual, string context, params string[] required)
    {
        if (required.Any(name => !actual.ContainsKey(name)))
        {
            throw new WorkerProtocolException($"{context} contains missing properties.");
        }
    }

    private static string RequiredString(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new WorkerProtocolException($"{context} {name} is required.");
        }
        return value.GetString()!;
    }

    private static int RequiredInt(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        if (!properties.TryGetValue(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var result))
        {
            throw new WorkerProtocolException($"{context} {name} is required.");
        }
        return result;
    }

    private static int NonNegativeInt(IReadOnlyDictionary<string, JsonElement> properties, string name, string context)
    {
        var value = RequiredInt(properties, name, context);
        if (value < 0) throw new WorkerProtocolException($"{context} {name} must be nonnegative.");
        return value;
    }

    private static string Identifier(string value, string name)
    {
        if (!IdentifierPattern().IsMatch(value)) throw new WorkerProtocolException($"Selected-page {name} is invalid.");
        return value;
    }

    private static string Hash(string value, string name)
    {
        if (!HashPattern().IsMatch(value)) throw new WorkerProtocolException($"Selected-page {name} is invalid.");
        return value;
    }

    private static string Signature(string value)
    {
        if (value.Length is < 1 or > 128 || !value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'))
        {
            throw new WorkerProtocolException("Selected-page signature is invalid.");
        }
        return value;
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdentifierPattern();

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex HashPattern();
}
