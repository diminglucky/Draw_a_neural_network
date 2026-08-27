# Universal Neural Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the template-first drawing path with a framework-neutral Universal Neural Network IR that can preserve arbitrary operators, branches, ports, shapes, evidence, confidence, and unresolved custom modules while still projecting to the editable publication canvas.

**Architecture:** `universal-ir.mjs` owns IR normalization, semantic classification, validation, and projection to the existing canvas document format. The code parser emits the IR in addition to its legacy-compatible canvas document; the browser normalizes IR before rendering and the existing publication layout consumes the projected graph. Built-in templates remain fixtures/examples, never the required path for code or AI-generated diagrams.

**Tech Stack:** Browser-native ES modules, Node.js built-in `node:test`, existing SVG renderer and publication layout.

## Global Constraints

- Preserve existing dirty files and do not reset, clean, commit, push, or create a new worktree.
- Preserve legacy `{ figure, nodes, edges }` documents and existing template behavior.
- Unknown/custom operators must remain explicit `unresolved` compound nodes with ports and evidence; never silently become ordinary blocks.
- Every production behavior change must have a test that failed before the implementation.
- Universal means topology/framework neutrality with evidence and confidence; opaque dynamic behavior must be surfaced as unresolved, not fabricated.

---

### Task 1: Define and validate Universal IR

**Files:**
- Create: `universal-ir.mjs`
- Create: `universal-ir.test.mjs`

**Interfaces:**
- `createUniversalIR(document, options) -> ir`
- `normalizeUniversalIR(ir) -> ir`
- `validateUniversalIR(ir) -> report`
- `projectUniversalIRToCanvas(ir) -> document`

- [ ] Write failing tests for arbitrary custom operators, multi-input edges, confidence/evidence, missing endpoints, and legacy canvas projection.
- [ ] Run `node --test universal-ir.test.mjs` and confirm the module-not-found failure.
- [ ] Implement deterministic IR normalization/classification and fail-closed validation.
- [ ] Project known families to existing primitive nodes and unknown families to explicit `compoundKind: "unresolved"` nodes.
- [ ] Run the focused test and confirm it passes.

### Task 2: Make source parsing preserve unknown modules

**Files:**
- Modify: `code-workflow.js:1-120,270-330,560-605`
- Modify: `code-workflow.test.mjs` if present; otherwise create `universal-code-workflow.test.mjs`

**Interfaces:**
- `diagramFromCode(source, framework) -> { figure, nodes, edges, ir, meta }`

- [ ] Write a failing custom PyTorch module test containing `self.custom = CustomBlock(...)` and `x = self.custom(x)`; assert an unresolved compound node and source evidence are retained.
- [ ] Run the focused test and verify the custom operator is currently lost or rendered as a generic block.
- [ ] Add custom-module detection to the existing parser and emit `ir` through `createUniversalIR`.
- [ ] Change the unknown layer projection to `compoundKind: "unresolved"` while preserving known primitive projections.
- [ ] Run focused code-parser tests and existing parser tests.

### Task 3: Make the browser consume Universal IR

**Files:**
- Modify: `app.js:1-220`
- Modify: `publication-layout-browser.mjs` only where IR-projected node metadata needs to be preserved.
- Create: `universal-canvas.test.mjs`

**Interfaces:**
- `normalizeDiagramDocument(document)` accepts either legacy canvas documents or `{ ir }` documents.

- [ ] Write a failing browser-facing projection test for an IR containing a custom op, branch, merge, and tensor shape.
- [ ] Run it and confirm `app.js` currently cannot consume the IR-only shape.
- [ ] Normalize/project IR before state assignment; preserve `ir`, `confidence`, `evidence`, `ports`, and `shape` in node metadata.
- [ ] Ensure automatic layout uses projected graph topology and unresolved compound frames rather than templates.
- [ ] Run browser module tests and static syntax checks.

### Task 4: Make the AI boundary IR-first

**Files:**
- Modify: `server.js:80-230`
- Modify: `ai-workflow.js:70-135`
- Modify: `server.test.mjs`

**Interfaces:**
- AI responses may return `{ ir, figure }`; the server/client projects and validates it before drawing.

- [ ] Write a failing API/schema test for an arbitrary operator and evidence/confidence metadata.
- [ ] Update the prompt/schema to accept generic operation families and an optional Universal IR without a fixed architecture enum.
- [ ] Validate IR server-side and return a structured unresolved/needs-confirmation result instead of a hardcoded architecture when evidence is incomplete.
- [ ] Keep the local fallback only as an explicit demo fallback and label it as such.
- [ ] Run the full unit suite and API smoke tests.

### Task 5: Verify universal path and document boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-27-universal-neural-agent.md` checkboxes

- [ ] Add fixtures for CNN, residual, attention, multi-branch custom, recurrent loop, and unresolved operator graphs.
- [ ] Run the full test command, syntax checks, and `git diff --check`.
- [ ] Browser-verify code-generated custom graph and all existing templates separately.
- [ ] Document what is statically exact, what requires runtime tracing, and how unresolved confidence is surfaced.
- [ ] Report that template rendering is retained as a fixture path, while Universal IR is the production generation boundary.
