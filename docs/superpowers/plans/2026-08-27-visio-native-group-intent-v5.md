# Visio Native Group Intent V5 Implementation Plan

Status: V5A implemented and verified in the current worktree. The TypeScript native-group intent is ready for a future Worker mapper; real Visio COM group creation and lifecycle readback remain V5B/V6.

Verification record:

- V5A focused: 4 tests passed.
- V1–V5 semantic/snapshot regression: 35 tests passed.
- Full API suite: 153 files passed, 4 pre-existing dirty-worktree files failed (6 tests total).
- TypeScript: only the pre-existing `publication-visual-plan-compiler.test.ts:299` `coordinateSpace` error remains.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 V4 snapshot 生成 formal-only、versioned、module-group-aware 的 Visio native intent。

**Architecture:** 新增独立 TypeScript adapter，把 V4 modules/parts/relations 投影为 native groups、children、connectors 和 readback manifest。它不修改旧 native intent service，不直接调用 Worker 或 COM。

**Tech Stack:** TypeScript 5.9、NodeNext、Vitest 3、现有 V4 contract；不增加依赖。

## Global Constraints

- 只接受 `formal` V4 snapshot；candidate/blocked fail closed。
- 使用 V4 snapshot 的 bounds、routes、hash 和 source mappings，不重新布局或制造拓扑。
- group/child shape data 必须包含 module identity、grammar、panel、ownership 和 source/evidence references。
- 不生成 COM command，不接受 Provider 文本、本地路径、原始代码或客户端坐标覆盖。

---

### Task 1: Define group intent contract

**Files:**

- Create: `apps/api/src/publication-visual-plan-vnext-native-group-intent.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext-native-group-intent.test.ts`

- [ ] Write failing contract tests for protocol, groups, children, connectors and readback manifest.
- [ ] Run the focused test and observe missing module failure.
- [ ] Add typed `compilePublicationVisualPlanVNextNativeGroupIntent` contract.
- [ ] Re-run focused tests.

### Task 2: Map modules and parts into native groups

**Files:**

- Modify: `apps/api/src/publication-visual-plan-vnext-native-group-intent.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext-native-group-intent.test.ts`

- [ ] Map one V4 module to one stable group ID.
- [ ] Map every V4 part to one child ID without flattening or dropping the part.
- [ ] Emit required group and child shape data from V4 readback/source mappings.
- [ ] Preserve module order, part order and V4 geometry exactly.

### Task 3: Map typed relations and enforce fail-closed rules

**Files:**

- Modify: `apps/api/src/publication-visual-plan-vnext-native-group-intent.ts`
- Test: `apps/api/tests/publication-visual-plan-vnext-native-group-intent.test.ts`

- [ ] Map relation type, visual role, marker, endpoints and route into group connectors.
- [ ] Reject candidate and blocked snapshots.
- [ ] Reject duplicate IDs, hash mismatch and out-of-page geometry.
- [ ] Reject unsafe output keys and deep-freeze the result.

### Task 4: Verify the isolated V5A boundary

- [ ] Run V5 focused tests and V1–V4 regressions.
- [ ] Run `npx.cmd tsc --noEmit` and record the pre-existing PVP test error separately.
- [ ] Run `git diff --check` on V5 files.
- [ ] Confirm no old native intent, route, Worker or COM file changed.
- [ ] Record that actual Worker group mapping and real Visio lifecycle remain V5B/V6.
