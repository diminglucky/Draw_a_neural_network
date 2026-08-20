# PublicationVisualPlan Browser Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an owner-scoped, revision-bound `PublicationVisualPlan` response as a safe, renderer-neutral browser SVG preview without creating any second browser geometry contract.

**Architecture:** The browser obtains only `GET /api/figure-drafts/:draftId/revisions/:revision/publication-preview` responses negotiated as Figure-Version 3. A new isolated PVP renderer validates the allowed response and renders exact PVP page coordinates, primitives, anchors and connector routes into escaped SVG. The existing Plan v2 preview remains untouched migration-only code; the chat card obtains an explicit PVP preview only after a user click.

**Tech Stack:** Browser ESM JavaScript, existing Vitest, existing escaped-string UI helpers, strict JSON-object validation.

## Global Constraints

- The canonical flow remains `UGS → GPG → PVP → SVG`; no client-originated geometry may be sent to the API.
- Accept only `formal`, `candidate`, or `clarification`; clarification has no PVP/SVG, while candidate is visibly preview-only and offers no Snapshot/export/Visio action.
- Preserve exact `pvp-du-1` coordinates (`1000 du = 1 inch`), PVP page bounds, port anchors and orthogonal connector routes; do not infer a second layout in the browser.
- Fail closed on unknown primitive kinds, malformed route/port references, non-integer or out-of-page geometry, unsupported capability protocol, unsafe record shapes, or response leakage fields.
- Escape every visible label/question/value. Never render evidence locators, excerpts, raw source, paths, provider data, commands, worker/COM/Visio configuration, SVG from a response, or arbitrary HTML.
- Do not add Snapshot persistence, export authorization, Worker invocation, VSDX handling, Visio page/document creation, `applyDiff`, or host acceptance in this slice.
- Keep all existing dirty-worktree changes intact; no commit or push without a new explicit user request.

---

## File Map

| File | Responsibility |
|---|---|
| `publication-visual-plan-preview.js` | Strict response/PVP projection and safe, deterministic PVP SVG renderer. |
| `apps/client/publication-visual-plan-preview.test.js` | Formal/candidate/clarification, escaping, route and fail-closed renderer evidence. |
| `chat-agent.js` | Revision-bound read-only PVP fetch helper and click-only PVP preview card integration. |
| `apps/client/chat-agent.test.js` | Exact PVP request contract and UI helper/card regression tests. |
| `styles.css` | Scoped PVP preview/candidate/clarification presentation only. |
| `docs/superpowers/plans/2026-08-20-u2-pvp-browser-preview.md` | This executed U2 browser-preview plan. |

## Public Interfaces

```js
export function renderPublicationVisualPlanPreview(response) { /* returns safe SVG */ }
export function publicationVisualPreviewSummary(response) { /* bounded public summary */ }
export function renderPublicationVisualClarification(response) { /* returns safe HTML fragment */ }

export async function getPublicationVisualPreview(draftId, revision, options = {}) { /* GET only */ }
```

The fetch helper accepts only `{ apiBase?, token, fetchImpl? }`, uses `Authorization: Bearer <token>` plus `Accept-Figure-Version: 3`, and sends neither a body nor idempotency key. It returns only a response that passes local safe-shape validation.

---

### Task 1: Isolated safe PVP SVG renderer

**Files:**
- Create: `publication-visual-plan-preview.js`
- Create: `apps/client/publication-visual-plan-preview.test.js`

**Consumes:** The bounded v3 `formal|candidate|clarification` response and PVP v1 fields emitted by `publication-visual-plan-compiler.ts`.

**Produces:** `renderPublicationVisualPlanPreview`, `publicationVisualPreviewSummary`, and `renderPublicationVisualClarification` for Task 2.

- [ ] **Step 1: Write failing renderer tests.** Add a self-contained dual-stream PVP fixture with `Input`, `CustomOperator`, `CustomModule`, `MergeConcat`, ports and four-point orthogonal routes. Assert the SVG has the PVP page `viewBox`, PVP primitive IDs/classes, unmodified connector route points and escaped labels. Add candidate, clarification, unknown primitive, invalid geometry, mismatched route endpoint, unsupported protocol and forbidden-leakage assertions.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/client/publication-visual-plan-preview.test.js`

Expected: test-file/module resolution fails because `publication-visual-plan-preview.js` does not yet exist.

- [ ] **Step 3: Implement the smallest strict renderer.** Define closed sets for PVP primitive kinds, port sides and response fields. Validate dense arrays, plain records, finite non-negative integer page/bounds/route values, primitive/port/connector identity, anchor-derived endpoints and every point inside the PVP page. Render `path` connectors from stored `route` points before primitive shapes; render a page background, labelled generic shapes, candidate watermark and escaped annotations. Reject clarification in the SVG renderer and render clarification separately from only question ID/text/candidate values.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/client/publication-visual-plan-preview.test.js && node --check publication-visual-plan-preview.js`

Expected: all focused assertions pass and Node reports no syntax error.

### Task 2: Revision-bound browser fetch and chat-card integration

**Files:**
- Modify: `chat-agent.js`
- Modify: `apps/client/chat-agent.test.js`
- Modify: `styles.css`

**Consumes:** Task 1 renderer; authenticated current FigureDraft ID/revision.

**Produces:** `getPublicationVisualPreview` and a click-only PVP preview panel that cannot invoke export, Worker, Visio or canvas mutations.

- [ ] **Step 1: Write failing client tests.** Import the new helper and assert an encoded draft ID/revision request uses exactly GET + `Authorization` + `Accept-Figure-Version: 3`, with no body. Assert rejection of failed/malformed responses. Assert PVP cards retain the existing migration preview while exposing a separate user-click PVP button, formal invokes the new renderer, candidate has visible preview-only copy, and clarification has no SVG. Assert rendered content contains no locator/excerpt/path/Worker/COM/Visio/export details.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/client/chat-agent.test.js -t "publication visual"`

Expected: import/export or expected new-card assertion failure because the helper and PVP UI path do not exist.

- [ ] **Step 3: Implement the read-only path.** Add `getPublicationVisualPreview` with strict positive-integer revision validation and local response validation from Task 1. Add a separate `data-agent-pvp-preview` button/panel only for a current ready draft revision. In the event handler, disable the clicked button while loading; call the GET helper; choose formal/candidate SVG or clarification fragment; re-enable in `finally`; and surface only an escaped bounded error. Add scoped CSS for PVP page, candidate badge and clarification list. Do not change legacy `getFigureDraftPreview`, its old endpoint or its renderer contract.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/client/chat-agent.test.js apps/client/publication-visual-plan-preview.test.js && node --check chat-agent.js && node --check publication-visual-plan-preview.js`

Expected: PVP and existing chat-client tests pass with syntax checks clean.

### Task 3: U2 boundary regression and self-review

**Files:**
- Modify only files from Tasks 1–2 if the verification exposes a direct contract defect.

**Consumes:** U1 PVP route and Tasks 1–2 browser path.

**Produces:** Evidence that browser UI consumes the same PVP route while current API authorization/clarification contracts remain intact.

- [ ] **Step 1: Run cross-layer focused matrix.**

Run: `npx vitest run apps/client/publication-visual-plan-preview.test.js apps/client/chat-agent.test.js apps/api/tests/figure-draft-preview-routes.test.ts apps/api/tests/publication-visual-plan.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts`

Expected: all focused browser, response and PVP tests pass.

- [ ] **Step 2: Run type/check matrix.**

Run: `npx tsc --noEmit && npm run api:test && npm run api:check && git diff --check -- publication-visual-plan-preview.js apps/client/publication-visual-plan-preview.test.js chat-agent.js apps/client/chat-agent.test.js styles.css docs/superpowers/plans/2026-08-20-u2-pvp-browser-preview.md`

Expected: all commands exit 0. This proves source/test/type/check integrity only; browser deployment, visual rubric, Snapshot/export, Visio and real-host lifecycle remain later gates.

## Plan Self-Review

- Task 1 is the single browser PVP parser/renderer; it keeps legacy Plan v2 types isolated and prevents browser-generated geometry.
- Task 2 is read-only, revision-bound UI consumption; it has no export or Visio side effect.
- Task 3 covers the PVP API boundary and broad repository regression checks.
- Scope explicitly excludes U3 Profiles, U4 input coverage, U5 Visio/applyDiff and any completion claim for the Agent product.
