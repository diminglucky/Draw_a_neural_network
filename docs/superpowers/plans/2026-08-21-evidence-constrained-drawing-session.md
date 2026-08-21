# Evidence-Constrained Drawing Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure, owner/device-bound Agent-core drawing session that safely turns supported input into a deterministic UGS/GPG/PVP preview or one clarification, then recomputes only the affected semantic region after a bounded confirmation.

**Architecture:** A renderer-neutral service wraps the existing typed-prompt/static-PyTorch UGS compilers and publication preview service. It returns immutable session revisions containing canonical hashes and semantic PVP identity; it never persists state or exposes raw source, renderer control, Snapshot, export, Worker, or COM authority.

**Tech Stack:** TypeScript, Node SHA-256, Vitest, existing UGS/GPG/PVP parsers and compilers.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`.
- Preserve and do not stage the pre-existing visual-rubric drafts reported by `git status --short`.
- Do not execute submitted code or select visual grammar by model name.
- The session result must contain no raw prompt/code/sketch bytes, path, browser geometry, provider credential, Worker/COM command, Snapshot, export token, or VSDX authority.
- A blocking topology produces one clarification and no PVP; formal/candidate PVPs remain renderer-neutral and export-ineligible.
- Production behavior begins with a focused failing Vitest test and is implemented minimally.

---

## File structure

- `apps/api/src/evidence-constrained-drawing-session.ts`: pure session contract, canonical identity, clarification derivation, confirmation, and semantic delta projection.
- `apps/api/tests/evidence-constrained-drawing-session.test.ts`: formal, static-code, clarification, confirmation, ownership, tamper, and determinism coverage.
- `docs/superpowers/specs/2026-08-21-evidence-constrained-drawing-agent-design.md`: approved core-Agent contract.
- `docs/superpowers/plans/2026-08-21-evidence-constrained-drawing-session.md`: this implementation plan.
- `docs/agent-program-state.json`, `docs/ROADMAP.md`, and the current implementation record: move the declared focus from renderer authorization to this core capability without accepting it prematurely.

### Task 1: Define the renderer-neutral session contract and open flow

**Files:**
- Create: `apps/api/tests/evidence-constrained-drawing-session.test.ts`
- Create: `apps/api/src/evidence-constrained-drawing-session.ts`

**Interfaces:**
- Consumes: `UniversalPreviewInput`, `PublicationVisualPlanUpdateIdentity`, parsed UGS.
- Produces: `openEvidenceConstrainedDrawingSession(input): EvidenceConstrainedDrawingSession`.

- [ ] **Step 1: Write the failing formal-session test**

```ts
const session = openEvidenceConstrainedDrawingSession(formalPromptRequest());
expect(session.state).toBe("formal_preview");
expect(session.preview?.pvp.eligibility.kind).toBe("formal");
expect(session.rawSource).toBeUndefined();
```

- [ ] **Step 2: Run the focused test and observe missing-module failure**

Run: `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts`

Expected: FAIL because `evidence-constrained-drawing-session` does not exist.

- [ ] **Step 3: Implement minimum parsed-input, canonical identity, and formal/candidate preview flow**

```ts
export function openEvidenceConstrainedDrawingSession(
  input: EvidenceConstrainedDrawingSessionOpenRequest,
): EvidenceConstrainedDrawingSession;
```

Derive UGS only with `compileUniversalInputToPublicationPreview`; derive update identity from the caller owner and bounded update target; use SHA-256 over a canonical session projection. Return a deep-frozen session with source IDs/hashes but no raw input.

- [ ] **Step 4: Add and run static-source and deterministic-identity tests**

```ts
expect(openEvidenceConstrainedDrawingSession(staticRequest()).state).toBe("formal_preview");
expect(openEvidenceConstrainedDrawingSession(formalPromptRequest())).toEqual(
  openEvidenceConstrainedDrawingSession(formalPromptRequest()),
);
```

Run: `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts`

Expected: PASS.

### Task 2: Add clarification, bounded confirmation, and semantic local delta

**Files:**
- Modify: `apps/api/tests/evidence-constrained-drawing-session.test.ts`
- Modify: `apps/api/src/evidence-constrained-drawing-session.ts`

**Interfaces:**
- Consumes: current immutable session plus confirmation `{ owner, sessionId, expectedRevision, questionId, value }`.
- Produces: `confirmEvidenceConstrainedDrawingSession(session, confirmation): EvidenceConstrainedDrawingSession`.

- [ ] **Step 1: Write failing clarification and confirmation tests**

```ts
const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
expect(pending).toMatchObject({ state: "clarification", preview: undefined, revision: 1 });
const resolved = confirmEvidenceConstrainedDrawingSession(pending, matchingConfirmation(pending));
expect(resolved).toMatchObject({ state: "formal_preview", revision: 2 });
expect(resolved.delta.affectedUgsIds.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run focused tests and observe the expected missing confirmation behavior**

Run: `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts`

Expected: FAIL because clarification/confirmation is not implemented.

- [ ] **Step 3: Implement exactly-one-question and confirmation transformation**

Choose the first blocking topology unresolved item by code-unit ordering. Require the only initial answer `confirm-topology-complete`; remove only that unresolved item, increase UGS/session revision, recompute GPG/PVP with the shared preview service, and project delta IDs from old/new PVP semantic arrays. Reject wrong owner/device/session/revision/question/value or unknown fields.

- [ ] **Step 4: Add fail-closed boundary tests and run focused suite**

```ts
expect(() => confirmEvidenceConstrainedDrawingSession(pending, foreignOwnerConfirmation(pending))).toThrow();
expect(() => confirmEvidenceConstrainedDrawingSession(pending, staleConfirmation(pending))).toThrow();
expect(() => openEvidenceConstrainedDrawingSession(unsafeControlRequest())).toThrow();
```

Run: `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts`

Expected: PASS.

### Task 3: Record the deliberate priority shift and verify the slice

**Files:**
- Modify: `docs/agent-program-state.json`
- Modify: `docs/ROADMAP.md`
- Modify: current implementation record under `docs/agent-governance/implementation-records/`

- [ ] **Step 1: Record M3.2 as deferred by product priority and set the core session as active non-accepted work**

Keep the export/Worker chain planned. Record that this slice is not Snapshot, export, Visio, or professional visual acceptance.

- [ ] **Step 2: Self-review documents and implementation scope**

Run: `rg -n "TODO|TBD|VGG|Visio Worker|COM" docs/superpowers/specs/2026-08-21-evidence-constrained-drawing-agent-design.md docs/superpowers/plans/2026-08-21-evidence-constrained-drawing-session.md apps/api/src/evidence-constrained-drawing-session.ts`

Expected: no placeholder; references to Worker/COM only in explicit non-goal or prohibition text; no model-specific routing.

- [ ] **Step 3: Run the focused and repository verification matrix**

Run: `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts; npx tsc --noEmit; npm run api:check; npm run agent:verify-roadmap; npm run api:test; git diff --check`

Expected: each command exits 0. This proves the core session’s unit/integration boundary, not real browser or Visio acceptance.

- [ ] **Step 4: Commit only the exact new session/docs/governance allowlist after verification**

```powershell
git add -- apps/api/src/evidence-constrained-drawing-session.ts apps/api/tests/evidence-constrained-drawing-session.test.ts docs/superpowers/specs/2026-08-21-evidence-constrained-drawing-agent-design.md docs/superpowers/plans/2026-08-21-evidence-constrained-drawing-session.md docs/agent-program-state.json docs/ROADMAP.md docs/agent-governance/implementation-records/<current-record>.md
git diff --cached --check
git commit -m "feat(agent): add evidence-constrained drawing session"
```

Do not push unless separately requested. Do not stage the visual-rubric drafts.
