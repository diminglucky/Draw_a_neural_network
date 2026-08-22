# Core Drawing V1 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Every task has an independent review gate and must preserve the global constraints below.

**Goal:** Deliver a trustworthy path from unfamiliar neural-network code, description, and later sketch evidence to a publication-quality preview and a safe incremental update of a user-selected existing Visio page.

**Architecture:** UGS/GPG/PVP remain the only canonical structural and visual state. A constrained evidence interpreter may propose UGS facts but never owns topology truth. A publication grammar compiler turns formal UGS/GPG into PVP. A separate current-page execution path discovers an existing Visio target, seals an Agent-owned region binding, applies only formal PVP diffs, and verifies the resulting native readback.

**Tech Stack:** TypeScript, Zod, Vitest, existing UGS/GPG/PVP services, browser PVP preview, Node Worker client, .NET Visio Worker, Windows Visio real-host acceptance.

## Global Constraints

- Work only in C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation on branch agent.
- Preserve user-owned visual-rubric drafts unless the owner explicitly includes them.
- Never execute submitted source, import user modules, or evaluate user-controlled code.
- Provider/model/browser input can contain neither raw SVG nor renderer coordinates, Worker controls, COM/VBA, shell, filesystem paths, export controls, or arbitrary native shape identifiers.
- Each candidate/proposed node, port, edge, and unresolved relation must reference bounded evidence. Candidate or blocking topology cannot reach Snapshot, native intent, Worker, or Visio.
- Grammar selection may use only UGS/GPG semantics, requested detail, and approved style policy; it must not use a model name, paper name, filename, or template label.
- Normal drawing attaches only to a user-selected existing Visio document/page and never creates, replaces, or closes that document/page. Save/close/reopen tests use an explicit target and cannot be used as a shortcut during ordinary updates.
- All Visio mutations are restricted to the binding's Agent-owned region and require current Worker readback, owner/device/workflow identity, page revision, page readback hash, and formal PVP identity.
- Every code change begins with a focused failing test. Run the task's focused tests before committing and the final delivery matrix before a delivery commit.

---

## Task 1: Close the CD0 governance precondition without inventing a milestone

**Files:**

- Modify: docs/agent-program-state.json
- Modify: docs/ROADMAP.md
- Modify: docs/agent-governance/implementation-records/current-roadmap.md
- Modify: docs/agent-governance/implementation-records/operation-history.md
- Test: apps/api/tests/agent-roadmap-cli.test.ts

**Interfaces:**

- Consumes: the current M2.8/M2.10/M2.11 ledger records and the owner-approved Core Drawing V1 design.
- Produces: planned M2.12/M2.13 records with explicit dependencies and acceptance contracts while preserving every current node status and currentFocus. Independent acceptance of existing nodes remains a separate evidence decision.

- [ ] **Step 1: Write the failing planned-node and current-focus test.**

~~~ts
expect(status.currentFocus).toMatchObject({ id: "M2.11", status: "awaiting_acceptance" });
expect(status.nodes.find((node) => node.id === "M2.12")).toMatchObject({ status: "planned", dependsOn: ["M2.8", "M2.10", "M2.11"] });
expect(status.nodes.find((node) => node.id === "M2.13")).toMatchObject({ status: "planned", dependsOn: ["M2.12"] });
~~~

- [ ] **Step 2: Run the focused roadmap test.**

Run: npx vitest run apps/api/tests/agent-roadmap-cli.test.ts

Expected: failure because the Core Drawing V1 planned-node mapping is not yet represented in the ledger.

- [ ] **Step 3: Record only independently reviewed, resolvable evidence.**

Add M2.12 and M2.13 with the exact title, dependency, acceptance mapping, next action, and successor semantics in the design's proposed ledger mapping. Preserve M2.8/M2.10/M2.11 statuses and currentFocus exactly. Any later acceptance record must include a reachable 40-character commit SHA, focused test reference, document reference, verification timestamp, and acceptance mapping. Render docs/ROADMAP.md from the JSON source after the data update.

- [ ] **Step 4: Verify deterministic ledger output.**

Run: npx vitest run apps/api/tests/agent-roadmap-cli.test.ts && npm run agent:verify-roadmap

Expected: passing test and exact roadmap parity.

- [ ] **Step 5: Commit only the governance slice.**

~~~text
git add docs/agent-program-state.json docs/ROADMAP.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/implementation-records/operation-history.md apps/api/tests/agent-roadmap-cli.test.ts
git commit -m "chore(agent): record core drawing precondition"
~~~

## Task 2: Add a bounded architecture-description and interpreter contract before UGS

**Files:**

- Create: apps/api/src/architecture-interpretation-contract.ts
- Create: apps/api/src/evidence-augmented-ugs-interpreter.ts
- Create: apps/api/src/evidence-augmented-ugs-harness.ts
- Create: apps/api/tests/evidence-augmented-ugs-interpreter.test.ts
- Modify: apps/api/src/universal-input-compilation-service.ts
- Modify: apps/api/src/evidence-constrained-drawing-session.ts
- Test: apps/api/tests/universal-input-compilation-service.test.ts
- Test: apps/api/tests/evidence-constrained-drawing-session.test.ts

**Interfaces:**

~~~ts
export interface ArchitectureInterpreter {
  propose(input: BoundedInterpretationRequest): Promise<InterpreterProposal>;
}

export function interpretEvidenceAugmentedInput(
  input: BoundedInterpretationRequest,
  proposal: unknown,
): { ugs: UniversalGraphSpec; state: "formal" | "clarification"; proposalHash: string };
~~~

BoundedInterpretationRequest has requestId, bounded public evidence, detail, maxNodes, and maxEdges. InterpreterProposal has version 1, nodes, ports, edges, evidence references, and unresolved items only. The Harness owns exact-key parsing and canonical proposal hashing.

- [ ] **Step 1: Write failing contract tests for the supported and rejected cases.**

~~~ts
expect(interpretEvidenceAugmentedInput(customModuleRequest, customModuleProposal).ugs.nodes)
  .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "custom_operator" })]));
expect(interpretEvidenceAugmentedInput(ambiguousMergeRequest, ambiguousMergeProposal).state)
  .toBe("clarification");
expect(() => interpretEvidenceAugmentedInput(validRequest, { ...validProposal, comCommand: "x" }))
  .toThrow(/unknown|field/i);
~~~

- [ ] **Step 2: Run the new test and observe the missing boundary.**

Run: npx vitest run apps/api/tests/evidence-augmented-ugs-interpreter.test.ts

Expected: failure because the contract/Harness modules do not yet exist.

- [ ] **Step 3: Implement the schema and fail-closed Harness.**

The Harness rejects unknown fields, raw source/image payloads, unsupported evidence IDs, duplicate IDs, dangling ports/edges, missing evidence references, invalid confidence, over-capacity proposals, and all renderer/native/provider-control fields. It preserves explicit unknown operators as custom_operator. Required input/output/add/concat/residual/cross-attention direction uncertainty returns exactly the first sorted clarification.

- [ ] **Step 4: Integrate without changing source-execution or native boundaries.**

Extend UniversalPreviewInput with an evidence-bound architecture-description variant. Keep static PyTorch analysis authoritative for parser facts. If the interpreter is absent, times out, or returns an invalid/contradictory proposal, compile only proven facts and return clarification; do not construct a guessed formal UGS. Thread proposal hash and evidence digest into the drawing session revision without exposing raw input.

- [ ] **Step 5: Verify the focused safety matrix.**

Run: npx vitest run apps/api/tests/evidence-augmented-ugs-interpreter.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/static-pytorch-universal-graph-spec.test.ts

Expected: custom explicit ports reach UGS; ambiguous topology remains clarification; no source execution, Snapshot, native intent, Worker, or Visio invocation occurs.

- [ ] **Step 6: Commit the interpreter slice.**

~~~text
git add apps/api/src/architecture-interpretation-contract.ts apps/api/src/evidence-augmented-ugs-interpreter.ts apps/api/src/evidence-augmented-ugs-harness.ts apps/api/src/universal-input-compilation-service.ts apps/api/src/evidence-constrained-drawing-session.ts apps/api/tests/evidence-augmented-ugs-interpreter.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts
git commit -m "feat(agent): constrain unfamiliar architecture interpretation"
~~~

## Task 3: Add semantic grammar selection and the visual acceptance corpus

**Files:**

- Create: apps/api/src/publication-visual-grammar-registry.ts
- Create: apps/api/src/publication-visual-acceptance-corpus.ts
- Create: apps/api/tests/fixtures/publication-visual-acceptance-corpus.ts
- Create: apps/api/tests/publication-visual-grammar-registry.test.ts
- Create: apps/api/tests/publication-visual-acceptance-corpus.test.ts
- Modify: apps/api/src/publication-visual-plan-compiler.ts
- Modify: apps/api/src/publication-visual-plan-qa.ts
- Modify: apps/client/publication-visual-plan-preview.test.js
- Create: docs/evidence/2026-08-21-core-drawing-v1-visual-review.md

**Interfaces:**

~~~ts
export type PublicationGrammarFamily =
  | "convolutional_hierarchy" | "residual_backbone" | "multi_branch_fusion"
  | "encoder_decoder" | "token_attention" | "dual_tower" | "custom_module";

export function selectPublicationVisualGrammar(input: {
  ugs: UniversalGraphSpec;
  graph: GeneralPublicationGraph;
  detail: "overview" | "architecture" | "operator_detail";
}): { family: PublicationGrammarFamily; recipeVersion: string };

export function parsePublicationGrammarRequest(input: unknown): {
  ugs: UniversalGraphSpec;
  graph: GeneralPublicationGraph;
  detail: "overview" | "architecture" | "operator_detail";
};
~~~

- [ ] **Step 1: Write failing family-selection and no-template tests.**

~~~ts
expect(selectPublicationVisualGrammar(residualFixture).family).toBe("residual_backbone");
expect(selectPublicationVisualGrammar(fusionFixture).family).toBe("multi_branch_fusion");
expect(selectPublicationVisualGrammar(customFixture).family).toBe("custom_module");
expect(() => parsePublicationGrammarRequest({ ...customFixture, modelName: "VGG16" })).toThrow(/unknown|field/i);
~~~

- [ ] **Step 2: Write failing corpus-completeness tests.**

~~~ts
expect(listPublicationVisualAcceptanceFixtures().map((item) => item.family)).toEqual(expect.arrayContaining([
  "convolutional_hierarchy", "residual_backbone", "multi_branch_fusion", "encoder_decoder",
  "token_attention", "dual_tower", "custom_module",
]));
expect(validatePublicationVisualAcceptanceCorpus()).toMatchObject({ status: "complete", fixtureCount: 13 });
~~~

- [ ] **Step 3: Run grammar and corpus tests.**

Run: npx vitest run apps/api/tests/publication-visual-grammar-registry.test.ts apps/api/tests/publication-visual-acceptance-corpus.test.ts

Expected: failure because no semantic registry or complete corpus exists.

- [ ] **Step 4: Implement deterministic visual recipes and QA.**

Selection accepts only parsed UGS/GPG/detail. Recipes produce PVP primitives, ports, connector lanes, source mappings, and style tokens with stable IDs. Add deterministic checks for family-recipe match, label density, primitive/annotation collision, page bounds, connector route, source mapping coverage, grayscale tokens, and PVP/browser identity. Existing generic QA remains the authoritative baseline; this task adds family-specific diagnostics rather than bypassing it.

- [ ] **Step 5: Record human review separately from test success.**

For all 13 fixtures, render overview and architecture detail browser artifacts. Record UGS/GPG/PVP/render hashes and reviewer decisions in docs/evidence/2026-08-21-core-drawing-v1-visual-review.md. A missing human-review entry leaves the corpus status incomplete; it cannot be promoted by a unit-test result.

- [ ] **Step 6: Verify compiler, browser, and corpus identity.**

Run: npm run api:test -- apps/api/tests/publication-visual-grammar-registry.test.ts apps/api/tests/publication-visual-acceptance-corpus.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-plan-qa.test.ts apps/client/publication-visual-plan-preview.test.js

Expected: every corpus fixture compiles deterministically, browser preview represents exactly the PVP identity, and a candidate/blocking structure cannot appear as formal visual authority.

- [ ] **Step 7: Commit the visual grammar slice.**

~~~text
git add apps/api/src/publication-visual-grammar-registry.ts apps/api/src/publication-visual-acceptance-corpus.ts apps/api/src/publication-visual-plan-compiler.ts apps/api/src/publication-visual-plan-qa.ts apps/api/tests/fixtures/publication-visual-acceptance-corpus.ts apps/api/tests/publication-visual-grammar-registry.test.ts apps/api/tests/publication-visual-acceptance-corpus.test.ts apps/client/publication-visual-plan-preview.test.js docs/evidence/2026-08-21-core-drawing-v1-visual-review.md
git commit -m "feat(agent): add semantic publication visual grammars"
~~~

## Task 4: Add sketch intake and observation projection as a candidate-only lane

**Files:**

- Create: apps/api/src/sketch-intake.ts
- Create: apps/api/src/sketch-observation-extractor.ts
- Create: apps/api/src/sketch-observation-ugs-adapter.ts
- Create: apps/api/tests/sketch-intake.test.ts
- Create: apps/api/tests/sketch-observation-ugs-adapter.test.ts
- Modify: apps/api/src/evidence-constrained-drawing-session.ts
- Test: apps/api/tests/evidence-constrained-drawing-session.test.ts

**Interfaces:**

~~~ts
export type SketchIntakeReceipt = {
  sketchId: string; sha256: string; mimeType: "image/png" | "image/jpeg";
  width: number; height: number; byteLength: number;
};
export type SketchObservationSet = {
  receipt: SketchIntakeReceipt; labels: readonly SketchLabel[];
  blocks: readonly SketchBlock[]; arrows: readonly SketchArrow[];
};
export function projectSketchObservationsToCandidateUgs(input: SketchObservationSet): UniversalGraphSpec;
~~~

- [ ] **Step 1: Write failing intake and candidate-only tests.**

~~~ts
expect(() => createSketchIntakeReceipt({ mimeType: "image/svg+xml", bytes: svgBytes })).toThrow();
const session = openEvidenceConstrainedDrawingSession(sketchObservationRequest);
expect(session.state).toBe("clarification");
expect(session.preview).toBeUndefined();
~~~

- [ ] **Step 2: Run the focused sketch tests.**

Run: npx vitest run apps/api/tests/sketch-intake.test.ts apps/api/tests/sketch-observation-ugs-adapter.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts

Expected: failure because bounded sketch receipts and observation projection do not exist.

- [ ] **Step 3: Implement the three strict boundaries.**

sketch-intake.ts validates allowed MIME, byte length, dimensions, SHA-256, and ephemeral input handling. sketch-observation-extractor.ts accepts only a receipt plus bounded extraction result and rejects Provider credentials, paths, raw geometry, UGS/PVP, and Visio fields. sketch-observation-ugs-adapter.ts gives every candidate node/edge observation evidence and makes unobserved direction, merge, repetition, label identity, and port relation blocking.

- [ ] **Step 4: Verify absence of native authority.**

Run: npx vitest run apps/api/tests/sketch-intake.test.ts apps/api/tests/sketch-observation-ugs-adapter.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts

Expected: image bytes do not cross from intake to public/session DTOs; sketches produce candidate/clarification only; no eligible Snapshot/native mapping is created.

- [ ] **Step 5: Commit the sketch candidate slice.**

~~~text
git add apps/api/src/sketch-intake.ts apps/api/src/sketch-observation-extractor.ts apps/api/src/sketch-observation-ugs-adapter.ts apps/api/src/evidence-constrained-drawing-session.ts apps/api/tests/sketch-intake.test.ts apps/api/tests/sketch-observation-ugs-adapter.test.ts apps/api/tests/evidence-constrained-drawing-session.test.ts
git commit -m "feat(agent): constrain sketch observations"
~~~

## Task 5: Attach to an existing Visio page and update only its Agent-owned region

**Files:**

- Create: apps/api/src/existing-visio-page-binding.ts
- Create: apps/api/src/interactive-visio-update-authorization.ts
- Create: apps/api/src/interactive-visio-update-service.ts
- Create: apps/api/tests/existing-visio-page-binding.test.ts
- Create: apps/api/tests/interactive-visio-update-service.test.ts
- Modify: apps/api/src/visio-session-protocol.ts
- Modify: apps/api/src/visio-worker-client.ts
- Modify: apps/api/src/visio-readback.ts
- Modify: apps/api/src/publication-visual-plan-native-intent.ts
- Modify: workers/visio-worker/src/VisioWorker.Core/VisioSessionModel.cs
- Modify: workers/visio-worker/src/VisioWorker.Core/VisioSessionManager.cs
- Modify: workers/visio-worker/src/VisioWorker.Live/VisioComSessionBackend.cs
- Modify: workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs
- Modify: workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs
- Test: apps/api/tests/visio-worker-client.test.ts
- Test: apps/api/tests/publication-visual-plan-native-intent.test.ts
- Test: workers/visio-worker/tests/VisioWorker.Core.Tests/VisioSessionManagerTests.cs
- Test: workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerV2ProtocolTests.cs
- Test: workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionOperationsTests.cs

**Interfaces:**

~~~ts
export function bindExistingVisioPage(input: {
  owner: TrustedVisioSessionIdentity;
  selected: ExistingVisioTarget;
  agentRegion: { mode: "existing"; regionId: string } | { mode: "create"; bounds: Bounds; userConfirmationId: string };
  readback: VisioReadback;
}): ExistingVisioPageBinding;

export async function applyFormalPvpToExistingVisioPage(input: {
  binding: ExistingVisioPageBinding;
  snapshot: GenericPlanSnapshot;
  expectedPvpHash: string;
}): Promise<{ binding: ExistingVisioPageBinding; readback: VisioReadback }>;
~~~

- [ ] **Step 1: Write failing discovery, no-create, and preservation tests.**

~~~ts
await expect(service.discoverExistingTargets(identity)).resolves.toHaveLength(2);
await expect(service.bind({ selectedTargetId: "missing" })).rejects.toThrow(/VISIO_TARGET_NOT_BOUND/);
await expect(service.bind({ selectedTargetId: "ambiguous" })).rejects.toThrow(/selection/i);
expect(worker.openOrCreateCalls).toBe(0);
expect(readback.unrelatedShapeIds).toEqual(["user-shape-1"]);
~~~

- [ ] **Step 2: Add protocol commands and Worker operations.**

Add strict discoverExistingTargets, attachExistingPage, readPage, and applyOwnedRegionDiff commands. discoverExistingTargets returns only Worker-issued opaque handles, native document/page identity, and measured page bounds. attachExistingPage rejects unknown or stale handles. Remove OpenOrCreate from the current-page path; it remains unavailable to those commands. Every response includes a readback revision/hash sufficient to bind the next request.

- [ ] **Step 3: Implement binding, ownership, and conflict rules.**

Server code derives the binding after a fresh readback. Native shapes/connectors include region ID, semantic ID, plan ID, plan hash, ownership version, and PVP ownership marker. Before mutation, compare target identity, owner/device/workflow, readback revision/hash, and every owned semantic object. Return PAGE_CHANGED, OWNED_SHAPE_MISSING, OWNED_SHAPE_MODIFIED, or REGION_CONFLICT without mutation on mismatch. Apply only the semantic PVP delta inside the measured Agent region; preserve every non-Agent shape and connector.

- [ ] **Step 4: Add lifecycle behavior without closing ordinary sessions.**

Normal applyFormalPvpToExistingVisioPage does not issue save or close. A dedicated explicit lifecycle command accepts a saved test-document locator, verifies save/readback, closes, reopens that exact document, and verifies editable shapes/connectors. It rejects the selected live user document unless a separate explicit confirmation allows it.

- [ ] **Step 5: Verify API and Worker contract tests.**

Run: npm run api:test -- apps/api/tests/existing-visio-page-binding.test.ts apps/api/tests/interactive-visio-update-service.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts

Run: dotnet test workers/visio-worker/VisioWorker.sln --no-restore --filter "FullyQualifiedName~VisioSessionManagerTests|FullyQualifiedName~WorkerV2ProtocolTests|FullyQualifiedName~VisioComSessionOperationsTests"

Expected: no target or ambiguous target creates nothing; stale/foreign/candidate/raw-control requests fail before mutation; user shapes survive; user edits to owned shapes produce conflict; successful updates advance the readback-bound revision without closing Visio.

- [ ] **Step 6: Commit the current-page update slice.**

~~~text
git add apps/api/src/existing-visio-page-binding.ts apps/api/src/interactive-visio-update-authorization.ts apps/api/src/interactive-visio-update-service.ts apps/api/src/visio-session-protocol.ts apps/api/src/visio-worker-client.ts apps/api/src/visio-readback.ts apps/api/src/publication-visual-plan-native-intent.ts apps/api/tests/existing-visio-page-binding.test.ts apps/api/tests/interactive-visio-update-service.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/publication-visual-plan-native-intent.test.ts workers/visio-worker/src/VisioWorker.Core/VisioSessionModel.cs workers/visio-worker/src/VisioWorker.Core/VisioSessionManager.cs workers/visio-worker/src/VisioWorker.Live/VisioComSessionBackend.cs workers/visio-worker/src/VisioWorker.Host/WorkerV2Protocol.cs workers/visio-worker/src/VisioWorker.Host/LongLivedWorkerRuntime.cs workers/visio-worker/tests/VisioWorker.Core.Tests/VisioSessionManagerTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerV2ProtocolTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/VisioComSessionOperationsTests.cs
git commit -m "feat(agent): update a bound existing Visio page"
~~~

## Task 6: Perform the real-host Core Drawing V1 acceptance matrix

**Files:**

- Create: docs/evidence/2026-08-21-core-drawing-v1-real-host-acceptance.md
- Modify: docs/agent-governance/implementation-records/current-roadmap.md
- Modify: docs/agent-governance/implementation-records/operation-history.md

**Interfaces:**

- Consumes: accepted Task 2–5 contracts, formal PVP Snapshot, explicit test-document binding, and a Windows host with Visio installed.
- Produces: evidence records only; it does not infer real-host success from unit tests.

- [ ] **Step 1: Prepare a controlled cross-family test document.**

Create or explicitly select a non-production test .vsdx containing one unrelated user shape and one selected page. Record document/page identity, initial readback hash, and user-shape identity before each family run.

- [ ] **Step 2: Execute the initial and incremental matrix.**

For convolutional hierarchy, residual, fusion, encoder-decoder, token/attention, dual tower, and custom module fixtures: bind the selected page, create/confirm an Agent region, draw the first formal PVP, make one semantic update, and independently read back text, shapes, ownership tags, and connectors.

- [ ] **Step 3: Execute negative and lifecycle cases.**

Prove no document/page creation for no-target and ambiguous-target cases; mutate an Agent-owned shape manually and verify OWNED_SHAPE_MODIFIED; verify a user shape remains unchanged; cancel an update; then save, close, reopen the explicit test document, verify editable shapes, and perform independent readback again.

- [ ] **Step 4: Record evidence and update governance only when every required row is proven.**

Record commands, host/Visio version, binding identities, input/PVP/readback hashes, screenshots, readback summaries, cancellation result, failures, and reviewer decision. Missing rows keep the relevant ledger node unaccepted.

- [ ] **Step 5: Run the final delivery matrix before any delivery commit.**

Run: npm run api:test

Run: npx tsc --noEmit

Run: npm run api:check

Run: npm run agent:verify-roadmap

Run: dotnet test workers/visio-worker/VisioWorker.sln --no-restore

Run: git diff --check

Expected: each command succeeds; browser corpus review and real-host evidence remain separately recorded gates.

- [ ] **Step 6: Commit only verified evidence and governance changes.**

~~~text
git add docs/evidence/2026-08-21-core-drawing-v1-real-host-acceptance.md docs/agent-governance/implementation-records/current-roadmap.md docs/agent-governance/implementation-records/operation-history.md docs/agent-program-state.json docs/ROADMAP.md
git commit -m "docs(agent): record core drawing v1 host acceptance"
~~~

## Dependency and parallelization rules

| Work lane | May start after | Owns | Cannot touch |
|---|---|---|---|
| Interpreter | M2.12 active after Task 1 | architecture contract, Harness, input compilation/session tests | PVP compiler, browser, Visio files |
| Visual grammar | Task 2 formal UGS contract | grammar registry, corpus, PVP QA, browser review artifacts | interpreter files, Worker files |
| Sketch | Task 2 formal UGS contract | intake receipt, observation extractor, candidate adapter | PVP/native/Worker files |
| Existing-page Visio | Task 2 formal UGS contract and accepted formal PVP/Snapshot boundary | page binding, Node Worker client/protocol, Worker session attach/readback | interpreter and grammar selection files |
| Real host | Tasks 3 and 5 | evidence only | product implementation except defects found by acceptance |

Task 3 and Task 4 may run in parallel after Task 2. Task 5 may begin its protocol and binding tests after Task 2 but cannot use visual corpus acceptance as evidence until Task 3 is complete. Task 6 starts only after Tasks 3–5 have passed their focused contracts and a reviewer confirms the exact test-document scope.
