# Selected Current-Page Visio Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize one formal, sealed universal publication plan onto exactly the document and page the user has selected in Visio, while preserving user-authored shapes and never creating a document, a page, or a replacement `.vsdx`.

**Architecture:** Keep the legacy v1/v2 export worker intact and isolated. Add a v3 selected-page command lane to the C# Worker, with a strict command parser, explicit attachment state, native target fingerprints, Agent ownership reconciliation, save-current-document and readback. The TypeScript adapter verifies the sealed plan and snapshot identity before dispatching that v3 lane; it does not send raw source, arbitrary COM requests, output paths, or unsealed PVPs.

**Tech Stack:** TypeScript, Zod, Vitest, C#/.NET 8, xUnit, Windows Visio COM STA worker, HMAC-bound selected-page protocol.

## Global Constraints

- A new request never uses `OpenOrCreate`, `SaveAs`, document creation, page creation, an output path, or a legacy export route.
- When Visio is absent, the Worker may start a visible application only; it returns `waiting_for_selected_page` until the user opens a document and selects an existing page.
- The target binding is document ID, page ID, document fingerprint, page fingerprint, expected revision, tenant/user/device/workflow, job ID, and ownership namespace.
- Only formal QA-passing PVPs with accepted review identity may generate a selected-page request. Candidate structures, stale snapshots, unsupported primitives, missing mappings, and identity mismatches fail before COM mutation.
- Reconciliation deletes only shapes marked with the exact ownership namespace after attachment and revision revalidation. It preserves every unmarked/user-owned shape.
- The Worker receives only allowlisted native primitives and sealed identity fields. It never receives source, provider content, SVG, model coordinates, shell, VBA, or arbitrary COM member names.
- Cancellation either leaves the last verified Agent-owned region unchanged or returns a readback-confirmed recoverable state. It must not delete the user region and then report success.

---

### Task 1: Define and test the C# v3 selected-page protocol

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Host/SelectedPageWorkerProtocol.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessorOptions.cs` if options must be extracted from the existing file
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageWorkerProtocolTests.cs`

**Consumes:** JSON commands built by `buildSelectedPageVisioSessionCommands` and a Worker-only selected-page request secret.

**Produces:** strict v3 commands `attachSelectedPage`, `applyOwnedRegion`, `saveSelectedDocument`, `readSelectedPage`, and `closeSession`, plus responses that bind request ID and selected-page identity.

- [ ] **Step 1: Write failing parser tests.** Assert the parser rejects every legacy field (`outputPath`, `open`, `createDocument`, `createPage`), duplicate or unknown JSON properties, malformed identifiers/hashes, a missing selected-page binding, a wrong protocol version, an `applyOwnedRegion` without a sealed plan, and a successful `readSelectedPage` response without ownership-separated readback.

- [ ] **Step 2: Run RED.**

  ```powershell
  dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageWorkerProtocolTests
  ```

  Expected: compile failure because the v3 protocol types and parser do not exist.

- [ ] **Step 3: Implement the exact v3 DTOs and parser.** Require exact-property JSON objects. Parse the full selected-page binding and `applyOwnedRegion` envelope; reject any command that exposes a document/page/output creation field. Do not change `WorkerV2RequestParser` behavior.

- [ ] **Step 4: Run GREEN.** Re-run the focused xUnit filter and the pre-existing `WorkerV2ProtocolTests`; both must pass.

### Task 2: Add a selected-page Worker state machine with fake-native tests

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Core/SelectedPageSessionManager.cs`
- Create: `workers/visio-worker/src/VisioWorker.Core/SelectedPageSessionModel.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageSessionManagerTests.cs`

**Consumes:** parsed v3 commands, a narrowly typed selected-page backend, allowlisted native-plan bytes, and a cancellation token.

**Produces:** a session that attaches a single target, applies only the exact namespace, saves the existing document, reads back the same target, and closes only Worker-held COM handles.

- [ ] **Step 1: Write failing state-machine tests using a recording fake.** Cover: launch-without-selection returns waiting state without `Add`; attach records a document/page/fingerprint/revision; apply preserves user shapes and replaces only matching namespace; changed fingerprint/revision rejects before deletion; save invokes `Document.Save`, not `SaveAs`; candidate/unsealed/unsupported input is rejected; cancellation after attachment does not mutate; cancellation during apply yields a recoverable readback or retains previous region.

- [ ] **Step 2: Run RED.**

  ```powershell
  dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageSessionManagerTests
  ```

  Expected: compile failure because no selected-page session manager exists.

- [ ] **Step 3: Implement the minimal state machine.** Make target attachment, current revision verification, namespace replacement, save, readback, and close separate transitions. Keep the backend interface limited to `EnsureVisibleApplication`, `AttachActiveSelection`, `ApplyOwnedRegion`, `SaveSelectedDocument`, `ReadSelectedPage`, and `ReleaseSession`; it has no creation or output methods.

- [ ] **Step 4: Run GREEN.** Re-run focused tests and all existing `VisioSessionManagerTests` to prove legacy and v3 lifecycles remain isolated.

### Task 3: Implement the native Visio selected-page backend

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComLiveAcceptanceTests.cs`

**Consumes:** selected-page session backend interface and allowlisted native diagram primitives derived from a sealed PVP.

**Produces:** an STA-confined COM implementation that launches or attaches Visio, requires an already-open selected page, computes stable target identity/fingerprint, reconciles owned shapes, saves the current document, and returns independent readback.

- [ ] **Step 1: Write failing fake-COM backend tests.** Assert absent Visio launches a visible application but calls neither `Documents.Add` nor `Pages.Add`; an active application with no active document/page returns waiting; user-selected document/page is attached; foreign page/document or changed fingerprint rejects; only matching ownership shapes are deleted; unmarked shapes survive; `Save` is called once and `SaveAs` never occurs.

- [ ] **Step 2: Run RED.**

  ```powershell
  dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageVisioComBackendTests
  ```

  Expected: compile failure because the backend does not exist.

- [ ] **Step 3: Implement COM attachment and ownership reconciliation.** Use the active Visio application when one exists; otherwise create only the visible application instance and wait. Obtain the active window/page and containing document, never `Documents.Add`. Calculate and re-check document/page fingerprints around every destructive transition. Tag each newly created primitive and connector with plan ID/hash/revision, semantic ID, primitive/connector ID and exact ownership namespace. Use `Document.Save()` only after readback proves the attached target is still identical.

- [ ] **Step 4: Run GREEN.** Run fake-COM tests plus existing worker live-session tests with live tests skipped by default.

### Task 4: Route v3 commands through the persistent Worker host

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/Program.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`

**Consumes:** v3 parser, selected-page session manager and live backend.

**Produces:** protocol-version dispatch with v1/v2 compatibility and v3 responses that preserve only safe errors/readback.

- [ ] **Step 1: Write failing host tests.** Verify a v3 attach command never initializes the v2 runtime; a v3 apply validates sealed identity before backend access; every response is correlated to its request; cancellation keeps the session usable for readback; and v3 cannot fall through to `OpenOrCreate`.

- [ ] **Step 2: Run RED.**

  ```powershell
  dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~WorkerHostLineProcessorTests
  ```

  Expected: v3 requests are classified as invalid because the host supports only v1/v2.

- [ ] **Step 3: Implement v3 dispatch.** Add `WorkerHostProtocol.V3`, lazily initialize a separate selected-page runtime, and prevent v2 runtime/backend reuse. Add a Worker configuration value for the selected-page sealing verifier; fail startup for live v3 when absent.

- [ ] **Step 4: Run GREEN.** Run all Worker Host, protocol and session test classes.

### Task 5: Add the server-side CurrentPageVisioAdapter and seal-to-Worker handoff

**Files:**
- Create: `apps/api/src/current-page-visio-adapter.ts`
- Create: `apps/api/tests/current-page-visio-adapter.test.ts`
- Modify: `apps/api/src/visio-worker-client.ts`
- Modify: `apps/api/src/visio-universal-worker-client.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/tests/visio-worker-client.test.ts`
- Test: `apps/api/tests/visio-universal-worker-client.test.ts`

**Consumes:** a server-stored formal snapshot, QA-passing PVP, accepted review identity, a trusted binding and sealed native intent.

**Produces:** a narrowly typed API-side adapter that verifies all identities and dispatches v3 Worker commands only; it never accepts user PVP/source/output paths.

- [ ] **Step 1: Write failing TypeScript tests.** Assert foreign owner/device/workflow, stale revision, candidate PVP, failed QA, absent review identity, mismatched PVP/SVG/PNG identity, unsupported primitive, missing mapping, changed selected-page readback, and output-path input all reject before the Worker receives a command. Assert the happy path emits exactly attach/apply/save/read/close with stable request IDs.

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/current-page-visio-adapter.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/visio-universal-worker-client.test.ts
  ```

  Expected: test module and current-page adapter are missing.

- [ ] **Step 3: Implement minimal adapter and client transport.** Resolve only trusted server records; validate sealed envelope locally; serialize v3 commands to the Worker; validate all Worker responses against the original binding; map `waiting_for_selected_page` to a non-success state; and keep all v1/v2 execute methods separate.

- [ ] **Step 4: Run GREEN.** Re-run focused Vitest files and `npx tsc --noEmit`.

### Task 6: Integrate only formal snapshots and complete host acceptance

**Files:**
- Modify: `apps/api/src/generic-plan-snapshot-service.ts`
- Modify: `apps/api/src/publication-visual-plan-native-intent.ts`
- Modify: `apps/api/src/visio-job-runner.ts`
- Test: `apps/api/tests/generic-plan-snapshot-service.test.ts`
- Test: `apps/api/tests/publication-visual-plan-native-intent.test.ts`
- Test: `apps/api/tests/visio-job-runner.test.ts`
- Create: `docs/evidence/2026-08-24-current-page-visio-acceptance.md`

**Consumes:** completed v3 Worker and CurrentPageVisioAdapter.

**Produces:** a job path whose input is a trusted formal snapshot and whose output is independent selected-page readback and real-host evidence.

- [ ] **Step 1: Write failing integration tests.** Prove no candidate can mint a snapshot/Worker job, a formal revision produces exactly one sealed binding, job cancellation preserves a known-good region, a stale selected page fails closed, and the public job result contains only status and safe readback—not source/evidence/native controls.

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts apps/api/tests/visio-job-runner.test.ts
  ```

  Expected: current job path accepts legacy diagrams rather than a selected-page sealed snapshot.

- [ ] **Step 3: Implement formal-only integration.** Add no public direct endpoint for raw PVP. Require the trusted snapshot and exact review artifacts. Preserve legacy export route behavior but prevent it from selecting the v3 path.

- [ ] **Step 4: Run GREEN.** Run focused API tests, `npx tsc --noEmit`, `npm run api:check`, and Worker unit tests.

- [ ] **Step 5: Perform real-host acceptance.** Start Visio visibly, open a test VSDX, select an existing page containing a manual user shape, then dispatch the composite formal PVP. Capture binding, PVP/SVG/PNG identity where available, command transcript, independent COM readback, save/close/reopen proof, editability proof, user-shape preservation proof, Agent-owned replacement proof, cancellation/recovery result, and process cleanup result. Do not mark the task complete if the controlled PNG review prerequisite remains unavailable.

## Verification Matrix

Run the following before any commit:

```powershell
npx vitest run apps/api/tests/current-page-visio-adapter.test.ts apps/api/tests/visio-session-protocol.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/visio-universal-worker-client.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts apps/api/tests/visio-job-runner.test.ts
npx tsc --noEmit
npm run api:check
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --no-restore
git diff --check
```

The real-host gate remains separate: no unit test, SVG preview, Worker mock, or COM process launch is evidence that the selected page was updated correctly.
