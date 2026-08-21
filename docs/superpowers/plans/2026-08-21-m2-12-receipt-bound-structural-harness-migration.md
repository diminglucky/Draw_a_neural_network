# M2.12 Receipt-Bound Structural Harness Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the structural phase of the universal drawing platform so a Coordinator-owned receipt/EvidencePack and an optional untrusted Provider yield either a canonical formal UGS, one revision-bound clarification, or rejection—never a second canonical graph path.

**Architecture:** This is a specialization of `2026-08-21-universal-neural-drawing-agent-platform.md` Phases 3–5, not a standalone pipeline. The Coordinator owns private receipt content, context issuance, cancellation, and stale-result fencing; the Provider receives only a redacted local-fact payload; the Harness canonicalizes evidence and topology, projects public text, and is the only component that emits formal UGS.

**Tech Stack:** TypeScript 5, Node ESM, strict unknown-field parsing, Vitest, existing UGS/GPG/PVP contracts, existing owner/device/session boundaries, DrawingRun Coordinator and ArtifactStore from platform Phases 1–2.

## Global Constraints

- Do not start Task 1 until platform Phase 0 inventory, Phase 1 DrawingRun contracts, and Phase 2 Coordinator/store/idempotency/cancellation contracts have accepted evidence.
- Do not execute, import, evaluate, persist publicly, or return user source or image bytes.
- Do not install LangChain, LangGraph, LangSmith, OpenAI Agents SDK, or a general Agent SDK in this migration.
- The Provider receives `ProviderContextPayload`, never `PrivateInputReceipt` or `ProviderContextReference`; it cannot receive raw bytes, path, credential, context ID, receipt ID, run ID, owner/device ID, or public UGS ID.
- Provider node/port/edge IDs and fact tokens are local-only. The Harness mints every public evidence/node/port/edge ID after validation and canonical ordering.
- Candidate, clarification, and rejected results create no PVP, Snapshot, export, Worker, COM, Visio, page-binding, or persistence side effect beyond the Coordinator-owned run/event/artifact record.
- Preserve accepted M2.8, M2.10, and M2.11 behavior through explicit adapters. Do not create a second UGS compiler or replace legacy route response semantics in place.
- Stage only the exact files of the completed task. Preserve visual-rubric drafts and unrelated working-tree changes.

---

## Required Contracts

```ts
export interface ProviderContextReference {
  contextId: string;
  runId: string;
  ownerId: string;
  deviceId: string;
  expectedRevision: number;
  evidencePackHash: string;
  allowedPurpose: "architecture_interpretation";
  expiresAt: string;
}

export interface ProviderContextPayload {
  version: 1;
  allowedPurpose: "architecture_interpretation";
  facts: readonly {
    localFactRef: `fact:f:${number}`;
    sourceKind: "static_analysis" | "typed_declaration" | "architecture_fact" | "sketch_observation";
    summary: string;
    confidence: number | null;
  }[];
  maxCharacters: number;
}

export type StructuralAssessment =
  | { kind: "formal"; ugs: UniversalGraphSpec; ugsHash: string; evidencePackHash: string }
  | { kind: "clarification"; candidateUgs: UniversalGraphSpec; candidateUgsHash: string; clarification: DrawingClarification; evidencePackHash: string }
  | { kind: "rejected"; errorCategory: StructuralErrorCategory };

export type ArchitectureDescriptionCompilation =
  | { kind: "formal"; ugs: UniversalGraphSpec; pvp: PublicationVisualPreview }
  | { kind: "clarification"; candidateUgs: UniversalGraphSpec; candidateUgsHash: string; clarification: DrawingClarification }
  | { kind: "rejected"; errorCategory: StructuralErrorCategory };
```

The Coordinator owns the mapping from `ProviderContextReference` to `ProviderContextPayload`; callers and Providers cannot construct it. The Provider responds with `InterpreterLocalProposal`, whose evidence relations use only the received local fact tokens. `ArchitectureDescriptionCompilation` may contain `pvp` only in its `formal` member.

---

### Task 0: Prove the platform prerequisites and freeze the old path

**Files:**

- Create: `docs/evidence/2026-08-21-m2-12-prerequisite-check.md`
- Modify: `docs/agent-program-state.json`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/implementation-records/operation-history.md`
- Modify: `docs/evidence/2026-08-21-drawing-run-migration-inventory.md`

**Consumes:** Accepted platform Phase 0–2 evidence and the legacy compiler/session/route inventory.

**Produces:** A recorded go/no-go decision and a complete map from each old interpretation caller to its Coordinator-backed successor.

- [ ] **Step 1: Write the governance RED assertions.**

Add roadmap tests that reject any M2.12 acceptance record unless it references accepted DrawingRun and Coordinator predecessor evidence, and reject a vNext route that lists a compatibility interpreter as its canonical input.

- [ ] **Step 2: Run the governance RED tests.**

Run: `npx vitest run apps/api/tests/agent-roadmap.test.ts apps/api/tests/agent-roadmap-cli.test.ts`

Expected: FAIL until prerequisite dependencies and migration inventory references exist.

- [ ] **Step 3: Record the migration inventory and prerequisite decision.**

For `architecture-interpretation-contract.ts`, `evidence-augmented-ugs-interpreter.ts`, `evidence-augmented-ugs-harness.ts`, `universal-input-compilation-service.ts`, `evidence-constrained-drawing-session.ts`, and every route caller, record: incoming DTO, whether it can create public UGS/PVP, replacement module, default selection, retirement condition, and rollback rule. A rollback disables the vNext route selection; it does not send new requests to the compatibility interpreter.

- [ ] **Step 4: Run the governance GREEN checks.**

Run:

```text
npx vitest run apps/api/tests/agent-roadmap.test.ts apps/api/tests/agent-roadmap-cli.test.ts
npm run agent:render-roadmap
npm run agent:verify-roadmap
```

Expected: PASS. M2.12 remains `active` with no acceptance evidence until later tasks complete.

- [ ] **Step 5: Commit the prerequisite record.**

```text
git add docs/evidence/2026-08-21-m2-12-prerequisite-check.md docs/evidence/2026-08-21-drawing-run-migration-inventory.md docs/agent-program-state.json docs/ROADMAP.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/implementation-records/operation-history.md apps/api/tests/agent-roadmap.test.ts apps/api/tests/agent-roadmap-cli.test.ts
git commit -m "docs(agent): gate M2.12 on drawing run prerequisites"
```

### Task 1: Implement private receipt, verified EvidencePack, and Provider payload separation

**Files:**

- Create: `apps/api/src/drawing-input/private-receipt.ts`
- Create: `apps/api/src/drawing-structure/evidence-pack.ts`
- Create: `apps/api/src/drawing-structure/provider-context.ts`
- Create: `apps/api/src/drawing-structure/public-evidence-reference.ts`
- Create: `apps/api/tests/drawing-input/private-receipt.test.ts`
- Create: `apps/api/tests/drawing-structure/evidence-pack.test.ts`
- Create: `apps/api/tests/drawing-structure/provider-context.test.ts`
- Create: `apps/api/tests/drawing-structure/public-evidence-reference.test.ts`
- Modify: `apps/api/src/drawing-run/coordinator.ts`
- Modify: `apps/api/src/drawing-run/artifact-store.ts`

**Consumes:** Accepted DrawingRun Coordinator, owner/device/revision fence, ArtifactStore, and cancellation semantics.

**Produces:** A Coordinator-owned private receipt, canonical EvidencePack, internal context reference, redacted Provider payload, and Harness-owned public evidence projection.

- [ ] **Step 1: Write failing receipt and context-separation tests.**

```ts
const context = createProviderContext(validCoordinatorInput);
expect(context.reference).toMatchObject({ runId: "run-1", expectedRevision: 3 });
expect(JSON.stringify(context.payload)).not.toContain("receipt-");
expect(JSON.stringify(context.payload)).not.toContain("run-1");
expect(JSON.stringify(context.payload)).not.toContain("C:\\private\\model.py");
expect(() => createPrivateInputReceipt({ ownerId: "owner-1", kind: "architecture_description" })).toThrow();
expect(() => buildEvidencePack(conflictingLocatorFacts)).toThrow(/conflict/i);
expect(projectPublicEvidence(reorderedFacts)).toEqual(projectPublicEvidence(verifiedFacts));
```

Cover valid server-created receipt construction, digest mismatch, byte/MIME limits, owner/device mismatch, cancellation, expired context, duplicate evidence deduplication, same locator/different digest conflict, and a public projection that excludes receipt/context/raw content/path/provider text.

- [ ] **Step 2: Run the receipt/context RED suite.**

Run: `npx vitest run apps/api/tests/drawing-input/private-receipt.test.ts apps/api/tests/drawing-structure/evidence-pack.test.ts apps/api/tests/drawing-structure/provider-context.test.ts apps/api/tests/drawing-structure/public-evidence-reference.test.ts`

Expected: FAIL because the new contracts and projection do not exist.

- [ ] **Step 3: Implement the smallest closed boundary.**

`createPrivateInputReceipt` accepts a defined Coordinator-only intake shape, computes or verifies SHA-256, validates kind/MIME/size, and returns metadata only. Raw bytes live only in the receipt content handle controlled by ArtifactStore. `buildEvidencePack` validates source lineage and canonical evidence keys. `createProviderContext` validates run owner/device/revision/cancellation/expiry, retains the internal reference, and projects only bounded fact summaries under `fact:f:*` tokens. `projectPublicEvidence` mints sorted `evidence:e:*` IDs only after deduplication/conflict detection.

- [ ] **Step 4: Run the receipt/context GREEN suite and typecheck.**

Run:

```text
npx vitest run apps/api/tests/drawing-input/private-receipt.test.ts apps/api/tests/drawing-structure/evidence-pack.test.ts apps/api/tests/drawing-structure/provider-context.test.ts apps/api/tests/drawing-structure/public-evidence-reference.test.ts apps/api/tests/drawing-run/coordinator.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit the input/evidence slice.**

```text
git add apps/api/src/drawing-input/private-receipt.ts apps/api/src/drawing-structure/evidence-pack.ts apps/api/src/drawing-structure/provider-context.ts apps/api/src/drawing-structure/public-evidence-reference.ts apps/api/src/drawing-run/coordinator.ts apps/api/src/drawing-run/artifact-store.ts apps/api/tests/drawing-input/private-receipt.test.ts apps/api/tests/drawing-structure/evidence-pack.test.ts apps/api/tests/drawing-structure/provider-context.test.ts apps/api/tests/drawing-structure/public-evidence-reference.test.ts
git commit -m "feat(agent): separate private receipt and provider payload"
```

### Task 2: Implement local-only interpreter service and canonical Structural Harness

**Files:**

- Create: `apps/api/src/drawing-structure/interpreter-contract.ts`
- Create: `apps/api/src/drawing-structure/interpreter-service.ts`
- Create: `apps/api/src/drawing-structure/structural-harness.ts`
- Create: `apps/api/src/drawing-structure/public-display-text.ts`
- Create: `apps/api/src/drawing-structure/clarification-policy.ts`
- Create: `apps/api/tests/drawing-structure/interpreter-service.test.ts`
- Create: `apps/api/tests/drawing-structure/structural-harness.test.ts`
- Create: `apps/api/tests/drawing-structure/public-display-text.test.ts`
- Create: `apps/api/tests/drawing-structure/clarification-policy.test.ts`
- Modify: `apps/api/src/architecture-interpretation-contract.ts`
- Modify: `apps/api/src/evidence-augmented-ugs-interpreter.ts`
- Modify: `apps/api/src/evidence-augmented-ugs-harness.ts`

**Consumes:** Task 1 EvidencePack/context boundary and existing UGS parser/validator.

**Produces:** An optional cancellable Provider call that returns local-only proposals and the only canonical UGS authority.

- [ ] **Step 1: Write the structural RED matrix.**

```ts
expect(assessStructure({ evidence, proposal: renamedAndReorderedProposal, detail: "architecture" }).ugsHash)
  .toBe(assessStructure({ evidence, proposal: originalProposal, detail: "architecture" }).ugsHash);
expect(assessStructure({ evidence, proposal: symmetricAmbiguousProposal, detail: "architecture" }).kind)
  .toBe("clarification");
expect(JSON.stringify(formal.ugs)).not.toContain("provider-local-input");
expect(JSON.stringify(formal.ugs)).not.toContain("C:\\private\\model.py");
expect(projectPublicDisplayText("C:\\private\\model.py")).toThrow();
expect(composePvpForAssessment(blockingAssessment)).toBeUndefined();
```

Independently cover unknown proposal field, unknown local fact token, duplicate local reference, dangling port, invalid direction, input incoming edge, output without input, invalid merge arity, missing residual data/skip lanes, missing cross-attention roles, conflict with proven facts, Provider timeout, non-timeout Provider error, stale/cancelled completion, local-ref renaming, array permutation, isomorphic branches, non-isomorphic graphs, and all forbidden public-text forms.

- [ ] **Step 2: Run the structural RED suite.**

Run: `npx vitest run apps/api/tests/drawing-structure/interpreter-service.test.ts apps/api/tests/drawing-structure/structural-harness.test.ts apps/api/tests/drawing-structure/public-display-text.test.ts apps/api/tests/drawing-structure/clarification-policy.test.ts`

Expected: FAIL because the replacement interpreter/Harness does not exist.

- [ ] **Step 3: Implement timeout-safe local proposal handling.**

`interpreter-service.ts` accepts only `ProviderContextPayload` produced by the Coordinator, applies the run revision/cancellation fence, and converts timeout to one deterministic unavailable clarification. A non-timeout Provider error is not reclassified as timeout. It never returns raw Provider response text to a caller.

- [ ] **Step 4: Implement canonical formalization and public text projection.**

Strictly parse local references and local fact tokens. Canonicalize evidence first. Compute semantic/evidence/port/relation neighbourhood fingerprints to a fixed point; use canonical component serialization as the sole ID-order source; never use a Provider local reference or array position as a tie-break. Reject or clarify unresolved semantic symmetry. Mint canonical evidence/node/port/edge IDs, rewrite all relations, allowlist public display text, validate UGS, and return only `formal`, `clarification`, or `rejected` assessment.

- [ ] **Step 5: Run focused compatibility and complete structural verification.**

Run:

```text
npx vitest run apps/api/tests/drawing-structure apps/api/tests/evidence-augmented-ugs-interpreter.test.ts apps/api/tests/universal-graph-spec.test.ts apps/api/tests/static-pytorch-universal-graph-spec.test.ts apps/api/tests/prompt-universal-graph-spec.test.ts
npx tsc --noEmit
git diff --check
```

Expected: PASS. Legacy tests are green through the compatibility adapter only.

- [ ] **Step 6: Commit the structural slice.**

```text
git add apps/api/src/drawing-structure apps/api/src/architecture-interpretation-contract.ts apps/api/src/evidence-augmented-ugs-interpreter.ts apps/api/src/evidence-augmented-ugs-harness.ts apps/api/tests/drawing-structure apps/api/tests/evidence-augmented-ugs-interpreter.test.ts
git commit -m "feat(agent): make harness the canonical structural authority"
```

### Task 3: Integrate Coordinator-backed compilation, clarification, and cutover

**Files:**

- Create: `apps/api/src/drawing-input/architecture-description.ts`
- Create: `apps/api/src/drawing-run/clarification-token.ts`
- Create: `apps/api/tests/drawing-input/architecture-description.test.ts`
- Create: `apps/api/tests/drawing-run/clarification-token.test.ts`
- Modify: `apps/api/src/universal-input-compilation-service.ts`
- Modify: `apps/api/src/evidence-constrained-drawing-session.ts`
- Modify: `apps/api/src/drawing-run/session-adapter.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/universal-input-compilation-service.test.ts`
- Modify: `apps/api/tests/evidence-constrained-drawing-session.test.ts`
- Modify: `apps/api/tests/drawing-run/session-adapter.test.ts`

**Consumes:** Task 2 `StructuralAssessment` and platform Phase 5 versioned-route boundary.

**Produces:** Formal-only PVP compilation, revision-bound clarification answer handling, and a versioned vNext route that cannot fall back to the compatibility interpreter.

- [ ] **Step 1: Write the integration RED tests.**

```ts
expect(compileArchitectureDescriptionFromRun(formalRun, options).kind).toBe("formal");
expect(compileArchitectureDescriptionFromRun(blockingRun, options)).toMatchObject({ kind: "clarification" });
expect("pvp" in compileArchitectureDescriptionFromRun(blockingRun, options)).toBe(false);
expect(() => answerClarification(foreignOwnerAnswer)).toThrow(/owner/i);
expect(() => answerClarification(staleRevisionAnswer)).toThrow(/revision/i);
expect(() => answerClarification(wrongEvidencePackAnswer)).toThrow(/evidence/i);
```

Also prove no formal PVP/Snapshot/export/Worker call occurs for candidate, clarification, rejection, cancellation, or stale Provider result; the route never accepts caller-supplied receipt/context/proposal; and a new route cannot import `evidence-augmented-ugs-interpreter.ts` or `evidence-augmented-ugs-harness.ts`.

- [ ] **Step 2: Run the integration RED suite.**

Run: `npx vitest run apps/api/tests/drawing-input/architecture-description.test.ts apps/api/tests/drawing-run/clarification-token.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/drawing-run/session-adapter.test.ts`

Expected: FAIL because callers still consume the compatibility request/proposal shape.

- [ ] **Step 3: Implement formal-only compilation and clarification tokens.**

`compileArchitectureDescriptionFromRun` loads the Coordinator-owned receipt/EvidencePack and assessment by run/revision; it does not accept raw receipt/context/proposal parameters. It invokes PVP composition only for `formal`. `clarification-token.ts` binds `{ runId, ownerId, deviceId, expectedRevision, evidencePackHash, candidateUgsHash, clarificationId }`; foreign, stale, cancelled, or mismatched answers fail before recomputation. The session is a presentation adapter over the stored run artifact and cannot regenerate UGS.

- [ ] **Step 4: Implement versioned cutover and safe rollback.**

Add a vNext Coordinator-backed route while preserving legacy route response semantics. The vNext route is selected only after Task 1–3 focused tests pass. Its rollback switch disables vNext selection and returns a safe unavailable response; it never routes a new request through the legacy free-text interpreter. Remove compatibility imports from all new routes before declaring cutover complete.

- [ ] **Step 5: Run focused and full API verification.**

Run:

```text
npx vitest run apps/api/tests/drawing-input/architecture-description.test.ts apps/api/tests/drawing-structure apps/api/tests/drawing-run apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/prompt-universal-graph-spec.test.ts apps/api/tests/static-pytorch-universal-graph-spec.test.ts
npx tsc --noEmit
npm run api:test
npm run api:check
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit the integration slice.**

```text
git add apps/api/src/drawing-input/architecture-description.ts apps/api/src/drawing-run/clarification-token.ts apps/api/src/universal-input-compilation-service.ts apps/api/src/evidence-constrained-drawing-session.ts apps/api/src/drawing-run/session-adapter.ts apps/api/src/routes.ts apps/api/tests/drawing-input/architecture-description.test.ts apps/api/tests/drawing-run/clarification-token.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/drawing-run/session-adapter.test.ts
git commit -m "feat(agent): route formal drawings through receipt-bound harness"
```

### Task 4: Record M2.12 acceptance only after independent review

**Files:**

- Create: `docs/evidence/2026-08-21-m2-12-receipt-bound-harness.md`
- Modify: `docs/agent-program-state.json`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/implementation-records/operation-history.md`

**Consumes:** Complete Task 0–3 commits and their verification output.

**Produces:** Evidence-backed transition from `active` to `awaiting_acceptance`; owner approval is separately required for `accepted`.

- [ ] **Step 1: Re-run the acceptance matrix before editing the ledger.**

Run:

```text
npx vitest run apps/api/tests/drawing-input apps/api/tests/drawing-structure apps/api/tests/drawing-run apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts
npx tsc --noEmit
npm run api:test
npm run api:check
npm run agent:verify-roadmap
git diff --check
```

Expected: every command exits 0 and the output is recorded with the resulting commit SHA.

- [ ] **Step 2: Obtain independent review against the security and identity matrix.**

The reviewer must verify: no Provider receives private IDs/bytes; no public artifact contains private/context/local/provider/path/source/native text; canonical hash is invariant under local-ref rename and ordering changes; evidence conflicts and structural symmetry fail closed; only formal outcomes create PVP; stale/cancelled/foreign clarification operations fail closed; and vNext routes cannot fall back to compatibility interpretation.

- [ ] **Step 3: Record only actual evidence and advance the state once.**

Record focused tests, full tests, TypeScript, independent review, implementation record, commit SHA, and exact predecessor evidence. Move M2.12 from `active` to `awaiting_acceptance` only if every acceptance clause is satisfied. Move to `accepted` only after owner acceptance. M2.13 remains planned until that transition is complete.

- [ ] **Step 4: Render and verify governance output.**

Run: `npm run agent:render-roadmap && npm run agent:verify-roadmap`

Expected: generated roadmap exactly matches `agent-program-state.json` with no dependency or evidence error.

- [ ] **Step 5: Commit verified governance evidence.**

```text
git add docs/evidence/2026-08-21-m2-12-receipt-bound-harness.md docs/agent-program-state.json docs/ROADMAP.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/implementation-records/operation-history.md
git commit -m "docs(agent): record receipt-bound M2.12 harness evidence"
```

## Plan self-review

- **Coverage:** Tasks 0–3 cover prerequisite authority, receipt/EvidencePack, internal-reference/transmitted-payload split, public text/evidence projection, canonical rekeying, formal-only PVP, clarification fencing, versioned cutover, and compatibility retirement. Task 4 is the separate evidence gate.
- **No parallel pipeline:** The plan consumes Phase 1–2 outputs and uses their Coordinator/ArtifactStore. It forbids receipt/session/persistence creation outside that authority.
- **No placeholder acceptance:** Every task has exact files, input/output boundaries, negative cases, commands, expected result, and a narrow commit allowlist.
- **Explicit exclusions:** Provider-quality, visual grammar, Sketch, Snapshot/export, Worker/COM/Visio, existing-page binding, and real-host acceptance remain outside M2.12.
