# Publication Visual Plan vNext Implementation Plan

Status: implemented and verified in the current worktree. V4 produces a deterministic PVP vNext snapshot; V5 Visio native groups and real save/reopen/readback remain intentionally outside this node.

Verification record:

- V4 focused: 6 tests passed.
- V1/V2/V3/composable visual regression: 31 tests passed.
- Full API suite: 152 files passed, 4 pre-existing dirty-worktree files failed (6 tests total).
- TypeScript: only the pre-existing `publication-visual-plan-compiler.test.ts:299` `coordinateSpace` error remains.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V1/V2/V3 的语义结果固化为 deterministic、versioned、renderer-neutral 的 PVP vNext Snapshot。

**Architecture:** 新增独立 `publication-visual-plan-vnext.ts`。它只消费 normalized Semantic Architecture Graph、V2 visual compilation 和 V3 Figure Story Plan，在服务端生成 panels/modules/parts/relations/insets/process/legend/source mappings 及几何。旧 PVP v1、Provider、客户端和 Visio Worker 保持不变。

**Tech Stack:** TypeScript 5.9、NodeNext、Vitest 3、Node `crypto`，不增加依赖。

## Global Constraints

- `blocked` graph 必须 fail closed；`candidate` snapshot 不能 formal 或 QA passed。
- 不保存原始代码、图片像素、本地路径、Provider 文本、COM command 或客户端 geometry override。
- 不新增或推断 graph 中没有的 module、data object、relation 或 evidence。
- 所有输出稳定排序、deep-freeze，并以 canonical SHA-256 identity 固化。
- 不修改旧 PVP、browser preview、Visio Worker 或现有 route。

---

### Task 1: Define the V4 snapshot contract

**Files:**

- Create: `apps/api/src/publication-visual-plan-vnext.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext.test.ts`

- [ ] Write failing tests for version, identity, panels, modules, parts, data objects, relations, containers, insets, process tracks, legend, source mappings and renderer requirements.
- [ ] Run `npm.cmd run api:test -- apps/api/tests/publication-visual-plan-vnext.test.ts` and observe the missing module failure.
- [ ] Add the public `compilePublicationVisualPlanVNext` contract and typed snapshot interfaces.
- [ ] Reject mismatched graph/compilation/story IDs and invalid empty layout seed.
- [ ] Re-run focused tests.

### Task 2: Implement deterministic story-to-snapshot projection

**Files:**

- Modify: `apps/api/src/publication-visual-plan-vnext.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext.test.ts`

- [ ] Add tests asserting overview order equals `story.mainPathModuleIds`, complex modules retain V2 part IDs, and every emitted visual has source/evidence mapping.
- [ ] Map modules to overview/detail/process according to story membership, with overview ownership taking precedence for main-path modules.
- [ ] Generate internal part bounds inside module bounds without creating topology.
- [ ] Map story insets, process lanes and legend entries exactly, preserving stable ordering.
- [ ] Re-run focused tests.

### Task 3: Implement deterministic geometry and typed routes

**Files:**

- Modify: `apps/api/src/publication-visual-plan-vnext.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext.test.ts`

- [ ] Add tests for page containment, module/part containment, stable panel grid, relation endpoint anchors and orthogonal routes.
- [ ] Place overview main path horizontally, auxiliary panels in deterministic rows, and parts within their owning module.
- [ ] Generate routes from semantic source/target ports and preserve relation type/marker.
- [ ] Keep geometry server-generated and exclude client override fields.
- [ ] Re-run focused tests.

### Task 4: Enforce eligibility, identity and immutability

**Files:**

- Modify: `apps/api/src/publication-visual-plan-vnext.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext.test.ts`

- [ ] Add tests for blocked fail-closed, candidate non-formal output, canonical hash changes on revision/seed, three-run byte equality and deep-freeze.
- [ ] Compute canonical hash with the hash field blanked and deep-freeze every nested result.
- [ ] Preserve compilation/story diagnostics and emit a readback manifest for each module and part.
- [ ] Reject unknown/extra unsafe fields in the internal input projection and never carry raw source/provider values.
- [ ] Re-run focused tests.

### Task 5: Regression and boundary verification

- [ ] Run focused V4 tests plus V1/V2/V3/composable visual regressions.
- [ ] Run `npx.cmd tsc --noEmit` and report the pre-existing publication visual test error separately.
- [ ] Run `git diff --check` on the V4 source, tests, spec and plan.
- [ ] Confirm no PVP v1, route or Visio Worker files changed.
- [ ] Record that V4 is a snapshot/layout gate; real Visio save/reopen/readback remains V5.
