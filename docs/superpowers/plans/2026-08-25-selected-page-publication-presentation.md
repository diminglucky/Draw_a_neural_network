# Selected-Page Publication Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the selected-page smoke diagram's generic label and page-fit behavior with a compact, model-neutral publication presentation while preserving the existing selected-page safety boundary.

**Architecture:** Keep PVP as the source of topology and visual semantics. Add a pure presentation policy to the C# native mapper/model and a pure content-bounds fitting transform to the Visio renderer; use a compiler-produced PVP for live acceptance. Do not alter the page, create documents, or add network-name templates.

**Tech Stack:** TypeScript, Vitest, C# 12/.NET 8, xUnit, Visio COM.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\current-page-visio-chain`.
- Preserve all pre-existing dirty changes.
- Do not commit, push, tag, reset, clean, force-push, or use `git add .` without a new explicit user request.
- Do not change the selected page size or create/open another Visio document.
- Do not introduce model-specific layout or visual branches.

---

### Task 1: Semantic label presentation

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Core/DiagramModel.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Host/SelectedPageNativeIntentMapper.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageNativeIntentMapperTests.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs`

**Interfaces:**
- Produces: an explicit label placement policy (`inside`, `outside`, or `none`) in the mapped figure plan.
- Consumes: existing `visualKind`, label, bounds, and resolved style.

- [ ] Add failing tests proving Add/Concat/Split markers have no external long label, RepeatBadge uses an internal label, and ordinary modules retain one readable label.
- [ ] Run the focused C# tests and confirm failures are caused by the absent policy.
- [ ] Add the smallest model, mapper, and renderer changes needed to honor the policy.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Content-bounds page fitting

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Test: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs`

**Interfaces:**
- Produces: `FitSelectedPageDocument` output whose primitive, connector, and label union occupies the selected page safe region.
- Consumes: the immutable mapped `DiagramDocument` and actual selected-page dimensions.

- [ ] Add a failing portrait-page test with a wide plan whose content occupies only a subset of its declared page.
- [ ] Confirm the current fitter wastes space by scaling the declared page.
- [ ] Fit the finite content union, retain a bounded margin, and keep a minimum readable label size without changing topology.
- [ ] Add a fail-closed test for a target that cannot meet minimum text readability.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Production-shaped live smoke input

**Files:**
- Create: `scripts/selected-page-publication-smoke.ts`
- Test: `apps/api/tests/publication-visual-plan-native-intent.test.ts`
- Test: `apps/api/tests/selected-page-drawing-job.test.ts`

**Interfaces:**
- Consumes: compiler-produced trusted generic PVP/native intent.
- Produces: one connected generic graph with source mappings and no disconnected decorative primitives.

- [ ] Add a failing test that rejects a production smoke fixture containing an unattached semantic adornment.
- [ ] Reuse the canonical compiler/native-intent path instead of constructing arbitrary primitive JSON.
- [ ] Run focused TypeScript tests and typecheck.

### Task 4: Real Visio acceptance and regression

**Files:**
- No production files unless a failing acceptance exposes a new root cause.

**Interfaces:**
- Consumes: the selected open test VSDX and production-shaped sealed native intent.
- Produces: saved editable Visio shapes plus readback and screenshot evidence.

- [ ] Run the live draw once and export/capture the visible page.
- [ ] Inspect label containment, content scale, attachment placement, line routing, and preservation of `USER SHAPE - KEEP`.
- [ ] Run the same draw a second time and prove Agent-owned shape count is stable.
- [ ] Save, inspect the VSDX package, and verify expected labels and absence of the old plan-ID title/CNN legend.
- [ ] Run the focused TypeScript suite, `npx.cmd tsc --noEmit`, full C# tests, Release build, and `git diff --check`.
- [ ] Report automated, real-Visio, and remaining visual/reflow gates separately.
