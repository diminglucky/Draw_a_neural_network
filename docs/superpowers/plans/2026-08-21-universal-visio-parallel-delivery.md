# Universal Visio Parallel Delivery Governance Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the roadmap ledger so it truthfully prioritizes a generic, stable PVP-to-Visio delivery path without claiming unfinished host acceptance or allowing PatternLibrary to become a prerequisite for direct drawing.

**Architecture:** The accepted UGS/GPG/PVP contracts remain the only renderer-neutral input. After them, native PVP primitive mapping and Prompt/static-code adapters are independent parallel tracks; sealed export follows Snapshot acceptance; sketch remains a candidate-and-clarification lane; PatternLibrary follows the real Windows/Visio lifecycle gate. The state ledger remains the authoritative current-state source, while ROADMAP is generated from it and the implementation record and operation history explain the evidence boundary.

**Tech Stack:** JSON roadmap ledger, Node ESM roadmap renderer/validator, Vitest, Markdown governance records.

## Global Constraints

- Do not mark browser SVG diagnostics, unit tests, a commit, or a design document as real Windows/Visio, editable VSDX, save-close-reopen, native readback, cancellation, or human visual acceptance.
- Do not let raw prompts, source code, sketches, browser geometry, or model output reach Visio COM; only a server-created canonical PVP may enter the future native path.
- Static code analysis remains non-executing; sketch output remains candidate or clarification when topology is unresolved.
- PatternCandidate and PatternLibrary are not model-name templates and must not start until M3.5 real-host evidence and M4.5 bounded sketch evidence are accepted.
- Keep operation history append-only and use only repository-relative references with resolvable, existing commit hashes in accepted-node evidence.
- Regenerate `docs/ROADMAP.md`; do not hand-edit the derived document.

---

### Task 1: Establish the failing roadmap contract

**Files:**

- Modify: `apps/api/tests/agent-roadmap-cli.test.ts`
- Verify: `scripts/agent-roadmap-cli.mjs`

**Consumes:** The current ledger renderer’s definition of an executable node: a planned node whose dependencies are accepted.

**Produces:** A regression test requiring M3.1 to be the active generic PVP-to-Visio vertical-slice focus, with M2.8 Prompt-to-UGS and M2.10 static-code-to-UGS independently executable.

- [ ] **Step 1: Change the asserted target state before editing the ledger.**

```ts
expect(status.currentFocus.id).toBe("M3.1");
expect(status.currentFocus).toMatchObject({ status: "active" });
expect(status.executableNodes.map((node) => node.id)).toEqual(["M2.8", "M2.10"]);
```

- [ ] **Step 2: Run the focused test and observe the old governance state fail.**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts`

Expected: FAIL because the ledger still reports M2.5 as current focus and M2.7 as prematurely executable.

### Task 2: Correct the ledger dependency graph and truthful evidence state

**Files:**

- Modify: `docs/agent-program-state.json`
- Modify: `docs/ROADMAP.md` through `npm run agent:render-roadmap`
- Verify: `scripts/agent-roadmap.mjs`

**Consumes:** Commit `f2f2114e57b8db34b99789b45927f4d0548fd26e` PVP Snapshot gate, commit `2eaa2c4197434731e2a9a0301395e42647cd9d90` deterministic Profiles, and the accepted M2.6 UGS/GPG/PVP structural foundation.

**Produces:** M2.5 becomes evidence-backed `awaiting_acceptance`; M3.1 becomes the active isolated PVP-to-native-primitive mapping slice; M2.8 and M2.10 are independently executable adapters; M2.7 is deferred behind M2.9, M3.5, and M4.5.

- [ ] **Step 1: Update M2.5 to PVP-backed language and evidence.** Its evidence must cite the focused Snapshot tests and rebaseline plan at the actual committed hash. Keep it `awaiting_acceptance`; this repair does not fabricate owner acceptance.

- [ ] **Step 2: Start M3.1 only at the safe mapping boundary.** Make it depend on accepted M2.6, state that it consumes only server-created canonical PVP fixtures, and explicitly prohibit public export, COM commands, or real-host claims. Make M3.2 depend on both M3.1 and M2.5 so sealed export cannot bypass Snapshot acceptance.

- [ ] **Step 3: Split input work without schema widening.** Retain `M2.8` as Prompt-to-UGS, add `M2.10` as Static-code-to-UGS, and make M2.9 require both but not PatternLibrary. Keep M4.5 as candidate-only sketch understanding and remove unrelated billing/provider control as its prerequisite.

- [ ] **Step 4: Defer PatternLibrary correctly.** Make M2.7 depend on preview acceptance, M3.5 real Windows/Visio acceptance, and M4.5 bounded sketch evidence. State that it cannot be an executable prerequisite for basic drawing.

- [ ] **Step 5: Regenerate the derived roadmap.**

Run: `npm run agent:render-roadmap`

Expected: `docs/ROADMAP.md` is generated from the corrected state ledger and lists only M2.8 and M2.10 as planned executable nodes.

### Task 3: Align the architectural narrative and implementation record

**Files:**

- Modify: `docs/superpowers/specs/2026-08-20-adaptive-universal-neural-figure-agent-design.md`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`

**Consumes:** The corrected ledger and the U0–U6 capability boundaries.

**Produces:** A written statement that U4 adapters and the first U5 PVP-to-Visio mapping slice can progress in parallel after the common PVP boundary, while public sealed export and PatternLibrary retain their stricter gates.

- [ ] **Step 1: Clarify the U4/U5 sequencing in the architecture specification.** Add an explicit parallel-delivery note: PVP-native mapping can begin from zero-template fixtures, but it is not a claim that arbitrary prompt/code/sketch inputs can export to Visio before the relevant adapter and real-host gates complete.

- [ ] **Step 2: Refresh the implementation record.** Replace stale Figure Plan and “M2.5 begins” language with current PVP Snapshot/Profiles evidence; distinguish browser-SVG visual-rubric diagnostics from formal cross-renderer acceptance; record the exact M3.1 safety boundary and later PatternLibrary gate.

- [ ] **Step 3: Append one operation-history event.** The event must record governance repair, cite this plan, the state ledger, specification, and implementation record, use `commit: null` until a later authorized commit exists, and state that no real Visio acceptance is claimed.

### Task 4: Verify parity and regression behavior

**Files:**

- Verify: `apps/api/tests/agent-roadmap-cli.test.ts`
- Verify: `docs/agent-program-state.json`
- Verify: `docs/ROADMAP.md`

**Consumes:** The modified test, ledger, derived roadmap, and operation record.

**Produces:** Fresh evidence that the roadmap is syntactically valid, generated content is in parity, and executable-node discovery cannot regress to early PatternLibrary.

- [ ] **Step 1: Run the focused roadmap test.**

Run: `npx vitest run apps/api/tests/agent-roadmap-cli.test.ts`

Expected: PASS with M3.1 active and M2.8/M2.10 executable.

- [ ] **Step 2: Run renderer and strict-roadmap verification.**

Run: `npm run agent:verify-roadmap && npm run agent:status -- --strict`

Expected: parity is valid; strict mode may report the intentionally dirty working tree only in human status warnings, not a state or dependency error.

- [ ] **Step 3: Run repository quality gates for documentation and the existing local visual-rubric slice.**

Run: `npx tsc --noEmit && npm run api:test && npm run api:check && git diff --check`

Expected: all commands exit 0. These checks do not constitute real Visio host acceptance.
