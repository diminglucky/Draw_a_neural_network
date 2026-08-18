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

    [Fact]
    public void Parser_rejects_unknown_nested_diagram_property()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x","method":"Quit"},"nodes":[],"edges":[]}""")));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("method", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_duplicate_nested_diagram_property()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[{"id":"node-1","id":"node-2","width":100,"height":100}],"edges":[]}""")));

        Assert.Contains("duplicate", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_negative_node_dimensions_before_request_is_returned()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[{"id":"node-1","width":-1,"height":100}],"edges":[]}""")));

        Assert.Contains("dimensions", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_duplicate_node_ids_before_request_is_returned()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[{"id":"node-1","width":100,"height":100},{"id":"node-1","width":100,"height":100}],"edges":[]}""")));

        Assert.Contains("duplicate", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_edge_with_missing_endpoint_before_request_is_returned()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[{"id":"node-1","width":100,"height":100}],"edges":[{"id":"edge-1","source":"node-1","target":"node-2","points":[{"x":0,"y":0},{"x":1,"y":1}]}]}""")));

        Assert.Contains("missing node", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_edge_with_fewer_than_two_points_before_request_is_returned()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[{"id":"node-1","width":100,"height":100}],"edges":[{"id":"edge-1","source":"node-1","target":"node-1","points":[{"x":0,"y":0}]}]}""")));

        Assert.Contains("fewer than two", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_invalid_figure_plan_before_request_is_returned()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[],"edges":[],"figurePlan":{"coordinateSpace":{"unit":"pixels","figureUnitInches":1,"origin":"bottom-left","width":0,"height":0},"primitiveGroups":[],"connectors":[],"labels":[]}}""")));

        Assert.Contains("figure plan", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_accepts_the_model_defined_null_figure_plan()
    {
        var request = WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[],"edges":[],"figurePlan":null}"""));

        Assert.Null(request.Diagram!.FigurePlan);
    }

    [Fact]
    public void Parser_rejects_output_path_outside_configured_root()
    {
        var root = Path.Combine(Path.GetTempPath(), "visio-v2-protocol-root");
        var json = Open(Path.Combine(root, "..", "outside.vsdx"));

        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(json, root));

        Assert.Contains("inside", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_normalizes_output_path_inside_configured_root()
    {
        var root = Path.Combine(Path.GetTempPath(), "visio-v2-protocol-root");
        var path = Path.Combine(root, "nested", "workflow.vsdx");

        var request = WorkerV2RequestParser.Parse(Open(path), root);

        Assert.Equal(Path.GetFullPath(path), request.OutputPath);
    }

    [Fact]
    public void Parser_without_a_trusted_root_rejects_commands_containing_output_path()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Open(Path.Combine(Path.GetTempPath(), "workflow.vsdx"))));

        Assert.Contains("root", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_invalid_operation_identifier()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[],"edges":[]}""", operationId: "operation/1")));

        Assert.Contains("operationId", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_invalid_sha256_plan_hash()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(Apply("""{"figure":{"title":"x"},"nodes":[],"edges":[]}""", planHash: "not-a-sha256")));

        Assert.Contains("Plan hash", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_invalid_session_identifier()
    {
        const string json = """{"protocolVersion":2,"requestId":"request-1","command":"snapshot","session":{"tenantId":"tenant","userId":"user/other","deviceId":"device","workflowId":"workflow"}}""";

        var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(json));

        Assert.Contains("Session identifiers", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static string Open(string outputPath) => $$"""{"protocolVersion":2,"requestId":"request-1","command":"open","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":{{System.Text.Json.JsonSerializer.Serialize(outputPath)}}}""";

    private static string Apply(string diagram, string operationId = "operation-1", string planHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") =>
        $$"""{"protocolVersion":2,"requestId":"request-1","command":"apply","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":{{System.Text.Json.JsonSerializer.Serialize(operationId)}},"planHash":{{System.Text.Json.JsonSerializer.Serialize(planHash)}},"diagram":{{diagram}}}""";
}
