# Universal Neural Visio Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground requested architectures in auditable evidence and compile any valid Universal IR into model-name-independent native Visio scenes.

**Architecture:** Keep `visio-diagram-plan/v1` as the public boundary. Add acquisition/evidence, derived facts, projection mapping, semantic scene, constraint layout and laid-out scene behind it; cut the bridge over only after real VSDX acceptance.

**Tech Stack:** Node.js ESM, `node:test`, PowerShell, Microsoft Visio COM, direct structured parsers for declarative model artifacts.

## Global Constraints

- Preserve all existing dirty-worktree changes.
- Never branch on architecture or module display names in compiler, layout or renderer.
- Never execute downloaded source in the Agent process.
- Universal IR remains the only network fact source.
- Scene geometry uses layout units; only the bridge converts to inches.
- No deletion before reference, API, persistence, test and real-Visio gates pass.
- Every task follows red-green-refactor and ends with focused tests.

---

## Phase A: Grounding

### Task 1: Input and Evidence Package Contracts

**Files:**
- Modify: `input-adapters.mjs`
- Modify: `input-adapters.test.mjs`
- Create: `architecture-evidence-package.mjs`
- Create: `architecture-evidence-package.test.mjs`

**Interfaces:**
- `normalizeArchitectureInput(input)` accepts `ir`, `source`, `repository`, `config`, `artifact`, `image`, `prompt`.
- `createArchitectureEvidencePackage(value)` returns `architecture-evidence-package/v1`.
- `validateArchitectureEvidencePackage(pkg)` validates identity, source hashes, claims and conflicts.

- [ ] Add failing tests for all seven input kinds, rejected unknown fields and path/URL metadata normalization.
- [ ] Add failing tests requiring immutable source IDs, SHA-256, authority, claim status and conflict diagnostics.
- [ ] Implement input normalization and package construction without changing current source/IR behavior.
- [ ] Verify: `node --import ./test-setup.mjs --test input-adapters.test.mjs architecture-evidence-package.test.mjs`.
- [ ] Commit only Task 1 files with `feat: add architecture evidence contract`.

### Task 2: Resolver and Provenance Policy

**Files:**
- Create: `architecture-resolver.mjs`
- Create: `architecture-resolver.test.mjs`
- Create: `source-provenance.mjs`
- Create: `source-provenance.test.mjs`

**Interfaces:**
- `resolveArchitectureRequest(input, dependencies)` returns resolved candidates or one pinned source.
- `validateSourceProvenance(source)` rejects mutable/unhashed production sources.

- [ ] Add failing tests proving ambiguous aliases return candidates and never fabricate topology.
- [ ] Add tests for pinned repository revisions, authority ordering and stronger-source conflict blocking.
- [ ] Implement a resolver registry whose entries locate sources only; reject entries containing nodes, edges or layout.
- [ ] Implement injected repository fetch dependencies so unit tests perform no network access.
- [ ] Verify focused tests and commit `feat: resolve grounded architecture sources`.

### Task 3: Config and Artifact Importers

**Files:**
- Create: `architecture-config-importer.mjs`
- Create: `architecture-config-importer.test.mjs`
- Create: `onnx-graph-importer.mjs`
- Create: `onnx-graph-importer.test.mjs`
- Modify: `package.json`, `package-lock.json` only if a structured ONNX dependency is required.

**Interfaces:**
- `importArchitectureConfig(document, context)` returns evidence graph claims, not model-specific IR.
- `importOnnxGraph(buffer, context)` returns nodes, edges, ports, tensors and provenance.

- [ ] Add fixtures for list-based module configuration, arbitrary fan-in/fan-out, repeats and unknown module names.
- [ ] Prove the config importer follows references and parameters without checking YOLO/C2f/SPPF strings.
- [ ] Add a minimal ONNX fixture validating graph inputs, outputs, tensor shapes and operator attributes.
- [ ] Reject pickle artifacts in the normal process with an actionable isolated-trace diagnostic.
- [ ] Verify focused tests and commit `feat: import grounded architecture definitions`.

### Task 4: Pipeline Integration

**Files:**
- Modify: `agent-pipeline.mjs`
- Modify: `agent-pipeline.test.mjs`
- Modify: `agent-service.mjs`
- Modify: `agent-service.test.mjs`
- Modify: `evidence-graph.mjs`

**Interfaces:**
- `extractArchitectureEvidence(input, options)` returns an Evidence Package for every input kind.
- `normalizeArchitectureEvidence(pkg)` produces Universal IR plus provenance diagnostics.

- [ ] Add failing tests showing prompt-only names stop at resolution, while pinned config/artifact inputs reach Universal IR.
- [ ] Preserve the current Agent Run confirmation and failure statuses.
- [ ] Integrate resolver/importers through injected dependencies; never fetch or execute inside normalization.
- [ ] Verify pipeline/service tests and commit `feat: ground agent architecture analysis`.

## Phase B: Universal Visual Core

### Task 5: Semantic Facts

**Files:**
- Create: `neural-semantic-facts.mjs`
- Create: `neural-semantic-facts.test.mjs`

**Interfaces:**
- `deriveNeuralSemanticFacts(ir)` returns immutable node/edge/region indexes.
- `validateNeuralSemanticFacts(facts, ir)` verifies evidence and identity coverage.

- [ ] Test independent data-domain, operation-effect, topology, role and certainty dimensions.
- [ ] Cover unknown operators, spatial scales, sequence tensors, state ports, branches, merges, cycles and cross-scale edges.
- [ ] Assert labels and architecture names do not affect facts.
- [ ] Implement derivation and commit `feat: derive neural semantic facts`.

### Task 6: Projection Mapping

**Files:**
- Create: `neural-projection-map.mjs`
- Create: `neural-projection-map.test.mjs`

**Interfaces:**
- `createProjectionMap(ir, facts, intent)` returns direct/collapse/expansion mappings.
- `validateProjectionMap(map, ir)` proves complete node, edge and port coverage.

- [ ] Test linear collapse, repeat collapse, opaque modules, branch-preserving expansion and external port remapping.
- [ ] Test that hidden edges are explicit and no branch/state/output edge can disappear under a budget.
- [ ] Implement deterministic mapping independent of model names.
- [ ] Commit `feat: add traceable neural projection mapping`.

### Task 7: Semantic Scene and Rule Registry

**Files:**
- Create: `semantic-neural-scene.mjs`
- Create: `semantic-neural-scene.test.mjs`
- Create: `neural-visual-rules.mjs`
- Create: `neural-visual-rules.test.mjs`

**Interfaces:**
- `compileSemanticScene(ir, facts, projectionMap, intent)` returns `semantic-neural-scene/v1`.
- `validateSemanticScene(scene, ir, projectionMap)` verifies body uniqueness and source coverage.

- [ ] Add failing tests for fixed rule phases, exclusive body conflicts and additive decorations.
- [ ] Implement generic plane/volume/stack, band/wedge, merge/split, repeat, relation, label and opaque primitives.
- [ ] Prove equivalent structural facts produce equivalent primitives despite renamed models/modules.
- [ ] Commit `feat: compile composable neural scenes`.

### Task 8: Constraint Layout

**Files:**
- Create: `neural-scene-layout.mjs`
- Create: `neural-scene-layout.test.mjs`
- Reuse: `visio-layout-tree.mjs`, `visio-port-routing.mjs` through adapters where valid.

**Interfaces:**
- `layoutNeuralScene(scene, profiles)` returns `laid-out-neural-scene/v1`.
- `validateLaidOutScene(layout)` reports hard violations and soft scores.

- [ ] Test containment, anchor ownership, non-overlap, obstacle routing and DAG direction as hard constraints.
- [ ] Test crossing/bend minimization, equal-scale alignment and evidenced symmetry as soft objectives.
- [ ] Test deterministic output and complexity-budget collapse diagnostics.
- [ ] Implement layout in abstract units and commit `feat: lay out neural scenes by constraints`.

## Phase C: Visio Cutover

### Task 9: Embed Scene in Visio Diagram Plan

**Files:**
- Modify: `visio-diagram-plan.mjs`
- Modify: `visio-diagram-plan.test.mjs`
- Modify: `agent-pipeline.mjs`
- Modify: `agent-pipeline.test.mjs`

**Interfaces:**
- `createVisioDiagramPlan({ ir, scene, diagnostics })` embeds validated laid-out scene.

- [ ] Freeze current `visio-diagram-plan/v1` API/readback fixtures before changing creation.
- [ ] Test scene/source identity coverage and reject missing anchors, invalid units or unresolved topology.
- [ ] Retain nodes/edges as compatibility indexes while making scene the visual source of truth.
- [ ] Commit `feat: embed neural scene in Visio plan`.

### Task 10: Native Scene Projection

**Files:**
- Modify: `visio-bridge.mjs`
- Modify: `visio-bridge.ps1`
- Modify: `visio-bridge.test.mjs`
- Modify: `visio-semantic-shapes.test.mjs`

**Interfaces:**
- `buildVisioRenderPlan(plan, options)` consumes `plan.scene` and never reconstructs visual semantics from plan nodes.

- [ ] Add failing bridge tests for each primitive form, source Shape Data, anchors, z-order and connector glue.
- [ ] Implement mechanical native shapes and labels without reading model/operator labels for dispatch.
- [ ] Keep old projection behind one internal fallback flag during acceptance only.
- [ ] Run focused tests, PowerShell parser and commit `feat: project neural scenes to Visio`.

### Task 11: Real Structural Acceptance

**Files:**
- Create: `fixtures/neural-structure-fixtures.mjs`
- Create: `neural-scene-acceptance.test.mjs`
- Create: `artifacts/render-neural-scene-acceptance.mjs`

- [ ] Add capability fixtures: sampling/repeat, bypass/add, encoder-decoder symmetry, three-scale fusion, attention, state feedback, peer streams, conditional routing, irregular graph and unknown operator.
- [ ] Assert structural facts and primitive mappings, never architecture names.
- [ ] Render representative fixtures into new VSDX files, export PNG, save-close-reopen and validate glue/readback.
- [ ] Record visual review findings; hard failures block cutover, profile metrics remain warnings until calibrated.
- [ ] Run `npm test`, PowerShell parse and `git diff --check`; commit `test: accept universal neural Visio scenes`.

## Phase D: Cleanup

### Task 12: Production Cutover and Proven Deletion

**Files:**
- Modify only files proven by reference scan; expected candidates include `universal-figure.mjs`, `semantic-visual-grammar.mjs`, `visio-detail-projection.mjs`, `visio-bridge.ps1` and corresponding tests.
- Modify: `README.md`, `docs/architecture.md`.

- [ ] Switch the production feature flag to Scene projection and rerun the complete acceptance matrix.
- [ ] Classify every old export as production, persistence-only or unreachable using `rg` and import tracing.
- [ ] Delete only unreachable `publication-block`, legacy PublicationTensor, generic compound-frame and retired projection paths.
- [ ] Preserve legacy snapshot upgrading at the persistence boundary where required.
- [ ] Verify full tests, PowerShell syntax, reference scans, VSDX readback, PNG review and `git diff --check`.
- [ ] Commit cleanup separately as `refactor: remove retired neural renderers`.

## Final Gate

The rebuild is complete only when all phases pass, production uses `plan.scene`,
no compiler/layout/bridge condition references architecture names, every source
identity is covered, and real Visio artifacts pass save-close-reopen/readback.
