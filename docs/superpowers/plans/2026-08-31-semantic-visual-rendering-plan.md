# Semantic Visual Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore semantic, publication-readable Visio rendering while keeping Universal IR model-agnostic and evidence-preserving.

**Architecture:** Compile Universal IR nodes into topology-derived visual roles, label slots, style profiles, and geometry metadata. Keep Visio as an existing-document native renderer with glued connectors and Shape Data readback. Use structural IR fixtures for generic behavior and the existing VGG16 artifact only as a real visual probe.

**Tech Stack:** Node.js ES modules, Node test runner, PowerShell, Microsoft Visio COM automation, existing Universal IR and Visio bridge.

## Global Constraints

- Do not add model-name branches or fixed model templates.
- Do not add ResNet/U-Net/Transformer fixed regression fixtures.
- Preserve unresolved modules when source evidence is insufficient.
- Preserve existing Visio documents and pages; do not create an implicit blank canvas.
- Stage only intentional source, test, documentation, and design files; leave `artifacts/` untracked.

---

### Task 1: Add semantic visual-role and label-slot contracts

**Files:**
- Create: `semantic-visual-grammar.mjs`
- Test: `semantic-visual-grammar.test.mjs`
- Modify: `universal-figure.mjs`

**Interfaces:**
- Consumes: normalized Universal IR nodes from `layoutUniversalFigure`.
- Produces: `visualRoleForNode(node)`, `styleProfileForRole(role)`, `labelSlotsForRole(role)`, and `compileSemanticVisualNode(node)`.

- [ ] **Step 1: Write the failing test**

  Add tests asserting that a node with spatial tensor evidence becomes `feature-map-stage`, a pool node becomes `pool-downsample`, a flatten node becomes `vectorize`, a dense node becomes `neuron-layer`, and an opaque custom node becomes `unresolved-module` without model-name input. Assert that each role returns external label slots and a non-card style profile.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run:

  ```powershell
  node --test semantic-visual-grammar.test.mjs
  ```

  Expected: module-not-found or missing-export failures because the semantic grammar module does not yet exist.

- [ ] **Step 3: Implement the minimal semantic grammar module**

  Export role, style, label-slot, and node-compilation functions. Base role selection only on `family`, `shape`, `attributes`, `internalGraph`, and topology flags. Include publication style profiles for feature maps, pooling, vectorization, neurons, output, merge, compound, and unresolved roles.

- [ ] **Step 4: Connect the grammar to Universal Figure normalization**

  Attach `visualRole`, `styleProfile`, `labelSlots`, and `geometryData` to normalized/layout nodes without removing existing `family`, `shape`, `attributes`, or `repeatCount` fields.

- [ ] **Step 5: Run the focused tests and the existing Universal Figure tests**

  Run:

  ```powershell
  node --test semantic-visual-grammar.test.mjs universal-figure.test.mjs
  ```

  Expected: all focused tests pass and existing layout behavior remains valid.

- [ ] **Step 6: Commit the task**

  ```powershell
  git add semantic-visual-grammar.mjs semantic-visual-grammar.test.mjs universal-figure.mjs
  git commit -m "feat: add topology-derived semantic visual roles"
  ```

### Task 2: Carry semantic roles into the Visio render plan

**Files:**
- Modify: `visio-bridge.mjs`
- Test: `visio-bridge.test.mjs`

**Interfaces:**
- Consumes: layout nodes compiled by Task 1.
- Produces: plan shapes with `visualRole`, `styleProfile`, `labelSlots`, `geometryData`, and semantic Shape Data.

- [ ] **Step 1: Write the failing tests**

  Add tests that build a plan from generic nodes and assert that the plan carries semantic roles, external label slots, style profiles, geometry metadata, and unchanged source node IDs. Add a structural branch fixture and assert that connectors still reference the actual outer shapes.

- [ ] **Step 2: Run the focused tests and verify failure**

  ```powershell
  node --test visio-bridge.test.mjs
  ```

  Expected: the new semantic fields are absent or empty.

- [ ] **Step 3: Implement the minimal plan propagation**

  Extend `shapePlan` and inner-shape planning to carry the semantic fields. Keep the existing render scope, document path, page name, glue references, and readback contract unchanged.

- [ ] **Step 4: Run focused tests**

  ```powershell
  node --test visio-bridge.test.mjs
  ```

  Expected: all Visio plan and readback tests pass.

- [ ] **Step 5: Commit the task**

  ```powershell
  git add visio-bridge.mjs visio-bridge.test.mjs
  git commit -m "feat: carry semantic visual roles into Visio plans"
  ```

### Task 3: Restore semantic Visio geometry and external labels

**Files:**
- Modify: `visio-bridge.ps1`
- Test: `visio-bridge.test.mjs`

**Interfaces:**
- Consumes: semantic Visio render plans from Task 2.
- Produces: native feature-map, pool, vectorize, neuron, compound, and unresolved Shapes with publication styling and external labels.

- [ ] **Step 1: Write failing bridge-contract tests**

  Assert that the PowerShell bridge contains role-specific drawing paths, external label rendering, non-fixed role styles, feature-map grid/slice geometry, and no requirement that every role be a generic rectangle.

- [ ] **Step 2: Run focused tests and verify failure**

  ```powershell
  node --test visio-bridge.test.mjs
  ```

  Expected: the new role-specific and label assertions fail against the current bridge.

- [ ] **Step 3: Implement role-specific native drawing**

  Add style resolution by semantic role, separate front/top/side fills, feature-map stack offsets, optional grid/slice lines, pool geometry, vectorize bars, neuron geometry, and external title/subtitle/tensor labels. Keep inner operator shapes compact and keep all primary source-node Shape Data on the outer shape.

- [ ] **Step 4: Preserve glue and cleanup behavior**

  Ensure the first and last connector segments glue to the outer primary Shape, labels do not become connector targets, Agent-owned cleanup remains scoped by `renderId`, and non-Agent shapes remain untouched.

- [ ] **Step 5: Run focused bridge tests and syntax checks**

  ```powershell
  node --test visio-bridge.test.mjs
  [scriptblock]::Create((Get-Content -Raw -Encoding UTF8 .\visio-bridge.ps1)) | Out-Null
  node --check visio-bridge.mjs
  ```

  Expected: all focused tests pass and both scripts parse successfully.

- [ ] **Step 6: Commit the task**

  ```powershell
  git add visio-bridge.ps1 visio-bridge.test.mjs
  git commit -m "feat: restore semantic Visio geometry and labels"
  ```

### Task 4: Verify generic topology and actual Visio output

**Files:**
- Modify: `agent-pipeline.test.mjs`
- Modify: `universal-figure.test.mjs`
- Modify: `visio-bridge.test.mjs`
- Create if needed: `artifacts/agent-vgg16/semantic-visual-verification.mjs`

**Interfaces:**
- Consumes: generic source and IR fixtures plus the existing VGG16 source sample.
- Produces: structural proof, actual VSDX readback, and a PNG visual inspection target.

- [ ] **Step 1: Add structural fixtures without model-name templates**

  Cover a linear graph, a branch/merge graph, a skip graph, a nested internal graph, and an unresolved custom graph. Assert semantic roles, edges, label slots, and no invented internal nodes.

- [ ] **Step 2: Run the complete Node suite before Visio execution**

  ```powershell
  node --test --test-reporter=spec
  node --check agent-pipeline.mjs
  node --check universal-figure.mjs
  node --check visio-bridge.mjs
  ```

  Expected: zero failed tests and successful JavaScript syntax checks.

- [ ] **Step 3: Render the existing VGG16 document in place**

  Use the existing document path and `Page-1` with `openMode=attach`; do not close the current document and do not create a blank canvas. Capture the returned readback and PNG preview.

- [ ] **Step 4: Inspect actual output against the existing visual baseline**

  Check that labels are readable, feature-map stages retain layered geometry, pool/vectorize/neuron roles are distinguishable, connectors are glued, and the output no longer consists of saturated card-like blocks.

- [ ] **Step 5: Verify the final workspace boundary**

  ```powershell
  git diff --check
  git status --short --branch
  git diff --stat
  ```

  Expected: only intentional source/test/design changes are listed; `artifacts/` remains untracked and is not staged.
