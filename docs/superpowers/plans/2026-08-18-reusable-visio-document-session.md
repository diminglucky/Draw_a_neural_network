# Reusable Visio Document Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one Visio document and one page per owner/device/workflow and apply idempotent plan increments without creating duplicate documents or Shapes.

**Architecture:** Pure session identity/state/idempotency lives in `VisioWorker.Core`. An injected backend owns native document/page handles and is called serially from the existing COM STA runner. Core tests use a recording fake; the Live adapter uses allowlisted COM operations and the existing drawing routines. The one-shot render path remains available for legacy requests until the session path is explicitly selected.

**Tech Stack:** C#/.NET 8 Windows, xUnit, existing `ComStaRunner`, `VisioComEngine`, `PathPolicy`, and `DiagramDocument` model.

## Global Constraints

- A session key is exactly `(tenantId, userId, deviceId, workflowId)` and all identifiers are bounded allowlisted identifiers.
- One open session has exactly one native document and one page; `OpenOrReuse` never calls document creation for an already-open key.
- Every plan has a stable `PlanHash`; every operation has a stable `OperationId`; replay performs no backend mutation.
- COM is allowed only inside the Worker’s STA lifecycle; no shell, VBA, PowerShell, arbitrary COM method name, or browser/API direct COM path.
- Save uses a validated temporary path under `OutputRoot`, then an atomic final move; close and recovery are explicit and idempotent.
- Mock/fake tests prove session semantics only and cannot be reported as real Visio acceptance.

---

### Task 1: Define Core session model and RED tests

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Core/VisioSessionModel.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioSessionManagerTests.cs`

**Interfaces:**
- Produces `VisioSessionKey`, `VisioSessionState`, `VisioSessionOperation`, `VisioSessionSnapshot`, and `IVisioSessionBackend`.
- `IVisioSessionBackend` exposes `OpenOrCreateAsync`, `ApplyPlanAsync`, `SaveAsAsync`, `CloseAsync`, and `RecoverAsync` using an opaque backend document/page handle.

- [ ] **Step 1: Write RED tests** for identifier validation, one document/page after repeated open, `Created -> Open -> Dirty -> Saving -> Open`, stable replay result, and owner/workflow isolation.
- [ ] **Step 2: Run** `dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter FullyQualifiedName~VisioSessionManagerTests`; confirm the missing types fail the test build.
- [ ] **Step 3: Add** the immutable key/result records and backend interface with bounded plan/operation identity validation.
- [ ] **Step 4: Run** the focused test again and keep it red until the manager exists.

### Task 2: Implement Core manager with minimal recording backend

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Core/VisioSessionManager.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioSessionManagerTests.cs`

**Interfaces:**
- Produces `VisioSessionManager.OpenOrReuseAsync`, `ApplyPlanAsync`, `ApplyPlanDiffAsync`, `SaveAsAsync`, `CloseAsync`, and `RecoverAsync`.

- [ ] **Step 1: Extend RED tests** for duplicate plan/operation replay, changed plan application, explicit close, close idempotency, recovery state, and no cross-owner lookup.
- [ ] **Step 2: Run** the focused filter and confirm failures identify missing manager behavior rather than test setup errors.
- [ ] **Step 3: Implement** a per-key session dictionary, serialized per-session gate, applied identity maps, exact state transitions, backend delegation, and no-op replay results. Do not add any Visio-specific drawing code in Core.
- [ ] **Step 4: Run** the focused tests and then all Core tests; expected result is zero failures.

### Task 3: Add Live backend and session-aware engine entrypoints

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Live/VisioComSessionBackend.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioDocumentLifecycle.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionBackendTests.cs`

**Interfaces:**
- Produces a Live backend that opens/creates one document and page, applies the existing allowlisted `DiagramDocument` primitives by semantic ID, saves/reopens only during explicit recovery/readback, and closes only on explicit lifecycle calls.
- The engine exposes a session-based entrypoint that runs all backend calls through `ComStaRunner`; the existing one-shot `RenderAsync` behavior remains unchanged for legacy callers.

- [ ] **Step 1: Add RED adapter tests** using a backend recorder to assert that repeated session plans do not invoke document creation and that close is not called after every plan.
- [ ] **Step 2: Run** the Live/Core focused tests and observe failure.
- [ ] **Step 3: Implement** the adapter with fixed semantic names (`synapse.node.*`, `synapse.edge.*`, and plan primitive IDs), allowlisted path validation, and explicit `SaveAs`/`Close`/`Recover` calls. Keep dynamic COM references inside this adapter and release them on the STA thread.
- [ ] **Step 4: Run** `dotnet test workers/visio-worker/VisioWorker.sln --no-restore` and `dotnet build workers/visio-worker/VisioWorker.sln --no-restore -c Release`.

### Task 4: Protocol/lifecycle proof

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Host/WorkerProtocol.cs` only if a session operation is already represented by the sealed Worker request boundary.
- Modify: `workers/visio-worker/src/VisioWorker.Host/Program.cs` only if a session lifecycle flag is needed and can remain allowlisted.
- Modify: focused protocol tests only for the exact new fields.

- [ ] **Step 1:** Add a RED protocol test for stable session key and operation identity round-trip.
- [ ] **Step 2:** Implement strict JSON parsing with unknown-field rejection and no arbitrary backend/COM operation names.
- [ ] **Step 3:** Run protocol, Core, and Live tests plus `git diff --check`.
- [ ] **Step 4:** Record that actual Windows/Visio same-document multi-step, save, close/reopen, and native readback remain a separate host acceptance gate.
