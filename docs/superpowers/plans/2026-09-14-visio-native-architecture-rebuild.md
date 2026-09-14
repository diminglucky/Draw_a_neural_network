# Visio-Native Architecture Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the renderer-neutral, flat layout pipeline with a Visio-native hierarchical neural-network diagram compiler that supports new network families through structural primitives rather than model-name branches.

**Architecture:** Keep evidence extraction and semantic network normalization as renderer-independent input concerns. Replace the figure/layout boundary with a Visio Diagram IR containing a typed container tree, measurable layout items, geometric ports, routed connectors, and native shape roles; project that IR directly to Visio COM and validate the persisted document.

**Tech Stack:** Node.js ES modules, Node test runner, PowerShell, Microsoft Visio COM automation.

## Global Constraints

- Microsoft Visio is the only drawing backend.
- Production layout logic must never branch on architecture names such as YOLO, ResNet, Transformer, GAN, U-Net, or VGG.
- Unknown modules remain explicit unresolved or named modules; the compiler never invents internal topology.
- Existing source identities and Visio Shape Data remain traceable through compaction and rendering.
- Existing uncommitted user changes must not be reverted.

---

### Task 1: Visio-Only Pipeline Contract

**Files:**
- Create: `visio-diagram-plan.mjs`
- Create: `visio-diagram-plan.test.mjs`
- Modify: `agent-pipeline.mjs`
- Modify: `agent-orchestrator.mjs`
- Modify: `agent-service.mjs`
- Modify: `visio-bridge.mjs`
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Produces: `createVisioDiagramPlan({ ir, geometry, diagnostics })`, `validateVisioDiagramPlan(plan)`.
- Compatibility: legacy `createFigurePlan` remains a temporary forwarding export until all callers migrate.

- [ ] Write tests requiring `visio-diagram-plan/v1`, `ready_for_visio`, and no renderer projection field.
- [ ] Run focused tests and confirm failures are caused by the missing Visio-native contract.
- [ ] Implement the Visio plan and migrate production callers.
- [ ] Run focused and full tests; update compatibility assertions without weakening source identity checks.

### Task 2: Typed Hierarchical Layout IR

**Files:**
- Replace: `architecture-layout-ir.mjs`
- Modify: `architecture-layout-ir.test.mjs`
- Create: `visio-layout-tree.mjs`
- Create: `visio-layout-tree.test.mjs`

**Interfaces:**
- Produces: `compileVisioLayoutTree(ir)` returning typed child references, container paths, scoped lanes, normalized repetitions, and validated parent relationships.

- [ ] Write failing tests for node/container child disambiguation, missing parents, cycles, scoped lanes, and `repeatCount` preservation.
- [ ] Implement legacy-input normalization into the typed tree.
- [ ] Add deterministic diagnostics for invalid ownership and cycles.
- [ ] Run focused tests and verify no architecture-name conditions exist.

### Task 3: Recursive Container Measurement and Placement

**Files:**
- Create: `visio-hierarchical-layout.mjs`
- Create: `visio-hierarchical-layout.test.mjs`
- Modify: `universal-figure.mjs`

**Interfaces:**
- Produces: `layoutVisioHierarchy(layoutTree, options)` returning container and node geometry.
- Supports: `horizontal`, `vertical`, `grid`, `flow`, and `stack` directions.

- [x] Write failing geometry tests for each direction and mixed nested directions.
- [x] Implement bottom-up measurement and top-down placement.
- [x] Ensure parent bounds include child bounds, title bands, padding, and gaps.
- [x] Route existing architecture inputs through the new layout and retain the old simple-chain fallback only for container-free input.

### Task 4: Post-Layout Detail Projection

**Files:**
- Create: `visio-detail-projection.mjs`
- Create: `visio-detail-projection.test.mjs`
- Modify: `universal-figure.mjs`

**Interfaces:**
- Produces: `projectVisioDetail(geometryGraph, { detail })` for `full`, `compact`, and `overview` detail levels.

- [ ] Write failing tests proving compaction preserves source node IDs, internal edges, container paths, ports, and repeat counts.
- [ ] remove pre-layout convolution condensation from the production path.
- [ ] implement post-layout repeated-block and linear-run projections.
- [ ] verify residual and cross-container edges remain addressable after projection.

### Task 5: Port Geometry and Obstacle-Aware Routing

**Files:**
- Create: `visio-port-routing.mjs`
- Create: `visio-port-routing.test.mjs`
- Modify: `visio-diagram-plan.mjs`

**Interfaces:**
- Produces: `resolveVisioPorts(geometryGraph)` and `routeVisioConnectors(geometryGraph, ports)`.

- [ ] Write failing tests for horizontal, vertical, multi-input merge, local residual, cross-container, and external feedback routes.
- [ ] Implement side-aware port anchors and stable port ordering.
- [ ] Implement corridor selection with node, title-band, and unrelated-container obstacles.
- [ ] Reject routes that still intersect hard obstacles and expose actionable diagnostics.

### Task 6: Native Visio Semantic Shapes

**Files:**
- Modify: `visio-bridge.mjs`
- Modify: `visio-bridge.ps1`
- Modify: `visio-bridge.test.mjs`

**Interfaces:**
- Supports native roles: `operator`, `tensor`, `module`, `merge-add`, `merge-concat`, `split`, `junction`, `decision`, `repeat-marker`, and `annotation`.

- [ ] Write failing bridge tests for every semantic shape and its Shape Data.
- [ ] Add COM-supported native drawing primitives and stable shape IDs.
- [ ] Glue connectors to explicit port cells or connection points.
- [ ] verify PowerShell parsing, dry-run plans, and persisted readback.

### Task 7: Structural Coverage and Visual Acceptance

**Files:**
- Create: `fixtures/structural-layouts.mjs`
- Create: `visio-structural-acceptance.test.mjs`
- Modify: `docs/architecture.md`

**Interfaces:**
- Covers structural fixtures without model names: linear chain, branch/merge, multi-scale pyramid, nested repeated stacks, recurrent state, conditional routing, multi-module feedback, and sparse expert routing.

- [ ] Add invariant tests for containment, ordering, overlap, port glue, and route obstacles.
- [ ] Render each fixture into an existing test `.vsdx` when native Visio is available.
- [ ] Export each Visio page to PNG and inspect representative desktop-sized pages.
- [ ] Run `npm test`, PowerShell parser validation, and `git diff --check`.
