# Token Transformer Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic preview-only `token-transformer` grammar that compiles a validated, single-stream ViT/Transformer Canonical NetworkIR into a source-traceable publication figure plan.

**Architecture:** Extend Canonical IR only with the structural `embedding` operator required to distinguish tokenization from a generic dense block. The grammar accepts one connected token/feature data path with a tokenization stage, a repeated `transformer_block`, and a head/output; it emits a compact token-strip/encoder-stack narrative using existing fixed Plan v2 primitives. It rejects CNN scale chains, U-Net semantics, multi-tower graphs, off-path branches, non-data attention ambiguity, and arbitrary rendering data.

**Tech Stack:** TypeScript ESM, Zod, Vitest, existing Canonical NetworkIR v2, GrammarRegistry, FigureSemanticModel, PublicationFigurePlan v2, Visual QA.

## Global Constraints

- Work only in the isolated `codex/commercial-foundation` worktree; preserve unrelated dirty files and never broad-stage, reset, clean, force-push, write VSDX, or alter legacy export routes.
- Model/provider output remains topology/evidence only. Grammar code can consume only Canonical IR and server-controlled FigureIntent.
- This grammar is preview-only and may not import or call Provider, Store, Fastify, Canvas, Worker, Visio/COM/VSDX, filesystem/output-path, shell, SVG/XML, or attachment APIs.
- The initial grammar supports a single token-transformer spine, not DETR/query fusion, cross-attention, multimodal dual towers, arbitrary residual-expanded internals, or a generic graph renderer.
- Every visible display object and relation must map to existing IR node/tensor/edge/evidence IDs; Plan output uses only current allowlisted primitive/relation kinds and must pass `runVisualQa`.

---

### Task 1: Make tokenization structural and add failing ViT grammar tests

**Files:**
- Modify: `apps/api/src/network-ir-v2.ts`
- Create: `apps/api/tests/fixtures/vit-canonical-ir.ts`
- Create: `apps/api/tests/grammars/token-transformer.test.ts`

- [ ] Write a valid ViT fixture with `input → embedding → transformer_block ×12 → classifier → output`, token/feature axes, repeat evidence, and a data path.
- [ ] Add failing tests that import the missing grammar and require selection above `0.70`, compact repeated-block semantics, `attention` relations, source mappings, allowlisted Plan output, and Visual QA with no blockers.
- [ ] Add failure tests for no token axes, no transformer block, a blocking unresolved attention fact, and detached/multi-stream structures.
- [ ] Run `npx vitest run apps/api/tests/grammars/token-transformer.test.ts` and verify RED because the grammar module is absent.

### Task 2: Register the grammar and implement deterministic semantic/Plan compilation

**Files:**
- Modify: `apps/api/src/figure-semantic-model.ts`
- Modify: `apps/api/src/publication-figure-plan-v2.ts`
- Modify: `apps/api/src/grammar-registry.ts`
- Modify: `apps/api/tests/grammar-registry.test.ts`
- Create: `apps/api/src/grammars/token-transformer.ts`

- [ ] Add `token-transformer` consistently to the grammar identifier contracts and default registry.
- [ ] Implement fail-closed topology analysis: exactly one input/output, all data nodes on one unambiguous path, an `embedding` stage, a token-feature tensor, and at least one `transformer_block`; reject spatial encoder-decoder or multi-branch semantics.
- [ ] Compile semantic regions `tokenization`, `transformer_encoder`, and `head`; compact transformer repetition into one display block with an IR-backed repeat count.
- [ ] Compile a deterministic horizontal plan with block frames, flow arrows, annotation track, only existing Plan primitives, source mappings, and Visual QA.
- [ ] Run the grammar and registry tests to verify GREEN.

### Task 3: Regression and boundary acceptance

- [ ] Run token-transformer, CNN, residual, encoder-decoder, grammar registry, semantic model, Plan v2, Visual QA, NetworkIR, draft preview API, and browser preview tests.
- [ ] Run strict TypeScript for modified source/tests, `git diff --check`, and a prohibited-import scan of the grammar module.
- [ ] Request a read-only review focused on selection correctness, token versus CNN/U-Net rejection, repeat/source mappings, Plan allowlists, and preview-only boundaries.

## Intentionally Out of Scope

No token Plan persistence/hash binding, `ready_for_visio`, Worker v2, Visio/COM/VSDX behavior, browser UI branch, live Provider/vision inference, Electron acceptance, or transformer variants with queries/cross-attention/fusion are implemented by this slice.
