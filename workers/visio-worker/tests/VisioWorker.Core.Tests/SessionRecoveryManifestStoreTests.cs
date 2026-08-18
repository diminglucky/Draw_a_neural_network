using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SessionRecoveryManifestStoreTests
{
    [Fact]
    public async Task Save_and_load_round_trip_a_manifest_without_exposing_a_path()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var manifest = CreateManifest(root);
            var savedAt = DateTimeOffset.Parse("2026-08-18T06:00:00Z");
            var lastActivity = DateTimeOffset.Parse("2026-08-18T06:05:00Z");

            await store.SaveAsync(manifest, savedAt, lastActivity);
            var stored = await store.LoadAsync(manifest.Key);

            Assert.NotNull(stored);
            Assert.Equal(manifest, stored.Manifest);
            Assert.Equal(savedAt, stored.SavedAt);
            Assert.Equal(lastActivity, stored.LastActivity);
            var tuple = string.Join("\n", manifest.Key.TenantId, manifest.Key.UserId, manifest.Key.DeviceId, manifest.Key.WorkflowId);
            var expectedFileName = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(tuple))).ToLowerInvariant() + ".json";
            Assert.Equal(expectedFileName, Path.GetFileName(store.GetPathForTesting(manifest.Key)));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_manifest_whose_embedded_key_differs_from_requested_key()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = new VisioSessionKey("tenant-a", "user", "device", "workflow");
            await File.WriteAllTextAsync(store.GetPathForTesting(key), """{"formatVersion":1,"manifest":{"key":{"tenantId":"tenant-b","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"C:\\exports\\workflow.vsdx","document":{"documentHandle":"document","pageHandle":"page"},"lastPlanHash":null,"operationJournal":[]},"savedAt":"2026-08-18T06:00:00+00:00","lastActivity":"2026-08-18T06:00:00+00:00"}""");

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
        }
        finally { DeleteRoot(root); }
    }

    [Fact]
    public async Task Load_rejects_corrupt_or_unknown_json()
    {
        var root = CreateRoot();
        try
        {
            var store = new SessionRecoveryManifestStore(root);
            var key = CreateManifest(root).Key;
            await File.WriteAllTextAsync(store.GetPathForTesting(key), """{"formatVersion":1,"unexpected":true}""");

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
            await File.WriteAllTextAsync(store.GetPathForTesting(key), "{");

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
            var envelope = JsonSerializer.Serialize(new
            {
                formatVersion = 1,
                manifest = new
                {
                    key = new { tenantId = "tenant", userId = "user", deviceId = "device", workflowId = "workflow" },
                    outputPath = manifest.OutputPath,
                    document = new { documentHandle = "document", pageHandle = "page" },
                    lastPlanHash = (string?)null,
                    operationJournal = Array.Empty<object>(),
                },
                savedAt = "2026-08-18T06:00:00+00:00",
                lastActivity = "2026-08-18T06:00:00+00:00",
            });
            await File.WriteAllTextAsync(store.GetPathForTesting(manifest.Key), envelope);

            await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(manifest.Key));
        }
        finally { DeleteRoot(root); }
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
            var path = store.GetPathForTesting(first.Key);
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

    private static VisioSessionRecoveryManifest CreateManifest(string root, string? outputPath = null, string documentHandle = "document") => new(
        new VisioSessionKey("tenant", "user", "device", "workflow"),
        outputPath ?? Path.Combine(root, "workflow.vsdx"),
        new VisioSessionDocument(documentHandle, "page"),
        null,
        []);

    private static string CreateRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "visio-manifest-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static void DeleteRoot(string root)
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
