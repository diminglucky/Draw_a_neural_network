# Visual Kernel Recovery P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the broken canonical PVP-to-SVG visual path without adding another architecture layer, then record a reproducible visual regression gate.

**Architecture:** Keep the existing `UGS -> GPG -> PVP` compiler unchanged. Repair the browser renderer's bounded CSS line-width contract so it accepts the canonical compiler's finite decimal point widths, while still rejecting units, signs, exponents, zero, and unbounded values. Re-run the anonymous corpus through the real compiler and browser renderer.

**Tech Stack:** TypeScript, JavaScript ES modules, Vitest, existing PVP compiler and SVG renderer.

## Global Constraints

- No model-name or paper-name routing.
- No new renderer, graph, workflow, storage, or protocol layer.
- Preserve canonical PVP hashes and native Visio intent semantics.
- Use the existing anonymous publication visual corpus as the cross-boundary gate.
- Do not claim publication-quality visual completion from this repair.

---

### Task 1: Repair bounded decimal stroke-width rendering

**Files:**
- Modify: `apps/client/publication-visual-plan-preview.test.js`
- Modify: `publication-visual-plan-preview.js`

**Interfaces:**
- Consumes: PVP style token values emitted as decimal strings such as `"1.2"`.
- Produces: `renderPublicationVisualPlanPreview(response): string` accepts bounded unitless decimal stroke widths and emits the same value in SVG.

- [x] **Step 1: Write the failing browser renderer test**

Add a focused test that sets primitive and connector `strokeWidth` to `"1.2"`, renders through `renderPublicationVisualPlanPreview`, and expects `stroke-width="1.2"` in the SVG. Add rejection assertions for `"0"`, `"1px"`, `"1e2"`, and `"100"` so the contract remains bounded and unitless.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx.cmd vitest run apps/client/publication-visual-plan-preview.test.js -t "accepts bounded decimal stroke widths"
```

Expected: FAIL with `PVP style token is invalid` for `"1.2"`.

- [x] **Step 3: Implement the minimal renderer contract change**

Replace the integer-only `strokeWidth` predicate in `validStyleValue` with a bounded unitless decimal predicate accepting values greater than zero and less than 100 with at most two decimal places. Do not change the PVP compiler or native intent mapping.

- [x] **Step 4: Run the browser renderer tests and verify GREEN**

Run:

```powershell
npx.cmd vitest run apps/client/publication-visual-plan-preview.test.js
```

Expected: all tests pass.

### Task 2: Restore the anonymous visual corpus gate

**Files:**
- Modify: `docs/agent-governance/implementation-records/operation-history.md`

**Interfaces:**
- Consumes: the repaired browser renderer and existing compiler-generated PVPs.
- Produces: reproducible evidence that the compiler, structural QA, SVG renderer, and native intent contract agree for the current anonymous corpus.

- [x] **Step 1: Run the four-layer focused gate**

Run:

```powershell
npx.cmd vitest run apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-corpus.test.ts apps/api/tests/publication-visual-plan-qa.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts apps/client/publication-visual-plan-preview.test.js
```

Expected: all five files and all tests pass.

- [x] **Step 2: Run TypeScript and foundation checks**

Run:

```powershell
npx.cmd tsc --noEmit
npm.cmd run api:check
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Record the exact evidence boundary**

Append one operation-history entry containing the failing symptom, root cause, changed contract, exact focused test count, TypeScript/foundation/diff results, and the explicit statement that this restores renderer compatibility but does not improve composition quality by itself.

- [x] **Step 4: Commit the narrow P0 repair**

Stage only the plan, browser renderer, browser test, and operation history. Commit with:

```text
fix: restore publication visual preview contract
```
