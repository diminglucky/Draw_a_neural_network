# Visio Worker Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Windows Visio Worker that renders the existing validated browser diagram into a readback-validated `.vsdx` without putting Visio COM objects inside the Node API process.

**Architecture:** The Node API will validate and submit one versioned JSON-lines request to a per-Job C# Worker child process. The Worker will use a headless mock engine in CI and a single-threaded late-bound Visio COM engine in live mode. The API will expose the existing authenticated Job ownership boundary and will publish only a validated `.vsdx` produced inside the configured output root.

**Tech Stack:** TypeScript/Node.js/Fastify/Zod/Vitest; C# `net8.0-windows`; `System.Text.Json`; `System.IO.Pipes`-free private child-process stdin/stdout JSON-lines transport; late-bound `Visio.Application` COM; xUnit for Worker core tests; PowerShell live smoke.

## Global Constraints

- The project is standalone and must not import NPP, Polars.NET, NppStudio, or any other repository's code or runtime assumptions.
- The Worker must never report live success without an existing `.vsdx` file and a successful readback result.
- The API must send the validated deterministic diagram, not raw model text or arbitrary model-generated COM/script instructions.
- All live Visio COM calls must execute on one initialized COM thread, and the Worker may quit only a Visio instance it launched itself.
- External GitHub code is reference material only; no third-party stencil assets are copied into this repository.
- The current slice must remain testable without Microsoft Visio; live Visio acceptance is a separate gate.

---

### Task 1: Define and test the versioned Worker protocol

**Files:**
- Create: `apps/api/src/visio-protocol.ts`
- Create: `apps/api/tests/visio-protocol.test.ts`

**Interfaces:**
- Produces `VISIO_PROTOCOL_VERSION = 1`.
- Produces `VisioWorkerRequest` with `protocolVersion`, `requestId`, `jobId`, `mode`, `outputPath`, and `diagram`.
- Produces `VisioWorkerResponse` with `protocolVersion`, `requestId`, `jobId`, `status`, optional `path`, optional `readback`, and optional `error`.
- Produces `parseVisioWorkerRequest(value: unknown)` and `parseVisioWorkerResponse(value: unknown)` that throw `FoundationError`-independent validation errors suitable for the API client.

- [ ] **Step 1: Write the failing protocol tests**

```ts
it("accepts a version-one mock request and preserves the diagram payload", async () => {
  const request = parseVisioWorkerRequest({
    protocolVersion: 1,
    requestId: "request-1",
    jobId: "job-1",
    mode: "mock",
    outputPath: "C:\\exports\\job-1.vsdx",
    diagram: { figure: { title: "CNN", stages: ["Input", "Output"] }, nodes: [], edges: [] },
  });
  expect(request.protocolVersion).toBe(1);
  expect(request.diagram.figure.title).toBe("CNN");
});

it("rejects an unsupported protocol version and a non-vsdx output", () => {
  expect(() => parseVisioWorkerRequest({ protocolVersion: 2 })).toThrow(/protocolVersion/);
  expect(() => parseVisioWorkerRequest({
    protocolVersion: 1, requestId: "r", jobId: "j", mode: "mock",
    outputPath: "C:\\exports\\job-1.json", diagram: { nodes: [], edges: [] },
  })).toThrow(/outputPath/);
});

it("accepts only succeeded responses with a valid readback or failed responses with an error", () => {
  expect(parseVisioWorkerResponse({ protocolVersion: 1, requestId: "r", jobId: "j", status: "succeeded", path: "C:\\x.vsdx", readback: { valid: true, shapeCount: 2, connectorCount: 1 }, error: null }).status).toBe("succeeded");
  expect(parseVisioWorkerResponse({ protocolVersion: 1, requestId: "r", jobId: "j", status: "failed", path: null, readback: null, error: { code: "VISIO_UNAVAILABLE", message: "not installed" } }).status).toBe("failed");
});
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `npx vitest run apps/api/tests/visio-protocol.test.ts`

Expected: FAIL because `apps/api/src/visio-protocol.ts` does not exist.

- [ ] **Step 3: Implement the minimal Zod protocol parser**

Use strict schemas for the envelope and a bounded object schema for the already-laid-out diagram. Reject unknown protocol versions, non-UUID-like IDs, unsupported modes, non-`.vsdx` paths, missing node/edge arrays, and malformed response readback.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run apps/api/tests/visio-protocol.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the protocol contract**

```powershell
git add apps/api/src/visio-protocol.ts apps/api/tests/visio-protocol.test.ts
git commit -m "feat: define Visio worker protocol"
```

### Task 2: Add deterministic diagram mapping and a headless Worker core

**Files:**
- Create: `workers/visio-worker/VisioWorker.sln`
- Create: `workers/visio-worker/src/VisioWorker.Core/VisioWorker.Core.csproj`
- Create: `workers/visio-worker/src/VisioWorker.Core/DiagramModel.cs`
- Create: `workers/visio-worker/src/VisioWorker.Core/DiagramMapper.cs`
- Create: `workers/visio-worker/src/VisioWorker.Core/MockVisioEngine.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/MockVisioEngineTests.cs`

**Interfaces:**
- `DiagramMapper.Map(DiagramEnvelope diagram)` returns stable page coordinates in inches and stable `synapse.*` Shape Data.
- `IVisioEngine.Render(DiagramDocument document, string temporaryPath)` returns `ReadbackResult`.
- `MockVisioEngine` implements `IVisioEngine`, writes a deterministic diagnostic JSON beside the requested mock output, and reports shape/connector counts.

- [ ] **Step 1: Write failing C# tests for coordinate mapping and mock readback**

```csharp
[Fact]
public void Maps_canvas_nodes_to_stable_page_coordinates_and_shape_data()
{
    var document = DiagramMapper.Map(Fixtures.CnnDiagram());
    var node = Assert.Single(document.Nodes, node => node.Id == "input");
    Assert.Equal("input", node.ShapeData["synapse.nodeId"]);
    Assert.Equal(1.0, node.XInches);
    Assert.Equal(1.0, node.YInches);
}

[Fact]
public async Task Mock_engine_returns_counts_and_creates_the_requested_artifact()
{
    var output = Path.Combine(Path.GetTempPath(), $"visio-mock-{Guid.NewGuid():N}.vsdx");
    var result = await new MockVisioEngine().RenderAsync(Fixtures.CnnDocument(), output);
    Assert.True(result.Valid);
    Assert.Equal(3, result.ShapeCount);
    Assert.Equal(2, result.ConnectorCount);
    Assert.True(File.Exists(output));
}
```

- [ ] **Step 2: Run the C# tests to verify the expected missing-project failure**

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj`

Expected: FAIL because the Worker projects and types do not exist.

- [ ] **Step 3: Implement the platform-neutral model, mapper, and mock engine**

Use the existing `diagram.nodes` `x/y/w/h` values and the existing canvas dimensions to map pixels to inches with one documented scale. Preserve skip edge route points, stage labels, node IDs, kinds, labels, and optional subtitles. The mock output must be deterministic and must never be used as a live result.

- [ ] **Step 4: Run the C# tests to verify the mock core passes**

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj`

Expected: all mapper and mock-engine tests pass.

- [ ] **Step 5: Commit the platform-neutral Worker core**

```powershell
git add workers/visio-worker
git commit -m "feat: add Visio diagram mapper and mock engine"
```

### Task 3: Implement the single-threaded live Visio COM engine

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Live/VisioWorker.Live.csproj`
- Create: `workers/visio-worker/src/VisioWorker.Live/ComStaRunner.cs`
- Create: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Create: `workers/visio-worker/src/VisioWorker.Live/PathPolicy.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/PathPolicyTests.cs`
- Create: `scripts/visio-com-smoke.ps1`

**Interfaces:**
- `ComStaRunner.InvokeAsync<T>(Func<T> action)` executes every COM action on one initialized STA thread.
- `VisioComEngine.RenderAsync(DiagramDocument document, string temporaryPath)` creates a document, renders nodes/connectors, saves, closes/reopens, and returns `ReadbackResult`.
- `PathPolicy.ValidateOutputPath(string path, string root)` rejects traversal, wrong extension, and paths outside the configured root.

- [ ] **Step 1: Write failing path-policy and thread-isolation tests**

```csharp
[Theory]
[InlineData("C:\\exports\\..\\outside.vsdx")]
[InlineData("C:\\exports\\result.json")]
public void Rejects_output_paths_outside_the_vsdx_root(string path)
{
    Assert.Throws<WorkerProtocolException>(() => PathPolicy.ValidateOutputPath(path, "C:\\exports"));
}

[Fact]
public async Task Com_runner_serializes_actions_on_one_sta_thread()
{
    await using var runner = new ComStaRunner();
    var ids = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => runner.InvokeAsync(() => Environment.CurrentManagedThreadId)));
    Assert.Single(ids.Distinct());
}
```

- [ ] **Step 2: Run the focused C# test and verify the expected missing-type failure**

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~PathPolicy`

Expected: FAIL because the live Worker types do not exist.

- [ ] **Step 3: Implement path policy and COM runner**

Use an absolute normalized root, compare paths with Windows ordinal-ignore-case semantics, create an STA thread, call `CoInitialize`/`CoUninitialize` on that thread, and dispose the runner after every Worker request.

- [ ] **Step 4: Implement late-bound Visio rendering and readback**

Create `Visio.Application` through `Type.GetTypeFromProgID`, set visibility from configuration, create a document/page, add native basic shapes and dynamic connectors, write `synapse.*` Shape Data, save to the temporary path, close/reopen the document, count shapes and connectors, and only then return a valid result. The engine must track whether it launched Visio and only quit that instance.

- [ ] **Step 5: Run platform-neutral tests and build the live project**

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj`

Run: `dotnet build workers/visio-worker/src/VisioWorker.Live/VisioWorker.Live.csproj`

Expected: tests pass and the Windows live project builds. This is not live Visio acceptance.

### Task 4: Add the Worker host and JSON-lines transport

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/VisioWorker.Host.csproj`
- Create: `workers/visio-worker/src/VisioWorker.Host/Program.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/ProtocolRoundTripTests.cs`
- Create: `scripts/visio-worker-mock-smoke.ps1`

**Interfaces:**
- The host reads one JSON request from stdin and writes one JSON response to stdout.
- `--mode mock` selects the headless engine; `--mode live` selects the COM engine.
- Exit code `0` is allowed only for a response with `status=succeeded`; malformed input, timeout, engine failure, and invalid readback return a non-zero exit code and a failed response.

- [ ] **Step 1: Write the failing host round-trip test**

```csharp
[Fact]
public async Task Mock_host_round_trip_returns_a_valid_readback()
{
    var result = await HostHarness.RunAsync("--mode", "mock", Fixtures.RequestJson());
    Assert.Equal(0, result.ExitCode);
    Assert.Equal("succeeded", result.Response.Status);
    Assert.True(result.Response.Readback!.Valid);
}
```

- [ ] **Step 2: Run the focused host test and verify it fails**

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~Host`

Expected: FAIL because the host executable and harness do not exist.

- [ ] **Step 3: Implement the host and response rules**

Use `System.Text.Json`, validate the request before touching an engine, enforce the output root, write only one response line, flush stdout, and dispose the engine in a `finally` block. Use a temporary file in the same directory and `File.Move(..., overwrite: true)` only after readback succeeds.

- [ ] **Step 4: Run the mock host smoke**

Run: `powershell -ExecutionPolicy Bypass -File scripts/visio-worker-mock-smoke.ps1`

Expected: output contains `Visio Worker mock smoke OK` and a valid mock readback.

### Task 5: Connect the API adapter and authenticated Visio export Job

**Files:**
- Create: `apps/api/src/visio-worker-client.ts`
- Create: `apps/api/tests/visio-worker-client.test.ts`
- Modify: `apps/api/src/adapters.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/job-service.test.ts`
- Modify: `apps/api/tests/config.test.ts`
- Modify: `README.md`

**Interfaces:**
- `VisioWorkerClient implements VisioExecutor`.
- `executeDiagram(input: { jobId: string; diagram: unknown }): Promise<{ path: string; readback: { valid: true; shapeCount: number; connectorCount: number } }>`.
- Config values: `VISIO_WORKER_PATH`, `VISIO_OUTPUT_ROOT`, `VISIO_WORKER_MODE`, and bounded `VISIO_WORKER_TIMEOUT_MS`.
- `POST /api/visio/export` requires the existing bearer session and `Idempotency-Key`, accepts a validated diagram, creates a `visio-export` Job, executes the Worker, and returns the completed Job or an explicit failure.

- [ ] **Step 1: Write failing client and route tests**

```ts
it("maps a successful Worker response to a Visio export result", async () => {
  const client = new VisioWorkerClient({ workerPath: fakeWorkerPath, outputRoot: tempRoot, mode: "mock" });
  await expect(client.executeDiagram({ jobId: "job-1", diagram: fixtureDiagram })).resolves.toMatchObject({
    path: expect.stringMatching(/job-1\.vsdx$/),
    readback: { valid: true, shapeCount: 3, connectorCount: 2 },
  });
});

it("returns an explicit 503 when the Worker is not configured", async () => {
  const response = await app.inject({ method: "POST", url: "/api/visio/export", headers: authorizedHeaders("visio-route-1"), payload: { diagram: fixtureDiagram } });
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("VISIO_EXECUTOR_NOT_CONFIGURED");
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run apps/api/tests/visio-worker-client.test.ts apps/api/tests/job-service.test.ts`

Expected: FAIL because the client, route, and configuration fields do not exist.

- [ ] **Step 3: Implement the client and dependency injection**

Spawn the configured Worker executable with redirected stdin/stdout, send one serialized request, enforce the timeout, parse the single response with the protocol parser, reject non-zero exit or invalid readback, and clean up the child process. Keep `NotConnectedVisioExecutor` as the safe default when no Worker path is configured.

- [ ] **Step 4: Implement the authenticated export route and Job transition**

Validate the submitted diagram against the existing publication-layout contract, create a `visio-export` Job owned by the current user/device, transition queued → running → succeeded/failed, and return no path on failed readback. Do not allow a body-supplied output path.

- [ ] **Step 5: Run focused API tests and the full API suite**

Run: `npx vitest run apps/api/tests/visio-worker-client.test.ts apps/api/tests/job-service.test.ts apps/api/tests/routes.test.ts`

Run: `npm run api:test`

Expected: focused tests and all existing tests pass.

- [ ] **Step 6: Commit the API integration**

```powershell
git add apps/api/src/visio-worker-client.ts apps/api/src/adapters.ts apps/api/src/config.ts apps/api/src/app.ts apps/api/src/routes.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/job-service.test.ts apps/api/tests/config.test.ts README.md
git commit -m "feat: connect authenticated Visio export jobs"
```

### Task 6: Verify live acceptance boundaries and document operations

**Files:**
- Modify: `scripts/visio-com-smoke.ps1`
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-08-12-visio-worker-acceptance.md`

- [ ] **Step 1: Run all platform-neutral verification**

Run: `npm run api:test`

Run: `npx tsc --noEmit`

Run: `dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj`

Run: `powershell -ExecutionPolicy Bypass -File scripts/visio-worker-mock-smoke.ps1`

Expected: all commands exit 0.

- [ ] **Step 2: Run the real COM smoke only when Visio is available**

Run: `powershell -ExecutionPolicy Bypass -File scripts/visio-com-smoke.ps1`

Expected on a Visio-installed machine: `Visio COM smoke OK`, a `.vsdx` output path, and independent readback counts. If Visio is unavailable, the script must report `VISIO_UNAVAILABLE` and exit non-zero without claiming success.

- [ ] **Step 3: Inspect the generated artifact independently**

Open the produced `.vsdx` in Visio, verify that the network nodes and connectors are visible, confirm the file can be closed and reopened, and record that observation separately from automated tests.

- [ ] **Step 4: Update the README with exact development and acceptance commands**

Document Worker build, mock mode, live COM mode, output root, security boundary, and the separate status gates. Explicitly state that external GitHub projects were used as references, not runtime dependencies.

- [ ] **Step 5: Commit the verification and operations documentation**

```powershell
git add scripts/visio-com-smoke.ps1 scripts/visio-worker-mock-smoke.ps1 README.md docs/superpowers/plans/2026-08-12-visio-worker-acceptance.md
git commit -m "docs: add Visio worker acceptance runbook"
```
