# Visible, Persistent Visio Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Worker-created Visio sessions safely observable by users and reliably clean up only the exact automation process they own.

**Architecture:** Introduce a small owned-application lease that maps `WindowHandle32` to an OS PID on the single COM STA.  Existing session operations retain visible documents and same-page reconciliation; the lease adds a bounded, identity-checked exit fallback only for Worker-created applications.

**Tech Stack:** .NET 8 Windows, Visio COM, `user32.dll` `GetWindowThreadProcessId`, xUnit, existing `ComStaRunner`.

## Global Constraints

- Preserve protocol v1 and v2 command contracts.
- `Visible=true` retains the original VSDX/Page after drawing; `Visible=false` remains headless.
- Never expose an unrestricted COM, Shell, VBA, or process-control endpoint.
- Never terminate an attached (`AttachToRunning=true`) or unverified Visio process.
- Capture process identity while COM application ownership is established; do not infer it by scanning process names later.
- Preserve the user-owned untracked plan drafts and all failed live-test evidence directories.

---

### Task 1: Owned Visio application lease and unit proofs

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Live/OwnedVisioApplicationLease.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionOperationsTests.cs`

**Interfaces:**
- Produce an internal lease that holds the verified process ID, process start time, and ownership flag.
- Produce an injectable process/window adapter so tests never start or stop real processes.
- Consume the existing `AttachToRunning` decision from `VisioComEngine.ConnectVisio`.

- [ ] **Step 1: Write failing lease tests.**

Add focused tests that require an owned application with a nonzero `WindowHandle32` to resolve one PID and that require attached/unresolved applications to have no lease.  Add a failure test showing a mismatched executable name or start time cannot be terminated.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~VisioComSessionOperationsTests`

Expected: FAIL because the lease abstraction and lifecycle hooks do not yet exist.

- [ ] **Step 3: Implement the minimal lease.**

Add a typed `GetWindowThreadProcessId` interop adapter.  Capture the window handle and Windows PID immediately after Worker creation, record the start time and executable name, and make lease creation fail closed when the information cannot be verified.  Do not use `Application.ProcessID`.

- [ ] **Step 4: Run GREEN tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~VisioComSessionOperationsTests`

Expected: PASS with no installed Visio required.

### Task 2: Lifecycle integration and visible-session contract

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/OwnedVisioApplicationLease.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComSessionOperations.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComSessionBackend.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionBackendTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionOperationsTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs`

**Interfaces:**
- Consume Task 1 lease via `VisioComSessionNative`.
- Preserve `IVisioComSessionOperations` command surface and the one-STA serialization guarantee.
- Produce deterministic disposal: attached sessions release only their own RCWs; owned sessions wait for their recorded process and use a final exact-PID fallback only after `Quit` times out.

- [ ] **Step 1: Write failing visible/ownership lifecycle tests.**

Test that visible mode closes nothing after `apply`/`applyDiff`, keeps one document handle/page identity, and only closes on explicit close.  Test that hidden owned mode calls the lease exit path during disposal, while attached mode never does.  Test that a failed exact-PID fallback surfaces a `WorkerProtocolException` without clearing ownership evidence.

Also add the regression discovered in Task 1 review: a Worker-created application whose window/PID/identity lease cannot be verified must not call `Application.Quit()` or exact-PID termination.  The session-native owner must retain the lease created at connection time; `GC.KeepAlive` is not an ownership handoff.

- [ ] **Step 2: Run RED tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~VisioComSessionBackendTests|FullyQualifiedName~DiagramMapperTests"`

Expected: FAIL because current disposal only calls COM `Quit`.

- [ ] **Step 3: Implement lifecycle order.**

Keep document/page close and RCW release on the STA.  Retain the lease created by `ConnectVisio` in the one-shot and long-lived native lifecycle owner.  Every `Application.Quit()` call must first require a non-null lease and a fresh `MatchesCurrentProcess` check; no lease means a fail-closed lifecycle error, not a guessed cleanup.  After a lease-gated `Quit`, wait a bounded time; only a still-matching owned `VISIO.EXE` with the same start identity can receive the exact process termination fallback.  Do not invoke cleanup while a visible session remains active; explicit `close` and final disposal are the only close boundaries.  `AttachToRunning=true` never receives a lease, quit request, wait, or termination fallback.

- [ ] **Step 4: Run GREEN tests.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~VisioComSessionBackendTests|FullyQualifiedName~DiagramMapperTests"`

Expected: PASS.

### Task 3: Installed-Visio hidden and visible acceptance

**Files:**
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionLiveAcceptanceTests.cs`
- Modify: `docs/superpowers/specs/2026-08-19-visible-visio-session-design.md`

**Interfaces:**
- Consume Task 2 lifecycle via the real `VisioComEngine` and `LongLivedWorkerRuntime`.
- Retain the `SYNAPSE_ENABLE_LIVE_VISIO_ACCEPTANCE=1` default-off gate.

- [ ] **Step 1: Write failing live acceptance assertions.**

Split the live assertions into hidden recovery and visible session paths.  Visible acceptance must wait for a nonzero `WindowHandle32`, assert the same VSDX/path/page identity after `applyDiff`, and assert that the document remains open before explicit close.  Both tests must assert zero owned process after their own explicit cleanup; they must reject a pre-existing Visio process instead of touching it.

- [ ] **Step 2: Run RED live test.**

Run: `$env:SYNAPSE_ENABLE_LIVE_VISIO_ACCEPTANCE='1'; dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~VisioComSessionLiveAcceptanceTests --logger 'console;verbosity=normal'`

Expected: current lifecycle cannot satisfy the zero-owned-process assertion.

- [ ] **Step 3: Run GREEN live test and read artifacts independently.**

Run the same command after Tasks 1–2.  Inspect the produced VSDX before cleanup using a separate COM reader; verify user shape preservation, one semantic classifier node/label/connector, correct Shape Data, and absence of superseded Agent shapes.

- [ ] **Step 4: Record factual evidence.**

Append only command output, artifact path, document/page identity, and process-cleanup result to the design spec.  Do not record source documents, user code, absolute personal paths, or a claim that API/UI integration exists.

### Task 4: Release gates and independent review

**Files:**
- Modify: `.superpowers/sdd/long-lived-visio-worker-progress.md`
- Modify: `.superpowers/sdd/task-5-report.md`

- [ ] **Step 1: Run complete Worker suite.**

Run: `dotnet test workers/visio-worker/VisioWorker.sln --no-restore`

Expected: zero failures; only the installed-Visio test skips when its environment gate is absent.

- [ ] **Step 2: Run Release build and whitespace validation.**

Run: `dotnet build workers/visio-worker/VisioWorker.sln --no-restore -c Release` and `git diff --check`.

Expected: zero warnings, zero errors, and no whitespace errors.

- [ ] **Step 3: Independent review and narrow commit.**

Review from base `ff88424` through the final Task 5 commit for process ownership, visible document retention, same-page behavior, and no process-name-wide termination.  Stage only the exact Task 5 implementation/tests/spec/evidence allowlist; leave both user-owned untracked plan files unstaged.  Do not push without explicit user authorization.
