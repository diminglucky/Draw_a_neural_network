using System.Text.Json;
using System.Reflection;
using System.Text;
using VisioWorker.Core;
using VisioWorker.Host;
using VisioWorker.Live;

namespace VisioWorker.Core.Tests;

public sealed class WorkerHostLineProcessorTests
{
    [Fact]
    public void Configures_every_json_lines_standard_stream_as_utf8()
    {
        Encoding? input = null;
        Encoding? output = null;
        TextWriter? error = null;
        using var errorStream = new MemoryStream();

        WorkerStandardStreams.Configure(encoding => input = encoding, encoding => output = encoding, writer => error = writer, () => errorStream);

        Assert.Equal(Encoding.UTF8.CodePage, input!.CodePage);
        Assert.Equal(Encoding.UTF8.CodePage, output!.CodePage);
        Assert.Equal(Encoding.UTF8.CodePage, error!.Encoding.CodePage);
        Assert.Empty(input.GetPreamble());
    }

    public static IEnumerable<object[]> MalformedProtocolDiscriminatorCases()
    {
        yield return ProtocolCase("exact-v1-duplicate", "\"protocolVersion\":1,\"protocolVersion\":1", false);
        yield return ProtocolCase("case-v1-duplicate", "\"protocolVersion\":1,\"ProtocolVersion\":1", false);
        yield return ProtocolCase("string-before-v1", "\"protocolVersion\":\"bad\",\"ProtocolVersion\":1", false);
        yield return ProtocolCase("v1-before-string", "\"protocolVersion\":1,\"ProtocolVersion\":\"bad\"", false);
        yield return ProtocolCase("null-before-v1", "\"protocolVersion\":null,\"ProtocolVersion\":1", false);
        yield return ProtocolCase("v1-before-null", "\"protocolVersion\":1,\"ProtocolVersion\":null", false);
        yield return ProtocolCase("string-before-v1-again", "\"protocolVersion\":\"not-an-integer\",\"ProtocolVersion\":1", false);
        yield return ProtocolCase("overflow-before-v1", "\"protocolVersion\":2147483648,\"ProtocolVersion\":1", false);
        yield return ProtocolCase("v1-before-overflow", "\"protocolVersion\":1,\"ProtocolVersion\":2147483648", false);
        yield return ProtocolCase("exact-v2-duplicate", "\"protocolVersion\":2,\"protocolVersion\":2", true);
        yield return ProtocolCase("case-v2-duplicate", "\"protocolVersion\":2,\"ProtocolVersion\":2", true);
        yield return ProtocolCase("null-before-v2", "\"protocolVersion\":null,\"ProtocolVersion\":2", true);
        yield return ProtocolCase("v2-before-null", "\"protocolVersion\":2,\"ProtocolVersion\":null", true);
        yield return ProtocolCase("string-before-v2", "\"protocolVersion\":\"bad\",\"ProtocolVersion\":2", true);
        yield return ProtocolCase("v2-before-string", "\"protocolVersion\":2,\"ProtocolVersion\":\"bad\"", true);
        yield return ProtocolCase("overflow-before-v2", "\"protocolVersion\":2147483648,\"ProtocolVersion\":2", true);
        yield return ProtocolCase("v2-before-overflow", "\"protocolVersion\":2,\"ProtocolVersion\":2147483648", true);
        yield return ProtocolCase("single-null", "\"protocolVersion\":null", false);
        yield return ProtocolCase("single-string", "\"protocolVersion\":\"bad\"", false);
        yield return ProtocolCase("single-overflow", "\"protocolVersion\":2147483648", false);
        yield return ProtocolCase("single-unsupported", "\"protocolVersion\":4", false);

        // JSON Number values mathematically equal to two are v2 candidates even when the
        // strict v2 parser later rejects their non-integer representation.
        foreach (var numericTwo in new[] { "2.0", "2.00", "2e0", "2E+0" })
        {
            yield return ProtocolCase($"numeric-{numericTwo}-single", $"\"protocolVersion\":{numericTwo}", true);

            foreach (var (name, value) in new[]
            {
                ("null", "null"),
                ("string", "\"bad\""),
                ("overflow", "2147483648"),
                ("v1", "1"),
            })
            {
                yield return ProtocolCase($"numeric-{numericTwo}-before-{name}", $"\"protocolVersion\":{numericTwo},\"ProtocolVersion\":{value}", true);
                yield return ProtocolCase($"{name}-before-numeric-{numericTwo}", $"\"protocolVersion\":{value},\"ProtocolVersion\":{numericTwo}", true);
            }
        }
    }

    [Theory]
    [MemberData(nameof(MalformedProtocolDiscriminatorCases))]
    public async Task Duplicate_or_invalid_protocol_discriminators_fail_closed_before_any_v1_draw(
        string caseName,
        string protocolProperties,
        bool expectsV2Failure)
    {
        using var fixture = new HostFixture();
        var line = fixture.V1EnvelopeWithProtocolProperties(protocolProperties, caseName);
        await using var processor = fixture.CreateLineProcessor();
        var classification = ReadProtocolClassification(line);

        Assert.Equal(expectsV2Failure ? "V2" : "V1", classification.Protocol);
        Assert.Equal(!expectsV2Failure, classification.IsSafeV1Failure);

        var response = await processor.ProcessLineAsync(line);

        if (expectsV2Failure)
        {
            var v2 = Assert.IsType<WorkerV2Response>(response);
            Assert.Equal("unknown", v2.RequestId);
            Assert.Equal("failed", v2.Status);
        }
        else
        {
            var v1 = Assert.IsType<WorkerResponse>(response);
            Assert.Equal("unknown", v1.RequestId);
            Assert.Equal("failed", v1.Status);
        }

        Assert.False(File.Exists(fixture.V1OutputPath));
        Assert.Equal(0, fixture.Backend.OpenOrCreateCalls);

        var output = new TrackingTextWriter();
        var exitCode = await RunHostLoopAsync(new StringReader(line), output, fixture.CreateOptions());
        var envelope = JsonDocument.Parse(output.Lines.Single()).RootElement;

        Assert.Equal(expectsV2Failure ? 0 : 1, exitCode);
        Assert.Equal("unknown", envelope.GetProperty("requestId").GetString());
        Assert.Equal("failed", envelope.GetProperty("status").GetString());
        Assert.False(File.Exists(fixture.V1OutputPath));
        Assert.Equal(0, fixture.Backend.OpenOrCreateCalls);
    }

    [Theory]
    [InlineData(WriterFailurePoint.WriteLine)]
    [InlineData(WriterFailurePoint.Flush)]
    public async Task Host_loop_propagates_writer_failure_only_after_scheduler_and_active_session_are_released(WriterFailurePoint failurePoint)
    {
        using var fixture = new HostFixture();
        var ticker = new ManualCheckpointTicker();
        var input = new ControlledTextReader();
        var output = new ThrowingTextWriter(failurePoint);

        var running = RunHostLoopAsync(input, output, fixture.CreateOptions(), ticker.WaitAsync, CancellationToken.None);
        await ticker.FirstWait;
        input.ProvideLine(fixture.OpenJson($"writer-{failurePoint}"));

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () => await running);

        Assert.Equal(failurePoint.ToString(), failure.Message);
        await ticker.CancellationObserved;
        Assert.Equal(1, fixture.Backend.OpenOrCreateCalls);
        Assert.Equal(1, fixture.Backend.SaveCalls);
        Assert.Equal(1, fixture.Backend.CloseCalls);

        ticker.Tick();
        Assert.Equal(1, fixture.Backend.SaveCalls);
        Assert.Equal(1, fixture.Backend.CloseCalls);
    }

    [Fact]
    public async Task Owned_engine_backend_initialization_preserves_the_primary_failure_after_successful_cleanup()
    {
        using var fixture = new HostFixture();
        var engine = new TrackedOwnedEngine();
        var options = fixture.CreateOptions(mode: "live", injectBackend: false);
        SetOwnedEngineFactory(options, new Func<VisioComEngineOptions, (IAsyncDisposable Engine, Func<IVisioSessionBackend> CreateSessionBackend)>(_ =>
            (engine, () => throw new InvalidOperationException("backend-initialization"))));
        await using var processor = new WorkerHostLineProcessor(options);

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () => await InvokeGetOrCreateV2RuntimeAsync(processor));

        Assert.Equal("backend-initialization", failure.Message);
        Assert.True(engine.Disposed);
    }

    [Fact]
    public async Task Owned_engine_backend_initialization_aggregates_primary_and_cleanup_failures()
    {
        using var fixture = new HostFixture();
        var engine = new ThrowingDisposeOwnedEngine();
        var options = fixture.CreateOptions(mode: "live", injectBackend: false);
        SetOwnedEngineFactory(options, new Func<VisioComEngineOptions, (IAsyncDisposable Engine, Func<IVisioSessionBackend> CreateSessionBackend)>(_ =>
            (engine, () => throw new InvalidOperationException("backend-initialization"))));
        await using var processor = new WorkerHostLineProcessor(options);

        var failure = await Assert.ThrowsAsync<AggregateException>(async () => await InvokeGetOrCreateV2RuntimeAsync(processor));

        Assert.Contains(failure.InnerExceptions, error => error is InvalidOperationException { Message: "backend-initialization" });
        Assert.Contains(failure.InnerExceptions, error => error is InvalidOperationException { Message: "engine-cleanup" });
    }

    [Fact]
    public async Task Host_loop_checkpoints_an_idle_v2_session_on_a_fake_tick_while_stdin_is_blocked()
    {
        using var fixture = new HostFixture();
        var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-19T00:00:00Z"));
        var ticker = new ManualCheckpointTicker();
        var input = new ControlledTextReader(fixture.OpenJson());
        var output = new TrackingTextWriter();
        using var cancellation = new CancellationTokenSource();

        AssertHostTickSchedulerSeam();
        var running = RunHostLoopAsync(input, output, fixture.CreateOptions(clock), ticker.WaitAsync, cancellation.Token);
        await output.FirstLineWritten;
        await ticker.FirstWait;

        clock.Advance(TimeSpan.FromMinutes(15));
        ticker.Tick();
        await ticker.SecondWait;

        Assert.Equal(1, fixture.Backend.SaveCalls);
        Assert.Equal(1, fixture.Backend.CloseCalls);

        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await running);
        await ticker.CancellationObserved;
    }

    [Fact]
    public async Task Host_loop_stops_and_awaits_its_tick_scheduler_at_eof()
    {
        using var fixture = new HostFixture();
        var ticker = new ManualCheckpointTicker();
        var input = new ControlledTextReader(fixture.V1Json());
        var output = new TrackingTextWriter();

        AssertHostTickSchedulerSeam();
        var running = RunHostLoopAsync(input, output, fixture.CreateOptions(), ticker.WaitAsync, CancellationToken.None);
        await output.FirstLineWritten;
        await ticker.FirstWait;

        input.CompleteEof();

        Assert.Equal(0, await running);
        await ticker.CancellationObserved;
        Assert.Equal(1, output.FlushCount);
    }

    [Fact]
    public async Task Two_failed_owned_engine_initializations_dispose_each_engine_and_allow_a_safe_retry()
    {
        using var fixture = new HostFixture();
        var factory = new FailingOwnedEngineFactory();
        var options = fixture.CreateOptions(mode: "live", injectBackend: false);
        SetOwnedEngineFactory(options, factory.Create);
        await using var processor = new WorkerHostLineProcessor(options);

        var first = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson("engine-failure-1")));
        var second = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson("engine-failure-2")));

        Assert.Equal("engine-failure-1", first.RequestId);
        Assert.Equal("engine-failure-2", second.RequestId);
        Assert.Equal(2, factory.Created.Count);
        Assert.All(factory.Created, engine => Assert.True(engine.Disposed));
    }

    [Theory]
    [InlineData("""{"protocolVersion":2,"protocolVersion":2,"requestId":"duplicate","command":"open","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"session.vsdx"}""")]
    [InlineData("""{"protocolVersion":2,"ProtocolVersion":2,"requestId":"case-duplicate","command":"open","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"session.vsdx"}""")]
    public async Task V2_candidate_duplicate_discriminators_remain_safe_v2_failures(string line)
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(line));

        Assert.Equal("unknown", response.RequestId);
        Assert.Equal("failed", response.Status);
    }

    [Fact]
    public async Task Host_loop_uses_trusted_protocol_classification_for_duplicate_v1_and_v2_candidates()
    {
        using var fixture = new HostFixture();
        var v1Output = new TrackingTextWriter();
        var v2Output = new TrackingTextWriter();
        var v1Duplicate = fixture.V1Json("protocolVersion", "ProtocolVersion");
        const string v2Duplicate = """{"protocolVersion":2,"ProtocolVersion":2,"requestId":"duplicate","command":"open","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"session.vsdx"}""";

        var v1Exit = await RunHostLoopAsync(new StringReader(v1Duplicate), v1Output, fixture.CreateOptions());
        var v2Exit = await RunHostLoopAsync(new StringReader(v2Duplicate), v2Output, fixture.CreateOptions());

        Assert.Equal(1, v1Exit);
        Assert.Equal("failed", JsonDocument.Parse(v1Output.Lines.Single()).RootElement.GetProperty("status").GetString());
        Assert.Equal(0, v2Exit);
        Assert.Equal("unknown", JsonDocument.Parse(v2Output.Lines.Single()).RootElement.GetProperty("requestId").GetString());
        Assert.Equal("failed", JsonDocument.Parse(v2Output.Lines.Single()).RootElement.GetProperty("status").GetString());
        Assert.Equal(1, v1Output.FlushCount);
        Assert.Equal(1, v2Output.FlushCount);
    }

    [Fact]
    public async Task Cancelled_line_processor_request_is_rethrown_instead_of_becoming_a_failure_response()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await processor.ProcessLineAsync(fixture.OpenJson(), cancellation.Token));
    }

    [Fact]
    public async Task V1_protocol_discriminator_is_case_insensitive_but_case_variant_duplicates_fail_closed()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var accepted = Assert.IsType<WorkerResponse>(await processor.ProcessLineAsync(fixture.V1Json("ProtocolVersion")));
        var rejected = Assert.IsType<WorkerResponse>(await processor.ProcessLineAsync(fixture.V1Json("protocolVersion", "ProtocolVersion")));

        Assert.Equal("succeeded", accepted.Status);
        Assert.Equal("failed", rejected.Status);
    }

    [Fact]
    public async Task V2_runtime_failure_after_strict_parse_retains_validated_request_id()
    {
        using var fixture = new HostFixture(manifestStore: new ThrowingManifestStore());
        await using var processor = fixture.CreateLineProcessor();

        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson("runtime-failure")));

        Assert.Equal("runtime-failure", response.RequestId);
        Assert.Equal("failed", response.Status);
    }

    [Fact]
    public async Task Host_loop_returns_legacy_v1_exit_codes_but_keeps_v2_failures_per_line()
    {
        using var fixture = new HostFixture();

        var noRequestExit = await RunHostLoopAsync(new StringReader(" \r\n\t\r\n"), new TrackingTextWriter(), fixture.CreateOptions());
        var v1FailureExit = await RunHostLoopAsync(new StringReader("{\"protocolVersion\":1}\r\n"), new TrackingTextWriter(), fixture.CreateOptions());
        var v2FailureOutput = new TrackingTextWriter();
        var v2FailureExit = await RunHostLoopAsync(new StringReader(fixture.UnsupportedV2CommandJson("v2-failure") + "\r\n"), v2FailureOutput, fixture.CreateOptions());

        Assert.Equal(2, noRequestExit);
        Assert.Equal(1, v1FailureExit);
        Assert.Equal(0, v2FailureExit);
        Assert.Equal("failed", JsonDocument.Parse(v2FailureOutput.Lines.Single()).RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Host_loop_flushes_each_nonblank_response_continues_after_malformed_v2_and_disposes_at_eof()
    {
        using var fixture = new HostFixture();
        var output = new TrackingTextWriter();
        var input = new StringReader(string.Join(Environment.NewLine,
            " ",
            """{"protocolVersion":2,"requestId":"bad-request","command":"launchShell","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}""",
            fixture.OpenJson("valid-v2"),
            fixture.V1Json(),
            ""));

        var exitCode = await RunHostLoopAsync(input, output, fixture.CreateOptions());
        var responses = output.Lines.Select(line => JsonDocument.Parse(line).RootElement.Clone()).ToArray();

        Assert.Equal(0, exitCode);
        Assert.Equal(3, responses.Length);
        Assert.Equal(3, output.FlushCount);
        Assert.Equal("unknown", responses[0].GetProperty("requestId").GetString());
        Assert.Equal("failed", responses[0].GetProperty("status").GetString());
        Assert.Equal("valid-v2", responses[1].GetProperty("requestId").GetString());
        Assert.Equal("succeeded", responses[1].GetProperty("status").GetString());
        Assert.Equal("succeeded", responses[2].GetProperty("status").GetString());
        Assert.Equal(1, fixture.Backend.CloseCalls);
    }

    [Fact]
    public async Task Two_v2_apply_lines_share_one_runtime_backend_open()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var open = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.OpenJson()));
        var apply = fixture.ApplyJson("operation-1");
        var first = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(apply));
        var replay = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(apply));

        Assert.Equal("succeeded", open.Status);
        Assert.Equal("succeeded", first.Status);
        Assert.True(first.Readback!.Valid);
        Assert.Equal(first, replay);
        Assert.Equal(1, fixture.Backend.OpenOrCreateCalls);
        Assert.Equal(1, fixture.Backend.ApplyPlanCalls);
        Assert.Equal(1, fixture.Backend.SaveCalls);
        Assert.Equal(1, fixture.Backend.ReadbackCalls);
    }

    [Fact]
    public async Task V2_apply_returns_failed_response_when_native_readback_is_invalid()
    {
        using var fixture = new HostFixture();
        fixture.Backend.NextReadback = new ReadbackResult(
            Valid: false,
            ShapeCount: 0,
            ConnectorCount: 0,
            ExpectedPrimitiveIds: [],
            ActualPrimitiveIds: [],
            MissingPrimitiveIds: ["primitive-one"],
            ExpectedConnectorIds: [],
            ActualConnectorIds: [],
            MissingConnectorIds: [],
            ShapeDataFailures: []);
        await using var processor = fixture.CreateLineProcessor();

        _ = await processor.ProcessLineAsync(fixture.OpenJson());
        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(fixture.ApplyJson("invalid-readback")));

        Assert.Equal("failed", response.Status);
        Assert.Equal(1, fixture.Backend.SaveCalls);
        Assert.Equal(1, fixture.Backend.ReadbackCalls);
    }

    [Fact]
    public async Task Malformed_v2_line_returns_one_failure_and_later_v2_line_succeeds()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var malformed = await processor.ProcessLineAsync(
            """{"protocolVersion":2,"requestId":"bad-request","command":"launchShell","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"}}""");
        var valid = await processor.ProcessLineAsync(fixture.OpenJson());

        var failure = Assert.IsType<WorkerV2Response>(malformed);
        Assert.Equal("failed", failure.Status);
        Assert.NotNull(failure.Error);
        Assert.Equal("succeeded", Assert.IsType<WorkerV2Response>(valid).Status);
        Assert.Equal(1, fixture.Backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task Invalid_v2_request_after_its_id_is_read_preserves_that_request_id_in_the_failure_response()
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(
            """{"protocolVersion":2,"requestId":"agent-apply-1","command":"apply","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":"operation-1","diagram":{"nodes":[],"edges":[],"unexpected":true}}"""));

        Assert.Equal("failed", response.Status);
        Assert.Equal("agent-apply-1", response.RequestId);
        Assert.NotNull(response.Error);
    }

    [Theory]
    [InlineData("""{"protocolVersion":2,"requestId":"pending-open-1","command":"open","session":null,"outputPath":"C:\\exports\\workflow.vsdx"}""")]
    [InlineData("""{"protocolVersion":2,"requestId":"pending-open-1","command":"open","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"outputPath":"C:\\exports\\workflow.vsdx","unexpected":true}""")]
    public async Task Malformed_v2_envelopes_never_correlate_a_pending_request_id(string line)
    {
        using var fixture = new HostFixture();
        await using var processor = fixture.CreateLineProcessor();

        var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(line));

        Assert.Equal("failed", response.Status);
        Assert.Equal("unknown", response.RequestId);
    }

    [Fact]
    public async Task Debug_acceptance_mode_returns_a_safe_protocol_rejection_reason_for_a_correlated_v2_request()
    {
        const string environmentName = "SYNAPSE_DEBUG_AGENT_VISIO";
        var previous = Environment.GetEnvironmentVariable(environmentName);
        Environment.SetEnvironmentVariable(environmentName, "1");
        try
        {
            using var fixture = new HostFixture();
            await using var processor = fixture.CreateLineProcessor();

            var response = Assert.IsType<WorkerV2Response>(await processor.ProcessLineAsync(
                """{"protocolVersion":2,"requestId":"agent-debug-1","command":"apply","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":"operation-1","diagram":{"nodes":[],"edges":[],"unexpected":true}}"""));

            Assert.Equal("agent-debug-1", response.RequestId);
            Assert.Equal("Invalid Worker v2 request: Unknown property 'unexpected' in diagram", response.Error);
        }
        finally
        {
            Environment.SetEnvironmentVariable(environmentName, previous);
        }
    }

    [Fact]
    public async Task Disposal_releases_the_runtime_session_at_end_of_input()
    {
        using var fixture = new HostFixture();
        var processor = fixture.CreateLineProcessor();
        await processor.ProcessLineAsync(fixture.OpenJson());

        await processor.DisposeAsync();

        Assert.Equal(1, fixture.Backend.CloseCalls);
    }

    [Fact]
    public async Task V3_attach_uses_its_own_selected_page_runtime_and_never_initializes_the_v2_export_backend()
    {
        using var fixture = new HostFixture();
        var selectedBackend = new RecordingSelectedPageBackend { ActiveTarget = SelectedPageTargetForTests };
        var options = fixture.CreateOptions(selectedPageBackend: selectedBackend);
        await using var processor = new WorkerHostLineProcessor(options);

        var response = await processor.ProcessLineAsync(SelectedPageAttachJson());

        var v3 = Assert.IsType<SelectedPageWorkerResponse>(response);
        Assert.Equal("succeeded", v3.Status);
        Assert.Equal("request-attach", v3.RequestId);
        Assert.Equal(1, selectedBackend.EnsureVisibleApplicationCalls);
        Assert.Equal(1, selectedBackend.AttachActiveSelectionCalls);
        Assert.Equal(0, fixture.Backend.OpenOrCreateCalls);
    }

    [Fact]
    public async Task V3_diagnostics_error_is_bounded_to_the_public_protocol_limit()
    {
        const string environmentName = "SYNAPSE_VISIO_WORKER_DIAGNOSTICS";
        var previous = Environment.GetEnvironmentVariable(environmentName);
        Environment.SetEnvironmentVariable(environmentName, "1");
        try
        {
            using var fixture = new HostFixture();
            var selectedBackend = new RecordingSelectedPageBackend
            {
                AttachFailure = new InvalidOperationException(new string('x', 2_500)),
            };
            await using var processor = new WorkerHostLineProcessor(fixture.CreateOptions(selectedPageBackend: selectedBackend));

            var response = Assert.IsType<SelectedPageWorkerResponse>(await processor.ProcessLineAsync(SelectedPageAttachJson()));

            Assert.Equal("failed", response.Status);
            Assert.Equal("request-attach", response.RequestId);
            Assert.NotNull(response.Error);
            Assert.InRange(response.Error!.Length, 1, 2_000);
            Assert.StartsWith("InvalidOperationException:", response.Error);
            Assert.EndsWith("[diagnostics truncated]", response.Error);
        }
        finally
        {
            Environment.SetEnvironmentVariable(environmentName, previous);
        }
    }

    [Fact]
    public async Task V3_host_rejects_a_hash_mismatched_raw_apply_before_the_injected_selected_page_backend_can_mutate()
    {
        using var fixture = new HostFixture();
        var selectedBackend = new RecordingSelectedPageBackend { ActiveTarget = SelectedPageTargetForTests };
        var options = fixture.CreateOptions(selectedPageBackend: selectedBackend);
        await using var processor = new WorkerHostLineProcessor(options);

        var response = Assert.IsType<SelectedPageWorkerResponse>(await processor.ProcessLineAsync(SelectedPageHashMismatchedApplyJson()));

        Assert.Equal("failed", response.Status);
        Assert.Equal("unknown", response.RequestId);
        Assert.Equal(0, selectedBackend.ApplyCalls);
        Assert.Equal(0, selectedBackend.AttachActiveSelectionCalls);
        Assert.Equal(0, fixture.Backend.OpenOrCreateCalls);
    }

    private static readonly SelectedPageTarget SelectedPageTargetForTests = new(
        "document-1", "page-1", new string('a', 64), new string('b', 64), 7);

    private static string SelectedPageAttachJson() => JsonSerializer.Serialize(new
    {
        protocolVersion = 3,
        requestId = "request-attach",
        command = "attachSelectedPage",
        binding = new
        {
            jobId = "job-1", tenantId = "tenant-1", userId = "user-1", deviceId = "device-1", workflowId = "workflow-1",
            documentId = SelectedPageTargetForTests.DocumentId, pageId = SelectedPageTargetForTests.PageId,
            documentFingerprint = SelectedPageTargetForTests.DocumentFingerprint, pageFingerprint = SelectedPageTargetForTests.PageFingerprint,
            expectedRevision = SelectedPageTargetForTests.ExpectedRevision, ownershipNamespace = "agent-region-1",
        },
    });

    private static string SelectedPageHashMismatchedApplyJson() => "{\"protocolVersion\":3,\"requestId\":\"request-invalid-apply\",\"command\":\"applyOwnedRegion\",\"binding\":{\"jobId\":\"job-1\",\"tenantId\":\"tenant-1\",\"userId\":\"user-1\",\"deviceId\":\"device-1\",\"workflowId\":\"workflow-1\",\"documentId\":\"document-1\",\"pageId\":\"page-1\",\"documentFingerprint\":\"" + new string('a', 64) + "\",\"pageFingerprint\":\"" + new string('b', 64) + "\",\"expectedRevision\":7,\"ownershipNamespace\":\"agent-region-1\"},\"ownershipNamespace\":\"agent-region-1\",\"sealedNativeIntent\":{\"version\":2,\"jobId\":\"job-1\",\"tenantId\":\"tenant-1\",\"userId\":\"user-1\",\"deviceId\":\"device-1\",\"workflowId\":\"workflow-1\",\"documentId\":\"document-1\",\"pageId\":\"page-1\",\"documentFingerprint\":\"" + new string('a', 64) + "\",\"pageFingerprint\":\"" + new string('b', 64) + "\",\"expectedRevision\":7,\"ownershipNamespace\":\"agent-region-1\",\"planId\":\"plan-1\",\"planHash\":\"" + new string('a', 64) + "\",\"canonicalPlanBase64\":\"e30\",\"expiresAt\":\"2030-01-01T00:00:00.000Z\",\"signature\":\"signature\"}}";

    private sealed class RecordingSelectedPageBackend : ISelectedPageSessionBackend
    {
        public SelectedPageTarget? ActiveTarget { get; set; }
        public Exception? AttachFailure { get; set; }
        public int EnsureVisibleApplicationCalls { get; private set; }
        public int AttachActiveSelectionCalls { get; private set; }
        public int ApplyCalls { get; private set; }
        public Task EnsureVisibleApplicationAsync(CancellationToken cancellationToken = default) { EnsureVisibleApplicationCalls++; return Task.CompletedTask; }
        public Task<SelectedPageTarget?> AttachActiveSelectionAsync(CancellationToken cancellationToken = default)
        {
            AttachActiveSelectionCalls++;
            return AttachFailure is null ? Task.FromResult(ActiveTarget) : Task.FromException<SelectedPageTarget?>(AttachFailure);
        }
        public Task ApplyOwnedRegionAsync(SelectedPageTarget target, string ownershipNamespace, DiagramDocument plan, CancellationToken cancellationToken = default) { ApplyCalls++; return Task.CompletedTask; }
        public Task SaveSelectedDocumentAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<SelectedPageReadback> ReadSelectedPageAsync(SelectedPageTarget target, string ownershipNamespace, CancellationToken cancellationToken = default) => Task.FromResult(new SelectedPageReadback(true, target.DocumentId, target.PageId, target.DocumentFingerprint, target.PageFingerprint, target.ExpectedRevision, ownershipNamespace, 0, [], 0));
        public Task ReleaseSessionAsync(SelectedPageTarget target, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class HostFixture : IDisposable
    {
        private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"visio-worker-host-{Guid.NewGuid():N}");
        private readonly DiagramEnvelope _diagram = Fixtures.CnnDiagram();
        private readonly IVisioSessionBackend _sessionBackend;
        private readonly ISessionRecoveryManifestStore _manifestStore;

        public HostFixture(IVisioSessionBackend? sessionBackend = null, ISessionRecoveryManifestStore? manifestStore = null)
        {
            Directory.CreateDirectory(_root);
            _sessionBackend = sessionBackend ?? Backend;
            _manifestStore = manifestStore ?? new EmptyManifestStore();
        }

        public RecordingSessionBackend Backend { get; } = new();

        public WorkerHostLineProcessor CreateLineProcessor() => new(CreateOptions());

        public WorkerHostLineProcessorOptions CreateOptions(IWorkerClock? clock = null, string mode = "mock", bool injectBackend = true, ISelectedPageSessionBackend? selectedPageBackend = null) => new()
        {
            OutputRoot = _root,
            Mode = mode,
            SessionBackend = injectBackend ? _sessionBackend : null,
            ManifestStore = _manifestStore,
            Clock = clock ?? new SystemWorkerClock(),
            CheckpointInterval = TimeSpan.FromMinutes(15),
            Capacity = 4,
            SelectedPageBackend = selectedPageBackend,
        };

        public string OpenJson(string requestId = "open-request") => JsonSerializer.Serialize(new
        {
            protocolVersion = 2,
            requestId,
            command = "open",
            session = Session(),
            outputPath = Path.Combine(_root, "session.vsdx"),
        }, JsonOptions);

        public string UnsupportedV2CommandJson(string requestId) => JsonSerializer.Serialize(new
        {
            protocolVersion = 2,
            requestId,
            command = "launchShell",
            session = Session(),
        }, JsonOptions);

        public string V1Json(params string[] protocolPropertyNames)
        {
            var names = protocolPropertyNames.Length == 0 ? ["protocolVersion"] : protocolPropertyNames;
            var protocolProperties = string.Join(",", names.Select(name => $"\"{name}\":1"));
            return $$"""{ {{protocolProperties}},"requestId":"v1-request","jobId":"v1-job","mode":"mock","outputPath":{{JsonSerializer.Serialize(Path.Combine(_root, "v1.vsdx"))}},"diagram":{{JsonSerializer.Serialize(_diagram, JsonOptions)}} }""";
        }

        public string V1EnvelopeWithProtocolProperties(string protocolProperties, string requestId) =>
            $$"""{ {{protocolProperties}},"requestId":"{{requestId}}","jobId":"v1-job","mode":"mock","outputPath":{{JsonSerializer.Serialize(V1OutputPath)}},"diagram":{{JsonSerializer.Serialize(_diagram, JsonOptions)}} }""";

        public string V1OutputPath => Path.Combine(_root, "v1.vsdx");

        public string ApplyJson(string operationId)
        {
            var planHash = DiagramPlanDigest.Compute(DiagramMapper.Map(_diagram));
            return JsonSerializer.Serialize(new
            {
                protocolVersion = 2,
                requestId = $"request-{operationId}",
                command = "apply",
                session = Session(),
                operationId,
                planHash,
                diagram = _diagram,
            }, JsonOptions);
        }

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        }

        private static object Session() => new
        {
            tenantId = "tenant",
            userId = "user",
            deviceId = "device",
            workflowId = "workflow",
        };
    }

    private sealed class EmptyManifestStore : ISessionRecoveryManifestStore
    {
        public Task SaveAsync(
            VisioSessionRecoveryManifest manifest,
            DateTimeOffset savedAt,
            DateTimeOffset lastActivity,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<StoredSessionRecoveryManifest?> LoadAsync(
            VisioSessionKey key,
            CancellationToken cancellationToken = default) => Task.FromResult<StoredSessionRecoveryManifest?>(null);
    }

    private sealed class RecordingSessionBackend : IVisioSessionBackend, IVisioSessionReadbackBackend
    {
        public int OpenOrCreateCalls { get; private set; }
        public int ApplyPlanCalls { get; private set; }
        public int SaveCalls { get; private set; }
        public int CloseCalls { get; private set; }
        public int ReadbackCalls { get; private set; }
        public ReadbackResult NextReadback { get; set; } = ReadbackValidator.Legacy(shapeCount: 1, connectorCount: 0);

        public string NormalizeOutputPath(string outputPath) => Path.GetFullPath(outputPath);

        public Task<VisioSessionDocument> OpenOrCreateAsync(
            VisioSessionKey sessionKey,
            CancellationToken cancellationToken = default)
        {
            OpenOrCreateCalls++;
            return Task.FromResult(new VisioSessionDocument("document-1", "page-1"));
        }

        public Task ApplyPlanAsync(
            VisioSessionDocument document,
            DiagramDocument plan,
            CancellationToken cancellationToken = default)
        {
            ApplyPlanCalls++;
            return Task.CompletedTask;
        }

        public Task ApplyPlanDiffAsync(
            VisioSessionDocument document,
            DiagramDocument plan,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<ReadbackResult> ReadbackAsync(
            VisioSessionDocument document,
            DiagramDocument plan,
            CancellationToken cancellationToken = default)
        {
            ReadbackCalls++;
            return Task.FromResult(NextReadback);
        }

        public Task<VisioSessionDocument> SaveAsAsync(
            VisioSessionDocument document,
            string outputPath,
            CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            return Task.FromResult(document);
        }

        public Task CloseAsync(
            VisioSessionDocument document,
            CancellationToken cancellationToken = default)
        {
            CloseCalls++;
            return Task.CompletedTask;
        }

        public Task<VisioSessionDocument> RecoverAsync(
            VisioSessionKey sessionKey,
            VisioSessionRecoveryManifest manifest,
            CancellationToken cancellationToken = default) => Task.FromResult(manifest.Document);
    }

    private sealed class ThrowingManifestStore : ISessionRecoveryManifestStore
    {
        public Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("injected runtime failure");
    }

    private static async Task<int> RunHostLoopAsync(TextReader input, TextWriter output, WorkerHostLineProcessorOptions options)
    {
        var loopType = typeof(WorkerHostLineProcessor).Assembly.GetType("VisioWorker.Host.WorkerHostLoop");
        Assert.True(loopType is not null, "The host loop must expose an integration seam.");
        if (loopType is null) return int.MinValue;

        var method = loopType.GetMethod("RunAsync", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, [typeof(TextReader), typeof(TextWriter), typeof(WorkerHostLineProcessorOptions), typeof(CancellationToken)]);
        Assert.True(method is not null, "The host loop must own processor lifetime and receive its input/output streams.");
        if (method is null) return int.MinValue;

        return await (Task<int>)method.Invoke(null, [input, output, options, CancellationToken.None])!;
    }

    private static async Task<int> RunHostLoopAsync(
        TextReader input,
        TextWriter output,
        WorkerHostLineProcessorOptions options,
        Func<CancellationToken, Task> waitForTickAsync,
        CancellationToken cancellationToken)
    {
        var method = GetHostTickSchedulerRunMethod();

        return await (Task<int>)method.Invoke(null, [input, output, options, waitForTickAsync, cancellationToken])!;
    }

    private static void AssertHostTickSchedulerSeam() => _ = GetHostTickSchedulerRunMethod();

    private static MethodInfo GetHostTickSchedulerRunMethod()
    {
        var loopType = typeof(WorkerHostLineProcessor).Assembly.GetType("VisioWorker.Host.WorkerHostLoop");
        Assert.True(loopType is not null, "The host loop must expose a tick scheduler seam.");
        if (loopType is null) throw new InvalidOperationException("WorkerHostLoop is missing.");

        var method = loopType.GetMethod(
            "RunAsync",
            BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
            [typeof(TextReader), typeof(TextWriter), typeof(WorkerHostLineProcessorOptions), typeof(Func<CancellationToken, Task>), typeof(CancellationToken)]);
        Assert.True(method is not null, "The host loop must schedule checkpoints while it waits for stdin.");
        return method ?? throw new InvalidOperationException("WorkerHostLoop tick scheduler overload is missing.");
    }

    private static void SetOwnedEngineFactory(WorkerHostLineProcessorOptions options, Delegate factory)
    {
        var property = typeof(WorkerHostLineProcessorOptions).GetProperty("OwnedEngineFactory", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        Assert.True(property is not null, "The line processor must provide an internal owned-engine creation seam.");
        property?.SetValue(options, factory);
    }

    private sealed class TrackingTextWriter : StringWriter
    {
        private readonly TaskCompletionSource _firstLineWritten = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int FlushCount { get; private set; }
        public Task FirstLineWritten => _firstLineWritten.Task;
        public IReadOnlyList<string> Lines => ToString().Split([Environment.NewLine], StringSplitOptions.RemoveEmptyEntries);

        public override async Task WriteLineAsync(string? value)
        {
            await base.WriteLineAsync(value);
            _firstLineWritten.TrySetResult();
        }

        public override Task FlushAsync()
        {
            FlushCount++;
            return base.FlushAsync();
        }
    }

    public enum WriterFailurePoint
    {
        WriteLine,
        Flush,
    }

    private sealed class ThrowingTextWriter(WriterFailurePoint failurePoint) : TextWriter
    {
        public override Encoding Encoding => Encoding.UTF8;

        public override Task WriteLineAsync(string? value) => failurePoint == WriterFailurePoint.WriteLine
            ? Task.FromException(new InvalidOperationException(nameof(WriterFailurePoint.WriteLine)))
            : Task.CompletedTask;

        public override Task FlushAsync() => failurePoint == WriterFailurePoint.Flush
            ? Task.FromException(new InvalidOperationException(nameof(WriterFailurePoint.Flush)))
            : Task.CompletedTask;
    }

    private sealed class FakeWorkerClock(DateTimeOffset utcNow) : IWorkerClock
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan elapsed) => UtcNow = UtcNow.Add(elapsed);
    }

    private sealed class ControlledTextReader(params string[] lines) : TextReader
    {
        private readonly Queue<string> _lines = new(lines);
        private readonly TaskCompletionSource<string?> _next = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            if (_lines.TryDequeue(out var line)) return ValueTask.FromResult<string?>(line);
            return new ValueTask<string?>(_next.Task.WaitAsync(cancellationToken));
        }

        public void CompleteEof() => _next.TrySetResult(null);

        public void ProvideLine(string line) => _next.TrySetResult(line);
    }

    private sealed class ManualCheckpointTicker
    {
        private readonly TaskCompletionSource _firstWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _secondWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _cancellationObserved = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private TaskCompletionSource? _pending;
        private int _waitCount;

        public Task FirstWait => _firstWait.Task;
        public Task SecondWait => _secondWait.Task;
        public Task CancellationObserved => _cancellationObserved.Task;

        public async Task WaitAsync(CancellationToken cancellationToken)
        {
            var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending = pending;
            if (Interlocked.Increment(ref _waitCount) == 1) _firstWait.TrySetResult();
            else _secondWait.TrySetResult();

            try
            {
                await pending.Task.WaitAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                _cancellationObserved.TrySetResult();
                throw;
            }
        }

        public void Tick() => _pending?.TrySetResult();
    }

    private sealed class FailingOwnedEngineFactory
    {
        public List<TrackedOwnedEngine> Created { get; } = [];

        public (IAsyncDisposable Engine, Func<IVisioSessionBackend> CreateSessionBackend) Create(VisioComEngineOptions options)
        {
            var engine = new TrackedOwnedEngine();
            Created.Add(engine);
            return (engine, () => null!);
        }
    }

    private sealed class TrackedOwnedEngine : IAsyncDisposable
    {
        public bool Disposed { get; private set; }

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class ThrowingDisposeOwnedEngine : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => ValueTask.FromException(new InvalidOperationException("engine-cleanup"));
    }

    private static object[] ProtocolCase(string caseName, string protocolProperties, bool expectsV2Failure) => [caseName, protocolProperties, expectsV2Failure];

    private static async Task<LongLivedWorkerRuntime> InvokeGetOrCreateV2RuntimeAsync(WorkerHostLineProcessor processor)
    {
        var method = typeof(WorkerHostLineProcessor).GetMethod("GetOrCreateV2RuntimeAsync", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.True(method is not null, "The owned-engine factory must share the production initialization transaction.");
        return await (Task<LongLivedWorkerRuntime>)method!.Invoke(processor, null)!;
    }

    private static (string Protocol, bool IsSafeV1Failure) ReadProtocolClassification(string line)
    {
        var method = typeof(WorkerHostLineProcessor).GetMethod("ReadProtocolVersion", BindingFlags.Static | BindingFlags.NonPublic);
        Assert.True(method is not null, "The host must classify the protocol before legacy v1 deserialization.");
        var classification = method!.Invoke(null, [line])!;
        var type = classification.GetType();
        return (
            type.GetProperty("Protocol")!.GetValue(classification)!.ToString()!,
            (bool)type.GetProperty("RequiresSafeV1Failure")!.GetValue(classification)!);
    }
}
