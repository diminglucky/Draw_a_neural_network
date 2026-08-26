# Selected-Page Preflight-Before-Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure selected-page fit and readability validation succeeds before the Worker can delete the previous Agent-owned Visio region.

**Architecture:** Split the live selected-page operation into an internal prepare phase and an apply phase. Preparation reads the actual attached page, produces a deterministic fitted `DiagramDocument`, and binds it to the exact `SelectedPageTarget`; apply accepts only that prepared value, revalidates the target, then performs the existing namespace-scoped replacement and tagging.

**Tech Stack:** C#/.NET 8, xUnit, Visio COM dynamic interop, existing `DiagramDocument` and `SelectedPageTarget` contracts.

## Global Constraints

- Do not change the selected-page JSON protocol, TypeScript adapter, PVP, native intent, or public API.
- Do not create/open a document or page, resize the selected page, call `SaveAs`, close the user's document, or quit the user's Visio application.
- Preparation is read-only with respect to shapes and may perform only page-metric reads plus deterministic affine fitting.
- An invalid figure plan, invalid page metric, invalid content bounds, unreadable fit, or mismatched prepared target must fail before namespace deletion.
- Preserve user shapes and shapes belonging to any other ownership namespace.
- Do not claim rollback for failures occurring after mutation begins; staged replacement is a later slice.

---

### Task 1: Define and prove the two-phase operations contract

**Files:**
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioWorker.Live.csproj`

**Interfaces:**
- Produces: `PreparedSelectedPageRegion(SelectedPageTarget Target, DiagramDocument Plan)`.
- Produces: `ISelectedPageVisioComOperations.PrepareOwnedRegion(target, plan)` and an `ApplyOwnedRegion(target, ownershipNamespace, preparedRegion)` that cannot receive an unprepared plan.

- [x] **Step 1: Write the failing backend tests.** Record operation names and assert the successful sequence is `prepare`, then `apply`. Add a preparation failure that throws a `WorkerProtocolException` and assert `ApplyOwnedRegionCalls == 0`. Add a mismatched prepared target case and assert apply is not entered.

- [x] **Step 2: Run the focused test and verify RED.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageVisioComBackendTests
```

Expected: compilation fails because `PreparedSelectedPageRegion` and the prepare/apply signatures do not exist.

- [x] **Step 3: Implement the minimal orchestration contract.** Add the immutable prepared-region record. Inside the existing STA callback, revalidate the active target, prepare the plan, reject a returned target mismatch, re-read the active target after preparation, and only then call apply. Keep the operations interface and prepared token internal; expose internals only to the Worker test assembly.

- [x] **Step 4: Run the focused backend tests and verify GREEN.** Run the Task 1 command and require all selected-page backend tests to pass.

### Task 2: Split native fit from native mutation

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs`

**Interfaces:**
- Produces: `VisioComEngine.PrepareSelectedPageRegion(page, document) -> DiagramDocument`.
- Produces: `VisioComEngine.DrawPreparedSelectedPageRegion(page, preparedDocument) -> void`.
- Consumes: only a prepared target-bound document in `SelectedPageVisioComNative.ApplyOwnedRegion`.

- [x] **Step 1: Write failing engine-contract tests.** Replace the old combined-method reflection test with tests proving preparation rejects a legacy document, actual page metrics cannot fall back to the source plan, the prepared token has no public constructor, and prepared drawing accepts only that token. Keep the existing deterministic fitting and readability tests unchanged.

- [x] **Step 2: Run the rendering-contract test and verify RED.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageRenderingContractTests
```

Expected: failure because the two new engine methods do not exist.

- [x] **Step 3: Implement the split.** Move strict real-page metric reads and `FitSelectedPageDocument` into `PrepareSelectedPageRegion`. Make `DrawPreparedSelectedPageRegion` accept only `PreparedSelectedPageRegion` and call `ConfigureAndDraw(..., resizePage: false)` without fitting again. In native operations, call prepare before `DeleteOwnedShapes`; use only the prepared plan for drawing and source-mapping tags.

- [x] **Step 4: Run both focused classes and verify GREEN.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~SelectedPageVisioComBackendTests|FullyQualifiedName~SelectedPageRenderingContractTests"
```

Expected: all focused tests pass.

### Task 3: Verify and record the exact safety boundary

**Files:**
- Modify: `docs/agent-governance/implementation-records/operation-history.md`
- Modify: `docs/superpowers/plans/2026-08-26-selected-page-preflight-before-mutation.md`

**Interfaces:**
- Consumes: the completed two-phase Worker implementation.
- Produces: reproducible verification evidence and explicit residual-risk documentation.

- [x] **Step 1: Run Worker and repository verification.**

```powershell
dotnet test workers/visio-worker/VisioWorker.sln -c Release
dotnet build workers/visio-worker/VisioWorker.sln -c Release --no-restore
npx.cmd tsc --noEmit
npm.cmd run api:check
git diff --check
```

Expected: every command exits `0`; if an unrelated baseline fails, record the exact file/test and do not relabel the suite as passing.

- [x] **Step 2: Append implementation evidence.** Record the RED compilation failure, final test counts, target-bound prepare/apply sequence, preserved protocol boundary, and the remaining lack of post-mutation rollback and real-host evidence.

- [x] **Step 3: Review the final diff.** Confirm only the design, plan, two Worker source files, two Worker test files, one Worker project file, and operation history are included.

- [x] **Step 4: Commit the narrow implementation.**

```powershell
git add -- workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs workers/visio-worker/src/VisioWorker.Live/VisioWorker.Live.csproj workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs docs/superpowers/plans/2026-08-26-selected-page-preflight-before-mutation.md docs/agent-governance/implementation-records/operation-history.md
git commit -m "fix: preflight selected-page drawing before mutation"
```
