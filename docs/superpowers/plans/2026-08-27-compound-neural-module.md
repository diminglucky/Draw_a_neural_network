# Compound Neural Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-rectangle rendering of Transformer and Attention modules with editable compound modules that expose internal operators, internal edges, and semantic visual primitives.

**Architecture:** Keep the existing document format backward compatible. Normalize legacy `encoder` and `attention` nodes into a `compound` node with a `compoundKind`, fixed deterministic child topology, and expanded frame bounds. Put the pure topology/layout contract in `compound-module.mjs`; keep DOM/SVG drawing in `app.js`. External edges continue to use the existing document edge model, while compound children and internal edges are rendered locally inside the compound frame.

**Tech Stack:** Browser-native ES modules, SVG DOM, Node.js built-in `node:test` and `node:assert/strict`.

## Global Constraints

- Preserve all existing untracked files and do not reset, clean, commit, or push.
- Existing `encoder` and `attention` documents must load without migration errors.
- Unknown future compound kinds must render as an explicit unresolved compound, never silently as a generic block.
- Every production behavior change must have a test that failed before the implementation.
- Existing CNN, MLP, volume, and skip-edge behavior must remain unchanged.

### Task 1: Define the compound topology contract

**Files:**
- Create: `compound-module.mjs`
- Create: `compound-module.test.mjs`

- [ ] Write failing tests for canonical Transformer and Attention children, internal edge endpoints, frame sizing, and legacy normalization.
- [ ] Run `node --test compound-module.test.mjs` and verify the new tests fail because the module does not exist.
- [ ] Implement `normalizeCompoundNode`, `getCompoundLayout`, and `compoundKindForNode` with deterministic child IDs and local bounds.
- [ ] Run the focused test and verify it passes.

### Task 2: Integrate legacy nodes with the new renderer

**Files:**
- Modify: `app.js:1-20,80-180,224-250,436-478,2240-2262`

- [ ] Add the compound module import and normalize nodes on template load, AI import, and local-storage restore.
- [ ] Route `encoder`, `attention`, and `compound` nodes through `drawCompound`.
- [ ] Draw a visible module frame, title, repeat badge, child operator shapes, attention matrix, Add markers, and internal routed edges.
- [ ] Add compound color and bounds/anchor handling without changing existing primitive branches.

### Task 3: Verify rendered structure and regressions

**Files:**
- Modify: `compound-module.test.mjs` if an edge case is found.
- Inspect only: `app.js`, `models.js`, `code-workflow.js`.

- [ ] Run `node --test compound-module.test.mjs publication-layout.test.js`.
- [ ] Run a syntax/import check for the browser modules.
- [ ] Inspect `git diff --check` and `git status --short` to confirm only the intended new/modified files changed.
- [ ] Report that this phase covers compound Transformer/Attention rendering; U-Net/ResNet/Diffusion expansion remains a subsequent phase unless separately implemented.
