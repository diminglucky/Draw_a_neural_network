# PVP-Backed Immutable Snapshot Rebaseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the immutable generic PlanSnapshot bind one server-validated, QA-passed `PublicationVisualPlan`, not the legacy `GeneralPublicationFigurePlan` metadata.

**Architecture:** The Snapshot service receives only server-side objects, reparses the UGS and PVP, recomposes the GPG, verifies all derived hashes and PVP lineage/update identity, then writes an owner/device/revision-scoped immutable clone of the exact PVP. The in-memory store derives its key from the canonical reconstructed Snapshot and returns clone-isolated values. Snapshot creation rejects candidate, clarification-by-absence, feedback, QA-pending, forged lineage and hostile accessor inputs before any store write.

**Tech Stack:** TypeScript ESM, Node SHA-256, Vitest, existing UGS/GPG/PVP canonical parsers, in-memory snapshot store.

## Global Constraints

- The new Snapshot input and persisted object use only `UGS → GPG → PVP`; do not import or reference legacy Figure Plan, VGG, analysis Snapshot, Worker DTO, browser SVG, source bytes, evidence locator, provider data, command or COM data.
- A Snapshot is created only for `pvp.eligibility.kind === "formal"` and `qaStatus === "passed"`; candidate, feedback, missing PVP and QA-pending plans perform zero writes.
- Snapshot identity binds tenant/user/device, graph ID, UGS revision, UGS hash, GPG hash, PVP plan ID/hash and canonical sorted source hashes. It deliberately excludes immutable `createdAt` audit metadata.
- The stored `publicationVisualPlan` is parsed, cloned and deep frozen. Its `identity.canonicalHash`, lineage and update identity must agree with the independently recomposed server objects and owner/device/revision.
- The preview route may return a formal PVP with `qaStatus: "pending"`, but `exportEligible` is true only when the PVP is formal **and** QA-passed. This slice still creates no export job, Worker call, Visio document or API snapshot route.
- Preserve other dirty worktree files; no commit or push without a fresh explicit request.

---

## File Map

| File | Responsibility |
|---|---|
| `apps/api/src/generic-plan-snapshot.ts` | PVP-backed snapshot identity, persistence DTO, canonical clone/freeze helpers. |
| `apps/api/src/generic-plan-snapshot-store.ts` | Insert-only canonical PVP Snapshot persistence and owner/device reads. |
| `apps/api/src/generic-plan-snapshot-service.ts` | Server-only UGS/GPG/PVP recomposition, eligibility and provenance gate. |
| `apps/api/src/publication-visual-preview-service.ts` | Preview-only export eligibility derived from both formal kind and QA status. |
| `apps/api/tests/generic-plan-snapshot.test.ts` | Deterministic PVP binding/immutability and no-legacy-field evidence. |
| `apps/api/tests/generic-plan-snapshot-store.test.ts` | Canonical insert, owner isolation, conflict, hostile accessor and clone proof. |
| `apps/api/tests/generic-plan-snapshot-service.test.ts` | Formal-passed success plus zero-write candidate/pending/forged/feedback cases. |
| `apps/api/tests/publication-visual-preview-service.test.ts` | Formal-pending preview stays non-exportable. |
| `docs/superpowers/plans/2026-08-20-m2-5-generic-immutable-plan-snapshot.md` | Mark the legacy Figure Plan proposal superseded by this PVP rebaseline. |

## Public Interfaces

```ts
export interface CreateGenericPlanSnapshotInput extends GenericPlanSnapshotOwner {
  graphId: string;
  ugsRevision: number;
  ugsCanonicalHash: string;
  generalPublicationGraphHash: string;
  publicationVisualPlan: PublicationVisualPlan;
  createdAt: string;
}

export interface GenericPlanSnapshot extends Readonly<GenericPlanSnapshotOwner> {
  readonly version: 2;
  readonly snapshotId: string;
  readonly graphId: string;
  readonly ugsRevision: number;
  readonly ugsCanonicalHash: string;
  readonly generalPublicationGraphHash: string;
  readonly publicationVisualPlanId: string;
  readonly publicationVisualPlanHash: string;
  readonly sourceHashes: readonly string[];
  readonly publicationVisualPlan: PublicationVisualPlan;
  readonly createdAt: string;
  readonly immutable: true;
}

export class GenericPlanSnapshotService {
  create(input: {
    owner: GenericPlanSnapshotOwner;
    ugsRevision: number;
    ugs: unknown;
    graph: GeneralPublicationGraph;
    publicationVisualPlan: unknown;
    createdAt: string;
  }): Promise<GenericPlanSnapshot>;
}
```

---

### Task 1: Rebase Snapshot identity and store on PVP

**Files:**
- Modify: `apps/api/src/generic-plan-snapshot.ts`
- Modify: `apps/api/src/generic-plan-snapshot-store.ts`
- Modify: `apps/api/tests/generic-plan-snapshot.test.ts`
- Modify: `apps/api/tests/generic-plan-snapshot-store.test.ts`

**Consumes:** `parsePublicationVisualPlan` and canonical PVP identity.

**Produces:** version-2 immutable Snapshot DTO that persists a deep-frozen PVP and no Figure Plan field.

- [ ] **Step 1: Write failing Snapshot/store tests.** Replace `generalPublicationFigurePlanHash` fixtures with a valid QA-passed PVP fixture. Assert source hashes are derived from the PVP lineage, PVP ID/hash change Snapshot identity, a legacy Figure Plan field is rejected/absent, and a hostile PVP accessor cannot change the persisted key/value.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts`

Expected: failing assertions because Snapshot v1 stores `generalPublicationFigurePlanHash` and contains no PVP.

- [ ] **Step 3: Implement PVP-backed canonical Snapshot.** Parse and clone the PVP before reading identity/lineage; derive `publicationVisualPlanId`, `publicationVisualPlanHash`, and sorted source hashes internally. Use a version-2 identity projection, deep-freeze the clone, reconstruct a canonical PVP-backed object in the store, and derive the storage key from that trusted reconstruction.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts && npx tsc --noEmit`

Expected: all Snapshot/store tests and TypeScript pass.

### Task 2: Server-only UGS/GPG/PVP Snapshot gate

**Files:**
- Create: `apps/api/src/generic-plan-snapshot-service.ts`
- Create: `apps/api/tests/generic-plan-snapshot-service.test.ts`

**Consumes:** Task 1 DTO/store; `parseUniversalGraphSpec`, `composeGeneralPublicationGraph`, `parsePublicationVisualPlan`, canonical hash helpers.

**Produces:** a service that permits only a canonical formal, QA-passed PVP aligned to the caller owner/device/revision and does zero writes on rejection.

- [ ] **Step 1: Write failing service tests.** Build a valid unknown dual-stream UGS/GPG/PVP fixture whose PVP is recreated as formal/QA-passed. Assert one successful immutable write. Add cases for candidate, formal-pending, feedback, forged GPG hash, forged PVP lineage, owner/device/revision mismatch, and hostile PVP input; each rejection must leave `store.get(...)` null.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts`

Expected: module resolution failure because the service does not exist.

- [ ] **Step 3: Implement the closed gate.** Parse UGS; recompute GPG for its detail and compare canonical digests; parse a detached PVP clone; reject non-formal, QA-pending, blocking or feedback plans; require PVP UGS/GPG/source hashes plus update owner/device/revision to match independently trusted inputs; then create and insert the PVP Snapshot.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts`

Expected: all Snapshot gate tests pass, including zero-write rejection assertions.

### Task 3: Preview/export eligibility repair and stale-plan retirement

**Files:**
- Modify: `apps/api/src/publication-visual-preview-service.ts`
- Modify: `apps/api/tests/publication-visual-preview-service.test.ts`
- Modify: `docs/superpowers/plans/2026-08-20-m2-5-generic-immutable-plan-snapshot.md`

**Consumes:** Task 2 formal-passed eligibility boundary.

**Produces:** formal-pending PVP remains previewable but cannot claim export eligibility; the old Figure Plan Snapshot plan is explicitly superseded.

- [ ] **Step 1: Write failing eligibility test.** Assert formal PVP with `qaStatus: "pending"` returns `kind: "formal", exportEligible: false`; candidate remains false.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/publication-visual-preview-service.test.ts`

Expected: the current preview service reports `exportEligible: true` for formal-pending output.

- [ ] **Step 3: Implement minimal eligibility rule.** Use `pvp.eligibility.kind === "formal" && pvp.eligibility.qaStatus === "passed"`; keep this slice preview-only and do not introduce an export route. Add a visible superseded header to the old M2.5 Figure Plan plan pointing to this document.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/publication-visual-preview-service.test.ts apps/api/tests/figure-draft-preview-routes.test.ts`

Expected: preview and owner/revision-route tests pass without creating Snapshots or jobs.

### Task 4: Cross-layer verification and plan self-review

**Files:**
- Modify only Task 1–3 files if verification exposes a direct contract defect.

- [ ] **Step 1: Run focused PVP/Snapshot matrix.**

Run: `npx vitest run apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-preview-service.test.ts apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/figure-draft-preview-routes.test.ts`

Expected: all PVP, eligibility, Snapshot and route contract tests pass.

- [ ] **Step 2: Run repository verification.**

Run: `npx tsc --noEmit && npm run api:test && npm run api:check && git diff --check -- apps/api/src/generic-plan-snapshot.ts apps/api/src/generic-plan-snapshot-store.ts apps/api/src/generic-plan-snapshot-service.ts apps/api/src/publication-visual-preview-service.ts apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/publication-visual-preview-service.test.ts docs/superpowers/plans/2026-08-20-m2-5-generic-immutable-plan-snapshot.md docs/superpowers/plans/2026-08-20-m2-5-pvp-snapshot-rebaseline.md`

Expected: every command exits 0. This proves snapshot and preview contracts only; it does not prove export, Visio, save/reopen or visual-rubric acceptance.

## Plan Self-Review

- Task 1 replaces the legacy Figure Plan snapshot binding with exact PVP identity and immutable cloned PVP content.
- Task 2 prevents untrusted/future caller PVPs from bypassing the canonical UGS/GPG lineage, eligibility or owner/device/revision checks.
- Task 3 removes the premature `formal + pending = exportEligible` contradiction and preserves preview-only scope.
- No task adds a Snapshot HTTP route, export job, Worker execution, Visio action, Presentation Profile, code analyzer expansion or sketch processing.
