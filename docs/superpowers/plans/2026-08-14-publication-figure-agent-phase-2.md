# PublicationFigureAgent Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist safe Phase-1 analyses as user-owned, append-only FigureDraft revisions that support one-question confirmation and optimistic concurrency.

**Architecture:** `FigureDraftService` is the only writer for draft/revision state. It consumes the Phase-1 public analysis boundary, creates revision 1, and appends a revision after a single confirmation using `expectedRevision` CAS. Store and routes enforce ownership; no Phase-2 object contains Provider keys, attachments, locators/excerpts, FigurePlan, primitive data, coordinates, output paths, or Visio jobs.

**Tech Stack:** TypeScript ESM, Zod, Vitest, Fastify, existing memory/Postgres FoundationStore.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`.
- Preserve the dirty worktree; do not use broad staging, reset, checkout, clean, force push, or overwrite VSDX files.
- Existing `/api/agent/chat`, Canvas compatibility output, authentication/device fencing, subscription/quota, idempotency, audits, and old `/api/visio/export` remain compatible.
- Draft/revision data is server-owned and user-scoped. Provider API keys, request headers, raw attachment bytes, evidence locator/excerpt, geometry, primitive IDs, output paths, FigurePlan, and Visio commands are forbidden.
- Phase 2 may only produce `needs_confirmation`, `ready_for_preview`, or `failed`; `ready_for_visio`, grammar selection, plan hashes, Worker calls, and VSDX creation remain out of scope.

---

### Task 1: Add Draft and Revision domain/store contracts

**Files:**
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Test: `apps/api/tests/figure-draft-store.test.ts`

**Produces:** `FigureDraft`, immutable `FigureDraftRevision`, `FigureDraftStatus`, user-scoped Store queries, and `appendFigureDraftRevision(input)` returning `{ revision, conflict }`.

- [ ] **Step 1: Write failing store tests** for create/read, cross-user invisibility, append success, and stale `expectedRevision` conflict.
- [ ] **Step 2: Run RED**

```powershell
npx vitest run apps/api/tests/figure-draft-store.test.ts
```

- [ ] **Step 3: Implement contracts and memory/Postgres persistence.** Revision payload contains only validated public `taskIntent`, public evidence, Canonical IR, blocking questions, warnings, and `readyForVisio: false`; create revision 1 and append only.
- [ ] **Step 4: Run GREEN** with the command above.

### Task 2: Implement FigureDraftService and revision CAS

**Files:**
- Create: `apps/api/src/figure-draft-service.ts`
- Test: `apps/api/tests/figure-draft-service.test.ts`

**Consumes:** `FoundationStore`, `FigureAnalysisResult`, `FigureDraft` contracts.

**Produces:** `createFromAnalysis(userId, conversationId, analysis)`, `get(userId, draftId)`, and `confirm(userId, draftId, expectedRevision, answer)`.

- [ ] **Step 1: Write failing tests** proving analysis creates revision 1, confirmation resolves exactly one blocking question into revision 2, revision 1 remains byte-equivalent, and stale CAS conflicts.
- [ ] **Step 2: Run RED**

```powershell
npx vitest run apps/api/tests/figure-draft-service.test.ts
```

- [ ] **Step 3: Implement minimal service.** Confirmation accepts only a candidate value from the single blocking question and replaces only that question; it never calls a Provider, Canvas action, grammar, plan, Worker, or Visio integration.
- [ ] **Step 4: Run GREEN** with the command above.

### Task 3: Add authenticated Draft routes and safe audit events

**Files:**
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/figure-draft-routes.test.ts`

**Produces:** user-authenticated `GET /api/figure-drafts/:draftId`, `GET /api/figure-drafts/:draftId/revisions/:revision`, and `POST /api/figure-drafts/:draftId/confirm`.

- [ ] **Step 1: Write failing route tests** for ownership fencing, device/session authentication, stale revision conflict, one-question confirmation, and no sensitive payload reflection.
- [ ] **Step 2: Run RED**

```powershell
npx vitest run apps/api/tests/figure-draft-routes.test.ts
```

- [ ] **Step 3: Implement routes.** Require existing user access; response projects only safe Draft/Revision fields; audit only draft ID, revision, status, and counts. Preserve all old routes, especially `/api/visio/export`.
- [ ] **Step 4: Run GREEN** with the command above.

### Task 4: Persist Agent analysis as revision 1 without breaking legacy chat

**Files:**
- Modify: `apps/api/src/agent-service.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/agent-service.test.ts`
- Modify: `apps/api/tests/agent-routes.test.ts`

**Produces:** optional safe `draft` summary in successful Agent chat results.

- [ ] **Step 1: Write failing compatibility tests** proving a safe v2 analysis yields a user-owned Draft revision 1; `needs_confirmation` persists its one blocking question; legacy `networkIR`, `diagram`, and `actions` remain present; invalid/no analysis creates no draft.
- [ ] **Step 2: Run RED**

```powershell
npx vitest run apps/api/tests/agent-service.test.ts apps/api/tests/agent-routes.test.ts
```

- [ ] **Step 3: Implement only the service dependency and route projection.** Do not persist provider keys or old Canvas drawing data as authoritative draft state.
- [ ] **Step 4: Run GREEN** with the command above.

### Task 5: Phase-2 regression and boundary acceptance

**Files:**
- Modify only if a test fixture requires a safe Draft fixture.

- [ ] **Step 1: Run focused suite**

```powershell
npx vitest run apps/api/tests/figure-draft-store.test.ts apps/api/tests/figure-draft-service.test.ts apps/api/tests/figure-draft-routes.test.ts apps/api/tests/agent-service.test.ts apps/api/tests/agent-routes.test.ts apps/api/tests/routes.test.ts
```

- [ ] **Step 2: Run strict TypeScript** over new/changed Phase-2 source files and `git diff --check` over exact paths.
- [ ] **Step 3: Contract scan** confirms no `FigurePlan`, primitive ID, coordinate, output path, Provider key, Visio Worker, COM, or VSDX operation exists in Draft domain/service/routes.
- [ ] **Step 4: Record explicitly unimplemented gates:** Grammar Registry, FigurePlan v2, Visual QA, draft-bound Visio export, Worker v2, real Visio/VSDX acceptance.
