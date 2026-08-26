using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Host;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageWorkerReadbackContractTests
{
    private static readonly SelectedPageTarget Target = new(
        "document-1",
        "page-1",
        new string('a', 64),
        new string('b', 64),
        ExpectedRevision: 7);

    [Fact]
    public async Task Read_selected_page_emits_the_flat_safe_readback_contract()
    {
        var backend = new RecordingBackend();
        await using var runtime = new SelectedPageWorkerRuntime(backend);
        var binding = new SelectedPageWorkerBinding(
            "job-1", "tenant-1", "user-1", "device-1", "workflow-1",
            Target.DocumentId, Target.PageId, Target.DocumentFingerprint, Target.PageFingerprint,
            Target.ExpectedRevision, "agent-region-1");

        await runtime.ProcessAsync(new SelectedPageWorkerRequest("request-attach", SelectedPageWorkerCommand.AttachSelectedPage, binding));
        var response = await runtime.ProcessAsync(new SelectedPageWorkerRequest("request-read", SelectedPageWorkerCommand.ReadSelectedPage, binding));

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        var readback = document.RootElement.GetProperty("readback");

        Assert.True(readback.TryGetProperty("valid", out var valid), "Worker readback must expose the public valid marker.");
        Assert.True(valid.GetBoolean());
        Assert.Equal(Target.DocumentId, readback.GetProperty("documentId").GetString());
        Assert.Equal(Target.PageId, readback.GetProperty("pageId").GetString());
        Assert.Equal("agent-region-1", readback.GetProperty("ownershipNamespace").GetString());
        Assert.Equal(0, readback.GetProperty("unclassifiedShapeCount").GetInt32());
        var shapes = readback.GetProperty("agentOwnedShapes");
        Assert.Equal(1, shapes.GetArrayLength());
        Assert.Equal("agent-region-1", shapes[0].GetProperty("ownershipNamespace").GetString());
        Assert.Equal("semantic-1", shapes[0].GetProperty("sourceMappingSemanticIds")[0].GetString());
        Assert.False(readback.TryGetProperty("target", out _), "Worker readback must not expose an internal nested target.");
        Assert.False(readback.TryGetProperty("agentOwnedShapeCount", out _), "Worker readback must not expose an internal aggregate count.");
        Assert.False(readback.TryGetProperty("agentOwnedPrimitiveIds", out _), "Worker readback must not expose an internal primitive-ID aggregate.");
    }

    private sealed class RecordingBackend : ISelectedPageSessionBackend
    {
        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task BeginAttachAttemptAsync() => Task.CompletedTask;
        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default) => Task.FromResult<SelectedPageTarget?>(Target);
        public Task RevalidateAttachedTargetAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task BeginApplyAttemptAsync(SelectedPageTarget target) => Task.CompletedTask;
        public Task BeginReadAttemptAsync(SelectedPageTarget target) => Task.CompletedTask;
        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default) =>
            Task.FromResult(new SelectedPageReadback(
                true,
                target.DocumentId,
                target.PageId,
                target.DocumentFingerprint,
                target.PageFingerprint,
                target.ExpectedRevision,
                ownershipNamespace,
                UserOwnedShapeCount: 2,
                AgentOwnedShapes: [new SelectedPageReadbackShape("shape-1", ownershipNamespace, ["semantic-1"])],
                UnclassifiedShapeCount: 0));
        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
