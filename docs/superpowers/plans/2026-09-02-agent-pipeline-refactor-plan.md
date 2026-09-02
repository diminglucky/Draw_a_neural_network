# Agent Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production model-template path with an evidence-driven pipeline that produces one topology-preserving Figure Plan for browser and Visio rendering.

**Architecture:** Introduce small contracts for input/evidence, a canonical network model, a renderer-neutral Figure Plan, and a resumable Agent orchestrator. Keep existing parsing, layout, and Visio primitives behind adapters; make `agent-pipeline.mjs` a thin compatibility facade that never selects a template by model name.

**Tech Stack:** Node.js ES modules, `node:test`, existing Universal IR/layout modules, browser SVG projection, PowerShell/Visio bridge.

## Global Constraints

- Do not add model-name branches or model-specific production templates.
- Model names are metadata only; topology and layout come from evidence and Universal IR.
- Preserve unresolved nodes/edges and emit structured diagnostics instead of inventing hidden structure.
- Browser and Visio consume the same Figure Plan identity, geometry, ports, and edge routes.
- Preserve existing untracked `artifacts/`, `docs/research/`, and `tmp/` content.
- Report source, tests, browser output, Visio execution, PNG inspection, and VSDX readback as separate evidence gates.

---

## File map

- Create `input-adapters.mjs`: `ArchitectureInput` normalization and adapter dispatch.
- Create `input-adapters.test.mjs`: input contract tests.
- Create `evidence-graph.mjs`: evidence records, diagnostics, graph conversion, and evidence merge helpers.
- Create `evidence-graph.test.mjs`: evidence provenance, unresolved, and conflict tests.
- Create `network-ir.mjs`: canonical IR boundary wrapping existing normalization/validation without duplicating parser logic.
- Create `network-ir.test.mjs`: canonical IR contract tests.
- Create `figure-plan.mjs`: renderer-neutral Figure Plan contract and plan validation.
- Create `figure-plan.test.mjs`: browser/Visio identity and topology tests.
- Create `agent-orchestrator.mjs`: inspect/extract/normalize/plan/render/readback/repair state machine.
- Create `agent-orchestrator.test.mjs`: state transition and repair tests.
- Modify `agent-pipeline.mjs`: route source/IR/image/prompt through the new contracts and orchestrator facade.
- Modify `agent-pipeline.test.mjs`: production-path regression tests.
- Modify `universal-ir.mjs`: preserve richer edge categories, port references, and unresolved evidence through normalization/projection.
- Modify `universal-figure.mjs`: expose Figure Plan data without model-name decisions and preserve recurrent/state topology.
- Modify `visio-bridge.mjs`: consume Figure Plan fields while retaining existing native rendering contract.
- Modify `server.js`: use the same analysis/figure plan for browser and Visio endpoints and return structured diagnostics.
- Add focused tests alongside each modified module; run the complete `node --test` suite at integration time.

## Task 1: Evidence and canonical network contracts (parallel)

**Files:**
- Create: `input-adapters.mjs`, `input-adapters.test.mjs`
- Create: `evidence-graph.mjs`, `evidence-graph.test.mjs`
- Create: `network-ir.mjs`, `network-ir.test.mjs`

**Interfaces:**
- `normalizeArchitectureInput(input) -> ArchitectureInput`
- `createEvidenceRecord(input) -> EvidenceRecord`
- `createEvidenceGraph({ input, records, nodes, edges, diagnostics }) -> EvidenceGraph`
- `evidenceGraphToUniversalIR(graph) -> UniversalIR`
- `normalizeNetworkIR(value) -> UniversalIR`
- `validateNetworkIR(value) -> ValidationReport`

- [ ] Write failing tests proving source/ir/image/prompt inputs normalize to explicit kinds, evidence has stable IDs/provenance/confidence/status, unresolved records survive conversion, and conflicts become diagnostics.
- [ ] Run `node --test input-adapters.test.mjs evidence-graph.test.mjs network-ir.test.mjs` and observe the expected missing-module failures.
- [ ] Implement the three contracts by delegating canonical node/edge normalization and validation to `universal-ir.mjs`; do not add parser or model-template logic.
- [ ] Re-run the focused tests and then `node --test universal-ir.test.mjs`.
- [ ] Commit the task with a focused message and record changed paths in the task report.

## Task 2: Renderer-neutral Figure Plan (parallel)

**Files:**
- Create: `figure-plan.mjs`, `figure-plan.test.mjs`
- Modify: `universal-figure.mjs`, `universal-figure.test.mjs`
- Modify: `visio-bridge.mjs`, `visio-bridge.test.mjs`

**Interfaces:**
- `createFigurePlan({ ir, layout, diagnostics }) -> FigurePlan`
- `validateFigurePlan(plan) -> ValidationReport`
- `figurePlanForBrowser(plan) -> BrowserFigurePlan`
- `figurePlanForVisio(plan, options) -> VisioFigurePlan`

- [ ] Write failing tests proving Figure Plan preserves source node/edge IDs, ports, state/loop/skip edge types, unresolved markers, and identical node/edge identity for browser and Visio projections.
- [ ] Run the focused tests and observe the expected missing-export or missing-contract failures.
- [ ] Implement `figure-plan.mjs` as a pure contract/validation layer over the existing layout result; expose plan data from `universal-figure.mjs` without selecting by model name.
- [ ] Update `visio-bridge.mjs` to consume the plan’s stable identities and semantic fields while retaining native Shape/Connector output.
- [ ] Re-run focused figure and Visio tests, then existing `universal-figure.test.mjs` and `visio-bridge.test.mjs`.
- [ ] Commit the task with a focused message and record changed paths in the task report.

## Task 3: Resumable Agent orchestrator (after Tasks 1–2)

**Files:**
- Create: `agent-orchestrator.mjs`, `agent-orchestrator.test.mjs`

**Interfaces:**
- `createAgentRun(input, dependencies) -> AgentRun`
- `runAgentPipeline(run) -> AgentResult`
- `resumeAgentRun(run, event) -> AgentRun`
- `diagnoseReadback(expected, actual) -> Diagnostic[]`

- [ ] Write failing tests covering `inspect → extract → normalize → plan`, `needs-confirmation` for unresolved evidence, render failure without mutating source IR, readback mismatch diagnostics, and bounded repair attempts.
- [ ] Run `node --test agent-orchestrator.test.mjs` and observe the expected missing-module failures.
- [ ] Implement the state machine with immutable stage snapshots, injected extraction/planning/render/readback functions, structured diagnostics, and a bounded repair transition.
- [ ] Re-run focused orchestrator tests and verify no dependency on `models.js` or model names.
- [ ] Commit the task with a focused message and record changed paths in the task report.

## Task 4: Production pipeline integration (after Task 3)

**Files:**
- Modify: `agent-pipeline.mjs`, `agent-pipeline.test.mjs`
- Modify: `server.js`, `server.test.mjs`
- Modify: `ai-workflow.js`, `code-workflow.js` only where required to pass the new result contract

**Interfaces:**
- `analyzeArchitectureInput(input, options) -> { status, ir, figurePlan, canvasDocument, diagnostics, validation, summary }`
- `/api/analyze-code` and `/api/analyze-diagram` return the same `figurePlan` identity contract.
- `/api/render-visio` renders `figurePlan`/layout generated by the same analysis result.

- [ ] Add failing regression tests proving source and direct IR inputs use the orchestrator, image input stops with `needs_external_vision` without fabricating topology, prompt input remains unresolved, and Visio dry-run receives the same plan IDs.
- [ ] Run focused integration tests and observe failures against the old result path.
- [ ] Replace direct multi-stage logic in `agent-pipeline.mjs` with adapter → evidence → canonical IR → orchestrator → Figure Plan composition; keep `models.js` unreachable from production analysis.
- [ ] Update server responses and Visio rendering to use the shared Figure Plan and structured diagnostics.
- [ ] Re-run `node --test agent-pipeline.test.mjs server.test.mjs code-agent-delegation.test.mjs ai-agent-boundary.test.mjs`.
- [ ] Commit the integration task with a focused message and record changed paths in the task report.

## Task 5: Whole-repository verification and delivery

**Files:**
- Modify: documentation only if testable behavior or command names changed.

- [ ] Run `node --test` and capture the complete exit code and pass/fail counts.
- [ ] Run the local server’s analysis and Visio dry-run endpoints against a source fixture; capture JSON status, Figure Plan IDs, and diagnostics.
- [ ] If Visio is available, execute the native bridge and inspect Shape Data, connector glue, VSDX readback, and the activated document PNG. If unavailable, report that gate explicitly as unverified.
- [ ] Inspect `git diff --stat`, `git status --short`, and all task commits; confirm user untracked files are untouched.
- [ ] Run a final architecture review for any production import or code path from `models.js`, and remove only such imports if the regression tests prove the fixture path remains available.

