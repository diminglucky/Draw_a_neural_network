# Universal Agent Roadmap Ledger Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved R1–R5 universal neural-figure capability tracks executable through the single roadmap ledger, without changing their implementation status or misreporting legacy VGG recovery as universal support.

**Architecture:** Add M2.6 as the planned R1 foundation for UniversalGraphSpec and General Publication Graph. Keep M2.5 as the planned R2 immutable snapshot gate, but change it to require M2.6 and generic hashes. Add planned M2.7 and M2.8 for adaptive pattern learning and prompt/static-code UGS adapters; map sketch understanding to the existing planned M4.5 gate and map generic Visio delivery to the existing M3.1–M3.5 path.

**Tech Stack:** JSON roadmap ledger, Node.js roadmap validator and renderer, Vitest, Markdown governance records, append-only JSONL history.

## Global Constraints

- `docs/agent-program-state.json` is the single mutable current-state source; `docs/ROADMAP.md` is generated only.
- Preserve accepted M0/M1/M2.1–M2.4 evidence and status exactly; they are reusable foundations, not proof that R1–R5 are finished.
- R0 remains a legacy VGG16 regression precondition and must not be mapped as a universal-renderer acceptance.
- All R1–R5 implementation nodes remain `planned`; only M2.6 becomes `currentFocus` after its accepted dependencies are verified.
- M2.5 must bind generic UGS, Presentation Graph, and Figure Plan hashes; it must not bind a legacy VGG DTO.
- Unknown operator/module names remain drawable in R1; only unresolved topology blocks formal export in later R2.
- Preserve the dirty working tree and stage no files or commits in this task.
- Every baseline is immutable: create a new working-tree baseline that supersedes the old one; never edit `DB-2026-08-20-adaptive-universal-agent.md`.

---

## Mapping contract

| Capability gate | Formal roadmap mapping | Required ordering |
|---|---|---|
| R0 legacy VGG recovery | precondition only | completed before migration; no milestone acceptance change |
| R1 UGS and General Publication Graph | new `M2.6` | current focus; depends on accepted M2.1–M2.4 |
| R2 generic Snapshot and export eligibility | existing `M2.5` | depends on M2.6 |
| R3 Adaptive Pattern Library | new `M2.7` | depends on M2.6 |
| R4 prompt and static-code adapters | new `M2.8` | depends on M2.6; sketch remains M4.5 |
| R4 sketch adapter | existing `M4.5` | depends on M2.9 and bounded provider controls |
| R5 generic Visio and real-host acceptance | existing `M3.1`–`M3.5` | begins only after M2.9 |

### Task 1: Prove the old ledger exposes the wrong executable order

**Files:**

- Modify: `apps/api/tests/agent-roadmap-cli.test.ts:12-28`
- Test: `apps/api/tests/agent-roadmap-cli.test.ts`

**Interfaces:**

- Consumes: `node scripts/agent-roadmap-cli.mjs status --json`.
- Produces: the public contract that the only executable item after migration is `M2.6`.

- [x] **Step 1: Change the CLI contract test to the new planned R1 focus**

  Replace the old M2.5 assertions with:

  ```ts
  expect(status.currentFocus.id).toBe("M2.6");
  expect(status.executableNodes).toHaveLength(1);
  expect(status.executableNodes[0]).toMatchObject({
    id: "M2.6",
    title: "UniversalGraphSpec and General Publication Graph",
    status: "planned",
  });
  ```

- [x] **Step 2: Run the focused test and confirm RED**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/agent-roadmap-cli.test.ts
  ```

  Expected before ledger change: failure because status reports `M2.5` rather than `M2.6`.

### Task 2: Apply the single-source roadmap migration

**Files:**

- Modify: `docs/agent-program-state.json`
- Test: `apps/api/tests/agent-roadmap-cli.test.ts`

**Interfaces:**

- Consumes: accepted M2.1–M2.4 nodes and the approved adaptive universal-agent specification.
- Produces: executable planned node M2.6, with M2.5/M2.7/M2.8/M2.9/M3.1–M3.5/M4.5 explicitly ordered around generic artifacts rather than legacy VGG DTOs.

- [x] **Step 1: Set the current focus and update timestamp**

  Set the ledger root values to a fresh UTC millisecond timestamp and:

  ```json
  "currentFocus": "M2.6"
  ```

- [x] **Step 2: Make M2.5 the R2 generic Snapshot gate**

  Keep its status `planned`, add `M2.6` to `dependsOn`, and set:

  ```json
  "outcome": "Generic UGS, Presentation Graph, and Figure Plan hashes bind to immutable export eligibility.",
  "acceptance": [{
    "id": "M2.5.snapshot",
    "text": "PlanSnapshot binds generic UGS, Presentation Graph, and Figure Plan hashes.",
    "requiredEvidenceKinds": ["test", "document"]
  }],
  "nextAction": "Implement only after M2.6 emits deterministic generic figure plans."
  ```

- [x] **Step 3: Add the planned R1, R3, and R4 nodes**

  Insert these nodes with empty evidence and no blockers:

  ```json
  {
    "id": "M2.6",
    "milestoneId": "M2",
    "title": "UniversalGraphSpec and General Publication Graph",
    "status": "planned",
    "dependsOn": ["M2.1", "M2.2", "M2.3", "M2.4"],
    "outcome": "Any topology-complete network becomes a deterministic general publication graph without model-name templates.",
    "acceptance": [{
      "id": "M2.6.ugs",
      "text": "UGS preserves evidence, ports, custom modules, topology uncertainty, and deterministic general layout.",
      "requiredEvidenceKinds": ["test", "document"]
    }],
    "evidence": [],
    "nextAction": "Implement UGS schema, validator, generic components, and zero-template fixtures.",
    "blockerIds": [],
    "successorId": null
  }
  ```

  ```json
  {
    "id": "M2.7",
    "milestoneId": "M2",
    "title": "Owner-scoped adaptive pattern library",
    "status": "planned",
    "dependsOn": ["M2.6"],
    "outcome": "Confirmed local structural patterns enhance presentation without becoming a model whitelist.",
    "acceptance": [{
      "id": "M2.7.patterns",
      "text": "Versioned owner-scoped candidates use a restricted visual recipe and deterministic conflict rules.",
      "requiredEvidenceKinds": ["test", "document"]
    }],
    "evidence": [],
    "nextAction": "Implement candidate lifecycle, constrained recipes, review, and promotion fixtures.",
    "blockerIds": [],
    "successorId": null
  }
  ```

  ```json
  {
    "id": "M2.8",
    "milestoneId": "M2",
    "title": "Prompt and static code to UniversalGraphSpec",
    "status": "planned",
    "dependsOn": ["M2.6"],
    "outcome": "Prompt declarations and non-executed static code produce evidence-backed generic graph candidates.",
    "acceptance": [{
      "id": "M2.8.adapters",
      "text": "Prompt and static code adapters preserve unknown modules and isolate unresolved topology.",
      "requiredEvidenceKinds": ["test", "document"]
    }],
    "evidence": [],
    "nextAction": "Implement bounded prompt and static-code adapters after the generic graph contract is accepted.",
    "blockerIds": [],
    "successorId": null
  }
  ```

- [x] **Step 4: Update successor dependencies and existing outcomes**

  Change M2.9 to depend on `M2.5`, `M2.7`, and `M2.8` in addition to its accepted foundations, and describe acceptance of the generic viewed preview. Update M3.1 to explicitly assemble generic snapshot export, M3.3 to accept only sealed generic plans, M3.4 to read back generic native components, M3.5 to prove an editable generic VSDX, and M4.5 to describe Sketch-to-UGS with candidate topology. Do not change their status or evidence.

- [x] **Step 5: Run the focused test and render the derived roadmap**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/agent-roadmap-cli.test.ts
  npm run agent:render-roadmap
  npm run agent:verify-roadmap -- --strict
  npm run agent:status -- --json
  ```

  Expected: the CLI test passes; generated ROADMAP shows M2.6 as the planned focus and sole executable node; strict validation succeeds.

### Task 3: Create immutable migration evidence and update current implementation truth

**Files:**

- Create: `docs/agent-governance/design-baselines/DB-2026-08-20-universal-roadmap-migration.md`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`

**Interfaces:**

- Consumes: validated ledger JSON and approved architecture/governance specs.
- Produces: a working-tree baseline that supersedes the old unmapped draft and an append-only migration event.

- [x] **Step 1: Calculate source hashes after the ledger edit**

  Run:

  ```powershell
  Get-FileHash -Algorithm SHA256 docs\superpowers\specs\2026-08-20-adaptive-universal-neural-figure-agent-design.md, docs\superpowers\specs\2026-08-20-agent-governance-traceability-design.md, docs\agent-program-state.json
  ```

  Expected: three SHA-256 digests for the immutable baseline table.

- [x] **Step 2: Create the new draft working-tree baseline**

  Include the new baseline ID, a fresh UTC timestamp, `working-tree` state, current HEAD, all three source hashes, `supersedes: DB-2026-08-20-adaptive-universal-agent`, and the exact R0–R5 mapping table from this plan. State explicitly that M2.6 is planned, no universal implementation is accepted, and the baseline does not carry a tag.

- [x] **Step 3: Update the implementation record and append one history event**

  The record must say R1 maps to M2.6 and is `planned`, R2 maps to M2.5, R3 maps to M2.7, R4 prompt/static code maps to M2.8 while sketch maps to M4.5, and R5 maps to M3.1–M3.5. Append a unique `roadmap_migrated` event with outcome `recorded`; it must use only repository-relative references and no commit because this task remains uncommitted.

- [ ] **Step 4: Verify governance hygiene**

  Run:

  ```powershell
  npm run agent:verify-roadmap -- --strict
  npm run api:test -- apps/api/tests/agent-roadmap.test.ts apps/api/tests/agent-roadmap-cli.test.ts
  git diff --check
  ```

  Expected: roadmap validation and both roadmap test files pass; diff check has no whitespace errors.

### Task 4: Establish the R1 implementation boundary

**Files:**

- Create: `docs/superpowers/plans/2026-08-20-r1-universal-graphspec-foundation.md`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`

**Interfaces:**

- Consumes: planned M2.6 contract.
- Produces: a separate test-first plan for UGS schema, topology/evidence validation, custom operator/module support, deterministic general publication graph, and zero-template fixtures.

- [x] **Step 1: Record R1 as the next code unit rather than starting multiple tracks**

  The R1 plan must exclude Snapshot export eligibility, PatternLibrary learning, prompt/code/sketch adapters, Worker changes, and live Visio tests. Those are owned by M2.5, M2.7, M2.8/M4.5, and M3.

- [x] **Step 2: Define its mandatory fixtures before source changes**

  Include fixtures for an unknown dual-stream fusion, an unknown repeated custom block, and an ambiguous topology candidate. Each fixture must declare expected UGS invariants and deterministic general publication graph invariants; it must not add model-name renderer branches, fixed node IDs, or fixed coordinates.

- [x] **Step 3: Leave delivery separate from migration**

  Do not stage or commit any file in this plan. A later user-requested commit must use an exact allowlist and separately verify the dirty pre-existing design files.

## Plan self-review

- **Spec coverage:** the plan maps all R0–R5 tracks; it preserves R0 as a precondition and gives R1 an executable M2.6 path before generic M2.5 snapshot work.
- **No-placeholder review:** all work items name concrete files, IDs, dependencies, values, commands, and expected outputs.
- **Type and naming review:** all node IDs match the `M<number>.<positive integer>` ledger validator; M2.5 keeps its snapshot identity and receives M2.6 as a dependency, preventing an invalid unresolved-current-focus state.
