# Analysis-Scoped PlanSnapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind a passing v3 figure analysis and deterministic publication plan to an immutable owner-scoped snapshot without reusing the legacy draft revision identity.

**Architecture:** Add a new analysis snapshot type/store/service beside the legacy `PlanSnapshot` APIs. Canonical JSON and SHA-256 define identity; the service accepts only `ready_for_preview` analysis records, validated publication plans, and passing visual QA. The output is cloned and recursively frozen, and the store keys every record by tenant/user/analysis/snapshot identity.

**Tech Stack:** TypeScript ESM, Node `crypto`, Vitest, existing `FigureAnalysisRecord`, `VisualQaResult`, and publication plan types.

## Global Constraints

- Work only in the `agent` worktree and preserve the two pre-existing untracked roadmap plan files.
- Do not modify the legacy `PlanSnapshot` contract or its tests except for imports shared by the new implementation.
- Candidate, failed, unresolved, or blocking-QA analysis cannot create a snapshot.
- The snapshot must not contain source bytes, provider data, evidence locators, worker paths, shell commands, or COM instructions.
- `insert` rejects duplicates and never overwrites; owner mismatch behaves as not found.
- Every production function added in this plan has a focused test written and observed failing first.

---

### Task 1: Define the immutable analysis snapshot contract

**Files:**
- Create: `apps/api/src/analysis-plan-snapshot.ts`
- Create: `apps/api/tests/analysis-plan-snapshot.test.ts`

**Interfaces:**
- Produces `AnalysisPlanSnapshot`, `CreateAnalysisPlanSnapshotInput`, `createAnalysisPlanSnapshot(input)`, and `canonicalJson(value)`.
- Input includes `tenantId`, `userId`, `analysisId`, `analysisStatus`, `architectureIrHash`, `figureIntentHash`, `publicationPlan`, `compilerManifest`, `visualQa`, `previewArtifactHashes`, and `createdAt`.
- Output includes `version: 1`, `snapshotId`, owner/analysis identity, canonical plan hash, cloned compiler/plan/QA/artifact data, `immutable: true`, and no source/evidence/provider fields.

- [ ] **Step 1: Write RED tests** for deterministic key ordering, ready-only creation, mutation isolation, deep freezing, valid hashes/IDs, and snapshot JSON not containing forbidden internal field names.
- [ ] **Step 2: Run** `npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts`; confirm failure because the module is absent.
- [ ] **Step 3: Implement** canonical JSON, strict validation, SHA-256 identity, structured cloning, and recursive freezing. Include all identity inputs in the hashed object, preserving publication-plan array order.
- [ ] **Step 4: Run** the focused test and confirm all tests pass; refactor only after green.

### Task 2: Add owner-scoped storage

**Files:**
- Create: `apps/api/src/analysis-plan-snapshot-store.ts`
- Create: `apps/api/tests/analysis-plan-snapshot-store.test.ts`

**Interfaces:**
- Produces `AnalysisPlanSnapshotOwner`, `AnalysisPlanSnapshotStore`, and `InMemoryAnalysisPlanSnapshotStore`.
- `insert(owner, snapshot): Promise<AnalysisPlanSnapshot>` rejects an existing owner/key.
- `get(owner, analysisId, snapshotId): Promise<AnalysisPlanSnapshot | null>` returns only the matching owner’s snapshot.

- [ ] **Step 1: Add RED tests** for insert/get, duplicate rejection, foreign tenant/user isolation, and returned-object mutation isolation.
- [ ] **Step 2: Run** `npx.cmd vitest run apps/api/tests/analysis-plan-snapshot-store.test.ts`; confirm expected missing-module failure.
- [ ] **Step 3: Implement** validated owner keys, cloned storage values, duplicate rejection, and null foreign lookup.
- [ ] **Step 4: Run** both new snapshot test files and the existing `plan-snapshot*.test.ts` files.

### Task 3: Bind FigureAnalysisRecord to snapshot creation

**Files:**
- Create: `apps/api/src/analysis-plan-snapshot-service.ts`
- Create: `apps/api/tests/analysis-plan-snapshot-service.test.ts`

**Interfaces:**
- Produces `AnalysisPlanSnapshotService` with `create(input)` and `get(owner, analysisId, snapshotId)`.
- `create` receives a `FigureAnalysisRecord`, a ready publication plan, compiler manifest, visual QA, artifacts, and timestamp; it returns the newly inserted immutable snapshot.

- [ ] **Step 1: Add RED service tests** proving candidate records never call the store, ready records create one snapshot, failed QA is rejected, and record owner/analysis identity is bound into the result.
- [ ] **Step 2: Run** the focused service test and observe the intended failure.
- [ ] **Step 3: Implement** fail-closed status/IR checks, derive the architecture hash from the supplied validated IR identity, delegate construction to `createAnalysisPlanSnapshot`, and insert only after all checks pass.
- [ ] **Step 4: Run** all three new test files and `npm.cmd run api:check`.

### Task 4: Integration verification

**Files:**
- Modify: `apps/api/src/figure-analysis-preview-service.ts` only if the existing preview response needs a typed snapshot handoff; preserve the public projection shape.
- Modify: `docs/ROADMAP.md` and `docs/agent-program-state.json` only in the later roadmap bookkeeping commit.

- [ ] **Step 1:** Run `npx.cmd vitest run apps/api/tests/analysis-plan-snapshot*.test.ts apps/api/tests/plan-snapshot*.test.ts`.
- [ ] **Step 2:** Run `npx.cmd tsc --noEmit` and `npm.cmd run api:check`.
- [ ] **Step 3:** Inspect `git diff --check` and confirm no source/provider/worker/path/command field crosses the new snapshot boundary.
