using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageWorkerProtocolTests
{
    private const string DocumentFingerprint = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string PageFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private const string PlanHash = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

    [Fact]
    public void Parser_accepts_a_read_only_current_selection_capture_without_a_client_supplied_page_binding()
    {
        var request = SelectedPageWorkerRequestParser.Parse("{\"protocolVersion\":3,\"requestId\":\"request-capture\",\"command\":\"captureSelectedPage\"}");

        Assert.Equal(SelectedPageWorkerCommand.CaptureSelectedPage, request.Command);
        Assert.Equal("request-capture", request.RequestId);
        Assert.Null(request.Binding);
    }

    [Fact]
    public void Parser_rejects_a_current_selection_capture_that_carries_any_mutation_or_client_target_field()
    {
        const string json = "{\"protocolVersion\":3,\"requestId\":\"request-capture\",\"command\":\"captureSelectedPage\",\"binding\":{}}";

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(json));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_accepts_an_exact_selected_page_attachment_request()
    {
        var request = SelectedPageWorkerRequestParser.Parse(Attach());
        var binding = Assert.IsType<SelectedPageWorkerBinding>(request.Binding);

        Assert.Equal(SelectedPageWorkerCommand.AttachSelectedPage, request.Command);
        Assert.Equal("request-attach", request.RequestId);
        Assert.Equal("document-1", binding.DocumentId);
        Assert.Equal("page-1", binding.PageId);
        Assert.Equal(DocumentFingerprint, binding.DocumentFingerprint);
        Assert.Equal(PageFingerprint, binding.PageFingerprint);
        Assert.Equal("agent-region-1", binding.OwnershipNamespace);
    }

    [Theory]
    [InlineData("outputPath", "\"C:\\\\exports\\\\replacement.vsdx\"")]
    [InlineData("createDocument", "true")]
    [InlineData("createPage", "true")]
    [InlineData("open", "true")]
    public void Parser_rejects_every_legacy_document_or_page_escape_hatch(string property, string rawValue)
    {
        var json = Attach()[..^1] + $",\"{property}\":{rawValue}}}";

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(json));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_an_apply_request_without_a_sealed_native_intent()
    {
        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(Apply("null")));

        Assert.Contains("sealed", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_an_apply_request_with_a_mismatched_ownership_namespace()
    {
        var intent = SealedIntent("other-region");

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(Apply(intent)));

        Assert.Contains("ownership", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_unknown_nested_binding_property()
    {
        var json = Attach().Replace("\"ownershipNamespace\":\"agent-region-1\"", "\"ownershipNamespace\":\"agent-region-1\",\"nativeMethod\":\"Quit\"");

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(json));

        Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Parser_rejects_a_sealed_intent_whose_declared_hash_does_not_match_its_base64url_bytes()
    {
        var intent = SealedIntent("agent-region-1").Replace(PlanHash, new string('c', 64), StringComparison.Ordinal);

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(Apply(intent)));

        Assert.Contains("hash", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static string Attach() => "{\"protocolVersion\":3,\"requestId\":\"request-attach\",\"command\":\"attachSelectedPage\",\"binding\":" + Binding() + "}";

    private static string Apply(string sealedNativeIntent) => "{\"protocolVersion\":3,\"requestId\":\"request-apply\",\"command\":\"applyOwnedRegion\",\"binding\":" + Binding() + ",\"ownershipNamespace\":\"agent-region-1\",\"sealedNativeIntent\":" + sealedNativeIntent + "}";

    private static string Binding() => "{\"jobId\":\"job-1\",\"tenantId\":\"tenant-1\",\"userId\":\"user-1\",\"deviceId\":\"device-1\",\"workflowId\":\"workflow-1\",\"documentId\":\"document-1\",\"pageId\":\"page-1\",\"documentFingerprint\":\"" + DocumentFingerprint + "\",\"pageFingerprint\":\"" + PageFingerprint + "\",\"expectedRevision\":7,\"ownershipNamespace\":\"agent-region-1\"}";

    // The TypeScript signer transmits base64url bytes in canonicalPlanBase64. Keeping this
    // fixture on the cross-language spelling prevents the Worker from accepting only a private
    // C# variant that no real API request can produce.
    private static string SealedIntent(string ownershipNamespace) => "{\"version\":2,\"jobId\":\"job-1\",\"tenantId\":\"tenant-1\",\"userId\":\"user-1\",\"deviceId\":\"device-1\",\"workflowId\":\"workflow-1\",\"documentId\":\"document-1\",\"pageId\":\"page-1\",\"documentFingerprint\":\"" + DocumentFingerprint + "\",\"pageFingerprint\":\"" + PageFingerprint + "\",\"expectedRevision\":7,\"ownershipNamespace\":\"" + ownershipNamespace + "\",\"planId\":\"plan-1\",\"planHash\":\"" + PlanHash + "\",\"canonicalPlanBase64\":\"e30\",\"expiresAt\":\"2030-01-01T00:00:00.000Z\",\"signature\":\"ddddddddddddddddddddddddddddddddddddddddddd\"}";
}
