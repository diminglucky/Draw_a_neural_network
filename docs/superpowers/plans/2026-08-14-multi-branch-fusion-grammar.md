# Multi-Branch Fusion Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, preview-only `multi-branch-fusion` grammar that compiles a verified two-tower Canonical NetworkIR with one evidence-backed fusion into a traceable publication figure plan.

**Architecture:** The grammar is a deliberately narrow compiler: it accepts two independent linear data spines that start at separate inputs, terminate at exactly one `cross_attention` or binary fusion node, and continue through one linear head to one output. It produces distinct left/right tower regions, an explicit central fusion marker, and an output head using existing Plan v2 primitives. All other multi-branch structures fail closed so later query-decoder and graph grammars can own them.

**Tech Stack:** TypeScript ESM, Zod, Vitest, Canonical NetworkIR v2, GrammarRegistry, FigureSemanticModel, PublicationFigurePlan v2, Visual QA.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`; do not broad-stage, reset, clean, force-push, write VSDX, or modify legacy export routes.
- Provider output stays topology and public evidence only. The grammar consumes only `CanonicalNetworkIR` and server-controlled `FigureIntent`.
- The grammar must not import or call Provider, Store, Fastify, Canvas, Worker, Visio/COM/VSDX, filesystem/output-path, shell, SVG/XML, or attachment APIs.
- The first supported subset has exactly two input towers, exactly one evidence-backed fusion point, exactly one data-only tail/head, and exactly one output.
- Every visible display object and relation must map to existing IR nodes, tensors, edges, and evidence. Plan output uses current allowlisted primitives/relations and must pass `runVisualQa`.
- `token-transformer` remains strictly single-stream and must continue rejecting cross-attention. DETR query decoders, iterative refinement, more than two towers, multiple fusion points, side inputs, feedback cycles, and generic multimodal graphs are outside this slice.

---

### Task 1: Establish the two-tower fixture and RED grammar tests

**Files:**
- Create: `apps/api/tests/fixtures/multi-branch-fusion-canonical-ir.ts`
- Create: `apps/api/tests/grammars/multi-branch-fusion.test.ts`

**Interfaces:**
- Consumes: `parseCanonicalNetworkIR(input)` and `defaultFigureIntent()`.
- Produces: `multiBranchFusionCanonicalIr(): CanonicalNetworkIR` and test expectations for `multiBranchFusionGrammar`.

- [x] **Step 1: Write the failing test**

```ts
const ir = multiBranchFusionCanonicalIr();
const model = multiBranchFusionGrammar.compileSemanticModel(ir, defaultFigureIntent());
const plan = multiBranchFusionGrammar.compilePlan(model, defaultFigureIntent());

expect(new GrammarRegistry([multiBranchFusionGrammar]).select(ir, defaultFigureIntent()).selected?.id)
  .toBe("multi-branch-fusion");
expect(model.displayRelations.some((relation) => relation.role === "attention")).toBe(true);
expect(plan.grammar.id).toBe("multi-branch-fusion");
expect(runVisualQa(plan).blocking).toEqual([]);
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run apps/api/tests/grammars/multi-branch-fusion.test.ts`

Expected: FAIL because the fixture and grammar module do not exist.

- [x] **Step 3: Add adversarial requirements to the same failing suite**

```ts
expect(multiBranchFusionGrammar.evaluate(noFusion, intent).blockers).toEqual(
  expect.arrayContaining([expect.stringContaining("fusion")]),
);
expect(new GrammarRegistry([multiBranchFusionGrammar]).select(extraTower, intent).status)
  .toBe("needs_confirmation");
```

Cover a third input, two fusion nodes, a non-data tower edge, a detached node, fusion edge/node without evidence, a hidden side tensor, a feedback edge, and a non-token-feature tower representation.

### Task 2: Add grammar identities and the strict fusion compiler

**Files:**
- Modify: `apps/api/src/figure-semantic-model.ts`
- Modify: `apps/api/src/publication-figure-plan-v2.ts`
- Modify: `apps/api/src/grammar-registry.ts`
- Modify: `apps/api/tests/grammar-registry.test.ts`
- Create: `apps/api/src/grammars/multi-branch-fusion.ts`

**Interfaces:**
- Consumes: `CanonicalNetworkIR`, `FigureIntent`, `FigureGrammar`, `FigureSemanticModel`, `PublicationFigurePlanV2`.
- Produces: `multiBranchFusionGrammar`, whose `evaluate`, `compileSemanticModel`, and `compilePlan` use `grammar.id === "multi-branch-fusion"`.

- [x] **Step 1: Add the grammar ID to all boundary schemas**

```ts
export type FigureGrammarId =
  | "cnn-classifier"
  | "encoder-decoder"
  | "residual-backbone"
  | "token-transformer"
  | "multi-branch-fusion";
```

Use the same literal in semantic-model and plan Zod grammar-ID enums, import the grammar in `grammar-registry.ts`, and register it after `token-transformer`.

- [x] **Step 2: Implement fail-closed topology analysis**

```ts
interface MultiBranchFusionTopology {
  left: Tower;
  right: Tower;
  fusion: CanonicalNode;
  tail: DataSpine;
  output: CanonicalNode;
}
```

Require two and only two `input` nodes, one and only one fusion (`cross_attention` relation into an attention node, or a binary `concat`/`add` operation when supported by NetworkIR), one output, unique tensor closure, data-only tower/tail edges, node and visible-edge evidence, no detached nodes, no cycles, no branch before/after fusion, and token-feature representations at both fusion inputs and output. Return grammar score `0.93` only when all invariants hold; otherwise use `0.1` with concrete blockers.

- [x] **Step 3: Compile the semantic figure and deterministic plan**

```ts
regions: ["left-tower", "right-tower", "fusion", "head"]
displayRelations: ["left-flow", "right-flow", "fusion-left", "fusion-right", "head-flow"]
```

Map each tower to one compact stage, map the fusion node to an `operator_block`, add two attention or flow relations into the fusion block and one flow relation out, and include source mappings for every display node. Position left and right towers in separate rows that converge on a central fusion block, then emit a horizontal head/output tail with `block_frame`, `tensor_volume`, `merge_marker`, `flow_arrow`, and `annotation_track` primitives only. Validate with `parseFigureSemanticModel`, `parsePublicationFigurePlanV2`, and `runVisualQa`.

- [x] **Step 4: Run the focused grammar and registry tests to verify GREEN**

Run: `npx vitest run apps/api/tests/grammars/multi-branch-fusion.test.ts apps/api/tests/grammar-registry.test.ts`

Expected: all tests pass.

### Task 3: Regressions, contract checks, and read-only review

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-multi-branch-fusion-grammar.md` only to mark executed checklist items after fresh evidence.

**Interfaces:**
- Consumes: the new grammar and all existing grammar contracts.
- Produces: current verification evidence, with no claim of live Provider, Visio, VSDX, or Electron acceptance.

- [x] **Step 1: Run the grammar and IR regressions**

Run: `npm run api:test -- --runInBand` is not a supported Vitest invocation; instead run `npm run api:test` from the worktree root.

Expected: Vitest exits zero, including CNN, residual, encoder-decoder, token-transformer, registry, semantic model, Plan v2, Visual QA, and draft-preview API tests.

- [x] **Step 2: Run static boundary checks**

Run:

```powershell
npm run api:check
npx tsc --noEmit --pretty false
git diff --check
rg -n -i 'provider|store|fastify|canvas|worker|visio|com|vsdx|shell|child_process|fs|svg|xml|attachment' apps/api/src/grammars/multi-branch-fusion.ts
```

Expected: the foundation check, TypeScript, and diff check exit zero; the prohibited-import search returns no import/call matches.

- [x] **Step 3: Conduct a read-only code review**

Inspect the final diff and verify that grammar selection is stable, malformed dual-tower graphs fail closed, every visible node/edge is traceable, the plan only uses allowlisted primitives, and the grammar stays preview-only.

## Intentionally Out of Scope

No generic graph renderer; DETR object queries/query decoder; multiple or hierarchical fusions; arbitrary number of modalities; co-attention/recurrent loops; Visio/COM/VSDX execution or readback; live Provider/vision inference; Electron acceptance; or commit/push is performed by this slice.

## Execution Record (2026-08-14)

- RED observed: `npx vitest run apps/api/tests/grammars/multi-branch-fusion.test.ts` failed because the grammar module did not exist.
- GREEN/regressions: focused grammar plus registry tests passed; `npm run api:test` passed 63 files and 382 tests; `npm run api:check` passed; the grammar file passed isolated strict TypeScript and prohibited-capability scans; `git diff --check` passed.
- The repository-wide `npx tsc --noEmit --pretty false` remains blocked by existing Visio test mocks that omit newly required `VisioReadback` fields in `visio-job-runner.test.ts`, `visio-routes.test.ts`, and `visio-worker-client.test.ts`; this slice does not modify those files.
- Independent read-only review found and this slice corrected the unsupported Vision/Text modality inference. It also prompted coverage for binary `add`, missing fusion-node evidence, residual tower edges, and feedback edges.
