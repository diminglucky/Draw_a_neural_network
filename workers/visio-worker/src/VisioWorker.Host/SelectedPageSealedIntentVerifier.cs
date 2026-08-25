using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VisioWorker.Live;

namespace VisioWorker.Host;

/// <summary>Verifies the same sorted-key JSON HMAC envelope emitted by the TypeScript signer.</summary>
public sealed class SelectedPageSealedIntentVerifier
{
    private readonly byte[] _secret;

    public SelectedPageSealedIntentVerifier(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret)) throw new ArgumentException("Selected-page sealing secret is required.", nameof(secret));
        _secret = Encoding.UTF8.GetBytes(secret);
    }

    public byte[] Verify(SelectedPageWorkerRequest request)
    {
        if (request.Command != SelectedPageWorkerCommand.ApplyOwnedRegion || request.SealedNativeIntent is not JsonElement intent)
            throw new WorkerProtocolException("Selected-page sealed intent is required for apply.");

        using var document = JsonDocument.Parse(intent.GetRawText());
        var root = document.RootElement;
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output)) WriteCanonical(writer, root, omitSignature: true);
        var expected = HMACSHA256.HashData(_secret, output.ToArray());
        var signature = DecodeBase64Url(root.GetProperty("signature").GetString()!);
        if (!CryptographicOperations.FixedTimeEquals(expected, signature))
            throw new WorkerProtocolException("Selected-page sealed intent signature is invalid.");
        return DecodeBase64Url(root.GetProperty("canonicalPlanBase64").GetString()!);
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value, bool omitSignature)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().Where(property => !omitSignature || !string.Equals(property.Name, "signature", StringComparison.Ordinal)).OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value, omitSignature: false);
                }
                writer.WriteEndObject();
                return;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item, omitSignature: false);
                writer.WriteEndArray();
                return;
            case JsonValueKind.String: writer.WriteStringValue(value.GetString()); return;
            case JsonValueKind.Number: writer.WriteRawValue(value.GetRawText(), skipInputValidation: false); return;
            case JsonValueKind.True: writer.WriteBooleanValue(true); return;
            case JsonValueKind.False: writer.WriteBooleanValue(false); return;
            case JsonValueKind.Null: writer.WriteNullValue(); return;
            default: throw new WorkerProtocolException("Selected-page sealed intent contains an invalid JSON value.");
        }
    }

    private static byte[] DecodeBase64Url(string value)
    {
        try { return Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/').PadRight(((value.Length + 3) / 4) * 4, '=')); }
        catch (FormatException error) { throw new WorkerProtocolException("Selected-page signature is invalid.", error); }
    }
}
