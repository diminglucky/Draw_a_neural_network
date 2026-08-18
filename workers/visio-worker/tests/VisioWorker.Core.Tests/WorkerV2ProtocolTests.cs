using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class WorkerV2ProtocolTests
{
    [Fact]
    public void Parser_rejects_unknown_apply_field_before_runtime_dispatch()
    {
        const string json = """{"protocolVersion":2,"requestId":"request-1","command":"apply","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":"operation-1","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","diagram":{"figure":{"title":"x"},"nodes":[],"edges":[]},"method":"Quit"}""";

        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(json));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_accepts_valid_apply_diff()
    {
        var request = WorkerV2RequestParser.Parse("""{"protocolVersion":2,"requestId":"request-1","command":"applyDiff","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":"operation-1","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","diagram":{"figure":{"title":"x"},"nodes":[],"edges":[]}}""");

        Assert.Equal(WorkerV2Command.ApplyDiff, request.Command);
        Assert.Equal("request-1", request.RequestId);
        Assert.Equal(new VisioSessionKey("tenant", "user", "device", "workflow"), request.Session.ToKey());
        Assert.NotNull(request.Diagram);
    }

    [Fact]
    public void Parser_rejects_invalid_command()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse("""{"protocolVersion":2,"requestId":"request-1","command":"quit","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}"""));

        Assert.Contains("command", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_save_containing_diagram()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse("""{"protocolVersion":2,"requestId":"request-1","command":"save","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"C:\\exports\\workflow.vsdx","diagram":{"figure":{"title":"x"},"nodes":[],"edges":[]}}"""));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_close_without_save_or_discard_disposition()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse("""{"protocolVersion":2,"requestId":"request-1","command":"close","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}"""));

        Assert.Contains("disposition", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}
