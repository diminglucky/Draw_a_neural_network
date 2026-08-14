# Encoder-Decoder Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, preview-only `encoder-decoder` grammar that turns a validated U-Net-shaped Canonical NetworkIR into a source-traceable publication-figure plan.

**Architecture:** The grammar inspects only validated Canonical NetworkIR plus server-controlled FigureIntent. It recognizes an image-feature encoder path, a bottleneck, an upsampling decoder path, and verified encoder-to-decoder Concat joins. It compiles a compact semantic U-shape and then emits only the existing Plan v2 primitive and relation allowlists. It neither persists a plan nor interacts with Canvas, Visio, a Worker, COM, VSDX, file paths, Provider credentials, or a route.

**Tech Stack:** TypeScript ESM, Zod contracts already used by the figure pipeline, Vitest, existing `runVisualQa` checks.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`; preserve unrelated dirty worktree changes and never broad-stage, reset, checkout, clean, force-push, or overwrite VSDX files.
- Canonical NetworkIR remains structural and evidence-backed: no architecture-name special cases, model coordinates, colors, SVG/XML, renderer names, primitive IDs, COM, shell, output paths, or Visio instructions enter it.
- Grammar selection remains fail-closed at `0.70`; insufficient verified encoder/decoder scale pairing, missing Concat joins, an independent dual tower, or token/attention dominance must not select `encoder-decoder`.
- Every display object and each cross-scale Concat relation must map to existing IR node/tensor/edge IDs and, where present in IR, evidence IDs.
- The grammar must use only Plan v2 `semantic_region`, `tensor_volume`, `block_frame`, `flow_arrow`, `merge_marker`, and `annotation_track` primitives plus `flow_arrow`/`merge_marker` relations. It must not represent U-Net Concat with residual semantics.
- This slice is preview-only. It does not change Draft persistence, `ready_for_visio`, `/api/visio/export`, browser UI behavior, Worker protocol, Visio launch, COM, or VSDX generation/readback.

---

### Task 1: Add the U-Net Canonical IR fixture and selection/compilation contract tests

**Files:**
- Create: `apps/api/tests/fixtures/unet-canonical-ir.ts`
- Create: `apps/api/tests/grammars/encoder-decoder.test.ts`
- Modify: `apps/api/tests/grammar-registry.test.ts`

**Consumes:** `parseCanonicalNetworkIR`, `FigureIntent`, `GrammarRegistry`, existing Plan v2 and Visual QA contracts.

**Produces:** a valid, evidence-backed U-Net fixture with two downsample transitions, bottleneck, two upsample transitions, and two encoder→Concat skips; tests that prove selection, compact semantics, mapping, Plan allowlists, and Visual QA behavior.

- [ ] **Step 1: Write the failing fixture and grammar tests.** The fixture must contain `input → enc-1 → pool-1 → enc-2 → pool-2 → bottleneck → up-2 → concat-2 → dec-2 → up-1 → concat-1 → dec-1 → output`; each Concat takes its scale-compatible encoder and decoder tensors. The tests import the not-yet-existing grammar and assert:

  ```ts
  expect(registry.select(ir, intent).selected?.id).toBe("encoder-decoder");
  expect(grammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.70);
  expect(model.displayRelations.filter((relation) => relation.role === "concat")).toHaveLength(2);
  expect(plan.primitives.some((primitive) => primitive.kind === "residual_skip")).toBe(false);
  expect(plan.primitives.filter((primitive) => primitive.kind === "merge_marker")).toHaveLength(2);
  expect(runVisualQa(plan).blocking).toEqual([]);
  ```

- [ ] **Step 2: Run the test to verify RED.**

  ```powershell
  npx vitest run apps/api/tests/grammars/encoder-decoder.test.ts
  ```

  Expected: the test fails because `apps/api/src/grammars/encoder-decoder.ts` does not exist.

- [ ] **Step 3: Extend grammar ID contracts only after RED.** Add `encoder-decoder` to semantic-model and Plan v2 grammar ID schemas. Register it between CNN and residual in the default registry, and update the exact grammar-registry expectation.

- [ ] **Step 4: Confirm schemas compile but the grammar test remains RED for the missing implementation.**

  ```powershell
  npx vitest run apps/api/tests/grammar-registry.test.ts apps/api/tests/grammars/encoder-decoder.test.ts
  ```

  Expected: registry contract passes; U-Net test still fails only because the grammar implementation is absent.

### Task 2: Implement pure encoder-decoder grammar selection and semantic compilation

**Files:**
- Create: `apps/api/src/grammars/encoder-decoder.ts`

**Consumes:** validated `CanonicalNetworkIR`, `FigureIntent`, FigureSemanticModel parser, and registry interfaces.

**Produces:** `encoderDecoderGrammar` with `evaluate(ir, intent)` and `compileSemanticModel(ir, intent)`.

- [ ] **Step 1: Implement topology analysis helpers.** Derive a feature-map size from existing tensor `height`/`width` axes; identify downsample transitions from pool output dimensions decreasing, upsample transitions from upsample output dimensions increasing, and Concat nodes that combine an encoder feature tensor with decoder output at equal spatial scale. Reject a missing input/output, fewer than two downsample or upsample transitions, fewer than two verified Concat joins, malformed scale pairs, a token/attention-dominant graph, or independent towers.

  ```ts
  interface EncoderDecoderTopology {
    encoder: Stage[];
    bottleneck: Stage;
    decoder: Stage[];
    skips: VerifiedConcatSkip[];
  }
  ```

- [ ] **Step 2: Compile compact display semantics.** Emit one display object per encoder level, one bottleneck, one decoder level per verified Concat, and one output head—not per layer. Add regions `encoder`, `bottleneck`, and `decoder`; add `downsample`, `upsample`, `flow`, and `concat` display relations. Give every display object exactly one mapping assembled from existing node/tensor/edge/evidence IDs.

- [ ] **Step 3: Run the focused grammar tests to verify GREEN.**

  ```powershell
  npx vitest run apps/api/tests/grammars/encoder-decoder.test.ts apps/api/tests/grammar-registry.test.ts
  ```

  Expected: U-Net selects `encoder-decoder`; all compact semantic, source-mapping, rejection, and registry assertions pass.

### Task 3: Compile a deterministic publication plan and validate both grammar boundaries

**Files:**
- Modify: `apps/api/src/grammars/encoder-decoder.ts`
- Test: `apps/api/tests/grammars/encoder-decoder.test.ts`

**Consumes:** the semantic model from Task 2 and existing `parsePublicationFigurePlanV2`/`runVisualQa`.

**Produces:** `compilePlan(model, intent)` with deterministic U-shaped preview geometry.

- [ ] **Step 1: Add the Plan-focused failing assertions.** Verify the plan has only allowlisted kinds, contains two `merge_marker` primitives and `merge_marker` relations, maps each marker to an edge ID of its actual Concat, and contains no `residual_skip` primitive/relation.

- [ ] **Step 2: Run RED for the Plan assertions.**

  ```powershell
  npx vitest run apps/api/tests/grammars/encoder-decoder.test.ts
  ```

  Expected: the new Plan assertions fail before `compilePlan` exists.

- [ ] **Step 3: Implement the Plan compiler.** Place encoder tensors on descending left levels, the bottleneck at the lowest centre, decoder blocks on ascending right levels, and each merge marker immediately before its decoder block. Use routes that begin/end on primitive boundaries. Generate title, stage, and Concat annotations solely from the semantic model. Parse the result through Plan v2, run Visual QA, and throw if it returns a blocking issue.

- [ ] **Step 4: Run GREEN.**

  ```powershell
  npx vitest run apps/api/tests/grammars/encoder-decoder.test.ts
  ```

  Expected: all U-Net selection, semantic model, mapping, Plan, and Visual QA assertions pass.

### Task 4: Focused regression and boundary verification

**Files:** no additional production files.

- [ ] **Step 1: Run the focused figure pipeline regression.**

  ```powershell
  npx vitest run apps/api/tests/grammars/encoder-decoder.test.ts apps/api/tests/grammars/cnn-classifier.test.ts apps/api/tests/grammars/residual-backbone.test.ts apps/api/tests/grammar-registry.test.ts apps/api/tests/figure-semantic-model.test.ts apps/api/tests/publication-figure-plan-v2.test.ts apps/api/tests/visual-qa.test.ts apps/api/tests/network-ir-v2.test.ts apps/api/tests/figure-draft-preview-service.test.ts apps/api/tests/figure-draft-preview-routes.test.ts apps/client/publication-figure-preview.test.js
  ```

- [ ] **Step 2: Run strict TypeScript and exact diff checks.**

  ```powershell
  npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --allowJs apps/api/src/figure-semantic-model.ts apps/api/src/publication-figure-plan-v2.ts apps/api/src/grammar-registry.ts apps/api/src/grammars/encoder-decoder.ts apps/api/tests/fixtures/unet-canonical-ir.ts apps/api/tests/grammars/encoder-decoder.test.ts
  git diff --check -- apps/api/src/figure-semantic-model.ts apps/api/src/publication-figure-plan-v2.ts apps/api/src/grammar-registry.ts apps/api/src/grammars/encoder-decoder.ts apps/api/tests/fixtures/unet-canonical-ir.ts apps/api/tests/grammars/encoder-decoder.test.ts apps/api/tests/grammar-registry.test.ts docs/superpowers/plans/2026-08-14-encoder-decoder-grammar.md
  ```

- [ ] **Step 3: Perform a dependency-boundary scan.**

  ```powershell
  rg -n -i '\b(provider|store|fastify|canvas|worker|visio|com|vsdx|shell|outputpath|svg|xml|attachment)\b' apps/api/src/grammars/encoder-decoder.ts
  ```

  Expected: no forbidden runtime dependency/import; narrative text must not introduce a runtime side effect.

- [ ] **Step 4: Request an independent read-only review.** Review selection correctness, Concat vs residual semantics, source mappings, Visual QA, and the absence of persistence/Worker/Visio side effects.

## Intentionally Out of Scope

This plan neither claims nor implements universal neural-network support, Plan persistence/hash binding, `ready_for_visio`, Worker v2, Visio launch/COM, new VSDX generation, close/reopen readback, Electron E2E, a live Provider/vision model, PostgreSQL/Redis acceptance, or production release.
