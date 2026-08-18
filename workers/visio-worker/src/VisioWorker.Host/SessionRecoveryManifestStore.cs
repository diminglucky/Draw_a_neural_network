using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Host;

public sealed record StoredSessionRecoveryManifest(
    VisioSessionRecoveryManifest Manifest,
    DateTimeOffset SavedAt,
    DateTimeOffset LastActivity);

public interface ISessionRecoveryManifestStore
{
    Task SaveAsync(
        VisioSessionRecoveryManifest manifest,
        DateTimeOffset savedAt,
        DateTimeOffset lastActivity,
        CancellationToken cancellationToken = default);

    Task<StoredSessionRecoveryManifest?> LoadAsync(
        VisioSessionKey key,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Worker-private persistence for recovery manifests. Manifest filenames are opaque hashes of their
/// session tuple and are never part of the protocol surface.
/// </summary>
public sealed class SessionRecoveryManifestStore : ISessionRecoveryManifestStore
{
    private const int CurrentFormatVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _outputRoot;
    private readonly string _manifestRoot;

    public SessionRecoveryManifestStore(string outputRoot)
    {
        if (string.IsNullOrWhiteSpace(outputRoot)) throw new WorkerProtocolException("Recovery manifest storage is unavailable.");

        try
        {
            _outputRoot = Path.GetFullPath(outputRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(_outputRoot)) throw new WorkerProtocolException("Recovery manifest storage is unavailable.");
            _manifestRoot = Path.Combine(_outputRoot, ".synapse-sessions");
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw new WorkerProtocolException("Recovery manifest storage is unavailable.", error);
        }
    }

    public async Task SaveAsync(
        VisioSessionRecoveryManifest manifest,
        DateTimeOffset savedAt,
        DateTimeOffset lastActivity,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        cancellationToken.ThrowIfCancellationRequested();

        string temporaryPath = string.Empty;
        try
        {
            var normalizedOutputPath = PathPolicy.ValidateOutputPath(manifest.OutputPath, _outputRoot);
            var storedManifest = new VisioSessionRecoveryManifest(
                manifest.Key,
                normalizedOutputPath,
                manifest.Document,
                manifest.LastPlanHash,
                manifest.OperationJournal);
            var finalPath = GetPath(manifest.Key, createDirectory: true);
            temporaryPath = Path.Combine(_manifestRoot, $"{Guid.NewGuid():N}.partial");

            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 4096,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, PersistedEnvelope.From(storedManifest, savedAt, lastActivity), JsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }

            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporaryPath, finalPath, overwrite: true);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (IsStorageException(error))
        {
            throw new WorkerProtocolException("Unable to persist recovery manifest.", error);
        }
        finally
        {
            if (!string.IsNullOrEmpty(temporaryPath)) TryDeletePartial(temporaryPath);
        }
    }

    public async Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(key);
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            var path = GetPath(key, createDirectory: false);
            if (!File.Exists(path)) return null;

            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            var stored = ParseEnvelope(document.RootElement, key);
            return stored;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (IsStorageException(error))
        {
            throw new WorkerProtocolException("Unable to load recovery manifest.", error);
        }
    }

    // Intended solely for focused storage tests; no worker protocol exposes this implementation detail.
    public string GetPathForTesting(VisioSessionKey key) => GetPath(key, createDirectory: true);

    private string GetPath(VisioSessionKey key, bool createDirectory)
    {
        ArgumentNullException.ThrowIfNull(key);
        try
        {
            if (createDirectory) Directory.CreateDirectory(_manifestRoot);
            var path = Path.Combine(_manifestRoot, SessionFileName(key));
            var fullPath = Path.GetFullPath(path);
            var rootWithSeparator = Path.GetFullPath(_manifestRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
                throw new WorkerProtocolException("Recovery manifest storage is unavailable.");
            return fullPath;
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (IsStorageException(error))
        {
            throw new WorkerProtocolException("Recovery manifest storage is unavailable.", error);
        }
    }

    private StoredSessionRecoveryManifest ParseEnvelope(JsonElement root, VisioSessionKey requestedKey)
    {
        try
        {
            var envelope = ExactProperties(root, "recovery manifest", "formatVersion", "manifest", "savedAt", "lastActivity");
            if (RequiredInt(envelope, "formatVersion") != CurrentFormatVersion)
                throw new WorkerProtocolException("Recovery manifest format is unsupported.");

            var manifestFields = ExactProperties(envelope["manifest"], "recovery manifest payload", "key", "outputPath", "document", "lastPlanHash", "operationJournal");
            var keyFields = ExactProperties(manifestFields["key"], "recovery manifest key", "tenantId", "userId", "deviceId", "workflowId");
            var embeddedKey = new VisioSessionKey(
                RequiredString(keyFields, "tenantId"),
                RequiredString(keyFields, "userId"),
                RequiredString(keyFields, "deviceId"),
                RequiredString(keyFields, "workflowId"));
            if (embeddedKey != requestedKey) throw new WorkerProtocolException("Recovery manifest session does not match the request.");

            var documentFields = ExactProperties(manifestFields["document"], "recovery manifest document", "documentHandle", "pageHandle");
            var journal = ParseJournal(manifestFields["operationJournal"]);
            var lastPlanHash = NullableString(manifestFields["lastPlanHash"], "lastPlanHash");
            var outputPath = PathPolicy.ValidateOutputPath(RequiredString(manifestFields, "outputPath"), _outputRoot);
            var manifest = new VisioSessionRecoveryManifest(
                embeddedKey,
                outputPath,
                new VisioSessionDocument(RequiredString(documentFields, "documentHandle"), RequiredString(documentFields, "pageHandle")),
                lastPlanHash,
                journal);
            return new StoredSessionRecoveryManifest(
                manifest,
                RequiredDate(envelope, "savedAt"),
                RequiredDate(envelope, "lastActivity"));
        }
        catch (WorkerProtocolException)
        {
            throw;
        }
        catch (Exception error) when (error is ArgumentException or FormatException or InvalidOperationException)
        {
            throw new WorkerProtocolException("Recovery manifest is invalid.", error);
        }
    }

    private static IReadOnlyList<VisioSessionOperationJournalEntry> ParseJournal(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array) throw new WorkerProtocolException("Recovery manifest is invalid.");
        var entries = new List<VisioSessionOperationJournalEntry>();
        foreach (var entry in element.EnumerateArray())
        {
            var fields = ExactProperties(entry, "recovery manifest operation", "operationId", "planHash");
            entries.Add(new VisioSessionOperationJournalEntry(RequiredString(fields, "operationId"), RequiredString(fields, "planHash")));
        }

        return entries;
    }

    private static Dictionary<string, JsonElement> ExactProperties(JsonElement element, string context, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("Recovery manifest is invalid.");
        var properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!properties.TryAdd(property.Name, property.Value)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        }

        var expected = new HashSet<string>(names, StringComparer.Ordinal);
        if (!expected.SetEquals(properties.Keys)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return properties;
    }

    private static string RequiredString(IReadOnlyDictionary<string, JsonElement> properties, string name) => RequiredString(properties[name], name);

    private static string RequiredString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(element.GetString()))
            throw new WorkerProtocolException("Recovery manifest is invalid.");
        return element.GetString()!;
    }

    private static string? NullableString(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Null) return null;
        return RequiredString(element, name);
    }

    private static int RequiredInt(IReadOnlyDictionary<string, JsonElement> properties, string name)
    {
        if (properties[name].ValueKind != JsonValueKind.Number || !properties[name].TryGetInt32(out var value))
            throw new WorkerProtocolException("Recovery manifest is invalid.");
        return value;
    }

    private static DateTimeOffset RequiredDate(IReadOnlyDictionary<string, JsonElement> properties, string name)
    {
        var value = RequiredString(properties, name);
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var date))
            throw new WorkerProtocolException("Recovery manifest is invalid.");
        return date;
    }

    private static string SessionFileName(VisioSessionKey key)
    {
        var tuple = string.Join("\n", key.TenantId, key.UserId, key.DeviceId, key.WorkflowId);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(tuple))).ToLowerInvariant() + ".json";
    }

    private static bool IsStorageException(Exception error) =>
        error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or PathTooLongException or JsonException;

    private static void TryDeletePartial(string path)
    {
        try { File.Delete(path); }
        catch (Exception error) when (IsStorageException(error)) { }
    }

    private sealed record PersistedEnvelope(int FormatVersion, PersistedManifest Manifest, DateTimeOffset SavedAt, DateTimeOffset LastActivity)
    {
        public static PersistedEnvelope From(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity) => new(
            CurrentFormatVersion,
            new PersistedManifest(
                new PersistedKey(manifest.Key.TenantId, manifest.Key.UserId, manifest.Key.DeviceId, manifest.Key.WorkflowId),
                manifest.OutputPath,
                new PersistedDocument(manifest.Document.DocumentHandle, manifest.Document.PageHandle),
                manifest.LastPlanHash,
                manifest.OperationJournal.Select(entry => new PersistedJournalEntry(entry.OperationId, entry.PlanHash)).ToArray()),
            savedAt,
            lastActivity);
    }

    private sealed record PersistedManifest(PersistedKey Key, string OutputPath, PersistedDocument Document, string? LastPlanHash, IReadOnlyList<PersistedJournalEntry> OperationJournal);
    private sealed record PersistedKey(string TenantId, string UserId, string DeviceId, string WorkflowId);
    private sealed record PersistedDocument(string DocumentHandle, string PageHandle);
    private sealed record PersistedJournalEntry(string OperationId, string PlanHash);
}
