# Visio Semantic Shape System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic 3D boxes and fixed three-plane inputs with evidence-driven flat native Visio neural-network primitives.

**Architecture:** Keep Visio Diagram Plan as the sole renderer contract. Add semantic fields in the JavaScript shape plan and dispatch PowerShell geometry only from those fields; retain PublicationTensor code solely for an explicit legacy role.

**Tech Stack:** Node.js ESM, node:test, PowerShell, Microsoft Visio COM.

## Global Constraints

- Do not select geometry from model or operator display names.
- Do not invent module internals without topology evidence.
- Preserve source identities, ports, Shape Data, and connector glue.
- Do not execute Visio visual rendering during this implementation phase.

---

### Task 1: Semantic Shape Contract

**Files:**
- Modify: `visio-bridge.mjs`
- Test: `visio-bridge.test.mjs`

**Interfaces:**
- Consumes: semantic node fields from Visio Diagram Plan.
- Produces: `shapeData.internalDetail`, `shapeData.modulePattern`, and evidence-driven tensor metadata.

- [ ] Add failing tests proving shape plans carry internal detail, module pattern, tensor rank, channel count, and repeat count without reading labels.
- [ ] Run `node --import ./test-setup.mjs --test visio-bridge.test.mjs` and verify failure.
- [ ] Extend `shapePlan()` to project the semantic fields into Shape Data.
- [ ] Rerun the focused tests and verify success.

### Task 2: Flat Input And Feature Primitives

**Files:**
- Modify: `visio-bridge.ps1`
- Test: `visio-bridge.test.mjs`, `visio-semantic-shapes.test.mjs`

**Interfaces:**
- Consumes: `visualRole`, `tensorRank`, `channelCount`, and `spatialSize`.
- Produces: one primary native Visio glyph per input or feature node.

- [ ] Add static failing tests that reject a hard-coded three-plane input and reject PublicationTensor dispatch for normal feature-map roles.
- [ ] Replace `Draw-InputTensor` with one flat dimensioned tensor plane; add depth only when rank/channel evidence requires it.
- [ ] Add `Draw-FeaturePlane` and dispatch normal feature maps to it.
- [ ] Keep `Draw-FeatureMapStack` reachable only through `legacy-publication-tensor`.
- [ ] Run focused JavaScript tests and PowerShell parser validation.

### Task 3: Modules And Repetition

**Files:**
- Modify: `visio-bridge.ps1`
- Test: `visio-semantic-shapes.test.mjs`

**Interfaces:**
- Consumes: `internalDetail`, `modulePattern`, `repeatCount`, and internal graph evidence.
- Produces: one flat module body, optional evidence-backed internal composition, and one external repeat badge.

- [ ] Add failing tests for a single primary named-module shape, external `xN`, and no fabricated internal shapes.
- [ ] Restyle named modules with a neutral body and semantic accent rail.
- [ ] Draw repeat count once outside the module.
- [ ] Ensure compound modules expand only when child shapes are present in the plan.
- [ ] Run focused tests and PowerShell parser validation.

### Task 4: Legend And Verification

**Files:**
- Modify: `visio-bridge.ps1`
- Test: `visio-bridge.test.mjs`, `visio-semantic-shapes.test.mjs`

**Interfaces:**
- Consumes: plan semantic categories.
- Produces: no per-module legend; optional category legend only.

- [ ] Add a failing static test rejecting named-module label enumeration in `Draw-Legend`.
- [ ] Remove the per-module legend call and preserve page title/subtitle handling.
- [ ] Run `npm test`.
- [ ] Parse `visio-bridge.ps1` with the PowerShell parser.
- [ ] Run `git diff --check` and inspect the final diff for model-name geometry branches.
