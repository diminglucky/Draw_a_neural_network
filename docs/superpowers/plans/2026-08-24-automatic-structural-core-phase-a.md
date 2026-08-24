# Automatic Structural Drawing Core Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for each implementation task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all runtime named-architecture generation and the named-architecture-only Visio execution path, leaving evidence-derived structural analysis as the only production route.

**Architecture:** The local deterministic provider continues to extract evidence and operator kinds from the actual prompt/code input, but it always builds a neutral structural candidate. It cannot recognize a model name or inject a fixed topology. The generic UGS/GPG/PVP pipeline remains unchanged. The legacy named bridge, snapshot, draft export route, and their scripts are removed rather than renamed.

**Tech Stack:** TypeScript, Fastify, Vitest, Node.js, PowerShell, Git.

## Global Constraints

- Runtime source must contain no named-architecture detection, preset, fixed topology builder, fixed known-model test fixture, or named-architecture-only bridge.
- Preserve generic UGS, GPG, PVP, visual QA, browser preview, authentication, generic job service, generic legacy Visio route, and generic `VisioJobRunner` behavior.
- Do not execute user code or accept raw renderer geometry/Visio instructions from the model.
- Do not alter, stage, or overwrite `apps/api/src/publication-visual-rubric.ts`, `apps/api/tests/publication-visual-rubric.test.ts`, `apps/api/tests/publication-visual-plan-zero-template.test.ts`, `apps/api/tests/agent-roadmap-cli.test.ts`, or `docs/superpowers/plans/2026-08-20-u3-visual-rubric.md`.
- Preserve immutable historical evidence and append-only JSONL history. Do not claim generic Visio or real-host acceptance.
- Use exact Git allowlists only. Do not use `git add .`, reset, clean, force-push, or rewrite commits.

---

### Task 1: Make local analysis evidence-derived and model-neutral

**Files:**
- Modify: `apps/api/src/adapters.ts`
- Modify: `apps/api/tests/agent-service.test.ts`
- Modify: `apps/client/publication-figure-preview.test.js`

**Consumes:** `collectLayerKinds`, source evidence extraction, `buildNodes`, and generic `buildEdges`.

**Produces:** a local provider that creates its candidate only from extracted operator evidence; no architecture-name detection, preset metadata, fixed topology, or visual metadata injection.

- [x] **Step 1: Add a failing behavioral test for code-derived custom structure.**

  In `apps/api/tests/agent-service.test.ts`, add a test that sends a code attachment containing `self.stem = nn.Conv2d(3, 24, 3)`, `self.gate = SpectralGate()`, `self.head = nn.Linear(24, 4)`, and a prompt that contains no layer list. Assert that the local result contains the extracted `conv` and `dense` kinds, does not contain a fixed tensor dimension such as `224 x 224`, carries code evidence for `model.py`, and has legacy compatibility style `preset: "source-derived"` plus figure description `A source-derived structural draft.`.

- [x] **Step 2: Run the new test and observe the current template-dependent behavior.**

  Run: `npx vitest run apps/api/tests/agent-service.test.ts`

  Expected before implementation: the new assertion fails because the current generic fallback still returns the obsolete `preset: "generic"` and its old deterministic-draft description.

- [x] **Step 3: Delete model-name branching from the local provider.**

  In `apps/api/src/adapters.ts`, delete `PublicationPreset`, `detectPublicationPreset`, `publicationPresetMeta`, and `buildPresetNodes`. Change both local provider call sites to:

  ```ts
  const nodes = buildNodes(layerKinds, evidenceOrCandidateEvidence).map(stripLegacyPresentationFields);
  const edges = buildEdges(nodes);
  ```

  Make `buildEdges(nodes)` return only consecutive evidence-derived flow edges. Use fixed neutral metadata only: title `Neural Network Architecture`, description `A source-derived structural draft.` and legacy style `preset: "source-derived"`. Do not add shapes, repeat counts, dimensions, branches, or labels that are not in extracted evidence.

- [x] **Step 4: Remove the obsolete named-architecture service assertion and neutralize the browser fixture ID.**

  Delete the old service test that expects a canonical named-model preset. Change only the browser preview fixture ID from `draft-vgg` to `draft-structural`; its plan remains a generic browser renderer test.

- [x] **Step 5: Run focused tests and an executable-source scan.**

  ```powershell
  npx vitest run apps/api/tests/agent-service.test.ts apps/client/publication-figure-preview.test.js
  rg -n -i 'vgg(?:[-_ ]?16)?|resnet|u[-_ ]?net|vision transformer|\bvit\b|detectPublicationPreset|buildPresetNodes' apps/api/src apps/api/tests apps/client scripts
  ```

  Expected: tests pass; the scan reports only still-to-be-removed named legacy files, not a local provider preset branch.

### Task 2: Retire named-architecture bridge, snapshot, and draft export execution

**Files:**
- Delete: `apps/api/src/agent-visio-bridge.ts`
- Delete: `apps/api/src/agent-visio-execution-snapshot.ts`
- Delete: `apps/api/tests/agent-visio-bridge.test.ts`
- Delete: `apps/api/tests/agent-visio-execution-snapshot.test.ts`
- Delete: `apps/api/tests/agent-visio-export-routes.test.ts`
- Delete: `apps/api/tests/agent-vgg16-visio-acceptance.test.ts`
- Create: `apps/api/tests/visio-draft-export-retirement.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/visio-job-runner.ts`

**Consumes:** generic legacy Visio route, `VisioExecutor`, `JobService`, and `VisioJobRunner`.

**Produces:** no draft-revision native export route and no named-topology snapshot dependency; generic legacy Visio handling remains intact.

- [x] **Step 1: Write the retirement test first.**

  Create one Vitest that builds the default app, posts `{}` to `/api/figure-drafts/draft-structural/revisions/1/visio-exports`, asserts `404`, and closes the app in `afterEach`.

- [x] **Step 2: Prove the old route exists.**

  Run: `npx vitest run apps/api/tests/visio-draft-export-retirement.test.ts`

  Expected before implementation: FAIL because the route is registered.

- [x] **Step 3: Remove the route and all snapshot wiring.**

  Remove snapshot imports/options/default construction from `app.ts`; remove snapshot dependency/import and only the draft-revision native export handler from `routes.ts`; preserve `/api/legacy/visio-exports`.

- [x] **Step 4: Simplify the runner to its generic executor contract.**

  Remove snapshot-store support from `VisioJobRunnerOptions` and replace snapshot execution with:

  ```ts
  return this.options.executor.executeDiagram({ jobId: job.id, diagram: input.diagram }, { signal });
  ```

  Preserve queuing, cancellation, recovery, job state, output path, and readback behavior.

- [x] **Step 5: Delete named bridge/snapshot sources and run focused checks.**

  ```powershell
  npx vitest run apps/api/tests/visio-draft-export-retirement.test.ts apps/api/tests/visio-routes.test.ts apps/api/tests/visio-job-runner.test.ts
  npx tsc --noEmit
  ```

  Expected: all commands pass.

### Task 3: Remove named scripts/fixtures and verify no executable named-model branch remains

**Files:**
- Delete: `apps/api/tests/fixtures/vgg16-canonical-ir.ts`
- Delete: `apps/api/tests/fixtures/ready-vgg16-figure-analysis.ts`
- Modify: `apps/api/tests/grammars/cnn-classifier.test.ts`
- Modify: `apps/api/tests/figure-draft-preview-service.test.ts`
- Modify: `apps/api/tests/figure-draft-preview-routes.test.ts`
- Modify: `apps/api/tests/network-ir-v1-adapter.test.ts`
- Delete: `scripts/generate-vgg16-figure-plan.mts`
- Delete: `scripts/generate-vgg16-figure-plan.test.mjs`
- Delete: `scripts/vgg16-visio-smoke.ps1`
- Delete: `scripts/vgg16-visio-smoke.test.mjs`
- Delete: `scripts/agent-vgg16-visio-acceptance.ts`

**Consumes:** generic structural test builders already present under `apps/api/tests/fixtures/universal-graph-spec.ts` and generic UGS/GPG/PVP tests.

**Produces:** an anonymous topology test corpus with no named-model fixture or executable script.

- [ ] **Step 1: Change named-model-dependent tests to existing anonymous universal graph fixtures or delete tests that only validate the retired bridge.**

  Preserve generic preview ownership, clarification, QA, and structural grammar assertions. Do not introduce a replacement named-model fixture. Where a legacy test requires canonical NetworkIR v2, build the smallest anonymous topology locally in that test using `parseCanonicalNetworkIR` and source-backed evidence IDs.

- [ ] **Step 2: Delete all named scripts and fixture files.**

  Delete exactly the files listed above; retain historical evidence and design logs.

- [ ] **Step 3: Run the complete retirement verification matrix.**

  ```powershell
  npm run api:test
  npx tsc --noEmit
  npm run api:check
  npm run agent:verify-roadmap
  git diff --check
  rg -n -i 'vgg(?:[-_ ]?16)?|resnet|u[-_ ]?net|vision transformer|\bvit\b' apps/api/src apps/api/tests apps/client scripts package.json
  ```

  Expected: verification commands pass; the final search has no output in executable source/test/script trees.

### Task 4: Implement composable semantic-region derivation as the next drawing-core slice

**Files:**
- Create: `apps/api/src/composable-semantic-regions.ts`
- Create: `apps/api/tests/composable-semantic-regions.test.ts`
- Modify: `apps/api/src/general-publication-graph.ts`
- Modify: `apps/api/tests/general-publication-graph.test.ts`

**Consumes:** validated UGS nodes/ports/edges/evidence and existing GPG component/relation roles.

**Produces:** deterministic structural regions for repeat, scale transition, add merge, concat fusion, token/attention, custom modules, and candidate topology without model-name classification.

- [ ] **Step 1: Write failing anonymous topology tests.**

  Cover a mixed graph containing a spatial scale transition, an add merge, a concat merge, and a custom module. Assert that one result contains all matching semantic-region records, each record has source node/edge/evidence IDs, deterministic IDs, and no architecture-name field.

- [ ] **Step 2: Implement a pure semantic-region derivation function.**

  Implement `deriveComposableSemanticRegions(ugs: UniversalGraphSpec): ComposableSemanticRegion[]`. Derive only from UGS kind, attributes, ports, relation, and evidence. Return `candidate_region` for candidate/feedback topology. Do not emit geometry, grammar name, coordinates, or renderer commands.

- [ ] **Step 3: Integrate derived regions into GPG and verify determinism.**

  Extend GPG composition so compatible regions coexist in one graph. Preserve existing generic components/relations and source mappings. Run focused tests, then begin a separate PVP composition plan only after this semantic boundary is accepted.
