# M2.5 Generic Immutable PlanSnapshot Implementation Plan

> **Superseded:** This proposal bound the deprecated `GeneralPublicationFigurePlan`. Use [2026-08-20-m2-5-pvp-snapshot-rebaseline.md](2026-08-20-m2-5-pvp-snapshot-rebaseline.md), which binds the canonical QA-passed `PublicationVisualPlan` required by the active UGS → GPG → PVP architecture.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the exact validated `UniversalGraphSpec → GeneralPublicationGraph → GeneralPublicationFigurePlan` projection to an owner/device/revision-scoped, insert-only generic PlanSnapshot.

**Architecture:** M2.5 adds new generic files and never adapts `PlanSnapshot` or `AnalysisPlanSnapshot`. The service parses the UGS, recomposes/verifies the graph and Figure Plan, derives all digests server-side, then persists immutable metadata through an owner/device-scoped insert-only store.

**Tech Stack:** TypeScript 5.9, Node SHA-256, Vitest 3, UGS/Figure Plan validation.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `agent`; never modify the root `main` checkout.
- Do not import legacy analysis/VGG DTOs, ArchitectureIR, FigureIntent, composable-DAG plans, preview artifacts, Worker DTOs, or Visio code.
- DTOs must contain no raw source, evidence locator, provider payload, browser directive, Worker path, command, COM instruction, SVG, or Visio field.
- Candidate/blocking topology, feedback, forged graph, forged Figure Plan, and wrong Figure Plan source-graph hash fail closed before persistence.
- SHA-256 identity binds tenant/user/device, graph ID, UGS revision, UGS/graph/plan hashes, and canonical sorted source hashes. `createdAt` is immutable audit metadata but does not change `snapshotId`.
- Persistence is insert-only. Duplicate identity gives a typed conflict; a foreign owner/device sees `null`; every return is deep-cloned and deep-frozen.
- M2.5 adds no route, preview artifact, export job, Worker invocation, or Visio operation.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/generic-plan-snapshot.ts` | Metadata contract, canonical JSON/digest, deterministic identity, validation, cloning/freezing. |
| `apps/api/src/generic-plan-snapshot-store.ts` | Owner/device-scoped insert-only store. |
| `apps/api/src/generic-plan-snapshot-service.ts` | Canonical UGS/graph/Figure Plan verification before persistence. |
| `apps/api/tests/generic-plan-snapshot.test.ts` | Identity, validation, immutability and DTO-boundary tests. |
| `apps/api/tests/generic-plan-snapshot-store.test.ts` | Conflict, isolation and clone-isolation tests. |
| `apps/api/tests/generic-plan-snapshot-service.test.ts` | Canonical provenance, rejection and zero-write tests. |
| `apps/api/tests/agent-roadmap-cli.test.ts` | State assertion after M2.6 acceptance / M2.5 activation. |
| Governance files | M2.5 evidence/status, generated roadmap, record and append-only history. |

## Public Contract

```ts
export interface GenericPlanSnapshotOwner {
  tenantId: string;
  userId: string;
  deviceId: string;
}

export interface CreateGenericPlanSnapshotInput extends GenericPlanSnapshotOwner {
  graphId: string;
  ugsRevision: number;
  ugsCanonicalHash: string;
  generalPublicationGraphHash: string;
  generalPublicationFigurePlanHash: string;
  sourceHashes: string[];
  createdAt: string;
}

export interface GenericPlanSnapshot extends GenericPlanSnapshotOwner {
  version: 1;
  snapshotId: string;
  graphId: string;
  ugsRevision: number;
  ugsCanonicalHash: string;
  generalPublicationGraphHash: string;
  generalPublicationFigurePlanHash: string;
  sourceHashes: string[];
  createdAt: string;
  immutable: true;
}

export interface GenericPlanSnapshotStore {
  insert(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): Promise<GenericPlanSnapshot>;
  get(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): Promise<GenericPlanSnapshot | null>;
}
```

The creation request is `{ owner, ugs: unknown, graph: GeneralPublicationGraph, figurePlan: GeneralPublicationFigurePlan, createdAt }`. Callers cannot submit any digest, source-hash list, graph ID, or revision as a trusted value.

## Task 0: Synchronize the roadmap test baseline

**Files:** Modify `apps/api/tests/agent-roadmap-cli.test.ts:20-22`.

**Consumes:** `agent-roadmap-cli.mjs status --json` and the owner-accepted M2.6 state.

**Produces:** a baseline that recognizes active M2.5 and executable M2.7/M2.8.

- [ ] **Step 1: Reproduce RED**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts`

Expected: FAIL because it expects prior focus `M2.6`.

- [ ] **Step 2: Make only the state expectation update**

```ts
expect(status.currentFocus.id).toBe("M2.5");
expect(status.currentFocus).toMatchObject({ status: "active" });
expect(status.executableNodes.map((node) => node.id)).toEqual(["M2.7", "M2.8"]);
```

- [ ] **Step 3: Verify GREEN**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts`

Expected: `2 passed`.

## Task 1: Implement pure immutable generic metadata

**Files:** Create `apps/api/src/generic-plan-snapshot.ts` and `apps/api/tests/generic-plan-snapshot.test.ts`.

**Consumes:** `compareCodeUnits` from `apps/api/src/stable-string-order.ts`.

**Produces:** `createGenericPlanSnapshot`, `cloneGenericPlanSnapshot`, `canonicalGenericPlanSnapshotJson`, `digestGenericPlanSnapshotValue`, and Task 2/3 types.

- [ ] **Step 1: Write failing contract tests**

```ts
it("keeps identity stable when only createdAt changes", () => {
  expect(createGenericPlanSnapshot(input({ createdAt: "2026-08-20T00:00:00.000Z" })).snapshotId)
    .toBe(createGenericPlanSnapshot(input({ createdAt: "2026-08-20T01:00:00.000Z" })).snapshotId);
});

it("changes identity for device, revision, source hashes, and projection hashes", () => {
  const baseline = createGenericPlanSnapshot(input());
  for (const changed of [
    input({ deviceId: "device-b" }),
    input({ ugsRevision: 2 }),
    input({ sourceHashes: ["b".repeat(64), "a".repeat(64)] }),
    input({ ugsCanonicalHash: "c".repeat(64) }),
    input({ generalPublicationGraphHash: "d".repeat(64) }),
    input({ generalPublicationFigurePlanHash: "e".repeat(64) }),
  ]) expect(createGenericPlanSnapshot(changed).snapshotId).not.toBe(baseline.snapshotId);
});

it("deep-freezes and clone-isolates metadata", () => {
  const snapshot = createGenericPlanSnapshot(input());
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.sourceHashes)).toBe(true);
  expect(cloneGenericPlanSnapshot(snapshot)).toEqual(snapshot);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimum contract**

```ts
export function createGenericPlanSnapshot(input: CreateGenericPlanSnapshotInput): GenericPlanSnapshot {
  const safe = validateGenericPlanSnapshotInput(input);
  const identity = {
    tenantId: safe.tenantId, userId: safe.userId, deviceId: safe.deviceId,
    graphId: safe.graphId, ugsRevision: safe.ugsRevision,
    ugsCanonicalHash: safe.ugsCanonicalHash,
    generalPublicationGraphHash: safe.generalPublicationGraphHash,
    generalPublicationFigurePlanHash: safe.generalPublicationFigurePlanHash,
    sourceHashes: [...safe.sourceHashes].sort(compareCodeUnits),
  };
  return deepFreeze({
    version: 1,
    snapshotId: "generic-plan-" + sha256(canonicalGenericPlanSnapshotJson(identity)).slice(0, 32),
    ...identity, createdAt: safe.createdAt, immutable: true,
  });
}
```

Validate stable IDs, positive safe revision, ISO time, 64-character hex digests, and nonempty duplicate-free source hashes. Canonical object keys use `compareCodeUnits`; cloning is `structuredClone` followed by deep-freeze.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot.test.ts`

Expected: all Task 1 cases pass.

## Task 2: Implement the insert-only scoped store

**Files:** Create `apps/api/src/generic-plan-snapshot-store.ts` and `apps/api/tests/generic-plan-snapshot-store.test.ts`.

**Consumes:** Task 1 contract and clone function.

**Produces:** `GenericPlanSnapshotStore`, `GenericPlanSnapshotStoreConflictError`, `InMemoryGenericPlanSnapshotStore`.

- [ ] **Step 1: Write failing behavior tests**

```ts
it("rejects duplicate immutable identity", async () => {
  await store.insert(owner, snapshot);
  await expect(store.insert(owner, snapshot)).rejects.toBeInstanceOf(GenericPlanSnapshotStoreConflictError);
});

it("does not disclose across tenant, user, or device", async () => {
  await store.insert(owner, snapshot);
  await expect(store.get({ ...owner, deviceId: "device-b" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
});

it("returns clone-isolated frozen values", async () => {
  const inserted = await store.insert(owner, snapshot);
  const fetched = await store.get(owner, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId);
  expect(fetched).toEqual(inserted);
  expect(fetched).not.toBe(inserted);
  expect(Object.isFrozen(fetched)).toBe(true);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-store.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement only insert and scoped get**

```ts
const key = JSON.stringify([owner.tenantId, owner.userId, owner.deviceId, graphId, ugsRevision, snapshotId]);
if (this.snapshots.has(key)) throw new GenericPlanSnapshotStoreConflictError();
this.snapshots.set(key, cloneGenericPlanSnapshot(snapshot));
```

Require snapshot tenant/user/device to equal the insert owner. Provide no global lookup, update, delete, or upsert.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-store.test.ts`

Expected: all Task 2 cases pass.

## Task 3: Implement the fail-closed provenance service

**Files:** Create `apps/api/src/generic-plan-snapshot-service.ts` and `apps/api/tests/generic-plan-snapshot-service.test.ts`.

**Consumes:** Tasks 1/2, `parseUniversalGraphSpec`, `composeGeneralPublicationGraph`, `verifyGeneralPublicationFigurePlan`.

**Produces:** `GenericPlanSnapshotService` and typed `INVALID`/`CONFLICT`/`STORE_FAILURE` errors.

- [ ] **Step 1: Write failing service tests**

```ts
it("uses only server-derived canonical hashes", async () => {
  const result = await service.create(canonicalRequest());
  const ugs = parseUniversalGraphSpec(canonicalRequest().ugs);
  const graph = composeGeneralPublicationGraph(ugs, { detail: canonicalRequest().graph.detail });
  expect(result.ugsCanonicalHash).toBe(digestGenericPlanSnapshotValue(ugs));
  expect(result.generalPublicationGraphHash).toBe(digestGenericPlanSnapshotValue(graph));
});

it.each(["candidate", "blocking-topology", "feedback", "forged-graph", "forged-plan", "wrong-source-graph-hash"])("rejects %s with no write", async (kind) => {
  await expect(service.create(rejectedRequest(kind))).rejects.toMatchObject({ code: "GENERIC_PLAN_SNAPSHOT_INVALID" });
  expect(countingStore.insertCount).toBe(0);
});

it("returns null for a foreign device", async () => {
  const snapshot = await service.create(canonicalRequest());
  await expect(service.get({ ...owner, deviceId: "device-b" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
});
```

Use a counting wrapper around the real in-memory store so the no-write assertion observes the persistence boundary.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Validate everything before the first write**

```ts
const ugs = parseUniversalGraphSpec(input.ugs);
const verifiedPlan = verifyGeneralPublicationFigurePlan({ ugs, graph: input.graph, plan: input.figurePlan });
const canonicalGraph = composeGeneralPublicationGraph(ugs, { detail: input.graph.detail });
const snapshot = createGenericPlanSnapshot({
  ...input.owner,
  graphId: ugs.graphId, ugsRevision: ugs.revision,
  ugsCanonicalHash: digestGenericPlanSnapshotValue(ugs),
  generalPublicationGraphHash: digestGenericPlanSnapshotValue(canonicalGraph),
  generalPublicationFigurePlanHash: digestGenericPlanSnapshotValue(verifiedPlan),
  sourceHashes: ugs.sourceHashes, createdAt: input.createdAt,
});
return this.options.store.insert(input.owner, snapshot);
```

Wrap validation failure as `INVALID` (400), duplicate insert as `CONFLICT` (409), and unknown store failure as `STORE_FAILURE` (500). Never call `insert` on a validation failure path.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts`

Expected: all Task 3 cases pass; rejected cases write zero records.

## Task 4: Independent review, governance, and delivery

**Files:** Modify `docs/agent-program-state.json`, generated `docs/ROADMAP.md`, the current implementation record, and append-only `2026-08.jsonl`.

- [ ] **Step 1: Run focused evidence**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/agent-roadmap-cli.test.ts`

Expected: all focused tests pass.

- [ ] **Step 2: Run full fresh evidence**

Run separately:

```powershell
npx tsc --noEmit
npm run api:check
npm run api:test
npm run agent:render-roadmap
npm run agent:verify-roadmap -- --strict
git diff --check
```

Expected: every command exits 0; record actual counts.

- [ ] **Step 3: Review the exact diff**

Check canonical provenance, zero-write invalid paths, owner/device isolation, deterministic identity, legacy-boundary violations, and scope creep. Resolve every Critical/Important finding and re-review before commit.

- [ ] **Step 4: Record truthful state**

Move M2.5 only to `awaiting_acceptance`, attach test/document evidence, render the roadmap, update the record, and append one JSONL event. Explicitly exclude preview routes, sealed authorization, Worker execution, Visio editing, save/close/reopen/readback, and real-host acceptance.

- [ ] **Step 5: Stage exact files after fresh verification**

```powershell
git add apps/api/src/generic-plan-snapshot.ts apps/api/src/generic-plan-snapshot-store.ts apps/api/src/generic-plan-snapshot-service.ts apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/agent-roadmap-cli.test.ts docs/superpowers/plans/2026-08-20-m2-5-generic-immutable-plan-snapshot.md docs/agent-program-state.json docs/ROADMAP.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/operation-history/2026-08.jsonl
git commit -m "feat(agent): bind generic immutable plan snapshots"
```

Inspect status, fetch `origin/agent`, push only `agent`, and verify the remote SHA. Never force-push, move tags, or stage unrelated work.

## Plan Self-Review

- Tasks 1–3 cover all required identity/hash/source bindings, immutability, insert-only isolation, UGS/graph/plan recomposition, candidate/blocking/feedback rejection, forged provenance rejection, and zero-write failures.
- `createdAt`, duplicate policy, foreign-read policy, and no-legacy/no-Visio boundaries are explicit.
- Task 2 consumes only Task 1 symbols; Task 3 consumes only Tasks 1/2 plus accepted M2.6 verification APIs.
