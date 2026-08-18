using System.Buffers.Binary;
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
    DateTimeOffset LastActivity,
    int FormatVersion = SessionRecoveryManifestStore.CurrentFormatVersion);

public interface ISessionRecoveryManifestStore
{
    Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default);
    Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default);
}

/// <summary>Worker-private, fail-closed persistence for recovery manifests.</summary>
public sealed class SessionRecoveryManifestStore : ISessionRecoveryManifestStore
{
    public const int CurrentFormatVersion = 4;
    private const string FileNameDomain = "visio-worker/session-recovery-manifest";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _outputRoot;
    private readonly string _manifestRoot;
    private readonly Func<string, Exception?>? _failureFactory;

    public SessionRecoveryManifestStore(string outputRoot) : this(outputRoot, failureFactory: null) { }

    // A private test seam keeps deterministic I/O failure proof out of the worker protocol surface.
    private SessionRecoveryManifestStore(string outputRoot, Func<string, Exception?>? failureFactory)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(outputRoot)) throw new ArgumentException();
            _outputRoot = Path.GetFullPath(outputRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(_outputRoot)) throw new ArgumentException();
            _manifestRoot = Path.Combine(_outputRoot, ".synapse-sessions");
            _failureFactory = failureFactory;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Failure("Recovery manifest storage is unavailable.");
        }
    }

    public async Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        cancellationToken.ThrowIfCancellationRequested();
        string? temporaryPath = null;

        try
        {
            if (manifest.CommandReplayJournal.Any(entry => entry.Command == VisioSessionReplayCommand.Unknown))
            {
                throw new WorkerProtocolException("Current recovery manifests require a typed command for every replay entry.");
            }
            if (!manifest.Document.HasNativeIdentity)
            {
                throw new WorkerProtocolException("Current recovery manifests require native Visio document and page identities.");
            }
            var normalizedOutputPath = PathPolicy.ValidateOutputPath(manifest.OutputPath, _outputRoot);
            var persistedManifest = new VisioSessionRecoveryManifest(
                manifest.Key,
                normalizedOutputPath,
                manifest.Document,
                manifest.LastPlanHash,
                manifest.OperationJournal,
                manifest.CommandReplayJournal);
            var finalPath = GetPath(manifest.Key, createDirectory: true);
            EnsureRegularOrMissingFile(finalPath);
            temporaryPath = Path.Combine(_manifestRoot, $"{Guid.NewGuid():N}.partial");

            ThrowInjected("open-write");
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 4096,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, PersistedEnvelope.From(persistedManifest, savedAt, lastActivity), JsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                ThrowInjected("flush");
                stream.Flush(flushToDisk: true);
            }

            cancellationToken.ThrowIfCancellationRequested();
            EnsureManifestDirectory(createDirectory: true);
            EnsureRegularOrMissingFile(finalPath);
            ThrowInjected("replace");
            File.Move(temporaryPath, finalPath, overwrite: true);
            temporaryPath = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (WorkerProtocolException error) when (error.InnerException is null)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Failure("Unable to persist recovery manifest.");
        }
        finally
        {
            if (temporaryPath is not null) TryDeletePartial(temporaryPath);
        }
    }

    public async Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(key);
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            var path = GetPath(key, createDirectory: false);
            EnsureRegularOrMissingFile(path);
            ThrowInjected("open-read");
            await using var stream = OpenRead(path);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseEnvelope(document.RootElement, key);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (WorkerProtocolException error) when (error.InnerException is null)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Failure("Unable to load recovery manifest.");
        }
    }

    private FileStream OpenRead(string path) => new(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous);

    private string GetPath(VisioSessionKey key, bool createDirectory)
    {
        try
        {
            EnsureManifestDirectory(createDirectory);
            var path = Path.GetFullPath(Path.Combine(_manifestRoot, SessionFileName(key)));
            var expectedPrefix = _manifestRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase)) throw new IOException();
            return path;
        }
        catch (WorkerProtocolException error) when (error.InnerException is null)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Failure("Recovery manifest storage is unavailable.");
        }
    }

    private void EnsureManifestDirectory(bool createDirectory)
    {
        EnsureExistingDirectoryPathHasNoReparsePoints(_outputRoot);
        try
        {
            EnsureExistingDirectoryPathHasNoReparsePoints(_manifestRoot);
        }
        catch (FileNotFoundException) when (createDirectory)
        {
            Directory.CreateDirectory(_manifestRoot);
            EnsureExistingDirectoryPathHasNoReparsePoints(_manifestRoot);
        }
        catch (DirectoryNotFoundException) when (createDirectory)
        {
            Directory.CreateDirectory(_manifestRoot);
            EnsureExistingDirectoryPathHasNoReparsePoints(_manifestRoot);
        }
    }

    private static void EnsureExistingDirectoryPathHasNoReparsePoints(string directoryPath)
    {
        var fullPath = Path.GetFullPath(directoryPath);
        var root = Path.GetPathRoot(fullPath) ?? throw new IOException();
        var current = root;
        ValidateDirectorySegment(current);
        var remainder = fullPath[root.Length..].Trim(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (remainder.Length == 0) return;

        foreach (var segment in remainder.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            ValidateDirectorySegment(current);
        }
    }

    private static void ValidateDirectorySegment(string path)
    {
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
    }

    private static void EnsureRegularOrMissingFile(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new IOException();
        }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
    }

    private StoredSessionRecoveryManifest ParseEnvelope(JsonElement root, VisioSessionKey requestedKey)
    {
        try
        {
            var envelope = ExactProperties(root, "formatVersion", "manifest", "savedAt", "lastActivity");
            var formatVersion = RequiredInt(envelope, "formatVersion");
            if (formatVersion is < 1 or > CurrentFormatVersion) throw new WorkerProtocolException("Recovery manifest format is unsupported.");
            var manifestFields = formatVersion == 1
                ? ExactProperties(envelope["manifest"], "key", "outputPath", "document", "lastPlanHash", "operationJournal")
                : ExactProperties(envelope["manifest"], "key", "outputPath", "document", "lastPlanHash", "operationJournal", "commandReplayJournal");
            var keyFields = ExactProperties(manifestFields["key"], "tenantId", "userId", "deviceId", "workflowId");
            var embeddedKey = new VisioSessionKey(
                RequiredString(keyFields, "tenantId"),
                RequiredString(keyFields, "userId"),
                RequiredString(keyFields, "deviceId"),
                RequiredString(keyFields, "workflowId"));
            if (embeddedKey != requestedKey) throw new WorkerProtocolException("Recovery manifest session does not match the request.");
            var documentFields = formatVersion == CurrentFormatVersion
                ? ExactProperties(manifestFields["document"], "documentHandle", "pageHandle", "nativeDocumentIdentity", "nativePageIdentity")
                : ExactProperties(manifestFields["document"], "documentHandle", "pageHandle");
            var sessionDocument = formatVersion == CurrentFormatVersion
                ? new VisioSessionDocument(
                    RequiredString(documentFields, "documentHandle"),
                    RequiredString(documentFields, "pageHandle"),
                    RequiredString(documentFields, "nativeDocumentIdentity"),
                    RequiredString(documentFields, "nativePageIdentity"))
                : new VisioSessionDocument(
                    RequiredString(documentFields, "documentHandle"),
                    RequiredString(documentFields, "pageHandle"));
            var manifest = new VisioSessionRecoveryManifest(
                embeddedKey,
                PathPolicy.ValidateOutputPath(RequiredString(manifestFields, "outputPath"), _outputRoot),
                sessionDocument,
                NullableString(manifestFields["lastPlanHash"]),
                ParseJournal(manifestFields["operationJournal"]),
                formatVersion == 1 ? [] : ParseCommandReplayJournal(manifestFields["commandReplayJournal"], formatVersion));
            return new StoredSessionRecoveryManifest(manifest, RequiredDate(envelope, "savedAt"), RequiredDate(envelope, "lastActivity"), formatVersion);
        }
        catch (WorkerProtocolException error) when (error.InnerException is null)
        {
            throw;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw Failure("Recovery manifest is invalid.");
        }
    }

    private static IReadOnlyList<VisioSessionOperationJournalEntry> ParseJournal(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return element.EnumerateArray().Select(entry =>
        {
            var fields = ExactProperties(entry, "operationId", "planHash");
            return new VisioSessionOperationJournalEntry(RequiredString(fields, "operationId"), RequiredString(fields, "planHash"));
        }).ToArray();
    }

    private static IReadOnlyList<VisioSessionCommandReplayEntry> ParseCommandReplayJournal(JsonElement element, int formatVersion)
    {
        if (element.ValueKind != JsonValueKind.Array) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return element.EnumerateArray().Select(entry =>
        {
            var fields = formatVersion >= 3
                ? ExactProperties(entry, "requestId", "command", "fingerprint", "status", "outputPath")
                : ExactProperties(entry, "requestId", "fingerprint", "status", "outputPath");
            return new VisioSessionCommandReplayEntry(
                RequiredString(fields, "requestId"),
                formatVersion >= 3
                    ? ParseReplayCommand(RequiredString(fields, "command"))
                    : VisioSessionReplayCommand.Unknown,
                RequiredString(fields, "fingerprint"),
                RequiredString(fields, "status"),
                RequiredString(fields, "outputPath"));
        }).ToArray();
    }

    private static VisioSessionReplayCommand ParseReplayCommand(string value) => value switch
    {
        "open" => VisioSessionReplayCommand.Open,
        "apply" => VisioSessionReplayCommand.Apply,
        "applyDiff" => VisioSessionReplayCommand.ApplyDiff,
        "save" => VisioSessionReplayCommand.Save,
        "snapshot" => VisioSessionReplayCommand.Snapshot,
        "close" => VisioSessionReplayCommand.Close,
        "recover" => VisioSessionReplayCommand.Recover,
        _ => throw new WorkerProtocolException("Recovery manifest is invalid."),
    };

    private static string ReplayCommandName(VisioSessionReplayCommand command) => command switch
    {
        VisioSessionReplayCommand.Open => "open",
        VisioSessionReplayCommand.Apply => "apply",
        VisioSessionReplayCommand.ApplyDiff => "applyDiff",
        VisioSessionReplayCommand.Save => "save",
        VisioSessionReplayCommand.Snapshot => "snapshot",
        VisioSessionReplayCommand.Close => "close",
        VisioSessionReplayCommand.Recover => "recover",
        _ => throw new WorkerProtocolException("Current recovery manifests require a typed command for every replay entry."),
    };

    private static Dictionary<string, JsonElement> ExactProperties(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new WorkerProtocolException("Recovery manifest is invalid.");
        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
            if (!fields.TryAdd(property.Name, property.Value)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        if (!new HashSet<string>(names, StringComparer.Ordinal).SetEquals(fields.Keys)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return fields;
    }

    private static string RequiredString(IReadOnlyDictionary<string, JsonElement> fields, string name) => RequiredString(fields[name]);

    private static string RequiredString(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(element.GetString())) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return element.GetString()!;
    }

    private static string? NullableString(JsonElement element) => element.ValueKind == JsonValueKind.Null ? null : RequiredString(element);

    private static int RequiredInt(IReadOnlyDictionary<string, JsonElement> fields, string name)
    {
        if (fields[name].ValueKind != JsonValueKind.Number || !fields[name].TryGetInt32(out var value)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return value;
    }

    private static DateTimeOffset RequiredDate(IReadOnlyDictionary<string, JsonElement> fields, string name)
    {
        if (!DateTimeOffset.TryParse(RequiredString(fields, name), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var date)) throw new WorkerProtocolException("Recovery manifest is invalid.");
        return date;
    }

    private static string SessionFileName(VisioSessionKey key) => SessionFileNameForTuple(key.TenantId, key.UserId, key.DeviceId, key.WorkflowId);

    private static string SessionFileNameForTuple(string tenantId, string userId, string deviceId, string workflowId)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes(FileNameDomain));
        hash.AppendData([0, 1]);
        Span<byte> length = stackalloc byte[sizeof(int)];
        foreach (var field in new[] { tenantId, userId, deviceId, workflowId })
        {
            var bytes = Encoding.UTF8.GetBytes(field);
            BinaryPrimitives.WriteInt32BigEndian(length, bytes.Length);
            hash.AppendData(length);
            hash.AppendData(bytes);
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant() + ".json";
    }

    private void ThrowInjected(string operation)
    {
        var failure = _failureFactory?.Invoke(operation);
        if (failure is not null) throw failure;
    }

    private static WorkerProtocolException Failure(string message) => new(message);

    private static void TryDeletePartial(string path)
    {
        try { File.Delete(path); }
        catch (Exception) { }
    }

    private sealed record PersistedEnvelope(int FormatVersion, PersistedManifest Manifest, DateTimeOffset SavedAt, DateTimeOffset LastActivity)
    {
        public static PersistedEnvelope From(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity) => new(
            CurrentFormatVersion,
            new PersistedManifest(
                new PersistedKey(manifest.Key.TenantId, manifest.Key.UserId, manifest.Key.DeviceId, manifest.Key.WorkflowId),
                manifest.OutputPath,
                new PersistedDocument(
                    manifest.Document.DocumentHandle,
                    manifest.Document.PageHandle,
                    manifest.Document.NativeDocumentIdentity!,
                    manifest.Document.NativePageIdentity!),
                manifest.LastPlanHash,
                manifest.OperationJournal.Select(entry => new PersistedJournalEntry(entry.OperationId, entry.PlanHash)).ToArray(),
                manifest.CommandReplayJournal.Select(entry => new PersistedCommandReplayEntry(entry.RequestId, ReplayCommandName(entry.Command), entry.Fingerprint, entry.Status, entry.OutputPath)).ToArray()),
            savedAt,
            lastActivity);
    }

    private sealed record PersistedManifest(PersistedKey Key, string OutputPath, PersistedDocument Document, string? LastPlanHash, IReadOnlyList<PersistedJournalEntry> OperationJournal, IReadOnlyList<PersistedCommandReplayEntry> CommandReplayJournal);
    private sealed record PersistedKey(string TenantId, string UserId, string DeviceId, string WorkflowId);
    private sealed record PersistedDocument(string DocumentHandle, string PageHandle, string NativeDocumentIdentity, string NativePageIdentity);
    private sealed record PersistedJournalEntry(string OperationId, string PlanHash);
    private sealed record PersistedCommandReplayEntry(string RequestId, string Command, string Fingerprint, string Status, string OutputPath);
}
