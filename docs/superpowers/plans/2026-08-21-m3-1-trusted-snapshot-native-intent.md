# M3.1 Trusted Snapshot Native Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M3.1 native-intent boundary accept only a server-stored, owner/device/revision-bound `GenericPlanSnapshot`, rather than a caller-supplied `PublicationVisualPlan`.

**Architecture:** `PublicationVisualNativeIntentService` receives a snapshot locator and `GenericPlanSnapshotOwner`, resolves the immutable snapshot through `GenericPlanSnapshotStore`, checks that the returned snapshot still matches every requested identity field, and maps only its formal, trusted-QA-promoted PVP. The PVP-to-intent mapper becomes a module-private helper: no HTTP route, browser geometry, raw prompt/code, COM command, Worker command, document/page session, job, or export action is added. M3.2 remains blocked until this hardened node reaches its later acceptance gate.

**Tech Stack:** TypeScript ESM, existing `GenericPlanSnapshot`/store/service contracts, PVP parser and QA promotion contract, Vitest.

## Global Constraints

- The public M3.1 service input is exactly `{ owner, graphId, ugsRevision, snapshotId }`; it must not accept a PVP, PVP hash, browser geometry, raw source, prompt, sketch, page ID, document ID, path, COM control, Worker command, or export/job control.
- Snapshot resolution must be owner/device scoped through `GenericPlanSnapshotStore.get`; a missing, foreign, identity-mismatched, or structurally invalid record must fail before native intent creation.
- The resolved PVP must be formal, `qaStatus: "passed"`, have no blocking reasons, have a valid trusted-QA promotion binding, pass structural PVP QA, and retain the existing primitive/connector/capability/DU-coordinate allowlists.
- Native intents retain only the existing safe intent projection. `documentId` and `pageId` remain descriptive metadata and cannot be used as COM selectors in M3.1.
- Do not change legacy Visio routes, the v3 legacy figure export service, the v4 preview route, Worker protocol, or Visio COM code in this plan.
- Preserve the user-owned U3 rubric drafts outside this plan's explicit file list.

---

### Task 1: Prove that raw PVP input is no longer a trusted native-intent source

**Files:**

- Modify: `apps/api/tests/publication-visual-plan-native-intent.test.ts`
- Modify: `apps/api/src/publication-visual-plan-native-intent.ts`

**Consumes:** `GenericPlanSnapshotService`, `InMemoryGenericPlanSnapshotStore`, formal trusted-QA PVP fixtures.

**Produces:** A failing test that requests native intent by owner/device/graph/revision/snapshot ID and proves no public mapper API accepts an arbitrary PVP.

- [ ] **Step 1: Write failing service-contract tests.** Add a fixture that promotes a compiler-created PVP, persists it with `GenericPlanSnapshotService`, and calls:

```ts
const intent = await service.compile({
  owner,
  graphId: snapshot.graphId,
  ugsRevision: snapshot.ugsRevision,
  snapshotId: snapshot.snapshotId,
});
expect(intent.planId).toBe(snapshot.publicationVisualPlanId);
expect(intent.planHash).toBe(snapshot.publicationVisualPlanHash);
```

Add negative cases for a foreign device, wrong graph ID, wrong revision, unknown snapshot ID, and a store response whose identity does not match the locator. Each case must reject before returning an intent.

- [ ] **Step 2: Run the focused test to verify RED.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts`

Expected: FAIL because `PublicationVisualNativeIntentService` does not exist and the current exported mapper still accepts a raw PVP.

- [ ] **Step 3: Implement the minimum trusted-source service.** Export only:

```ts
export class PublicationVisualNativeIntentService {
  constructor(options: { snapshotStore: GenericPlanSnapshotStore }) {}
  async compile(input: {
    owner: GenericPlanSnapshotOwner;
    graphId: string;
    ugsRevision: number;
    snapshotId: string;
  }): Promise<PublicationVisualNativeIntent>;
}
```

Resolve with `snapshotStore.get(input.owner, input.graphId, input.ugsRevision, input.snapshotId)`. Reject null or any returned record whose `tenantId`, `userId`, `deviceId`, `graphId`, `ugsRevision`, or `snapshotId` differs from the locator. Keep the current pure mapping code private to this module and call it only with `snapshot.publicationVisualPlan`.

- [ ] **Step 4: Run the focused test to verify GREEN.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts`

Expected: all native-intent tests pass.

### Task 2: Make export-grade PVP eligibility executable in M3.1

**Files:**

- Modify: `apps/api/tests/publication-visual-plan-native-intent.test.ts`
- Modify: `apps/api/src/publication-visual-plan-native-intent.ts`

**Consumes:** The trusted Snapshot from Task 1 and the existing PVP QA-promotion contract.

**Produces:** Regression tests and validation that prove native intent cannot arise from pending, manually passed, capability-incomplete, or non-DU PVP data.

- [ ] **Step 1: Write failing rejection tests.** Test that snapshot-backed native intent rejects PVPs with each forbidden state:

```ts
expect(() => compileFromTrustedSnapshot(pendingSnapshot)).toThrow(/qaStatus|QA|promotion/i);
expect(() => compileFromTrustedSnapshot(manuallyPassedSnapshot)).toThrow(/promotion/i);
expect(() => compileFromTrustedSnapshot(capabilityMissingSnapshot)).toThrow(/capabilit/i);
expect(() => compileFromTrustedSnapshot(nonDuSnapshot)).toThrow(/coordinate/i);
```

The stored test doubles must return canonical snapshot-shaped values; mutation may only occur after persistence to prove the service reparses and rejects invalid data rather than trusting references.

- [ ] **Step 2: Run the focused test to verify RED.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts`

Expected: the pending/promotion tests fail against the current mapper behavior.

- [ ] **Step 3: Implement the minimum checks.** The private mapper must require `formal`, `qaStatus === "passed"`, zero blocking reasons, recomputed structural QA pass, exactly one valid trusted-QA promotion binding, required renderer capabilities, and the existing canonical PVP coordinate-space parser. Reuse the established promotion-validation logic; do not duplicate a second incompatible format.

- [ ] **Step 4: Run the focused test to verify GREEN.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts`

Expected: all positive and rejection tests pass.

### Task 3: Refresh truthful M3.1 governance without claiming M3.2 or real Visio

**Files:**

- Modify: `docs/superpowers/plans/2026-08-21-m3-1-pvp-native-intent.md`
- Modify: `docs/agent-program-state.json`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`
- Test: `apps/api/tests/agent-roadmap-cli.test.ts`

**Consumes:** The focused test evidence from Tasks 1–2 and the user-authorized Snapshot-as-trust-source decision.

**Produces:** A ledger that says M3.1 maps only store-resolved trusted snapshots, records the P1 correction, retains M3.2 as not implemented, and updates stale M2.8/M2.10 preview facts from commit `75dadb8` without claiming their owner acceptance.

- [ ] **Step 1: Write a failing roadmap assertion.** Require the generated status to state that M3.1's next action is independent acceptance of the trusted-snapshot mapper, while M3.2 remains non-executable until M2.5 and M3.1 are accepted.

- [ ] **Step 2: Run the roadmap test to verify RED.**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts`

Expected: FAIL because current ledger still describes raw PVP fixtures and stale adapter status.

- [ ] **Step 3: Update only the evidence records justified by this implementation.** Move M2.5 from `awaiting_acceptance` to `accepted` only because the owner authorized it in this task; add an operation-history record. Move M2.8/M2.10 to `awaiting_acceptance` with the committed source/test/plan evidence from `75dadb8`; do not mark them accepted. Keep M3.1 `active` until independent review of Tasks 1–2. Regenerate `docs/ROADMAP.md` through `npm run agent:render-roadmap`.

- [ ] **Step 4: Run the roadmap test to verify GREEN.**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts && npm run agent:verify-roadmap`

Expected: status and generated roadmap are consistent.

### Task 4: Run integrated verification and independent review

**Files:**

- Verify only the files from Tasks 1–3, plus the explicit U3 exclusions.

- [ ] **Step 1: Run focused native-intent and snapshot regression.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/agent-roadmap-cli.test.ts`

Expected: all focused tests pass.

- [ ] **Step 2: Run repository quality gates.**

Run: `npx tsc --noEmit`, `npm run api:test`, `npm run api:check`, and `git diff --check`.

Expected: every command exits 0. These checks do not prove Worker execution, COM, VSDX persistence, save/reopen, cancellation, or real-host acceptance.

- [ ] **Step 3: Independent review.** Verify that no public route imports the private raw-PVP mapper, no M3.2/Worker/COM code was added, and no user-owned U3 draft is staged or modified.
