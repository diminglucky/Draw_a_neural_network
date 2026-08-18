# Long-Lived Visio Worker Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Worker protocol v2 so one authorized workflow keeps one Visio document/page, checkpoints after exactly 15 idle minutes, and recovers the same VSDX after Worker restart.

**Architecture:** Preserve the existing version-1 one-shot `WorkerRequestProcessor`. Add a strict version-2 JSON discriminator/parser, a long-lived runtime that owns one `VisioComEngine`/backend/session manager, an atomic private manifest store, and a JSON-lines host loop that keeps the v2 runtime alive across input lines.

**Tech Stack:** .NET 8 Windows, System.Text.Json, xUnit, `VisioSessionManager`, `VisioComSessionBackend`, `VisioComEngine`, `PathPolicy`, `ComStaRunner`.

## Global Constraints

- Version 1 behavior remains source and behavior compatible.
- Version 2 commands are exactly `open`, `apply`, `applyDiff`, `save`, `snapshot`, `close`, and `recover`.
- Reject unknown fields before native work. Never accept arbitrary COM/VBA/shell/script/desktop actions.
- Session identity is exactly `(tenantId, userId, deviceId, workflowId)`.
- `apply` and `applyDiff` require an operation ID, a 64-character SHA-256 plan hash, and a valid diagram.
- Idle checkpoint is exactly 15 minutes with a one-minute scheduler tick and an injected clock.
- Output and manifests stay under the configured output root; manifests are Worker-owned and atomically written.
- Uncertain COM, ownership, cancellation, save, close, or manifest outcomes fail closed; they never create a replacement document/page.
- Agent/API authorization and confirmation remain outside this Worker; browser code never directly controls it.
- Unit proof and manually gated installed-Visio proof are reported separately.

---

### Task 1: Strict protocol v2 model and parser

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerV2ProtocolTests.cs`

**Interfaces:**
- Produce `WorkerV2Command`, `WorkerV2Session`, `WorkerV2Request`, `WorkerV2Response`, and `WorkerV2RequestParser.Parse(string json)`.
- Later tasks receive a parsed `WorkerV2Request`, never raw client JSON.

- [ ] **Step 1: Write failing parser tests.**

```csharp
[Fact]
public void Parser_rejects_unknown_apply_field_before_runtime_dispatch()
{
    const string json = """{"protocolVersion":2,"requestId":"request-1","command":"apply","session":{"tenantId":"tenant","userId":"user","deviceId":"device","workflowId":"workflow"},"operationId":"operation-1","planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","diagram":{"figure":{"title":"x"},"nodes":[],"edges":[]},"method":"Quit"}""";
    var error = Assert.Throws<WorkerProtocolException>(() => WorkerV2RequestParser.Parse(json));
    Assert.Contains("unknown", error.Message, StringComparison.OrdinalIgnoreCase);
}
```

Add tests for a valid `applyDiff`, invalid command, `save` containing `diagram`, and `close` lacking `save|discard` disposition.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~WorkerV2ProtocolTests`

Expected: missing v2 parser/type compile failure.

- [ ] **Step 3: Implement the sealed contracts and property-set parser.**

```csharp
public enum WorkerV2Command { Open, Apply, ApplyDiff, Save, Snapshot, Close, Recover }
public sealed record WorkerV2Session(string TenantId, string UserId, string DeviceId, string WorkflowId)
{
    public VisioSessionKey ToKey() => new(TenantId, UserId, DeviceId, WorkflowId);
}
public sealed record WorkerV2Request(string RequestId, WorkerV2Command Command, WorkerV2Session Session, string? OutputPath, string? OperationId, string? PlanHash, DiagramEnvelope? Diagram, string? CloseDisposition);
```

Use `JsonDocument` first, require protocol version 2 and exact common properties, then select an exact allowed property set per command. Validate the Core key, operation, and path constraints before returning the request.

- [ ] **Step 4: Run GREEN tests and commit.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~WorkerV2ProtocolTests`

Expected: all focused tests pass.

```powershell
git add -- workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerV2ProtocolTests.cs
git commit -m "feat: add strict Visio worker v2 protocol"
```

### Task 2: Atomic private recovery-manifest store

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/SessionRecoveryManifestStore.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/SessionRecoveryManifestStoreTests.cs`

**Interfaces:**
- Produce `StoredSessionRecoveryManifest(VisioSessionRecoveryManifest Manifest, DateTimeOffset SavedAt, DateTimeOffset LastActivity)`.
- Produce `ISessionRecoveryManifestStore.SaveAsync(...)` and `LoadAsync(VisioSessionKey key, ...)`.

- [ ] **Step 1: Write failing storage tests.**

```csharp
[Fact]
public async Task Load_rejects_manifest_whose_embedded_key_differs_from_requested_key()
{
    var store = new SessionRecoveryManifestStore(CreateRoot());
    var key = new VisioSessionKey("tenant-a", "user", "device", "workflow");
    await File.WriteAllTextAsync(store.GetPathForTesting(key), """{"formatVersion":1,"key":{"tenantId":"tenant-b","userId":"user","deviceId":"device","workflowId":"workflow"}}""");
    await Assert.ThrowsAsync<WorkerProtocolException>(() => store.LoadAsync(key));
}
```

Also cover normal round-trip, corrupt JSON, output-root escape, and preservation of the prior manifest if a partial write fails.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~SessionRecoveryManifestStoreTests`

Expected: missing store compile failure.

- [ ] **Step 3: Implement private atomic manifests.**

```csharp
public sealed class SessionRecoveryManifestStore : ISessionRecoveryManifestStore
{
    public Task SaveAsync(VisioSessionRecoveryManifest manifest, DateTimeOffset savedAt, DateTimeOffset lastActivity, CancellationToken cancellationToken = default);
    public Task<StoredSessionRecoveryManifest?> LoadAsync(VisioSessionKey key, CancellationToken cancellationToken = default);
}
```

Derive the filename from SHA-256 of the session tuple under `<outputRoot>/.synapse-sessions/`. Write a versioned JSON envelope to a sibling GUID partial file, flush it, then atomically replace the final file. On load, reject unknown fields, reconstruct the existing Core manifest, validate the requested key and normalized path, and never expose a manifest path to a client.

- [ ] **Step 4: Run GREEN tests and commit.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~SessionRecoveryManifestStoreTests`

Expected: all focused tests pass.

```powershell
git add -- workers/visio-worker/src/VisioWorker.Host/SessionRecoveryManifestStore.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SessionRecoveryManifestStoreTests.cs
git commit -m "feat: persist Visio session recovery manifests"
```

### Task 3: Long-lived runtime, command dispatch, and 15-minute checkpoint

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/WorkerClock.cs`
- Create: `workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/LongLivedWorkerRuntimeTests.cs`

**Interfaces:**
- `IWorkerClock.UtcNow`; production `SystemWorkerClock` and test `FakeWorkerClock`.
- `LongLivedWorkerRuntime.ProcessAsync(WorkerV2Request request, CancellationToken)`.
- `LongLivedWorkerRuntime.CheckpointIdleSessionsAsync(CancellationToken)`.

- [ ] **Step 1: Write failing runtime tests.**

```csharp
[Fact]
public async Task Idle_checkpoint_saves_closes_and_fresh_runtime_recovers_same_session()
{
    var clock = new FakeWorkerClock(DateTimeOffset.Parse("2026-08-18T00:00:00Z"));
    var backend = new RecordingSessionBackend();
    var store = new InMemoryManifestStore();
    await using var first = new LongLivedWorkerRuntime(backend, store, clock, TimeSpan.FromMinutes(15), 4);
    await first.ProcessAsync(Open("session.vsdx"));
    await first.ProcessAsync(Apply("operation-1", Hash('a')));
    clock.Advance(TimeSpan.FromMinutes(15));
    await first.CheckpointIdleSessionsAsync();
    Assert.Equal(1, backend.SaveCalls);
    Assert.Equal(1, backend.CloseCalls);
    await using var second = new LongLivedWorkerRuntime(backend, store, clock, TimeSpan.FromMinutes(15), 4);
    var response = await second.ProcessAsync(Recover());
    Assert.Equal("succeeded", response.Status);
    Assert.Equal(1, backend.RecoverCalls);
}
```

Also cover repeated `open`, apply replay, 14:59 no-op, explicit `close(save)`, cross-owner isolation, capacity checkpoint, and checkpoint failure with no new document.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~LongLivedWorkerRuntimeTests`

Expected: missing runtime/clock compile failure.

- [ ] **Step 3: Implement command runtime.**

`open` binds a normalized VSDX path once and returns an existing snapshot or Worker-owned manifest recovery. `apply`/`applyDiff` map diagrams and call `VisioSessionManager`. `save` persists the returned recovery manifest. `close(save)` saves then closes; `close(discard)` closes while retaining the last manifest. `recover` loads only from the store. `snapshot` is read-only. Update activity after each accepted command and retain a bounded per-session command replay ledger keyed by request ID.

- [ ] **Step 4: Implement idle/capacity behavior.**

At 15 minutes call manager save using the bound path, persist the returned manifest, then close. At active-capacity, checkpoint the least-recently-active safe session; if it cannot checkpoint, fail the new open request. Never use recovery failure as permission to create a document.

- [ ] **Step 5: Run GREEN tests and commit.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~LongLivedWorkerRuntimeTests`

Expected: all focused tests pass.

```powershell
git add -- workers/visio-worker/src/VisioWorker.Host/WorkerClock.cs workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs workers/visio-worker/tests/VisioWorker.Core.Tests/LongLivedWorkerRuntimeTests.cs
git commit -m "feat: add durable long-lived Visio worker runtime"
```

### Task 4: Persistent JSON-lines host with v1 compatibility

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/Program.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerProtocol.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/ProtocolRoundTripTests.cs`

**Interfaces:**
- `WorkerHostLineProcessor.ProcessLineAsync(string line, CancellationToken)` selects only by `protocolVersion`.
- It owns exactly one `LongLivedWorkerRuntime` for every v2 input line and delegates v1 to the existing processor.

- [ ] **Step 1: Write failing host-line tests.**

```csharp
[Fact]
public async Task Two_v2_apply_lines_share_one_runtime_backend_open()
{
    var backend = new RecordingSessionBackend();
    await using var processor = CreateLineProcessor(backend);
    await processor.ProcessLineAsync(OpenJson());
    await processor.ProcessLineAsync(ApplyJson("operation-1"));
    await processor.ProcessLineAsync(ApplyJson("operation-1"));
    Assert.Equal(1, backend.OpenOrCreateCalls);
    Assert.Equal(1, backend.ApplyPlanCalls);
}
```

Add v1 round-trip compatibility, malformed v2 line followed by valid v2, and EOF disposal tests.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~WorkerHostLineProcessorTests`

Expected: missing line processor compile failure.

- [ ] **Step 3: Implement the loop and router.**

```csharp
await using var processor = new WorkerHostLineProcessor(options);
while (await Console.In.ReadLineAsync().ConfigureAwait(false) is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    var response = await processor.ProcessLineAsync(line.TrimStart('\uFEFF')).ConfigureAwait(false);
    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions)).ConfigureAwait(false);
    await Console.Out.FlushAsync().ConfigureAwait(false);
}
return 0;
```

Use a bounded `JsonDocument` to read only protocol version. Route v1 through existing deserialization/mode handling; route v2 exclusively through the strict parser. A malformed line writes one safe failure response and leaves later v2 lines able to use the same runtime.

- [ ] **Step 4: Run selected and full tests, then commit.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~ProtocolRoundTripTests|FullyQualifiedName~WorkerHostLineProcessorTests|FullyQualifiedName~WorkerV2ProtocolTests|FullyQualifiedName~LongLivedWorkerRuntimeTests"`

Expected: all selected tests pass.

```powershell
git add -- workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs workers/visio-worker/src/VisioWorker.Host/Program.cs workers/visio-worker/src/VisioWorker.Host/WorkerProtocol.cs workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/ProtocolRoundTripTests.cs
git commit -m "feat: host persistent Visio session commands"
```

### Task 5: Real long-lived Visio acceptance and release gates

**Files:**
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionLiveAcceptanceTests.cs`
- Modify: `docs/superpowers/specs/2026-08-18-long-lived-visio-worker-protocol-design.md` only to record factual evidence after successful execution.

- [ ] **Step 1: Add a manually gated idle/restart acceptance test.**

```csharp
[Fact(Skip = "Manual installed-Visio acceptance test; enable only on a controlled Windows Visio host.")]
public async Task Idle_checkpoint_and_fresh_runtime_recover_same_editable_vsdx()
{
    await using var first = CreateLiveRuntime(clock);
    await first.ProcessAsync(Open("session.vsdx"));
    await first.ProcessAsync(Apply("operation-1", firstPlan));
    clock.Advance(TimeSpan.FromMinutes(15));
    await first.CheckpointIdleSessionsAsync();
    await using var second = CreateLiveRuntime(clock);
    await second.ProcessAsync(Recover());
    await second.ProcessAsync(ApplyDiff("operation-2", secondPlan));
    await second.ProcessAsync(Save());
    AssertVsdxContainsExpectedSessionOwnershipAndNoDuplicateOldSemanticIds(OutputPath);
}
```

Prove unmarked user shapes survive, the checkpoint closes the first runtime, a fresh runtime recovers the original VSDX/page, and independent VSDX inspection finds expected ownership/semantic data without stale duplicates.

- [ ] **Step 2: Run the enabled real acceptance test and final release gates.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~VisioComSessionLiveAcceptanceTests`

Expected: enabled installed-Visio acceptance passes; report it separately from unit results.

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore`

Expected: zero failures; only manually gated tests skip.

Run: `dotnet build workers/visio-worker/VisioWorker.sln --no-restore -c Release`

Expected: zero warnings and zero errors.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Commit acceptance evidence with an exact allowlist.**

```powershell
git add -- workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionLiveAcceptanceTests.cs docs/superpowers/specs/2026-08-18-long-lived-visio-worker-protocol-design.md
git diff --cached --check
git commit -m "test: verify long-lived Visio session recovery"
```
