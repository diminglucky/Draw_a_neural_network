# R0 Publication Layout Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the canonical VGG16 bridge, immutable execution snapshot, and Visio export request path by making the legacy publication layout accept the canonical VGG stage IDs it already receives.

**Architecture:** This is a regression-only compatibility repair inside the legacy VGG publication fixture. `compileAgentCnnVisioDiagram` continues to project a validated canonical VGG16 IR into the restricted Worker diagram DTO. `publication-figure-plan.js` will recognize the two pre-existing, semantically identical VGG16 naming conventions at the layout and label boundaries; it will keep rejecting all other unsupported CNN publication group IDs.

**Tech Stack:** Node.js ESM, Vitest, Node built-in test runner, TypeScript API, existing C# Visio Worker validation suite.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`; preserve all pre-existing uncommitted documentation and governance files.
- Do not execute, import, or run user-supplied neural-network code.
- R0 restores the legacy canonical VGG16 fixture only; it does not implement UniversalGraphSpec, a generic renderer, a model-family registry, or a new Visio command surface.
- `assertCanonicalVgg16` remains legacy-fixture-only and must not be introduced into a future universal export path.
- Keep unsupported publication group IDs fail-closed with `Unsupported CNN publication group: <id>`.
- Do not change fixed canvas/page dimensions, primitive schemas, Worker DTO shape, snapshot digest input, ownership binding, or export authorization behavior.
- Use test-first changes: observe a new explicit regression assertion fail before editing production source.
- Do not stage or commit unrelated current worktree changes; any later commit must use an exact file allowlist.

---

## Root-cause record

The focused command below consistently fails before the fix:

```powershell
npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts
```

Observed failure:

```text
publication-figure-plan.js:206
Unsupported CNN publication group: conv-1
```

Backward trace:

```text
canonical VGG16 fixture
-> toVgg16WorkerSource()
-> group IDs conv-1..conv-5 / classifier
-> buildPublicationFigurePlan()
-> layoutCnnPlate()
-> xById lacks conv-* / classifier entries
-> thrown error
```

The earlier standalone `publication-figure-plan.test.js` fixture uses `block-1..block-5` and `softmax`; it passes only because it does not exercise the canonical bridge naming contract. Both naming sets describe the same 13 fixed VGG16 layout slots. The minimal root-cause fix is an explicit, limited alias table for the IDs emitted by `toVgg16WorkerSource`, plus a heading expression that recognizes both fixed stage-name prefixes.

During RED/GREEN execution, the recovered bridge also exposed a second stale assertion: `publication-figure-plan.js` was widened to `1800×720` by `7f188d1`, with its standalone fixture updated in the same commit, while the older bridge test from `f2ccaa7` still asserted `1600×540`. The Worker protocol accepts positive coordinate dimensions and has no `1600×540` constraint. R0 therefore updates that bridge assertion to the authoritative published `1800×720` canvas; it does not alter the production canvas or Worker DTO.

## File structure and change boundaries

| File | Responsibility in this task |
|---|---|
| `publication-figure-plan.js` | Legacy VGG-only publication fixture: map canonical bridge aliases to the existing fixed slots and preserve local `CONV N` labels. |
| `apps/api/tests/agent-visio-bridge.test.ts` | API-level regression contract: canonical VGG16 stages must receive deterministic slot positions and labels without changing the restricted Worker DTO. |
| `apps/api/tests/agent-visio-execution-snapshot.test.ts` | Existing downstream snapshot regression coverage; no source change expected. |
| `apps/api/tests/agent-visio-export-routes.test.ts` | Existing downstream async export-route regression coverage; no source change expected. |
| `docs/agent-governance/implementation-records/current-roadmap.md` | Record actual R0 evidence and remaining universal-renderer boundary after the tests pass. |
| `docs/agent-governance/operation-history/2026-08.jsonl` | Append one non-sensitive, factual R0 recovery event after successful verification. |

### Task 1: Add an API-level canonical VGG layout regression test

**Files:**

- Modify: `apps/api/tests/agent-visio-bridge.test.ts:7-37`
- Test: `apps/api/tests/agent-visio-bridge.test.ts`

**Interfaces:**

- Consumes: `compileAgentCnnVisioDiagram({ draftId: string; revision: number; canonicalNetworkIR: unknown }): AgentVisioBridgeResult`.
- Produces: a regression assertion that the bridge retains canonical IDs while assigning the fixed legacy VGG slots.

- [x] **Step 1: Extend the existing successful compilation test with precise expected canonical positions and stage label text**

  Add these assertions immediately after the existing `conv-1` / `conv-5` repeat assertions:

  ```ts
  expect(groups.find((group) => group.id === "conv-1")?.bounds.x).toBe(210);
  expect(groups.find((group) => group.id === "conv-5")?.bounds.x).toBe(970);
  expect(groups.find((group) => group.id === "classifier")?.bounds.x).toBe(1590);
  expect(result.diagram.figurePlan.labels.find((label) => label.id === "conv-1.heading")?.text).toBe("Block 1");
  ```

- [x] **Step 2: Run the focused bridge test and confirm RED**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts
  ```

  Expected before production change: all three existing bridge cases still fail with `Unsupported CNN publication group: conv-1`; the new assertions are intentionally unreachable until that regression is repaired.

- [x] **Step 3: Confirm the failure is localized to alias lookup, not canonical IR validation**

  Run:

  ```powershell
  npm run api:check
  node --test publication-figure-plan.test.js
  ```

  Expected: `api:check` passes; the old standalone fixture remains green because it uses `block-*` / `softmax`. This contrast confirms the input is valid and the defect is the naming boundary in `layoutCnnPlate`.

### Task 2: Repair the fixed VGG slot and heading alias contract

**Files:**

- Modify: `publication-figure-plan.js:183-214`
- Test: `apps/api/tests/agent-visio-bridge.test.ts`

**Interfaces:**

- Consumes: group IDs from legacy standalone fixtures (`block-1..block-5`, `softmax`) and the canonical bridge (`conv-1..conv-5`, `classifier`).
- Produces: deterministic `bounds.x` for every canonical VGG16 group and unchanged `semantic.stageRegion`, anchors, primitive IDs, connector geometry, and figure-plan validation.

- [x] **Step 1: Keep the existing legacy slots and add only canonical bridge aliases**

  In `layoutCnnPlate`, retain all existing `xById` entries and add these exact entries:

  ```js
  ["conv-1", 210],
  ["conv-2", 400],
  ["conv-3", 590],
  ["conv-4", 780],
  ["conv-5", 970],
  ["classifier", 1590],
  ```

  Do not replace the map with ordinal-stage inference. Explicit aliases retain the legacy fixture's fail-closed behavior for non-VGG group IDs and avoid accidentally treating a new network as canonical VGG16.

- [x] **Step 2: Make feature-stage headings recognize the two fixed VGG prefixes**

  Change only the feature-stack expression in `headingFor` to:

  ```js
  return stageHeading("Block", group.id, /^(?:block|conv)-(\d+)$/);
  ```

  Do not change labels for pooling, flatten, fully connected, or classifier groups.

- [x] **Step 3: Run the focused bridge test and confirm GREEN**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts
  ```

  Expected: `1 passed` test file, `3 passed` tests. The result must expose canonical `conv-*` / `classifier` IDs and the four precise assertions from Task 1.

- [x] **Step 4: Run the legacy fixture test to confirm compatibility**

  Run:

  ```powershell
  node --test publication-figure-plan.test.js
  ```

  Expected: all legacy Node test cases pass, proving that `block-*` and `softmax` retain their original fixed layout behavior.

### Task 3: Verify all affected API paths

**Files:**

- Test: `apps/api/tests/agent-visio-bridge.test.ts`
- Test: `apps/api/tests/agent-visio-execution-snapshot.test.ts`
- Test: `apps/api/tests/agent-visio-export-routes.test.ts`

**Interfaces:**

- Consumes: repaired bridge result.
- Produces: verified snapshot creation and accepted asynchronous export response; no API schema or route implementation changes.

- [x] **Step 1: Run the three formerly failing API suites together**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts apps/api/tests/agent-visio-execution-snapshot.test.ts apps/api/tests/agent-visio-export-routes.test.ts
  ```

  Expected: all selected test files pass; snapshot tests obtain the deterministic bridge digest; export-route tests receive their expected `202` response rather than `500`.

- [x] **Step 2: Run API type and full-suite regression checks**

  Run:

  ```powershell
  npm run api:check
  npm run api:test
  ```

  Expected: type check passes; full Vitest suite passes with no remaining `Unsupported CNN publication group` failure.

- [x] **Step 3: Run the Worker non-regression suite**

  Run:

  ```powershell
  dotnet test .\workers\visio-worker\VisioWorker.sln --no-restore
  ```

  Expected: all currently enabled Worker tests pass. This proves the unchanged restricted Worker contract still deserializes and validates the bridge DTO; it is not a proof of live desktop Visio behavior.

### Task 4: Record implementation truth and prepare a narrow delivery

**Files:**

- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`
- Modify: `docs/superpowers/plans/2026-08-20-r0-publication-layout-recovery.md`

**Interfaces:**

- Consumes: exact command outputs and final Git diff.
- Produces: append-only operational evidence and an implementation record that distinguishes repaired legacy regression from universal-agent progress.

- [x] **Step 1: Update the plan checkboxes and implementation record from executed evidence only**

  Record the final commit SHA only after commit succeeds. State explicitly:

  ```text
  R0 restored only the legacy canonical VGG16 fixture chain.
  R0 did not make the public Visio path universal and did not advance M2.5 acceptance.
  ```

- [x] **Step 2: Append one JSONL operation-history event after all selected checks pass**

  The event must have a unique event ID, an ISO-8601 timestamp, a concise non-sensitive summary, relative repository references, the executed checks, and the remaining R1/R2/M2.5 boundary. Do not include local absolute paths, raw test logs, credentials, source content, or user data.

- [ ] **Step 3: Verify governance and diff hygiene**

  Run:

  ```powershell
  npm run agent:render-roadmap
  npm run agent:verify-roadmap -- --strict
  git diff --check
  git status --short
  ```

  Expected: roadmap rendering and strict verification pass; diff check has no whitespace errors; status lists only the intentional pre-existing governance/design documents, the new R0 plan, and the narrow R0 source/test/governance updates.

- [ ] **Step 4: Review exact staged allowlist before any commit**

  Use only an explicit allowlist, for example:

  ```powershell
  git add -- publication-figure-plan.js apps/api/tests/agent-visio-bridge.test.ts docs/superpowers/plans/2026-08-20-r0-publication-layout-recovery.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/operation-history/2026-08.jsonl
  git diff --cached --check
  git diff --cached --name-only
  ```

  Do not run `git add .`; do not include the pre-existing redesign/spec/roadmap edits unless the user separately renews authorization to commit them.

- [ ] **Step 5: Commit only after all checks are green and the staged names are correct**

  Run:

  ```powershell
  git commit -m "fix: restore canonical VGG publication layout"
  ```

  Expected: one narrow commit. Pushing or tagging is out of scope until the user requests it.

## Verification matrix and completion boundary

| Gate | Evidence required | R0 status after green |
|---|---|---|
| Root cause | focused reproducible `conv-1` failure and backward trace | closed |
| Bridge | canonical VGG16 IDs, slots, headings, deterministic digest | closed |
| Snapshot | existing snapshot suite passes | closed |
| Export route | existing export suite returns accepted job | closed |
| API regression | `api:check` and full `api:test` pass | closed |
| Worker contract | Worker suite passes | closed |
| Real desktop Visio | single page, applyDiff, save/reopen, native readback | not attempted by R0 |
| Universal UGS renderer | unknown operator/module and topology handling | not implemented by R0 |
| M2.5 acceptance | generic immutable UGS/Presentation/Figure Plan snapshot | not advanced by R0 |

## Plan self-review

- **Spec coverage:** R0 in the adaptive universal-agent design requires only restoration of the current VGG bridge, execution snapshot, and export route baseline. Tasks 1–3 test each of those paths. Task 4 records the result without falsely advancing the generic R1–R5 work.
- **No-placeholder review:** every implementation step names the exact file, API, entries, assertion values, command, and expected result; there are no unresolved placeholder markers.
- **Type and naming review:** the plan retains the existing `compileAgentCnnVisioDiagram` interface, `AgentVisioBridgeResult` DTO, `layoutCnnPlate` group contract, and existing VGG test fixture IDs. The `classifier` alias is constrained to a fixed layout slot; no dynamic name mapping is proposed.
