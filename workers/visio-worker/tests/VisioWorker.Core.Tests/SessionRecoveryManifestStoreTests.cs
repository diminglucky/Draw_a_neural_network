using System.Buffers.Binary;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;
using Xunit.Sdk;

namespace VisioWorker.Core.Tests;

public sealed class SessionRecoveryManifestStoreTests
{
    [Fact]
    public async Task Save_and_load_round_trip_a_manifest_with_a_versioned_private_filename()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var manifest = CreateManifest(root, commandReplayJournal: [CreateTypedCommandReplay("save-1", "Apply", new string('a', 64), Path.Combine(root, "workflow.vsdx"))]);
            var savedAt = DateTimeOffset.Parse("2026-08-18T06:00:00Z");
            var lastActivity = DateTimeOffset.Parse("2026-08-18T06:05:00Z");

            await store.SaveAsync(manifest, savedAt, lastActivity);
            var stored = await store.LoadAsync(manifest.Key);

            Assert.NotNull(stored);
            Assert.Equal(manifest.Key, stored!.Manifest.Key);
            Assert.Equal(manifest.OutputPath, stored.Manifest.OutputPath);
            Assert.Equal(manifest.Document, stored.Manifest.Document);
            Assert.Equal(manifest.LastPlanHash, stored.Manifest.LastPlanHash);
            Assert.Equal(manifest.OperationJournal, stored.Manifest.OperationJournal);
            Assert.Equal(manifest.CommandReplayJournal, stored.Manifest.CommandReplayJournal);
            Assert.Equal(3, FormatVersionOf(stored));
            Assert.Equal(savedAt, stored.SavedAt);
            Assert.Equal(lastActivity, stored.LastActivity);
            Assert.True(File.Exists(ManifestPath(root, manifest.Key)));

            using var persisted = JsonDocument.Parse(await File.ReadAllTextAsync(ManifestPath(root, manifest.Key)));
            var replay = persisted.RootElement.GetProperty("manifest").GetProperty("commandReplayJournal")[0];
            Assert.Equal("apply", replay.GetProperty("command").GetString());
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_accepts_a_legacy_v1_manifest_with_an_empty_command_replay_journal()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            await WriteManifestAsync(root, key, ValidEnvelope("tenant", "user", "device", "workflow", Path.Combine(root, "workflow.vsdx")));

            var stored = await store.LoadAsync(key);

            Assert.NotNull(stored);
            Assert.Equal(1, FormatVersionOf(stored!));
            Assert.Empty(stored!.Manifest.CommandReplayJournal);
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public void Versioned_binary_framing_distinguishes_newline_boundary_collision_candidates()
    {
        var method = typeof(SessionRecoveryManifestStore).GetMethod("SessionFileNameForTuple", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var first = (string)method.Invoke(null, ["a\nb", "c", "d", "e"])!;
        var second = (string)method.Invoke(null, ["a", "b\nc", "d", "e"])!;

        Assert.NotEqual(first, second);
        Assert.Matches("^[a-f0-9]{64}\\.json$", first);
        Assert.Matches("^[a-f0-9]{64}\\.json$", second);
    }

    [Fact]
    public async Task Load_rejects_manifest_whose_embedded_key_differs_from_requested_key()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = new VisioSessionKey("tenant-a", "user", "device", "workflow");
            await WriteManifestAsync(root, key, ValidEnvelope("tenant-b", "user", "device", "workflow", Path.Combine(root, "workflow.vsdx")));

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_corrupt_json()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            await WriteManifestAsync(root, key, "{");

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_duplicate_fields()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            var json = "{\"formatVersion\":1,\"formatVersion\":1,\"manifest\":" + ManifestJson(key, Path.Combine(root, "workflow.vsdx")) + ",\"savedAt\":\"2026-08-18T06:00:00+00:00\",\"lastActivity\":\"2026-08-18T06:00:00+00:00\"}";
            await WriteManifestAsync(root, key, json);

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_unknown_nested_field()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            var json = "{\"formatVersion\":1,\"manifest\":{\"key\":{\"tenantId\":\"tenant\",\"userId\":\"user\",\"deviceId\":\"device\",\"workflowId\":\"workflow\",\"unexpected\":true},\"outputPath\":" + JsonSerializer.Serialize(Path.Combine(root, "workflow.vsdx")) + ",\"document\":{\"documentHandle\":\"document\",\"pageHandle\":\"page\"},\"lastPlanHash\":null,\"operationJournal\":[]},\"savedAt\":\"2026-08-18T06:00:00+00:00\",\"lastActivity\":\"2026-08-18T06:00:00+00:00\"}";
            await WriteManifestAsync(root, key, json);

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_unsupported_format_version()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            var json = "{\"formatVersion\":4,\"manifest\":" + ManifestJson(key, Path.Combine(root, "workflow.vsdx")) + ",\"savedAt\":\"2026-08-18T06:00:00+00:00\",\"lastActivity\":\"2026-08-18T06:00:00+00:00\"}";
            await WriteManifestAsync(root, key, json);

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_manifest_whose_output_path_escapes_the_output_root()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var manifest = CreateManifest(root, outputPath: Path.Combine(root, "..", "outside.vsdx"));
            await WriteManifestAsync(root, manifest.Key, ValidEnvelope("tenant", "user", "device", "workflow", manifest.OutputPath));

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(manifest.Key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_fails_closed_for_an_injected_open_error_without_exposing_private_paths()
    {
        var root = CreateRoot();
        try
        {
            var key = CreateManifest(root).Key;
            var manifestPath = ManifestPath(root, key);
            var store = CreateStoreWithFailure(root, operation => operation == "open-read"
                ? new UnauthorizedAccessException($"denied {manifestPath}")
                : null);

            var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));

            Assert.DoesNotContain(root, error.Message, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(manifestPath, error.ToString(), StringComparison.OrdinalIgnoreCase);
            Assert.Null(error.InnerException);
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Save_rejects_a_reparse_point_for_the_private_manifest_directory()
    {
        var root = CreateRoot();
        var outside = CreateRoot();
        var link = Path.Combine(root, ".synapse-sessions");
        try
        {
            CreateJunctionOrSkip(link, outside);
            var store = new SessionRecoveryManifestStore(root);

            var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => store.SaveAsync(CreateManifest(root), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow));

            Assert.DoesNotContain(root, error.ToString(), StringComparison.OrdinalIgnoreCase);
            Assert.Empty(Directory.EnumerateFiles(outside));
        }
        finally
        {
            DeleteLink(link);
            DeleteRoot(root);
            DeleteRoot(outside);
        }
    }

    [Fact]
    public async Task Save_rejects_a_reparse_point_in_the_configured_output_root_ancestry()
    {
        var parent = CreateRoot();
        var target = CreateRoot();
        var output = Path.Combine(parent, "linked", "output");
        var link = Path.Combine(parent, "linked");
        try
        {
            Directory.CreateDirectory(Path.Combine(target, "output"));
            CreateJunctionOrSkip(link, target);
            var store = new SessionRecoveryManifestStore(output);

            var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => store.SaveAsync(CreateManifest(output), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow));

            Assert.DoesNotContain(parent, error.ToString(), StringComparison.OrdinalIgnoreCase);
            Assert.Empty(Directory.EnumerateFiles(Path.Combine(target, "output"), "*.json", SearchOption.AllDirectories));
        }
        finally
        {
            DeleteLink(link);
            DeleteRoot(parent);
            DeleteRoot(target);
        }
    }

    [Fact]
    public async Task Save_preserves_the_prior_manifest_when_atomic_replacement_fails()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var first = CreateManifest(root, documentHandle: "first-document");
            await store.SaveAsync(first, DateTimeOffset.Parse("2026-08-18T06:00:00Z"), DateTimeOffset.Parse("2026-08-18T06:01:00Z"));
            var path = ManifestPath(root, first.Key);
            File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.ReadOnly);

            try
            {
                await Assert.ThrowsAsync<WorkerProtocolException>(() => store.SaveAsync(CreateManifest(root, documentHandle: "second-document"), DateTimeOffset.Parse("2026-08-18T06:02:00Z"), DateTimeOffset.Parse("2026-08-18T06:03:00Z")));
            }
            finally
            {
                File.SetAttributes(path, FileAttributes.Normal);
            }

            var stored = await store.LoadAsync(first.Key);
            Assert.NotNull(stored);
            Assert.Equal("first-document", stored.Manifest.Document.DocumentHandle);
        }
        finally { DeleteRoot(root); }
    }

    private static SessionRecoveryManifestStore CreateStoreWithFailure(string root, Func<string, Exception?> failureFactory)
    {
        var constructor = typeof(SessionRecoveryManifestStore).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            [typeof(string), typeof(Func<string, Exception>)],
            modifiers: null);
        Assert.NotNull(constructor);
        return (SessionRecoveryManifestStore)constructor.Invoke([root, failureFactory])!;
    }

    private static async Task WriteManifestAsync(string root, VisioSessionKey key, string json)
    {
        var path = ManifestPath(root, key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, json);
    }

    private static string ValidEnvelope(string tenantId, string userId, string deviceId, string workflowId, string outputPath) =>
        "{\"formatVersion\":1,\"manifest\":{\"key\":{\"tenantId\":" + JsonSerializer.Serialize(tenantId) + ",\"userId\":" + JsonSerializer.Serialize(userId) + ",\"deviceId\":" + JsonSerializer.Serialize(deviceId) + ",\"workflowId\":" + JsonSerializer.Serialize(workflowId) + "},\"outputPath\":" + JsonSerializer.Serialize(outputPath) + ",\"document\":{\"documentHandle\":\"document\",\"pageHandle\":\"page\"},\"lastPlanHash\":null,\"operationJournal\":[]},\"savedAt\":\"2026-08-18T06:00:00+00:00\",\"lastActivity\":\"2026-08-18T06:00:00+00:00\"}";

    private static string ManifestJson(VisioSessionKey key, string outputPath) =>
        "{\"key\":{\"tenantId\":" + JsonSerializer.Serialize(key.TenantId) + ",\"userId\":" + JsonSerializer.Serialize(key.UserId) + ",\"deviceId\":" + JsonSerializer.Serialize(key.DeviceId) + ",\"workflowId\":" + JsonSerializer.Serialize(key.WorkflowId) + "},\"outputPath\":" + JsonSerializer.Serialize(outputPath) + ",\"document\":{\"documentHandle\":\"document\",\"pageHandle\":\"page\"},\"lastPlanHash\":null,\"operationJournal\":[]}";

    private static string ManifestPath(string root, VisioSessionKey key) =>
        Path.Combine(root, ".synapse-sessions", FileNameForTuple(key.TenantId, key.UserId, key.DeviceId, key.WorkflowId));

    private static string FileNameForTuple(params string[] fields)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes("visio-worker/session-recovery-manifest"));
        hash.AppendData([0, 1]);
        Span<byte> length = stackalloc byte[sizeof(int)];
        foreach (var field in fields)
        {
            var value = Encoding.UTF8.GetBytes(field);
            BinaryPrimitives.WriteInt32BigEndian(length, value.Length);
            hash.AppendData(length);
            hash.AppendData(value);
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant() + ".json";
    }

    private static VisioSessionRecoveryManifest CreateManifest(
        string root,
        string? outputPath = null,
        string documentHandle = "document",
        IEnumerable<VisioSessionCommandReplayEntry>? commandReplayJournal = null) => new(
        new VisioSessionKey("tenant", "user", "device", "workflow"),
        outputPath ?? Path.Combine(root, "workflow.vsdx"),
        new VisioSessionDocument(documentHandle, "page"),
        null,
        [],
        commandReplayJournal);

    private static VisioSessionCommandReplayEntry CreateTypedCommandReplay(string requestId, string commandName, string fingerprint, string outputPath)
    {
        var entryType = typeof(VisioSessionCommandReplayEntry);
        var commandProperty = entryType.GetProperty("Command", BindingFlags.Public | BindingFlags.Instance);
        Assert.NotNull(commandProperty);
        Assert.True(commandProperty!.PropertyType.IsEnum);
        var command = Enum.Parse(commandProperty.PropertyType, commandName, ignoreCase: false);
        var constructor = entryType.GetConstructors().SingleOrDefault(candidate =>
        {
            var parameters = candidate.GetParameters();
            return parameters.Length == 5
                && parameters[0].ParameterType == typeof(string)
                && parameters[1].ParameterType == commandProperty.PropertyType
                && parameters[2].ParameterType == typeof(string)
                && parameters[3].ParameterType == typeof(string)
                && parameters[4].ParameterType == typeof(string);
        });
        Assert.NotNull(constructor);
        return (VisioSessionCommandReplayEntry)constructor!.Invoke([requestId, command, fingerprint, "succeeded", outputPath]);
    }

    private static int FormatVersionOf(StoredSessionRecoveryManifest stored)
    {
        var property = typeof(StoredSessionRecoveryManifest).GetProperty("FormatVersion", BindingFlags.Public | BindingFlags.Instance);
        Assert.NotNull(property);
        return Assert.IsType<int>(property!.GetValue(stored));
    }

    private static string CreateRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "visio-manifest-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static void CreateJunctionOrSkip(string link, string target)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/d /c mklink /J \"{link}\" \"{target}\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            }) ?? throw new IOException();
            process.WaitForExit();
            if (process.ExitCode != 0 || (File.GetAttributes(link) & FileAttributes.ReparsePoint) == 0) throw new IOException();
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or PlatformNotSupportedException)
        {
            throw SkipException.ForSkip($"Cannot create a directory junction for this regression test: {error.GetType().Name}.");
        }
    }

    private static void DeleteLink(string link)
    {
        try
        {
            if (Directory.Exists(link) && (File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0) Directory.Delete(link);
        }
        catch (IOException) { }
    }

    private static void DeleteRoot(string root)
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
