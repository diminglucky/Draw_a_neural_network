using VisioWorker.Core;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

[Trait("Category", "LiveVisio")]
public sealed class VisioComSessionLiveAcceptanceTests
{
    // Deliberately excluded from the default suite: it launches the locally installed Microsoft Visio COM server.
    // Run this focused test manually on a Windows Visio host after temporarily enabling it in the acceptance job.
    [Fact(Skip = "Manual installed-Visio acceptance test; enable only on a controlled Windows Visio host.")]
    public async Task Same_live_session_draws_updates_saves_closes_and_recovers_one_editable_vsdx()
    {
        var outputRoot = Path.Combine(Path.GetTempPath(), "synapse-live-visio-session-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputRoot);
        try
        {
            {
                await using var engine = new VisioComEngine(new VisioComEngineOptions(OutputRoot: outputRoot));
                await using var backend = engine.CreateSessionBackend();
                var manager = new VisioSessionManager(backend);
                var key = new VisioSessionKey("live-tenant", "live-user", "live-device", "live-workflow");
                var firstPlan = Plan("encoder", "Encoder");
                var secondPlan = Plan("decoder", "Decoder");

                var first = await manager.ApplyPlanAsync(key, Operation("first"), firstPlan);
                var second = await manager.ApplyPlanDiffAsync(key, Operation("second"), secondPlan);
                var outputPath = Path.Combine(outputRoot, "session.vsdx");
                var saved = await manager.SaveAsAsync(key, outputPath);
                await manager.CloseAsync(key);
                var recovered = await manager.RecoverAsync(key, saved.RecoveryManifest!);
                var afterRecovery = await manager.ApplyPlanDiffAsync(key, Operation("after-recovery"), Plan("classifier", "Classifier"));
                await manager.CloseAsync(key);

                Assert.False(first.Replayed);
                Assert.False(second.Replayed);
                Assert.Equal(VisioSessionState.Dirty, second.Snapshot.State);
                Assert.True(File.Exists(outputPath));
                Assert.Equal(VisioSessionState.Open, recovered.State);
                Assert.False(afterRecovery.Replayed);
                Assert.Equal(VisioSessionState.Dirty, afterRecovery.Snapshot.State);
                Assert.NotEqual(saved.Document!.DocumentHandle, recovered.Document!.DocumentHandle);
            }
        }
        finally
        {
            await DeleteOutputDirectoryAsync(outputRoot);
        }
    }

    private static VisioSessionOperation Operation(string id) => new(id, Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id))));

    private static async Task DeleteOutputDirectoryAsync(string outputRoot)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, recursive: true);
                return;
            }
            catch (IOException) when (attempt < 8)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250));
            }
        }
    }

    private static DiagramDocument Plan(string nodeId, string label) => new(
        "Live session diagram",
        [label],
        [new VisioNode(nodeId, "conv", label, null, 0, 1, 1, 1.2, 0.9, "64×56×56", "standard", "network-node", 1, 1, false, "#4f86c6", new Dictionary<string, string> { ["synapse.layerRole"] = "network-node" })],
        [new VisioConnector(nodeId + "-edge", nodeId, "output", "signal", [new DiagramPoint(2.2, 1.45), new DiagramPoint(4, 1.45)])]);
}
