# Trusted PVP QA Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow only an explicit server-side trusted visual-review decision to promote a structurally passing formal `PublicationVisualPlan` from `qaStatus: "pending"` to `qaStatus: "passed"`, while binding the source PVP hash into the promoted PVP and Snapshot gate.

**Architecture:** A narrow promotion service reparses the pending PVP, reruns deterministic PVP structural QA, validates an explicit review acknowledgement against the pending canonical hash, then creates a new canonical PVP with a stable `visual-qa:pvp-qa-1:<sourceHash>` formal reason. The Snapshot service recomputes the pending projection from every passed PVP and rejects a missing or mismatched promotion binding before the store is written.

**Tech Stack:** TypeScript ESM, Node structured clone, existing PVP canonical parser/hash, Vitest.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`.
- Consume only PVP and PVP QA contracts; do not import legacy Figure Plan, VGG, browser SVG, Worker, COM or Visio DTOs.
- The promotion service is server-only and has no HTTP route, export job, Worker call, Visio document, or browser mutation.
- Promotion requires formal/pending/no-blocking PVP, passing structural QA, an explicit `trusted-human` approval and the exact pre-promotion PVP hash.
- Candidate, feedback, already-passed, malformed, structurally failed or hash-mismatched PVPs are rejected without creating a promoted PVP or writing a Snapshot.
- A passed PVP must contain exactly one canonical promotion reason; Snapshot recomputes the pending projection and verifies the embedded source hash before insert.
- Preserve all unrelated dirty governance files and do not commit or push without a fresh explicit request.

---

### Task 1: Server-only trusted QA promotion

**Files:**

- Create: `apps/api/src/publication-visual-plan-qa-promotion.ts`
- Create: `apps/api/tests/publication-visual-plan-qa-promotion.test.ts`

**Consumes:** `parsePublicationVisualPlan`, `createPublicationVisualPlan`, `evaluatePublicationVisualPlanQa`.

**Produces:** `promotePublicationVisualPlanAfterTrustedReview(input)` returning immutable `{ plan, decision }`.

- [ ] **Step 1: Write failing tests.** Cover a formal/pending PVP with matching review source hash; assert a passed clone, one `visual-qa:pvp-qa-1:<sourceHash>` reason and a decision binding source/approved hashes. Cover candidate, structural QA failure, wrong source hash and already-passed input rejections.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-qa-promotion.test.ts`

Expected: module resolution fails because the promotion service does not yet exist.

- [ ] **Step 3: Implement the minimal closed promotion service.** Parse/clone the PVP, require explicit trusted-human approval and a valid reviewer/timestamp, rerun structural QA, construct a fresh passed PVP with the source-hash reason, and return frozen decision metadata. Do not make an already-passed plan idempotent; replay must be explicit at a later persistent decision layer.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-qa-promotion.test.ts apps/api/tests/publication-visual-plan-qa.test.ts`

Expected: all tests pass.

### Task 2: Require canonical promotion binding before Snapshot persistence

**Files:**

- Modify: `apps/api/src/generic-plan-snapshot-service.ts`
- Modify: `apps/api/tests/generic-plan-snapshot-service.test.ts`

**Consumes:** Task 1 promotion reason contract and existing server-side QA gate.

**Produces:** Snapshot rejects manually constructed `qaStatus: "passed"` PVPs and permits only a promoted PVP whose embedded source hash reconstructs exactly.

- [ ] **Step 1: Write failing tests.** Change the successful Snapshot fixture to use `promotePublicationVisualPlanAfterTrustedReview`. Add a zero-write rejection for the prior manually passed fixture.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts`

Expected: the manual passed fixture is still accepted because no promotion binding is checked.

- [ ] **Step 3: Implement the binding verifier.** Locate exactly one `visual-qa:pvp-qa-1:<sourceHash>` reason, clone the PVP into its pending projection after removing the marker, canonicalize it, and require the reconstructed pending hash to equal the embedded source hash. Keep structural QA and all lineage/owner/device/revision checks.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/publication-visual-plan-qa-promotion.test.ts`

Expected: promoted PVP inserts once; manual, candidate, pending, feedback, forged and structurally failed PVPs cause zero writes.

### Task 3: Cross-layer verification

**Files:**

- Modify only Task 1–2 files if verification finds a direct contract defect.

- [ ] **Step 1: Run focused PVP/Snapshot tests.**

Run: `npx vitest run apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-plan-qa.test.ts apps/api/tests/publication-visual-plan-qa-promotion.test.ts apps/api/tests/publication-visual-preview-service.test.ts apps/api/tests/generic-plan-snapshot.test.ts apps/api/tests/generic-plan-snapshot-store.test.ts apps/api/tests/generic-plan-snapshot-service.test.ts apps/api/tests/publication-visual-plan-zero-template.test.ts`

Expected: every focused test passes.

- [ ] **Step 2: Run repository verification.**

Run: `npx tsc --noEmit && npm run api:test && npm run api:check && git diff --check`

Expected: every command exits 0. This proves source/test contracts only; it does not prove trusted-review authorization persistence, sealed export, Visio, save/reopen, or host acceptance.

## Plan Self-Review

- The promotion operation cannot run automatically from browser activity or structural QA alone; it requires an explicit trusted-human acknowledgement.
- A stable source hash marker lets the Snapshot gate distinguish the closed promotion projection from a hand-edited passed status.
- The plan deliberately excludes a review-decision database, authentication role policy, public API, export job and Visio worker. Those require a later sealed export design.
