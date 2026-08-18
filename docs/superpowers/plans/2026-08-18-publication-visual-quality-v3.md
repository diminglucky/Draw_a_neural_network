# v3 Publication Visual Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Implement M2.3 as a stable, versioned, server-side, fail-closed visual-quality boundary for v3 composable figure plans without changing the legacy v2 QA path or prematurely wiring preview/export routes.

**Architecture:** Keep \`ComposableDagFigureCompiler\` responsible for deterministic semantic DAG layout and routing. Add a v3 publication-plan wrapper that carries the compiled DAG plan, deterministic visual specification, and evidence index. Validate that wrapper through a pure \`runComposableDagVisualQa\` function returning the existing snapshot-compatible \`VisualQaResult\`; blocking failures prevent later PlanSnapshot creation.

**Tech Stack:** TypeScript, Vitest, existing \`ComposableDagFigurePlan\`, \`ArchitectureIRv3\`, \`FigureIntent\`, \`VisualQaResult\`, and Node/Vitest repository commands.

## Global Constraints

- Preserve the v2 \`PublicationFigurePlanV2\` and existing \`visual-qa.ts\` contract unchanged.
- Do not add Preview Route, PlanSnapshot persistence, export-job creation, Provider behavior, Keras/ONNX, GNN, or real Visio behavior in M2.3.
- Do not accept Provider text, paths, SVG/XML, shell, PowerShell, VBA, COM, or Worker fields in the v3 publication plan.
- \`candidate_structure\` and blocking unresolved IR never produce a ready publication plan or passing Visual QA.
- Visual QA must be pure, non-mutating, deterministic, bounded, and fail-closed.
- Preserve unrelated tracked and untracked worktree changes; stage only the exact M2.3 allowlist.
- Follow RED -> GREEN -> REFACTOR for every behavior change.

---

### Task 1: Define the v3 publication-plan and visual-spec types

**Files:**

- Create: \`apps/api/src/composable-dag-publication-plan.ts\`
- Create: \`apps/api/tests/composable-dag-publication-plan.test.ts\`
- Test fixture: \`apps/api/tests/fixtures/figure-component-gold-ir.ts\`
- Reference: \`apps/api/src/composable-dag-figure-compiler.ts\`, \`apps/api/src/figure-components.ts\`, \`apps/api/src/plan-snapshot.ts\`, \`apps/api/src/network-ir-v3.ts\`

**Interfaces:**

Consumes \`ArchitectureIRv3\`, \`FigureIntent\`, \`ComposableDagFigurePlan\`, \`FigureBounds\`, and \`ArchitectureIRv3["evidenceIndex"]\`.

Produces:

~~~ts
export const COMPOSABLE_DAG_PUBLICATION_PLAN_VERSION = 1 as const;
export const COMPOSABLE_DAG_VISUAL_QA_VERSION = "composable-dag-visual-qa-v1" as const;

export interface ComposableDagVisualSpec {
  page: {
    background: string;
    minMargin: number;
    minFontSizePt: number;
    minContrastRatio: number;
  };
  componentStyles: Record<string, {
    fill: string;
    stroke: string;
    grayscalePattern: "solid" | "stripe" | "dot" | "hatch" | "none";
  }>;
  connectionStyles: Record<string, {
    stroke: string;
    grayscalePattern: "solid" | "dash" | "dot" | "double";
    thickness: number;
  }>;
  labels: Array<{
    id: string;
    semanticId: string;
    text: string;
    bounds: FigureBounds;
    fontSizePt: number;
  }>;
}

export interface ComposableDagPublicationPlan {
  version: typeof COMPOSABLE_DAG_PUBLICATION_PLAN_VERSION;
  dagPlan: ComposableDagFigurePlan;
  visualSpec: ComposableDagVisualSpec;
  evidenceIndex: ArchitectureIRv3["evidenceIndex"];
  qaVersion: typeof COMPOSABLE_DAG_VISUAL_QA_VERSION;
}

export type ComposableDagPublicationBuildResult =
  | { status: "ready"; publicationPlan: ComposableDagPublicationPlan }
  | { status: "unresolved"; graphId: string; unresolved: ComposableDagUnresolved[] };

export function buildComposableDagPublicationPlan(input: {
  architectureIr: ArchitectureIRv3;
  intent: FigureIntent;
  layoutSeed: string;
}): ComposableDagPublicationBuildResult;
~~~

- [ ] **Step 1: Write the failing test for a ready publication plan**

Compile the existing CNN gold IR and assert that the result is ready, has version 1, has the expected graph ID, has the fixed QA version, has one label per component, has component styles, and copies the IR evidence index.

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts
~~~

Expected: failure because the v3 publication-plan builder and types do not exist. Fix fixture/import errors before writing production code.

- [ ] **Step 3: Write the minimal deterministic publication-plan builder**

Call \`compileComposableDagFigure\`; preserve unresolved results; derive a bounded visual spec from semantic component kind, connection transport, page bounds, and \`FigureIntent\`; generate one bounded single-line label per component; copy the IR evidence index with \`structuredClone\`; return no mutable references to compiler input.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused command. Expected: the new test passes.

- [ ] **Step 5: Add unresolved, determinism, and immutability tests**

Cover blocking unresolved IR, cyclic/unreachable topology, identical inputs producing byte-equivalent plans, bounded single-line labels, and mutation of the returned plan not mutating the source IR or compiler output.

- [ ] **Step 6: Run the task tests with the existing compiler tests**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/composable-dag-figure-compiler.test.ts apps/api/tests/figure-components.test.ts
~~~

Expected: all pass with M2.1/M2.2 behavior unchanged.

---

### Task 2: Add pure v3 geometry, route, and source-mapping QA

**Files:**

- Create: \`apps/api/src/composable-dag-visual-qa.ts\`
- Create: \`apps/api/tests/composable-dag-visual-qa.test.ts\`
- Modify only if required by the contract: \`apps/api/src/composable-dag-publication-plan.ts\`

**Interfaces:**

Consumes \`ComposableDagPublicationPlan\`.

Produces:

~~~ts
import type { VisualQaResult } from "./plan-snapshot.js";

export function runComposableDagVisualQa(
  input: ComposableDagPublicationPlan,
): VisualQaResult;
~~~

- [ ] **Step 1: Write RED tests for valid plans and non-mutating output**

Assert that CNN, residual, encoder-decoder, and token-transformer publication plans pass, that a valid result has status \`pass\`, and that serializing the input before and after QA yields the same bytes.

- [ ] **Step 2: Run the focused QA test and verify RED**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-visual-qa.test.ts
~~~

Expected: failure because \`runComposableDagVisualQa\` does not exist.

- [ ] **Step 3: Implement deterministic geometry and page checks**

Check plan/QA version, finite positive page values, finite positive component bounds, page bounds, minimum margins, component collisions, finite positive label bounds, label bounds, label overlap, minimum font size, and bounded density/scale. Use pure helpers and stable diagnostic ordering.

- [ ] **Step 4: Run valid-plan tests and verify GREEN**

Run the focused QA command. Expected: valid gold plans pass.

- [ ] **Step 5: Add RED geometry regression tests**

Cover component overflow, component collision, label overflow, label collision, non-finite coordinates/dimensions, zero/negative dimensions, undersized labels, and invalid page values. Each test asserts fail status and an exact blocking check ID.

- [ ] **Step 6: Implement geometry diagnostics and verify GREEN**

Report bounded object IDs and stable check IDs. Run the focused QA suite.

- [ ] **Step 7: Add RED route and evidence tests**

Cover missing source/target components, missing ports, routes with fewer than two points, detached endpoints, out-of-page route points, missing component mappings, unknown evidence IDs, and unknown semantic mapping IDs.

- [ ] **Step 8: Implement route and evidence checks and verify GREEN**

Validate routes against declared component bounds and ports. Validate mappings against the plan evidence index. Return no source excerpts, source code, paths, or raw evidence payloads.

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-visual-qa.test.ts
~~~

---

### Task 3: Add style, contrast, grayscale, and deterministic diagnostics QA

**Files:**

- Modify: \`apps/api/src/composable-dag-visual-qa.ts\`
- Modify: \`apps/api/tests/composable-dag-visual-qa.test.ts\`
- Modify only if required by the visual spec contract: \`apps/api/src/composable-dag-publication-plan.ts\`

**Interfaces:**

Consumes \`ComposableDagPublicationPlan.visualSpec\`. Produces the same snapshot-compatible \`VisualQaResult\`.

- [ ] **Step 1: Write RED style tests**

Cover invalid hex colors, missing component styles, missing connection styles, invalid grayscale patterns, non-positive thickness, contrast below threshold, grayscale-colliding semantic relations, duplicate/unbounded label IDs/text, and unsupported style tokens.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-visual-qa.test.ts
~~~

Expected: each new style test fails because its check is not implemented.

- [ ] **Step 3: Implement bounded color and style validation**

Implement strict \`#RRGGBB\` parsing, relative luminance and contrast ratio, style completeness, bounded thickness, grayscale collision checks, label ID/text uniqueness, and bounded single-line text. Never silently lower thresholds.

- [ ] **Step 4: Verify GREEN and diagnostic determinism**

Run the focused QA suite and assert valid styles pass, invalid styles fail with stable IDs, and equivalent input order produces equal results.

- [ ] **Step 5: Confirm the legacy v2 QA boundary**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/visual-qa.test.ts apps/api/tests/composable-dag-visual-qa.test.ts
~~~

Expected: v2 and v3 QA suites pass without v2 changes.

---

### Task 4: Connect the M2.3 result to the v3 compiler contract without adding routes

**Files:**

- Modify: \`apps/api/src/composable-dag-publication-plan.ts\`
- Modify only for an explicit stable adapter export: \`apps/api/src/composable-dag-figure-compiler.ts\`
- Modify: \`apps/api/tests/composable-dag-publication-plan.test.ts\`

**Interfaces:**

Consumes validated Architecture IR v3, FigureIntent, and a bounded layout seed. Produces a ready \`ComposableDagPublicationPlan\` or an unresolved result. It has no HTTP, persistence, filesystem, Provider, or Worker dependency.

- [ ] **Step 1: Write RED integration tests**

Prove that a ready M2.2 plan wraps into a v3 publication plan; unresolved compiler output cannot wrap as ready; evidence index and visual spec are present and deterministic; no PlanSnapshot/store is created; v2 plans are not accepted.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/composable-dag-figure-compiler.test.ts
~~~

Expected: only the new adapter assertions fail before the adapter is complete.

- [ ] **Step 3: Implement the smallest explicit adapter**

Accept only validated IR, FigureIntent, and bounded seed; call M2.2 compiler; preserve unresolved results; create the publication wrapper; expose no external side effects.

- [ ] **Step 4: Run focused M2.3 tests and verify GREEN**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/composable-dag-figure-compiler.test.ts apps/api/tests/composable-dag-visual-qa.test.ts
~~~

Expected: all M2.2/M2.3 tests pass.

---

### Task 5: Run repository gates and record M2.3 evidence

**Files:**

- Create: \`docs/evidence/2026-08-18-m2-3-publication-visual-quality.md\`
- Modify: \`docs/agent-program-state.json\` only after all gates pass
- Regenerate: \`docs/ROADMAP.md\` using the repository roadmap CLI after state/evidence changes
- Preserve: unrelated plans and existing worktree changes

- [ ] **Step 1: Run the focused M2.3 suite**

Run:

~~~powershell
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/composable-dag-visual-qa.test.ts apps/api/tests/composable-dag-figure-compiler.test.ts apps/api/tests/figure-components.test.ts apps/api/tests/visual-qa.test.ts
~~~

Expected: all v3 M2.3 tests and unchanged v2 QA tests pass.

- [ ] **Step 2: Run full repository gates**

Run:

~~~powershell
npm.cmd run api:test
npx.cmd tsc --noEmit
npm.cmd run api:check
npm.cmd run agent:status -- --strict
git diff --check
~~~

Expected: every command exits zero. Report any unrelated failure with the exact file and command.

- [ ] **Step 3: Write the evidence record**

Record the exact implementation commit, focused/full test counts, strict TypeScript, foundation check, roadmap status, diff check, accepted M2.3 scope, and explicit non-accepted browser screenshot, manual visual, Provider, live PostgreSQL/Redis, Electron, Worker-live, Visio COM, VSDX, close/reopen, and real-host gates.

- [ ] **Step 4: Update the roadmap only after evidence exists**

Use the ledger transition rules to move M2.3 from \`planned\` to \`awaiting_acceptance\` or \`accepted\`. Add evidence satisfying \`M2.3.qa\` and regenerate \`docs/ROADMAP.md\`. Do not mark accepted without a resolvable implementation commit and required test/document evidence.

- [ ] **Step 5: Review the exact diff and worktree**

Run:

~~~powershell
git status --short --branch
git diff --stat
git diff --check
~~~

Stage only M2.3 implementation, tests, evidence, state, generated roadmap, and the plan if intentionally included. Do not stage unrelated plans.

