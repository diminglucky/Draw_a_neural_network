# Publication Composition Kernel P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canonical PVP compiler's fixed-size rank/lane geometry with one deterministic, model-neutral composition kernel that gives terminals, modules, operators, and semantic markers a clear visual hierarchy and balances branch columns around the main reading axis.

**Architecture:** Keep `UGS -> GPG -> PVP` and the current SVG/Visio renderers unchanged. Extract only descriptor ordering, primitive sizing, branch-column balancing, attachment packing, and page-extents calculation from `publication-visual-plan-compiler.ts` into a pure `publication-composition-kernel.ts`; the compiler remains the integration owner and connector routing continues to consume the resulting canonical bounds. This is the first executable Composition slice, not a claim that the complete `FigureStoryPlan`, multi-panel PVP v2, or page-aware Visio reflow is finished.

**Tech Stack:** TypeScript, Vitest, existing `ComposableRegionVisualDescriptor`, PVP compiler, SVG corpus, native-intent mapper.

## Global Constraints

- No model name, paper name, reference ID, class name, or fixture ID may select geometry.
- UGS remains topology authority, GPG remains display-semantic authority, and PVP remains geometry authority.
- The kernel may position existing descriptors but may not create, delete, or reconnect topology.
- Candidate/formal eligibility, source mappings, update identity, native capability requirements, and selected-page safety remain unchanged.
- No new renderer, workflow, database object, Provider path, Visio command, or protocol version.
- Every production behavior change starts with a failing test and retains deterministic canonical hashes.
- Passing structural tests is not publication-quality or real-Visio visual acceptance.

---

### Task 1: Add a pure model-neutral composition kernel

**Files:**
- Create: `apps/api/src/publication-composition-kernel.ts`
- Create: `apps/api/tests/publication-composition-kernel.test.ts`

**Interfaces:**
- Consumes: `readonly ComposableRegionVisualDescriptor[]` produced by `compileComposableRegionVisuals`.
- Produces: `composePublicationLayout(descriptors): PublicationCompositionLayout`, containing stable ordered descriptors, `boundsByPrimitive`, page bounds, and safe margins.

- [x] **Step 1: Write the failing visual-hierarchy test**

Create descriptors with anonymous IDs and ranks for one terminal, two parallel modules, one merge marker, and one output. Assert that terminal/operator/module widths differ by semantic role, merge markers stay square and smaller than modules, the two-item branch column straddles the same vertical reading axis used by adjacent single-item columns, and no primary bounds overlap.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx.cmd vitest run apps/api/tests/publication-composition-kernel.test.ts
```

Expected: FAIL because `publication-composition-kernel.js` and `composePublicationLayout` do not exist.

- [x] **Step 3: Implement the minimal pure kernel**

Implement these deterministic rules:

```ts
const PRIMARY_SIZE = {
  terminal: { width: 480, height: 240 },
  operator: { width: 600, height: 280 },
  module: { width: 720, height: 320 },
  candidate: { width: 720, height: 280 },
};
```

Use compact rank order rather than raw rank gaps. Within each rank, sort by existing lane/order/primitive ID. Center the rank's vertical stack around the global reading axis. Compute each rank's x-position from the previous rank's actual footprint, including its right-side attachment corridor. Preserve the existing bounded attachment placements and collision loop. Derive page and safe margins from the final primitive extents.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command again. Expected: all kernel tests pass.

### Task 2: Cut the canonical PVP compiler over to the kernel

**Files:**
- Modify: `apps/api/src/publication-visual-plan-compiler.ts`
- Modify: `apps/api/tests/publication-visual-plan-compiler.test.ts`

**Interfaces:**
- Consumes: `composePublicationLayout(visualCompilation.descriptors)`.
- Produces: the existing `PublicationVisualPlan`; no public schema or caller signature changes.

- [x] **Step 1: Add failing compiler-level assertions**

For anonymous formal fixtures, assert:

```ts
expect(inputTerminal.bounds.width).toBeLessThan(moduleFrame.bounds.width);
expect(operatorFrame.bounds.width).toBeLessThanOrEqual(moduleFrame.bounds.width);
expect(addMarker.bounds.width).toBe(addMarker.bounds.height);
expect(addMarker.bounds.width).toBeLessThan(moduleFrame.bounds.width);
```

Replace assertions that require every primary to be exactly `760 x 320` with hierarchy and containment assertions. Add one branch-balance assertion comparing the vertical center of adjacent single-node columns with the center of the parallel branch column.

- [x] **Step 2: Run compiler tests and verify RED**

Run:

```powershell
npx.cmd vitest run apps/api/tests/publication-visual-plan-compiler.test.ts
```

Expected: FAIL because the compiler still gives ordinary terminals, operators, and modules the same `760 x 320` bounds.

- [x] **Step 3: Integrate the kernel and remove duplicate geometry code**

Import `composePublicationLayout`, replace `compactDeterministicLayout`, `primaryBounds`, attachment packing, and page-extents calculation with its result, and delete the superseded private constants/functions from the compiler. Do not change connector semantics, styles, PVP schema, or native intent.

- [x] **Step 4: Run compiler tests and verify GREEN**

Run the Task 2 command again. Expected: all compiler tests pass.

### Task 3: Restore cross-renderer gates and record the evidence boundary

**Files:**
- Modify: `apps/api/tests/publication-visual-corpus.test.ts`
- Modify: `docs/agent-governance/implementation-records/operation-history.md`

**Interfaces:**
- Consumes: the new canonical PVP geometry.
- Produces: anonymous corpus evidence that the same geometry remains deterministic, QA-valid, browser-renderable, and native-intent compatible.

- [x] **Step 1: Add corpus-level composition invariants**

For every formal case, assert that all primitive bounds lie inside `coordinateSpace.page`, primary primitives do not overlap, marker dimensions are bounded below module dimensions, and at least one structurally applicable case demonstrates non-uniform semantic sizing. Do not snapshot paper-specific coordinates or colors.

- [x] **Step 2: Run the complete visual gate**

Run:

```powershell
npx.cmd vitest run apps/api/tests/publication-composition-kernel.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-corpus.test.ts apps/api/tests/publication-visual-plan-qa.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts apps/client/publication-visual-plan-preview.test.js
npx.cmd tsc --noEmit
npm.cmd run api:check
git diff --check
```

Expected: every command exits `0`.

- [x] **Step 3: Record exact evidence and limitations**

Append one operation-history entry with the RED failure, changed layout invariants, final test counts, and an explicit statement that this improves hierarchy and branch balance but does not yet implement Story, panels, overview/detail, selected-page reflow, image-level human review, or real Visio acceptance.

- [x] **Step 4: Commit the narrow slice**

Stage only the plan, kernel, focused tests, compiler integration, corpus assertions, and operation-history entry. Commit with:

```text
feat: add publication composition kernel
```
