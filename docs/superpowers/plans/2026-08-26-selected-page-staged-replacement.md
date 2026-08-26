# Selected-Page Staged Owned-Region Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the previous Agent-owned Visio region until an exactly identified replacement is completely tagged, source-mapped, promoted, target-revalidated, and followed by an observable exact-ID cleanup.

**Architecture:** Keep the pure replacement coordinator but replace page-wide before/after ID inference with an operation-scoped creation journal populated by the renderer from each native shape returned by Visio. The live adapter revalidates the active target before destructive cleanup and returns a structured exact-ID deletion outcome. Process-termination recovery remains a separately stated future boundary.

**Tech Stack:** C#/.NET 8, xUnit, Visio COM dynamic interop, existing selected-page prepared-region boundary.

## Global Constraints

- Do not change browser/API/Worker JSON, PVP, native-intent, save, or readback schemas.
- Do not create/open/resize/close a Visio document or page and do not use `SaveAs`.
- Do not delete old final-owned shape IDs until every new shape has verified staging ownership, non-empty source mapping, and verified final ownership.
- Cleanup after pre-promotion failure may delete only shape IDs explicitly recorded by the current renderer invocation.
- A page-wide Shape ID difference must never be used as creation-ownership evidence.
- Final cleanup must delete the captured old shape IDs, never all shapes carrying the final namespace.
- A final old-shape cleanup failure retains the promoted replacement and reports failure; it must not erase the new region.
- The active selected-page target must be re-read and verified immediately before old-shape deletion.
- Exact-ID deletion must report requested, deleted, missing, and failed IDs.
- Staged replacement does not claim process-crash recovery, save/readback rollback, or real-host acceptance; no retry-after-process-termination claim is permitted.

---

### Task 1: Replace page-wide ID inference with an operation-scoped creation journal

**Files:**
- Create: `workers/visio-worker/src/VisioWorker.Live/SelectedPageOwnedRegionReplacement.cs`
- Create: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageOwnedRegionReplacementTests.cs`

**Interfaces:**
- Produces: internal `SelectedPageShapeCreationJournal` with `Record(int shapeId)` and immutable `ShapeIds`.
- Changes: `ISelectedPageShapeMutation.DrawPrepared(PreparedSelectedPageRegion, SelectedPageShapeCreationJournal)`.
- Preserves: `SelectedPageOwnedRegionReplacement.Execute(mutation, preparedRegion, finalNamespace, stagingNamespace)`.

- [x] **Step 1: Write failing state-machine tests.** Change the in-memory fake so `DrawPrepared` records exact created IDs into the supplied journal. Insert external ID `40` during drawing without recording it and assert that staging, promotion, and cleanup never receive `40`. Retain draw failure, staging failure, promotion failure, zero-created-shape, and old-cleanup failure cases.

- [x] **Step 2: Run the focused test and verify RED.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageOwnedRegionReplacementTests
```

Expected: compilation fails because `SelectedPageShapeCreationJournal` and the revised `DrawPrepared` signature do not exist.

- [x] **Step 3: Implement the minimal coordinator.** Keep orchestration pure. Pass a fresh journal into `DrawPrepared`; use only `journal.ShapeIds` for zero-shape validation, staging, promotion, and failure cleanup. Remove `ReadShapeIds` from the mutation interface and remove all page-wide set-difference ownership logic.

- [x] **Step 4: Run the focused test and verify GREEN.** Run the Task 1 command and require all replacement-state tests to pass.

### Task 2: Make native drawing report exact renderer-created IDs

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs`

**Interfaces:**
- Consumes: the pure creation journal contract and target-bound `PreparedSelectedPageRegion`.
- Produces: `VisioComEngine.DrawPreparedSelectedPageRegion(page, preparedRegion, onShapeCreated)` where every native shape creation invokes `onShapeCreated(shapeId)` immediately after the COM creation call returns and before styling or later fallible work.

- [x] **Step 1: Write failing rendering contract assertions.** Assert the prepared draw helper requires a creation callback and that every supported node visual, label, auxiliary plane, annotation and connector creation path reports its returned Shape ID. Add a backend contract assertion that the native adapter no longer exposes page-wide `ReadShapeIds` ownership inference.

- [x] **Step 2: Run selected-page backend tests and verify RED.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageVisioComBackendTests
```

Expected: failure because the current prepared draw helper discards created Shape IDs and the mutation interface still reads page-wide IDs.

- [x] **Step 3: Implement exact creation reporting.** Thread one internal creation callback through `ConfigureAndDraw` and all shape-producing helpers. Invoke it immediately after each `DrawRectangle`, `DrawLine`, bezier/connector creation, label creation, auxiliary plane creation, and other native creation call. The selected-page adapter records those IDs in the journal; no page-wide diff remains.

- [x] **Step 4: Run replacement, backend, rendering, session, and readback tests.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~SelectedPageOwnedRegionReplacementTests|FullyQualifiedName~SelectedPageVisioComBackendTests|FullyQualifiedName~SelectedPageRenderingContractTests|FullyQualifiedName~SelectedPageSessionManagerTests|FullyQualifiedName~SelectedPageWorkerReadbackContractTests"
```

Expected: all focused tests pass.

### Task 3: Revalidate the active target and expose partial cleanup state

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageOwnedRegionReplacement.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageOwnedRegionReplacementTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`

**Interfaces:**
- Produces: internal `SelectedPageShapeDeletionOutcome` with immutable `RequestedShapeIds`, `DeletedShapeIds`, `MissingShapeIds`, and `FailedShapeIds`.
- Adds: `ISelectedPageShapeMutation.RevalidateActiveTarget(SelectedPageTarget target)`.
- Changes: `ISelectedPageShapeMutation.DeleteShapes(...)` returns `SelectedPageShapeDeletionOutcome`.

- [x] **Step 1: Write failing coordinator tests.** Add a target-switch case that succeeds through promotion, fails revalidation, does not request old-ID deletion, and retains both regions. Add a partial old-cleanup case that deletes ID `10`, fails ID `11`, retains the promoted IDs, and exposes all four deletion sets with `replacementPromoted=true`.

- [x] **Step 2: Run replacement tests and verify RED.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter FullyQualifiedName~SelectedPageOwnedRegionReplacementTests
```

Expected: compilation fails because target revalidation and structured deletion outcomes do not exist.

- [x] **Step 3: Implement target revalidation and deletion outcomes.** Re-read the active Visio application/window/document/page and compare the complete target immediately before old cleanup. Delete exact IDs independently, continue after per-shape deletion failures, classify missing IDs as already absent, and raise a typed internal `WorkerProtocolException` carrying the structured outcome when failures remain.

- [x] **Step 4: Run the focused selected-page matrix and verify GREEN.**

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~SelectedPageOwnedRegionReplacementTests|FullyQualifiedName~SelectedPageVisioComBackendTests|FullyQualifiedName~SelectedPageRenderingContractTests|FullyQualifiedName~SelectedPageSessionManagerTests|FullyQualifiedName~SelectedPageWorkerReadbackContractTests"
```

Expected: all focused tests pass, including external insertion, target switch, and partial deletion.

### Task 4: Verify, review, record, and commit

**Files:**
- Modify: `docs/agent-governance/implementation-records/operation-history.md`
- Modify: `docs/superpowers/plans/2026-08-26-selected-page-staged-replacement.md`

**Interfaces:**
- Consumes: the completed staged replacement implementation.
- Produces: exact evidence and residual-risk documentation.

- [x] **Step 1: Run complete verification.**

```powershell
dotnet test workers/visio-worker/VisioWorker.sln -c Release
dotnet build workers/visio-worker/VisioWorker.sln -c Release --no-restore
npx.cmd tsc --noEmit
npm.cmd run api:check
git diff --check
```

- [x] **Step 2: Request independent review.** Require explicit review of renderer-owned exact IDs, external Shape insertion, pre-promotion cleanup, target revalidation, structured partial deletion, namespace isolation, and truthful process-crash exclusions.

- [x] **Step 3: Record evidence and boundaries.** Append RED/GREEN results, final test counts, review result, and the remaining process-crash/save/readback/real-host limitations to operation history. Explicitly state that no retry-after-process-termination guarantee exists.

- [x] **Step 4: Commit the narrow documentation record.** Stage only the plan and operation history. Commit as:

```text
docs: record staged selected-page replacement
```
