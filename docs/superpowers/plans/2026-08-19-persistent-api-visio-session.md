# Persistent API Visio Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a confirmed Agent render into one visible persistent Visio VSDX/Page that can receive later diffs without opening another canvas.

**Architecture:** The .NET Worker remains the only COM owner. Its v2 runtime will return native readback after saving an applied plan. The API will use one serialized v2 child process per authenticated owner/device/workflow session instead of closing stdin after a one-shot v1 request.

**Tech Stack:** Node.js/TypeScript/Fastify/Vitest, .NET 8/Visio COM/xUnit, JSON Lines over child-process stdio.

## Global Constraints

- Preserve the v1 Worker protocol and existing non-visible one-shot exports.
- `Visible=true` uses v2 and leaves Worker stdin open between responses.
- A v2 `apply` or `applyDiff` response contains native page readback; API code never manufactures it from a requested diagram.
- Session identity is exactly `(tenantId, userId, deviceId, workflowId)` and output paths remain beneath the configured Worker root.
- First render is `open` + `apply` + `save`; revision is `applyDiff` + `save`; only explicit close or orderly API shutdown sends `close(save)`.
- Do not add generic COM, Shell, VBA, process, or filesystem-control protocol fields.
- Keep the two user-owned untracked roadmap drafts unchanged and unstaged.

---

### Task 1: Return in-session native readback through Worker v2

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Core/VisioSessionManager.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComSessionBackend.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComSessionOperations.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionBackendTests.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`

**Interfaces:**
- Add typed `ReadbackAsync(document, plan)` to the reusable-session backend and `Readback(document, plan)` to the fixed COM operation surface.
- Extend `WorkerV2Response` with nullable typed `WorkerReadback`; populate it only after `apply`/`applyDiff` is saved.

- [ ] **Step 1: Write a failing test.** Record an `apply` request and assert one post-save readback call plus `readback.valid=true`; assert invalid readback yields a failed v2 response.
- [ ] **Step 2: Run RED.** Run `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~VisioComSessionBackendTests|FullyQualifiedName~WorkerHostLineProcessorTests" --logger "console;verbosity=normal"` and verify the new test fails for the missing typed readback path.
- [ ] **Step 3: Implement the smallest typed path.** Read the currently held page on the existing COM STA; reuse legacy/semantic validators; save before readback; map `ReadbackResult` to `WorkerReadback`; do not add readback to other v2 commands.
- [ ] **Step 4: Run GREEN.** Repeat Step 2 with zero failures.

### Task 2: Worker-owned canonical plan digest for v2 callers

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerV2ProtocolTests.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/LongLivedWorkerRuntimeTests.cs`

**Interfaces:**
- `planHash` is optional for v2 `apply` and `applyDiff`; `operationId` and `diagram` remain required.
- The Worker maps the diagram, computes its canonical digest, uses that digest for the operation journal and request fingerprint, and compares an optional caller value against it case-insensitively.

- [ ] **Step 1: Write failing tests.** Assert an `apply` without `planHash` parses and succeeds with the Worker-derived operation digest. Assert a supplied mismatched hash is rejected before native apply. Assert supplied matching hashes remain compatible.
- [ ] **Step 2: Run RED.** Run `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~WorkerV2ProtocolTests|FullyQualifiedName~LongLivedWorkerRuntimeTests" --logger "console;verbosity=normal"` and observe the absent-hash case fail under the old parser/validator.
- [ ] **Step 3: Implement worker derivation.** Keep the typed mapping and canonical `DiagramPlanDigest.Compute` inside `LongLivedWorkerRuntime`; reject unknown fields as before; never use an unverified caller hash to create a `VisioSessionOperation` or replay fingerprint.
- [ ] **Step 4: Run GREEN.** Repeat Step 2 with zero failures.

### Task 3: Long-lived v2 child client for visible API exports

**Files:**
- Modify: `apps/api/src/adapters.ts`
- Modify: `apps/api/src/visio-worker-client.ts`
- Create: `apps/api/src/visio-session-protocol.ts`
- Test: `apps/api/tests/visio-worker-client.test.ts`
- Create: `apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs`

**Interfaces:**
- `VisioExecutor.executeDiagram` receives trusted `userId`, `deviceId`, optional `workflowId`, and operation `apply | applyDiff`; callers derive them from stored jobs.
- Add optional `closeSession({ userId, deviceId, workflowId })` and `close()` executor methods.
- Visible live mode sends `open`/`apply`/`save` initially and later `applyDiff`/`save` to the same child. It validates request IDs, output path, and native readback.

- [ ] **Step 1: Write a failing test.** A v2 fake Worker records lines and remains alive. Assert first render leaves stdin open, same-session revision reuses the child and sends `applyDiff`, explicit close sends `close(save)` before stdin ends, and a succeeded response without readback is rejected. The API omits `planHash`; it must not duplicate the .NET canonical hashing algorithm.
- [ ] **Step 2: Run RED.** Run `npx vitest run apps/api/tests/visio-worker-client.test.ts` and observe failure because the client writes v1 once and immediately ends stdin.
- [ ] **Step 3: Implement minimal transport.** Use strict v2 schemas, a bounded per-session FIFO/pending map, fixed configuration-derived spawn arguments, sanitized failure handling, and retain v1 for non-visible exports.
- [ ] **Step 4: Run GREEN.** Repeat Step 2 with zero failures.

### Task 4: Bind revisions and explicit close to authenticated jobs

**Files:**
- Modify: `apps/api/src/visio-job-runner.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/visio-job-runner.test.ts`
- Test: `apps/api/tests/visio-routes.test.ts`

**Interfaces:**
- The job runner passes stored owner/device/original workflow ID and operation to the executor.
- `POST /api/legacy/visio-exports/:id/revisions` creates a same-owner/device child job with the parent job ID as workflow ID and operation `applyDiff`.
- `POST /api/legacy/visio-exports/:id/close` delegates only the server-derived parent workflow identity to `closeSession`.

- [ ] **Step 1: Write failing tests.** Assert first job uses `apply` and its ID as workflow; authorized revision uses the original workflow plus `applyDiff`; cross-device revision/close never call the executor; API shutdown invokes executor close after job cancellation.
- [ ] **Step 2: Run RED.** Run `npx vitest run apps/api/tests/visio-job-runner.test.ts apps/api/tests/visio-routes.test.ts` and observe the missing bindings/routes.
- [ ] **Step 3: Implement only bound controls.** Persist server-created workflow/operation input; reject wrong parent/device using `NOT_FOUND`; accept no client-controlled session ID, path, COM operation, or close disposition.
- [ ] **Step 4: Run GREEN.** Repeat Step 2 with zero failures.

### Task 5: Cross-layer verification and one controlled live session

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-visible-visio-session-design.md`

- [ ] **Step 1: Run focused tests.** Run the focused .NET command from Task 1 and `npx vitest run apps/api/tests/visio-worker-client.test.ts apps/api/tests/visio-job-runner.test.ts apps/api/tests/visio-routes.test.ts` with zero failures.
- [ ] **Step 2: Build.** Run `dotnet build workers/visio-worker/VisioWorker.sln --no-restore -c Release`, `npx tsc --noEmit`, and `git diff --check` with no build errors or whitespace failures.
- [ ] **Step 3: Controlled acceptance.** Start one visible long-lived session through API transport, issue initial render then one `applyDiff`, verify same VSDX/Page/window, and leave it open. Do not issue `close` unless the user asks.
- [ ] **Step 4: Review.** Record sanitized evidence, independently review the diff, and never push without an explicit request.
