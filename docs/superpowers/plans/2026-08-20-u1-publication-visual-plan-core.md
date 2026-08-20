# PublicationVisualPlan v1 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the one strict, deterministic, renderer-neutral `PublicationVisualPlan` (PVP) used by the future preview, Snapshot, export and Visio paths.

**Architecture:** Keep `UniversalGraphSpec → GeneralPublicationGraph` unchanged. Add a PVP compiler that validates formal/candidate eligibility, creates integer `pvp-du-1` bounds, primitive ports and orthogonal connector routes from the canonical GPG, then serializes exactly one canonical PVP schema. The old `GeneralPublicationFigurePlan` remains an internal migration-only artifact and is not extended by this plan.

**Tech Stack:** TypeScript ESM, Zod, Node `crypto`, Vitest, existing `compareCodeUnits`, UGS and GPG modules.

## Global Constraints

- Never execute, import or evaluate uploaded model source.
- PVP accepts no unknown fields, non-finite numbers, sparse arrays or duplicate stable IDs.
- `pvp-du-1` is top-left origin, X right, Y down, and every coordinate is an integer; `1000 du = 1 inch`.
- Candidate PVP is preview-only; it cannot be passed to Snapshot/export/Worker code.
- Unknown names remain `custom_operator`/`custom_module`; only unknown topology is candidate/clarification.
- New public DTOs use `UGS`, `GPG` and `PVP`, not `Presentation Graph`, `Figure Plan` or `Preview Plan`.
- Preserve existing dirty worktree changes; stage only files named by a completed task.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/publication-visual-plan.ts` | PVP v1 types, strict parser, canonical JSON/hash, eligibility checks and deep-frozen output. |
| `apps/api/src/publication-visual-plan-compiler.ts` | Canonical `UGS + GPG → PVP` compiler with deterministic geometry, ports and orthogonal routes. |
| `apps/api/tests/publication-visual-plan.test.ts` | Schema/canonicalization/eligibility tests. |
| `apps/api/tests/publication-visual-plan-compiler.test.ts` | Unknown-network compilation, port/route/source-mapping and candidate tests. |

## Public Interfaces

```ts
export type PublicationVisualPlanKind = "formal" | "candidate";

export interface PublicationVisualPlanUpdateIdentity {
  ownerId: string;
  deviceId: string;
  workflowId: string;
  documentId: string;
  pageId: string;
  expectedRevision: number;
}

export interface PublicationVisualPlan {
  identity: { schemaVersion: 1; planId: string; canonicalHash: string };
  eligibility: { kind: PublicationVisualPlanKind; formalReasons: string[]; blockingReasons: string[]; qaStatus: "pending" | "passed" };
  lineage: { ugsHash: string; gpgHash: string; sourceHashes: string[]; composerHash: string; profileSetHash: string };
  coordinateSpace: { id: "pvp-du-1"; origin: "top_left"; axes: "x_right_y_down"; unit: "du"; duPerInch: 1000; page: PublicationVisualPlanBounds; safeMargins: PublicationVisualPlanBounds };
  regions: PublicationVisualPlanRegion[];
  primitiveGroups: PublicationVisualPlanPrimitiveGroup[];
  primitives: PublicationVisualPlanPrimitive[];
  ports: PublicationVisualPlanPort[];
  connectors: PublicationVisualPlanConnector[];
  annotations: PublicationVisualPlanAnnotation[];
  legend: { entries: []; bounds?: PublicationVisualPlanBounds; styleTokenIds: string[] };
  styleTokens: { tokenSetVersion: "pvp-style-1"; tokens: PublicationVisualPlanStyleToken[] };
  profileApplications: [];
  sourceMappings: PublicationVisualPlanSourceMapping[];
  rendererRequirements: { protocolVersion: "pvp-renderer-1"; requiredCapabilities: string[]; optionalCapabilities: string[] };
  updateIdentity: PublicationVisualPlanUpdateIdentity;
}

export function parsePublicationVisualPlan(input: unknown): PublicationVisualPlan;
export function canonicalPublicationVisualPlanJson(input: PublicationVisualPlan): string;
export function compilePublicationVisualPlan(input: {
  ugs: UniversalGraphSpec;
  graph: GeneralPublicationGraph;
  sourceHashes: string[];
  updateIdentity: PublicationVisualPlanUpdateIdentity;
}): PublicationVisualPlan;
```

### Task 1: Strict PVP v1 parser and canonical identity

**Files:**
- Create: `apps/api/src/publication-visual-plan.ts`
- Create: `apps/api/tests/publication-visual-plan.test.ts`

**Consumes:** `compareCodeUnits` from `apps/api/src/stable-string-order.ts`.

**Produces:** `PublicationVisualPlan`, `parsePublicationVisualPlan`, `canonicalPublicationVisualPlanJson`, and strict `pvp-du-1` validation for Task 2.

- [ ] **Step 1: Write failing parser tests**

```ts
it("accepts one canonical formal PVP and derives a stable hash", () => {
  const first = parsePublicationVisualPlan(formalPlan());
  const reordered = parsePublicationVisualPlan(reorderedEquivalentFormalPlan());
  expect(first.identity.canonicalHash).toBe(reordered.identity.canonicalHash);
  expect(first).toEqual(reordered);
});

it.each(["unknownField", "duplicatePort", "sparseRoute", "nonFinite", "offPageBounds", "connectorEndpointMismatch"])("rejects invalid PVP %s", (kind) => {
  expect(() => parsePublicationVisualPlan(invalidPlan(kind))).toThrow();
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run apps/api/tests/publication-visual-plan.test.ts`

Expected: failure because `publication-visual-plan.js` and its exports do not exist.

- [ ] **Step 3: Implement the minimal schema and canonical projection**

```ts
export function parsePublicationVisualPlan(input: unknown): PublicationVisualPlan {
  const parsed = publicationVisualPlanSchema.parse(input);
  assertStableIds(parsed);
  assertIntegerCoordinateSpace(parsed);
  assertPortAndRouteTopology(parsed);
  const withoutHash = { ...parsed, identity: { ...parsed.identity, canonicalHash: "" } };
  const canonicalHash = sha256(canonicalPublicationVisualPlanJson(withoutHash));
  if (parsed.identity.canonicalHash !== canonicalHash) throw new Error("PVP canonicalHash must match canonical projection");
  return deepFreeze(structuredClone(parsed));
}
```

Implement every list in ID/code-unit order, use strict Zod objects, reject `feedback` in a formal plan, and require candidate plans to have no formal reason or `qaStatus="passed"`.

- [ ] **Step 4: Run parser tests and TypeScript**

Run: `npx vitest run apps/api/tests/publication-visual-plan.test.ts; npx tsc --noEmit`

Expected: all new tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit only this task after review**

```powershell
git add -- apps/api/src/publication-visual-plan.ts apps/api/tests/publication-visual-plan.test.ts
git diff --cached --check
git commit -m "feat(agent): add strict publication visual plan schema"
```

### Task 2: Canonical UGS/GPG-to-PVP compiler

**Files:**
- Create: `apps/api/src/publication-visual-plan-compiler.ts`
- Create: `apps/api/tests/publication-visual-plan-compiler.test.ts`
- Modify: `apps/api/src/publication-visual-plan.ts` only if Task 1 needs exported primitive helper types.

**Consumes:** Task 1 parser; `parseUniversalGraphSpec`; `composeGeneralPublicationGraph`; canonical GPG IDs and layout ranks.

**Produces:** `compilePublicationVisualPlan`, with one right-side output port and one left-side input port per formal primitive, source-mapped straight/orthogonal routes and deterministic `planId`/hash.

- [ ] **Step 1: Write failing compiler tests**

```ts
it("compiles an unseen dual-stream custom network into a formal PVP with anchored ports and routes", () => {
  const plan = compilePublicationVisualPlan(inputForUnknownDualStreamFusion());
  expect(plan.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
  expect(plan.primitives.some((item) => item.kind === "CustomOperator")).toBe(true);
  expect(plan.connectors.every((item) => item.route[0]!.x === portAnchor(plan, item.sourcePortId).x)).toBe(true);
  expect(plan.sourceMappings).toHaveLength(plan.primitives.length);
});

it("compiles candidate topology only as a non-exportable candidate PVP", () => {
  const plan = compilePublicationVisualPlan(inputForCandidateTopology());
  expect(plan.eligibility.kind).toBe("candidate");
  expect(plan.eligibility.qaStatus).toBe("pending");
});
```

- [ ] **Step 2: Run the compiler test and verify RED**

Run: `npx vitest run apps/api/tests/publication-visual-plan-compiler.test.ts`

Expected: failure because `compilePublicationVisualPlan` does not exist.

- [ ] **Step 3: Implement deterministic geometry and routing**

```ts
const x = safeMargin + rank * (primitiveWidth + columnGap);
const y = safeMargin + order * (primitiveHeight + laneGap);
const sourcePort = rightOutputPort(primitive);
const targetPort = leftInputPort(target);
const midX = Math.max(sourcePort.x + routeGap, Math.floor((sourcePort.x + targetPort.x) / 2));
const route = [sourcePort, { x: midX, y: sourcePort.y }, { x: midX, y: targetPort.y }, targetPort];
```

Map `input`, `output`, `custom_operator`, `custom_module`, split, merge and repeat GPG roles to the PVP primitive vocabulary. Every compiler-created primitive receives exactly one source mapping and all arrays are code-unit sorted before calling `parsePublicationVisualPlan`.

- [ ] **Step 4: Run focused UGS/GPG/PVP tests**

Run: `npx vitest run apps/api/tests/universal-graph-spec.test.ts apps/api/tests/general-publication-graph.test.ts apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts`

Expected: all listed tests pass.

- [ ] **Step 5: Commit only Task 2 after review**

```powershell
git add -- apps/api/src/publication-visual-plan.ts apps/api/src/publication-visual-plan-compiler.ts apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts
git diff --cached --check
git commit -m "feat(agent): compile universal publication visual plans"
```

### Task 3: Renderer capability and formal/candidate boundary regression matrix

**Files:**
- Modify: `apps/api/tests/publication-visual-plan.test.ts`
- Modify: `apps/api/tests/publication-visual-plan-compiler.test.ts`

**Consumes:** Task 1 parser and Task 2 compiler.

**Produces:** Regression evidence that unsupported primitive/version, feedback topology, candidate edge and malformed route all fail closed before Snapshot/export integration begins.

- [ ] **Step 1: Write failing capability/eligibility tests**

```ts
it.each(["feedback", "candidateEdge", "unsupportedPrimitive", "wrongProtocolVersion"])("does not produce a formal PVP for %s", (kind) => {
  const plan = compilePublicationVisualPlan(inputFor(kind));
  expect(plan.eligibility.kind).toBe("candidate");
  expect(plan.eligibility.formalReasons).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run apps/api/tests/publication-visual-plan-compiler.test.ts -t "does not produce a formal PVP"`

Expected: failure for the first unsupported case.

- [ ] **Step 3: Implement only the required fail-closed classification**

```ts
const kind: PublicationVisualPlanKind = hasCandidateTopology || hasFeedback || hasUnsupportedPrimitive
  ? "candidate"
  : "formal";
```

Do not add Snapshot, HTTP route, SVG or Worker behavior in this task.

- [ ] **Step 4: Run U1-core verification**

Run: `npx vitest run apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/general-publication-graph.test.ts; npx tsc --noEmit; npm run api:check; git diff --check`

Expected: all commands exit with code 0.

- [ ] **Step 5: Commit only Task 3 after review**

```powershell
git add -- apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts
git diff --cached --check
git commit -m "test(agent): lock publication visual plan eligibility"
```

## Plan Self-Review

- Task 1 covers strict PVP schema, canonicalization, coordinates, IDs, ports and routes.
- Task 2 covers the canonical UGS/GPG compiler, source mapping and unknown-network formal output.
- Task 3 covers candidate/feedback/capability fail-closed behavior before Snapshot/export integration.
- Browser projection, Snapshot migration, public route migration, Profiles and Visio rendering are deliberately out of this core plan and remain later U1/U2/U3/U5 tasks from the approved architecture specification.
