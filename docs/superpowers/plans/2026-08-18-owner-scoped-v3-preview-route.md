# M2.4 Owner-Scoped v3 Preview Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose an authenticated owner-scoped v3 preview route for persisted `FigureAnalysisRecord` values while candidate structures remain non-compilable and the legacy v2 Draft preview route remains unchanged.

**Architecture:** A dependency-free `FigureAnalysisPreviewService` loads a user-scoped analysis, returns a safe candidate projection, or compiles ready Architecture IR through the M2.3 publication-plan and Visual QA boundaries. One Fastify route and app wiring expose the service. M2.4 creates no PlanSnapshot or fake SVG/PNG artifacts.

**Tech Stack:** TypeScript strict mode, Fastify 5, Vitest 3, `FoundationStore`, `FigureAnalysisRecord`, M2.3 publication-plan/Visual QA modules, existing authentication/version conventions.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`; preserve unrelated dirty and untracked files.
- Require `Accept-Figure-Version: 3`; return `Figure-Version: 3` on successful responses.
- Scope every lookup by authenticated `userId`; missing and foreign analyses return the same safe `404`.
- Candidate structures return HTTP 200 with `STRUCTURE_PENDING_CONFIRMATION` and never call compiler, QA, snapshot store, export service, or Worker.
- Ready structures revalidate IR v3, compile through M2.3, and fail closed on unresolved output or failed blocking QA.
- Public output omits evidence index/payloads, source locators/excerpts, source code, paths, Provider/Worker fields, SVG/XML, and commands.
- Do not modify the v2 Draft preview route or `apps/api/src/visual-qa.ts`.
- Every production behavior follows RED -> GREEN -> REFACTOR; each task ends with focused verification and a narrow commit.

---

### Task 1: Define service contract and RED tests

**Files:** Create `apps/api/src/figure-analysis-preview-service.ts` and `apps/api/tests/figure-analysis-preview-service.test.ts`. Reference `figure-analysis.ts`, `store.ts`, `composable-dag-publication-plan.ts`, and `composable-dag-visual-qa.ts`.

**Interfaces:** `FigureAnalysisPreviewServiceOptions` contains `store: Pick<FoundationStore, "getFigureAnalysis">`, optional `compilePublicationPlan: typeof buildComposableDagPublicationPlan`, and optional `runVisualQa: typeof runComposableDagVisualQa`. Export `FigureAnalysisPreviewResponse` as the v3 candidate/publication-plan union defined in the M2.4 spec.

- [ ] Write RED tests with valid ready/candidate `FigureAnalysisRecord` fixtures. Inject builder/QA wrappers with counters. Candidate must return version 3, `kind: "candidate_structure"`, watermark, blocking question, and zero compiler/QA calls. Ready must return `kind: "publication_plan"`, passing QA, one builder call, one QA call, deterministic repeated bytes, no `evidenceIndex`, and no raw evidence. Cover missing/foreign records and blocking unresolved ready IR.
- [ ] Run `npx.cmd vitest run apps/api/tests/figure-analysis-preview-service.test.ts`; expected missing module/export failure.
- [ ] Commit only the RED test: `git add apps/api/tests/figure-analysis-preview-service.test.ts; git commit -m "test: define v3 analysis preview service contract"`.

---

### Task 2: Implement the pure service and safe projection

**Files:** Modify `apps/api/src/figure-analysis-preview-service.ts`; test `apps/api/tests/figure-analysis-preview-service.test.ts`.

- [ ] Default the injected functions to M2.3 builder/QA. Load with `getFigureAnalysis(userId, analysisId)` and use one safe not-found error for null. Candidate requires one persisted blocking question and returns before compiler/QA. Ready requires non-null IR and `validateArchitectureIRv3(record.architectureIR, undefined, { renderReady: true })`.
- [ ] For ready records call `buildComposableDagPublicationPlan({ architectureIr: validated.ir, intent: defaultFigureIntent(), layoutSeed: `m2-4-${record.id}` })`, reject unresolved result, run `runComposableDagVisualQa`, reject failed result, and return a deep-cloned projection.
- [ ] Projection includes only graph/version/intent/page geometry, bounded component/port/route fields, visual styles, labels, and QA version/status. Omit `evidenceIndex`, evidence IDs, source mappings, locators, excerpts, and compiler-only layout seed.
- [ ] Run `npx.cmd vitest run apps/api/tests/figure-analysis-preview-service.test.ts`; expected all GREEN.
- [ ] Commit `git add apps/api/src/figure-analysis-preview-service.ts apps/api/tests/figure-analysis-preview-service.test.ts; git commit -m "feat: add owner scoped v3 analysis preview service"`.

---

### Task 3: Add RED route tests

**Files:** Create `apps/api/tests/figure-analysis-preview-routes.test.ts`. Reference `figure-analysis-routes.test.ts`, `figure-draft-preview-routes.test.ts`, `app.ts`, and `routes.ts`.

- [ ] Use real `buildApp()`, registration/login, and `POST /api/figure-analyses`. Test missing version `400`, unauthenticated `401`, foreign owner `404`, same-owner ready `200` with response header `Figure-Version: 3`, candidate watermark/no compiler side effect, safe DTO omission, deterministic repeated response, no snapshot/export Job, and unchanged v2 Draft preview.
- [ ] The wished-for request is `GET /api/figure-analyses/${analysisId}/preview` with `accept-figure-version: 3`; assert response `{ version: 3, kind: "publication_plan", visualQa: { status: "pass" } }` for a ready fixture.
- [ ] Run `npx.cmd vitest run apps/api/tests/figure-analysis-preview-routes.test.ts`; expected route-not-found or missing app wiring.
- [ ] Commit `git add apps/api/tests/figure-analysis-preview-routes.test.ts; git commit -m "test: define owner scoped v3 preview route"`.

---

### Task 4: Wire app, route, audit, and compatibility GREEN tests

**Files:** Modify `apps/api/src/app.ts`, `apps/api/src/routes.ts`, and the route test.

- [ ] Add optional `figureAnalysisPreviewService` to `BuildAppOptions`/`RouteOptions`, instantiate from `FoundationStore` by default, and register `GET /api/figure-analyses/:analysisId/preview` after the v3 analysis read route.
- [ ] Reuse `figureAnalysisVersion`, `requireUser`, and `safeIdentifier`; accept no body or client plan. Call `service.preview(access.user.id, analysisId)`, audit only analysis ID/kind/capability/version/counts/QA status, set `Figure-Version: 3`, and return the safe response.
- [ ] Run `npx.cmd vitest run apps/api/tests/figure-analysis-preview-service.test.ts apps/api/tests/figure-analysis-preview-routes.test.ts apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/figure-draft-preview-routes.test.ts apps/api/tests/universal-preview-service.test.ts apps/api/tests/visual-qa.test.ts apps/api/tests/composable-dag-visual-qa.test.ts`.
- [ ] Commit `git add apps/api/src/app.ts apps/api/src/routes.ts apps/api/tests/figure-analysis-preview-routes.test.ts; git commit -m "feat: expose owner scoped v3 analysis preview route"`.

---

### Task 5: Verify, evidence, and roadmap acceptance

**Files:** Create `docs/evidence/2026-08-18-m2-4-owner-scoped-v3-preview-route.md`; modify `docs/agent-program-state.json` only after gates; regenerate `docs/ROADMAP.md`. Preserve the two unrelated untracked plans.

- [ ] Run the focused Task 4 suite and record exact counts.
- [ ] Run `npm.cmd run api:test`, `npx.cmd tsc --noEmit`, `npm.cmd run api:check`, `npm.cmd run agent:verify-roadmap`, and `git diff --check`.
- [ ] Write evidence with commits, focused/full counts, typecheck/foundation/roadmap results, owner/candidate/DTO boundaries, and explicit non-acceptance of screenshot QA, artifact rendering, PlanSnapshot, Provider, live PostgreSQL/Redis, Electron, Worker-live, Visio COM, VSDX, and close/reopen/readback.
- [ ] Move M2.4 through `planned -> active -> awaiting_acceptance -> accepted`, set `currentFocus` to the next executable node, render roadmap, and rerun `npm.cmd run agent:verify-roadmap`.
- [ ] Review `git status --short --branch`, `git diff --stat`, and `git diff --check`; stage only M2.4 evidence/state/generated roadmap and commit `docs: record m2.4 preview route evidence`. Never stage the two unrelated plans or push/merge without user choice.
