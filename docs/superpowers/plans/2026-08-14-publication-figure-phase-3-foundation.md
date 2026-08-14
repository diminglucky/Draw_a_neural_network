# Publication Figure Phase 3 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile an already validated Canonical NetworkIR into a deterministic, explainable publication-figure semantic model and safe preview-only FigurePlan for CNN and residual-backbone networks.

**Architecture:** Keep structural facts in Canonical NetworkIR and place visual decisions behind a pure FigureIntent → GrammarRegistry → FigureSemanticModel → PublicationFigurePlan v2 pipeline. Grammars are deterministic and cannot access HTTP, Store, Provider credentials, Canvas, Worker, Visio, COM, VSDX, output paths, or arbitrary coordinates supplied by a model. This phase is preview-only: it does not add a Draft plan field, change the existing `/api/visio/export`, create Visio jobs, or emit `ready_for_visio`.

**Tech Stack:** TypeScript ESM, Zod, Vitest, existing `network-ir-v2.ts` Canonical IR and safe public evidence schemas.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`; preserve the dirty worktree and never broad-stage, reset, checkout, clean, force-push, or overwrite VSDX files.
- Phase 2 Chat→Draft remains compatible: no FigurePlan, grammar, primitive IDs, geometry, output paths, Worker call, COM call, VSDX creation, or `ready_for_visio` is persisted in a Draft revision.
- Existing `/api/agent/chat`, Canvas compatibility fields, authorization/device fencing, usage/idempotency/audit, and old `/api/visio/export` remain compatible.
- Grammar input is a validated `CanonicalNetworkIR` plus a server-controlled `FigureIntent`; no model-generated SVG, XML, COM, VBA, shell, Python, coordinates, primitives, or renderer name is accepted.
- Initial registered grammars are exactly `cnn-classifier` and `residual-backbone`; U-Net and transformer grammars are later slices.
- All source mapping is to existing Canonical IR node/edge/tensor IDs and public evidence IDs only; locators/excerpts and attachment bytes are forbidden.
- Plan output is preview-only and bounded: at most 96 display objects, 240 relations, 180 annotations, 600 primitives, and 240 characters per annotation.

---

### Task 1: FigureIntent and semantic-model contracts

**Files:**
- Create: `apps/api/src/figure-intent.ts`
- Create: `apps/api/src/figure-semantic-model.ts`
- Create: `apps/api/tests/figure-intent.test.ts`
- Create: `apps/api/tests/figure-semantic-model.test.ts`

**Produces:** `parseFigureIntent(input)`, `defaultFigureIntent()`, strict `FigureIntent`, and strict `FigureSemanticModel`/source-mapping parsers for downstream grammars.

- [ ] **Step 1: Write failing intent tests.** Cover default normalization, color/grayscale presets, allowed presentation purposes, and rejection of unknown renderer, coordinates, paths, primitive IDs, or unknown object fields.

  ```ts
  expect(() => parseFigureIntent({ purpose: "paper_overview", renderer: "visio-com" })).toThrow();
  expect(parseFigureIntent({ purpose: "architecture_detail", printMode: "grayscale" }))
    .toMatchObject({ stylePreset: "publication_monochrome", target: "preview" });
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/figure-intent.test.ts apps/api/tests/figure-semantic-model.test.ts
  ```

  Expected: modules do not exist.

- [ ] **Step 3: Implement strict Zod contracts.** `FigureIntent` permits only purpose, density, orientation, print mode, emphasis, preview target, and controlled style preset. `FigureSemanticModel` permits only bounded display objects, semantic regions, relations, labels, and source IDs. Reject unknown fields and source IDs not present in supplied IR.

- [ ] **Step 4: Run GREEN.** Re-run the command from Step 2; expected: all tests pass.

### Task 2: Deterministic grammar registry and selection gate

**Files:**
- Create: `apps/api/src/grammar-registry.ts`
- Create: `apps/api/tests/grammar-registry.test.ts`

**Consumes:** `CanonicalNetworkIR`, `FigureIntent`, `FigureSemanticModel` contracts from Task 1.

**Produces:** `GrammarId`, `FigureGrammar`, `GrammarScore`, `GrammarRegistry.select(ir, intent)` with stable ordering and a `0.70` minimum selection threshold.

- [ ] **Step 1: Write failing registry tests.** Define fake grammars with equal scores to prove grammar-ID tie break; prove blockers win over scores; prove a `0.69` best score returns a confirmation-required result; prove blocking IR unresolved entries prevent selection.

  ```ts
  expect(registry.select(ir, intent)).toMatchObject({ status: "needs_confirmation", selected: null });
  expect(registry.select(clearIr, intent).selected?.id).toBe("cnn-classifier");
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/grammar-registry.test.ts
  ```

- [ ] **Step 3: Implement pure registry.** Freeze registration order, evaluate each grammar without side effects, discard scores with blockers, sort by descending score then grammar ID, and return reasons/candidates without a plan if below threshold or Canonical IR has blocking unresolved facts.

- [ ] **Step 4: Run GREEN.** Re-run the command from Step 2; expected: all tests pass.

### Task 3: Preview-only PublicationFigurePlan v2 and grammar-neutral visual QA

**Files:**
- Create: `apps/api/src/publication-figure-plan-v2.ts`
- Create: `apps/api/src/visual-qa.ts`
- Create: `apps/api/tests/publication-figure-plan-v2.test.ts`
- Create: `apps/api/tests/visual-qa.test.ts`

**Consumes:** `FigureSemanticModel`, FigureIntent, source mappings from Task 1.

**Produces:** strict `parsePublicationFigurePlanV2`, `validatePublicationFigurePlanV2`, `runVisualQa(plan)` and preview-only primitives `semantic_region`, `tensor_volume`, `block_frame`, `flow_arrow`, `residual_skip`, `merge_marker`, `annotation_track`.

- [ ] **Step 1: Write failing Plan/QA tests.** Reject source-less objects, unsupported primitives, non-finite geometry, duplicate IDs, disconnected relation endpoints, excessive primitive counts, label overlap, page overflow, and grayscale-inseparable relation styles.

  ```ts
  expect(validatePublicationFigurePlanV2({ ...plan, primitives: [{ id: "x", kind: "shell" }] })).toMatchObject({ valid: false });
  expect(runVisualQa(overlappingPlan).blocking.map((issue) => issue.code)).toContain("label-overlap");
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/publication-figure-plan-v2.test.ts apps/api/tests/visual-qa.test.ts
  ```

- [ ] **Step 3: Implement bounded plan and QA.** Validate every primitive against a fixed allowlist, only permit finite deterministic plan geometry, require semantic object source mapping, and make QA return diagnostics without mutating the plan.

- [ ] **Step 4: Run GREEN.** Re-run the command from Step 2; expected: all tests pass.

### Task 4: CNN classifier grammar with VGG16 fixture

**Files:**
- Create: `apps/api/src/grammars/cnn-classifier.ts`
- Create: `apps/api/tests/grammars/cnn-classifier.test.ts`
- Create: `apps/api/tests/fixtures/vgg16-canonical-ir.ts`

**Consumes:** registry/semantic model/plan/QA contracts from Tasks 1–3.

**Produces:** a pure `cnn-classifier` grammar that scores a single CNN backbone, compiles tensor-scale narrative objects, and emits an allowlisted preview plan for VGG16.

- [ ] **Step 1: Write failing VGG16 grammar tests.** Assert `cnn-classifier` scores at least `0.70`, maps five convolution stages and classifier head to IR IDs, represents downsampling/repetition as semantic cues, and emits no residual primitive.

  ```ts
  expect(grammar.evaluate(vgg16Ir, intent).score).toBeGreaterThanOrEqual(0.70);
  expect(plan.primitives.some((item) => item.kind === "residual_skip")).toBe(false);
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/grammars/cnn-classifier.test.ts
  ```

- [ ] **Step 3: Implement deterministic CNN semantics and layout.** Use only IR stage/repeat/tensor facts; produce tensor volumes, scale transitions, classifier block and annotation track with source mappings. No VGG names or coordinates may enter Canonical IR.

- [ ] **Step 4: Run GREEN.** Re-run the command from Step 2; expected: all tests pass and QA contains no blocking issue.

### Task 5: Residual-backbone grammar with ResNet fixture

**Files:**
- Create: `apps/api/src/grammars/residual-backbone.ts`
- Create: `apps/api/tests/grammars/residual-backbone.test.ts`
- Create: `apps/api/tests/fixtures/resnet50-canonical-ir.ts`

**Consumes:** contracts and registry from Tasks 1–3.

**Produces:** a pure `residual-backbone` grammar that recognises Add/residual relations and emits bounded residual shortcut/merge semantics rather than a linear CNN diagram.

- [ ] **Step 1: Write failing ResNet grammar tests.** Assert `residual-backbone` beats `cnn-classifier`, score is at least `0.70`, stage repetition is compact, every residual shortcut maps to a `residual`/`add` IR relation, and Plan QA is blocking-clean.

  ```ts
  expect(registry.select(resnetIr, intent).selected?.id).toBe("residual-backbone");
  expect(plan.primitives.some((item) => item.kind === "residual_skip")).toBe(true);
  ```

- [ ] **Step 2: Run RED.**

  ```powershell
  npx vitest run apps/api/tests/grammars/residual-backbone.test.ts
  ```

- [ ] **Step 3: Implement residual semantics and plan compiler.** Represent each residual stage with a main flow, repeat bracket, residual shortcut and merge marker, retaining all source relations. Do not add an HTTP route, Store write, Worker call, or VSDX output.

- [ ] **Step 4: Run GREEN.** Re-run the command from Step 2; expected: all tests pass and `cnn-classifier` still passes its fixture.

### Task 6: Phase-3 foundation acceptance

**Files:**
- Modify only where test fixture imports require it.

- [ ] **Step 1: Run the foundation suite.**

  ```powershell
  npx vitest run apps/api/tests/figure-intent.test.ts apps/api/tests/figure-semantic-model.test.ts apps/api/tests/grammar-registry.test.ts apps/api/tests/publication-figure-plan-v2.test.ts apps/api/tests/visual-qa.test.ts apps/api/tests/grammars/cnn-classifier.test.ts apps/api/tests/grammars/residual-backbone.test.ts apps/api/tests/network-ir-v2.test.ts
  ```

- [ ] **Step 2: Run targeted strict TypeScript and exact diff checks.**

  ```powershell
  npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --allowJs apps/api/src/figure-intent.ts apps/api/src/figure-semantic-model.ts apps/api/src/grammar-registry.ts apps/api/src/publication-figure-plan-v2.ts apps/api/src/visual-qa.ts apps/api/src/grammars/cnn-classifier.ts apps/api/src/grammars/residual-backbone.ts
  git diff --check -- apps/api/src/figure-intent.ts apps/api/src/figure-semantic-model.ts apps/api/src/grammar-registry.ts apps/api/src/publication-figure-plan-v2.ts apps/api/src/visual-qa.ts apps/api/src/grammars apps/api/tests
  ```

- [ ] **Step 3: Contract scan.** Confirm Phase-3 modules import no Provider, Store, Fastify, Canvas action, Visio Worker, COM, VSDX, output-path, shell, SVG/XML, or raw-attachment APIs; Draft revisions remain free of plan/geometry/primitive data.

- [ ] **Step 4: Record intentionally unimplemented gates.** U-Net, transformer/fusion grammars, Draft plan persistence/revision commands, Worker Plan v2, draft-bound Visio export, live VSDX readback, browser visual review, Electron and real Provider acceptance are not part of this foundation slice.
