# Publication Figure Browser Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a server-compiled `PublicationFigurePlan v2` as a deterministic, safe, publication-style browser preview that users can inspect before any future Visio action.

**Architecture:** A new dependency-free client renderer consumes only the authenticated preview API response and maps its fixed primitive/relation allowlists to escaped SVG markup. `chat-agent.js` fetches a ready Draft preview only on an explicit user click and mounts it as a FigureDraft card; it never mutates the legacy Canvas, invokes `/api/visio/export`, or forwards the plan to desktop code.

**Tech Stack:** Native ES modules, SVG markup generated from validated Plan v2, Vitest, existing fixed API relay/authentication helpers, existing Agent drawer CSS.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`; preserve unrelated dirty changes and never broad-stage, reset, checkout, clean, force-push, or overwrite VSDX files.
- `PublicationFigurePlan v2` is preview-only. The renderer must not contain COM, Visio, Worker, output-path, shell, SVG supplied by a model, arbitrary renderer, or Canvas mutation APIs.
- The preview fetch must be `GET /api/figure-drafts/:draftId/preview`, bearer-authenticated, owner-scoped, and initiated only by an explicit UI action.
- The renderer supports exactly the Plan v2 primitive/relation allowlists. Unknown kinds, missing finite bounds, invalid page dimensions, duplicate IDs, and unsafe text must fail closed rather than be interpolated into the DOM.
- Client rendering remains separate from FigureDraft persistence, plan hashing, `ready_for_visio`, and `/api/visio/export` migration.

---

### Task 1: Add a pure, safe PublicationFigurePlan SVG renderer

**Files:**

- Create: `publication-figure-preview.js`
- Create: `publication-figure-preview.test.js`

**Consumes:** a public preview response containing `plan: PublicationFigurePlanV2`, `grammar`, and `qa`.

**Produces:** `renderPublicationFigurePreview(preview)` returning deterministic SVG markup, and `previewSummary(preview)` returning only user-visible title/grammar/QA text.

- [ ] **Step 1: Write failing renderer tests.** Cover tensor/block/region/arrow/residual/merge/annotation rendering, `viewBox` derived only from finite plan dimensions, escaped annotation text, grayscale metadata, QA warning summary, and rejection of unknown primitive/relation kinds or `<script>` text.

  ```js
  expect(renderPublicationFigurePreview({ plan: createPlanFixture(), grammar: { id: "cnn-classifier" }, qa: { blocking: [], warnings: [] } }))
    .toContain('viewBox="0 0 1000 600"');
  expect(() => renderPublicationFigurePreview({ plan: { ...createPlanFixture(), primitives: [{ ...createPlanFixture().primitives[0], kind: "shell" }] } })).toThrow(/primitive/i);
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run publication-figure-preview.test.js
  ```

  Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Implement the renderer.** Export only:

  ```js
  export function renderPublicationFigurePreview(preview) { /* strict local validation then SVG string */ }
  export function previewSummary(preview) { /* safe grammar/status/QA projection */ }
  ```

  Use fixed internal render functions for `semantic_region`, `tensor_volume`, `block_frame`, `flow_arrow`, `residual_skip`, `merge_marker`, and `annotation_track`. Escape every label/text value and derive all geometry from numeric Plan fields; never use `innerHTML` with values outside this renderer's escaped SVG string.

- [ ] **Step 4: Run GREEN.**

  ```powershell
  npx vitest run publication-figure-preview.test.js
  ```

  Expected: all renderer contract tests pass.

### Task 2: Add an explicit authenticated client preview request

**Files:**

- Modify: `chat-agent.js`
- Modify: `apps/client/chat-agent.test.js`

**Consumes:** `draft.id` from the existing Agent chat response, `resolveFoundationApiBase`, bearer token, and Task 1 renderer.

**Produces:** `getFigureDraftPreview(draftId, options)` and `renderFigureDraftCard(draft, preview)` with an explicit preview button.

- [ ] **Step 1: Write failing client tests.** Assert the helper calls exactly `/api/figure-drafts/<encoded-id>/preview` with only the bearer header, rejects non-200 responses without rendering a Plan, and cards expose a preview action only for `ready_for_preview` Drafts.

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/client/chat-agent.test.js
  ```

  Expected: missing preview helper/card rendering symbols.

- [ ] **Step 3: Implement the bounded request and card.** The preview button fetches once after the user clicks it, renders a loading state, mounts `renderPublicationFigurePreview(preview)`, then shows grammar and QA warnings. A `needs_confirmation` Draft shows its existing structural state but cannot fetch/render a Plan. Do not create a Visio button for the publication preview.

- [ ] **Step 4: Run GREEN.**

  ```powershell
  npx vitest run apps/client/chat-agent.test.js publication-figure-preview.test.js
  ```

  Expected: request, authorization/header, status gating, escaping, and renderer tests pass.

### Task 3: Apply compact publication-card styling and verify integration boundaries

**Files:**

- Modify: `styles.css`
- Modify: `chat-agent.js`
- Test: `apps/client/chat-agent.test.js`

**Consumes:** Task 1 SVG output and Task 2 card markup.

**Produces:** responsive card styling with an independent page-like preview surface, legend/QA chips, horizontal overflow protection, and no style coupling to the editable legacy Canvas.

- [ ] **Step 1: Add focused assertions.** Require the ready-preview result markup to contain `data-agent-figure-preview`, preserve escaped user-visible text, and omit any `data-agent-visio-export` control from the new publication-card block.

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/client/chat-agent.test.js
  ```

  Expected: preview-card assertions fail before card integration.

- [ ] **Step 3: Implement CSS and integration.** Add only `.publication-figure-card*` rules. Render an isolated SVG frame with its own background, fixed aspect/page fit, legend, QA state and warning list. Existing legacy Canvas actions remain outside the card and retain their current buttons/preview-token requirement.

- [ ] **Step 4: Run GREEN and focused regression.**

  ```powershell
  npx vitest run publication-figure-preview.test.js apps/client/chat-agent.test.js apps/api/tests/figure-draft-preview-service.test.ts apps/api/tests/figure-draft-preview-routes.test.ts
  ```

  Expected: all client and preview API tests pass.

### Task 4: Type/syntax/boundary acceptance

**Files:** no new production files beyond Tasks 1–3.

- [ ] **Step 1: Run syntax/type checks.**

  ```powershell
  node --check publication-figure-preview.js
  node --check chat-agent.js
  npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --allowJs apps/api/src/figure-draft-preview-service.ts apps/api/src/app.ts apps/api/src/routes.ts
  ```

- [ ] **Step 2: Run boundary scans.**

  ```powershell
  rg -n -i '\b(visio|worker|com|vsdx|shell|outputpath|canvas-actions|synapseApplyAgentDiagram)\b' publication-figure-preview.js
  git diff --check -- publication-figure-preview.js publication-figure-preview.test.js chat-agent.js apps/client/chat-agent.test.js styles.css
  ```

  Expected: the renderer has no forbidden runtime dependency; diff check has no whitespace errors.

- [ ] **Step 3: Record acceptance limits.** State separately that unit/API contract verification is complete, while browser visual review, Electron, real Provider, Plan persistence/hash binding, Visio Worker v2, COM, VSDX and readback remain unverified/not implemented by this slice.
