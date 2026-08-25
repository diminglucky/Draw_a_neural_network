using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class SelectedPageSealedIntentVerifierTests
{
    // Generated once with apps/api/src/visio-universal-protocol.ts:
    // createSelectedPageSealedPlan(bindingWithCanonicalPlanBytes(Buffer.from("{}")), FixtureSecret).
    // It is intentionally hard-coded so this test detects a byte-level signer/canonicalization drift.
    private const string FixtureSecret = "ts-selected-page-fixture-secret-v2";
    private const string FixtureEnvelope = """
        {"version":2,"jobId":"job-1","tenantId":"tenant-1","userId":"user-1","deviceId":"device-1","workflowId":"workflow-1","documentId":"document-1","pageId":"page-1","documentFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pageFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","expectedRevision":7,"ownershipNamespace":"agent-region-1","planId":"plan-1","planHash":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","expiresAt":"2030-01-01T00:00:00.000Z","canonicalPlanBase64":"e30","signature":"qNmt4uiKAY0QBYWQs4ARWztKZuu8yOMS2BS5WTZ4TQ8"}
        """;
    // Generated with the same TypeScript signer as FixtureEnvelope, using the valid v3 boundary values
    // jobId=1job, tenantId=2tenant, userId=3user, deviceId=4device, workflowId=5workflow,
    // documentId=6document, pageId=7page, ownershipNamespace=8agent, planId=9plan, expectedRevision=0.
    private const string NumericIdentifierInitialRevisionFixtureEnvelope = """
        {"version":2,"jobId":"1job","tenantId":"2tenant","userId":"3user","deviceId":"4device","workflowId":"5workflow","documentId":"6document","pageId":"7page","documentFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pageFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","expectedRevision":0,"ownershipNamespace":"8agent","planId":"9plan","planHash":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","expiresAt":"2030-01-01T00:00:00.000Z","canonicalPlanBase64":"e30","signature":"MXOp4rp93-3Mq7vp1zmlhHFt0IYMLBr82fcMxbwHAuw"}
        """;
    private const string NativeIntent = """
        {"protocolVersion":"pvp-native-intent-1","planId":"plan-1","planHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","updateIdentity":{"ownerId":"user-1","deviceId":"device-1","workflowId":"workflow-1","documentId":"document-1","pageId":"page-1","expectedRevision":7},"coordinateSpace":{"id":"pvp-du-1","unit":"du","duPerInch":1000,"page":{"x":0,"y":0,"width":1000,"height":600}},"primitives":[{"primitiveId":"input-1","componentId":"input-1","nativeKind":"terminal","label":"Input","bounds":{"x":10,"y":20,"width":100,"height":80},"styleTokenIds":[],"shapeData":{"pvp.planId":"plan-1","pvp.planHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","pvp.primitiveId":"input-1","pvp.componentId":"input-1","pvp.ownership":"agent"}}],"connectors":[]}
        """;
    private static readonly SelectedPageTarget Target = new(
        "document-1", "page-1", new string('a', 64), new string('b', 64), 7);

    [Fact]
    public void Verifier_accepts_the_stable_TypeScript_v2_signer_fixture()
    {
        var verifier = new SelectedPageSealedIntentVerifier(FixtureSecret);

        verifier.Verify(SelectedPageWorkerRequestParser.Parse(ApplyRequest(FixtureEnvelope)));
    }

    [Fact]
    public void Parser_and_verifier_accept_a_TypeScript_valid_numeric_identifier_and_initial_revision_fixture()
    {
        var request = SelectedPageWorkerRequestParser.Parse(NumericIdentifierInitialRevisionApplyRequest());

        new SelectedPageSealedIntentVerifier(FixtureSecret).Verify(request);
    }

    [Fact]
    public async Task Runtime_maps_authenticated_canonical_plan_bytes_without_equating_outer_and_inner_plan_hashes()
    {
        var envelope = SignedEnvelope(NativeIntent);
        using var envelopeDocument = JsonDocument.Parse(envelope);
        var backend = new RecordingBackend { ActiveTarget = Target };
        await using var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier(FixtureSecret));

        await runtime.ProcessAsync(AttachRequest());
        var response = await runtime.ProcessAsync(Request(envelope));

        Assert.Equal("succeeded", response.Status);
        Assert.NotEqual(new string('c', 64), envelopeDocument.RootElement.GetProperty("planHash").GetString());
        Assert.Equal(1, backend.ApplyCalls);
        Assert.NotNull(backend.AppliedPlan);
        Assert.Equal("plan-1", backend.AppliedPlan.Title);
        Assert.Equal("input-1", Assert.Single(backend.AppliedPlan.Nodes).Id);
    }

    [Fact]
    public async Task Runtime_rejects_a_validly_signed_outer_plan_id_that_does_not_match_the_decoded_plan_before_apply()
    {
        var backend = new RecordingBackend { ActiveTarget = Target };
        await using var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier(FixtureSecret));
        await runtime.ProcessAsync(AttachRequest());

        var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Request(SignedEnvelope(NativeIntent, planId: "plan-2"))));

        Assert.Contains("binding", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, backend.ApplyCalls);
    }

    [Fact]
    public async Task Runtime_rejects_validly_signed_decoded_target_identity_that_does_not_match_the_binding_before_apply()
    {
        var mismatchedIdentity = NativeIntent.Replace("\"ownerId\":\"user-1\"", "\"ownerId\":\"user-2\"", StringComparison.Ordinal);
        var backend = new RecordingBackend { ActiveTarget = Target };
        await using var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier(FixtureSecret));
        await runtime.ProcessAsync(AttachRequest());

        var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(Request(SignedEnvelope(mismatchedIdentity))));

        Assert.Contains("binding", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, backend.ApplyCalls);
    }

    [Theory]
    [InlineData("\"planId\":\"plan-1\"", "\"planId\":\"plan-2\"")]
    [InlineData("\"canonicalPlanBase64\":\"e30\"", "\"canonicalPlanBase64\":\"W10\"")]
    [InlineData("\"expiresAt\":\"2030-01-01T00:00:00.000Z\"", "\"expiresAt\":\"2000-01-01T00:00:00.000Z\"")]
    public async Task Runtime_rejects_a_tampered_v2_envelope_before_any_backend_apply(string oldValue, string newValue)
    {
        var tampered = FixtureEnvelope.Replace(oldValue, newValue, StringComparison.Ordinal);

        var error = await AssertRuntimeRejectsBeforeApplyAsync(Request(tampered), FixtureSecret);

        Assert.Contains("signature", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Runtime_rejects_a_valid_TypeScript_fixture_when_the_worker_has_a_different_secret_before_any_backend_apply()
    {
        var error = await AssertRuntimeRejectsBeforeApplyAsync(Request(FixtureEnvelope), "wrong-worker-secret");

        Assert.Contains("signature", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Runtime_rejects_a_forged_signature_before_any_backend_apply()
    {
        var forged = FixtureEnvelope.Replace("qNmt4uiKAY0QBYWQs4ARWztKZuu8yOMS2BS5WTZ4TQ8", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", StringComparison.Ordinal);

        var error = await AssertRuntimeRejectsBeforeApplyAsync(Request(forged), FixtureSecret);

        Assert.Contains("signature", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("\"canonicalPlanBase64\":\"e30\"", "\"canonicalPlanBase64\":\"W10\"", "hash")]
    [InlineData("\"expiresAt\":\"2030-01-01T00:00:00.000Z\"", "\"expiresAt\":\"2000-01-01T00:00:00.000Z\"", "expired")]
    public void Parser_rejects_hash_or_expiration_tampering_before_the_runtime_can_reach_a_backend(string oldValue, string newValue, string expectedMessage)
    {
        var tampered = FixtureEnvelope.Replace(oldValue, newValue, StringComparison.Ordinal);
        var backend = new RecordingBackend();

        var error = Assert.Throws<WorkerProtocolException>(() => SelectedPageWorkerRequestParser.Parse(ApplyRequest(tampered)));

        Assert.Contains(expectedMessage, error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, backend.ApplyCalls);
    }

    private static SelectedPageWorkerRequest Request(string envelope)
    {
        using var document = JsonDocument.Parse(envelope);
        return new SelectedPageWorkerRequest(
            "request-apply",
            SelectedPageWorkerCommand.ApplyOwnedRegion,
            new SelectedPageWorkerBinding("job-1", "tenant-1", "user-1", "device-1", "workflow-1", "document-1", "page-1", new string('a', 64), new string('b', 64), 7, "agent-region-1"),
            "agent-region-1",
            document.RootElement.Clone());
    }

    private static SelectedPageWorkerRequest AttachRequest() => new(
        "request-attach",
        SelectedPageWorkerCommand.AttachSelectedPage,
        new SelectedPageWorkerBinding("job-1", "tenant-1", "user-1", "device-1", "workflow-1", Target.DocumentId, Target.PageId, Target.DocumentFingerprint, Target.PageFingerprint, Target.ExpectedRevision, "agent-region-1"));

    private static string SignedEnvelope(string canonicalPlan, string planId = "plan-1")
    {
        var canonicalPlanBytes = Encoding.UTF8.GetBytes(canonicalPlan);
        var envelope = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["version"] = 2,
            ["jobId"] = "job-1",
            ["tenantId"] = "tenant-1",
            ["userId"] = "user-1",
            ["deviceId"] = "device-1",
            ["workflowId"] = "workflow-1",
            ["documentId"] = "document-1",
            ["pageId"] = "page-1",
            ["documentFingerprint"] = new string('a', 64),
            ["pageFingerprint"] = new string('b', 64),
            ["expectedRevision"] = 7,
            ["ownershipNamespace"] = "agent-region-1",
            ["planId"] = planId,
            ["planHash"] = Convert.ToHexString(SHA256.HashData(canonicalPlanBytes)).ToLowerInvariant(),
            ["expiresAt"] = "2030-01-01T00:00:00.000Z",
            ["canonicalPlanBase64"] = Base64Url(canonicalPlanBytes),
        };
        var unsignedEnvelope = JsonSerializer.SerializeToUtf8Bytes(envelope);
        envelope["signature"] = Base64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(FixtureSecret), unsignedEnvelope));
        return JsonSerializer.Serialize(envelope);
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static async Task<WorkerProtocolException> AssertRuntimeRejectsBeforeApplyAsync(SelectedPageWorkerRequest request, string secret)
    {
        var backend = new RecordingBackend();
        await using var runtime = new SelectedPageWorkerRuntime(backend, new SelectedPageSealedIntentVerifier(secret));

        var error = await Assert.ThrowsAsync<WorkerProtocolException>(() => runtime.ProcessAsync(request));

        Assert.Equal(0, backend.ApplyCalls);
        return error;
    }

    private static string ApplyRequest(string envelope) => "{\"protocolVersion\":3,\"requestId\":\"request-apply\",\"command\":\"applyOwnedRegion\",\"binding\":{\"jobId\":\"job-1\",\"tenantId\":\"tenant-1\",\"userId\":\"user-1\",\"deviceId\":\"device-1\",\"workflowId\":\"workflow-1\",\"documentId\":\"document-1\",\"pageId\":\"page-1\",\"documentFingerprint\":\"" + new string('a', 64) + "\",\"pageFingerprint\":\"" + new string('b', 64) + "\",\"expectedRevision\":7,\"ownershipNamespace\":\"agent-region-1\"},\"ownershipNamespace\":\"agent-region-1\",\"sealedNativeIntent\":" + envelope + "}";

    private static string NumericIdentifierInitialRevisionApplyRequest() => "{\"protocolVersion\":3,\"requestId\":\"1request\",\"command\":\"applyOwnedRegion\",\"binding\":{\"jobId\":\"1job\",\"tenantId\":\"2tenant\",\"userId\":\"3user\",\"deviceId\":\"4device\",\"workflowId\":\"5workflow\",\"documentId\":\"6document\",\"pageId\":\"7page\",\"documentFingerprint\":\"" + new string('a', 64) + "\",\"pageFingerprint\":\"" + new string('b', 64) + "\",\"expectedRevision\":0,\"ownershipNamespace\":\"8agent\"},\"ownershipNamespace\":\"8agent\",\"sealedNativeIntent\":" + NumericIdentifierInitialRevisionFixtureEnvelope + "}";

    private sealed class RecordingBackend : ISelectedPageSessionBackend
    {
        public SelectedPageTarget? ActiveTarget { get; init; }
        public int ApplyCalls { get; private set; }
        public DiagramDocument? AppliedPlan { get; private set; }

        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default) => Task.FromResult(ActiveTarget);
        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default) { ApplyCalls++; AppliedPlan = plan; return Task.CompletedTask; }
        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.FromResult(new SelectedPageReadback(target, 0, 0, []));
        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
