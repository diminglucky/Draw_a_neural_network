# Automatic Structural Neural-Figure Agent Design

**Status:** Approved direction; supersedes the model-specific legacy-removal specification
**Date:** 2026-08-24
**Scope:** Establish the single product path for a general neural-network drawing Agent: evidence-driven structural analysis of each user input, semantic publication-figure compilation, deterministic preview, and later incremental rendering on the current Visio page.

## 1. Product decision

The Agent is not a catalogue of known neural-network diagrams. It must draw unfamiliar architectures from the structure present in the user's current code, structured description, or sketch. A named architecture, filename, paper title, fixed layer identifier, or prompt keyword must never select a runtime topology, visual layout, or renderer path.

For every new or changed input, the Agent performs automatic structural analysis. It produces a versioned result that is reused for preview, revision, and later Visio application. Re-analysis occurs only when the source/revision changes or the user resolves an uncertainty; the system does not randomly redraw an unchanged confirmed architecture.

## 2. Explicit non-template rule

The runtime must not contain:

- model-name detection or a named-architecture preset;
- a fixed list of nodes, edges, tensor sizes, repeat counts, classifier tails, labels, or coordinates for a known network;
- a bridge that accepts only one topology;
- a visual grammar selected by model name, source filename, paper title, or prompt keyword;
- a test fixture that becomes a production branch or fallback.

The system may contain general knowledge that is independent of any named model:

- operator vocabulary and extensible custom-operator handling;
- topology relations such as data flow, split, add, concat, skip, condition, and feedback;
- tensor scale/channel/repetition facts when supplied by evidence;
- visual primitives, layout constraints, typography, contrast, grayscale, and non-overlap rules;
- deterministic tests built from anonymous topology cases.

This is analogous to a compiler: it contains a language grammar and code generator, but it does not contain a handwritten implementation of the user's program.

## 3. Automatic analysis pipeline

```text
Code / structured description / sketch
  -> source-specific evidence extraction
  -> normalized EvidencePack
  -> AnalysisProposal candidates
  -> structural reconciliation and confidence assessment
  -> UniversalGraphSpec (UGS)
  -> semantic derivation into General Publication Graph (GPG)
  -> composable visual grammar plan
  -> Publication Visual Plan (PVP)
  -> deterministic SVG/PNG/browser preview
  -> visual QA and user confirmation
  -> future sealed current-Visio-page incremental adapter
```

Each stage has one responsibility and must never bypass the preceding stage.

### 3.1 Source-specific evidence extraction

**Code** is processed without executing user code. A framework adapter extracts declarations, calls, module ownership, data-flow edges, tensor facts when statically provable, and source locations. Unsupported dynamic behavior, alias ambiguity, reused modules, dynamic control flow, or unprovable tensor relations are recorded as uncertainty rather than guessed.

**Structured descriptions** are converted by a typed extraction contract. The language model may propose nodes, ports, relations, tensor claims, repeated regions, and evidence references. It cannot emit coordinates, SVG/XML, script, shell, COM, Worker, or Visio instructions.

**Sketches** produce visual observations only: candidate shapes, candidate connectors, text labels, and confidence. A sketch is never sufficient to create a formal graph when topology is ambiguous. The Agent asks one focused clarification or combines the observation with code/description evidence.

### 3.2 EvidencePack and reconciliation

Every inferred node, port, edge, repetition, tensor claim, and semantic relation must carry evidence references. The reconciliation layer gives code-derived proven facts priority over language-model or sketch candidates, rejects contradictions, and marks unresolved information as `candidate` or a blocking clarification.

Only a topology with no blocking structural uncertainty can become a formal UGS/PVP. Candidate diagrams may be previewed only as explicitly uncertain review artifacts and cannot create a Visio job.

### 3.3 UniversalGraphSpec

UGS is the canonical model-neutral topology contract. It represents inputs, outputs, operators, custom operators, custom modules, containers, state, ports, edges, groups, evidence, and unresolved items. It contains no renderer geometry and no architecture-name classification.

An unfamiliar operation is represented as a `custom_operator` or `custom_module` with bounded evidence and a label derived from the source. It remains drawable even when its internal implementation is not yet understood. The user may request a later expansion, which creates a new revision rather than changing the accepted graph silently.

## 4. Semantic derivation and composable visual grammar

The semantic layer recognizes structural patterns, not model identities. It derives a set of independently composable regions and relations from UGS facts:

| Structural evidence | Derived visual semantic |
|---|---|
| spatial tensor sequence with scale change | tensor-stage and scale-transition |
| repeated equivalent subgraph | repeat-group and repeat badge |
| two or more paths entering an add operator | residual/add merge |
| two or more paths entering concatenation | feature-fusion merge |
| downsampling chain, bottleneck, upsampling chain, aligned cross-links | encoder-decoder relationship |
| token sequence and attention data flow | token/attention region |
| multiple independent inputs/branches | multi-branch region |
| feedback/state edge | iterative or recurrent relation |
| unknown source-backed module | custom module frame |

The derived result is a General Publication Graph with semantic regions, display components, relations, source mapping, and an explicit confidence/eligibility state. It must be possible for one drawing to contain several of these regions. A system must not select one whole-network grammar and force a hybrid network into it.

The visual grammar is therefore a library of composition rules, not templates. It maps semantic components to primitive families such as tensor volumes/trapezoids, operator frames, module frames, repeat badges, merge markers, flow arrows, skip routes, token strips, attention relations, annotations, and legends. It never decides the topology.

## 5. Deterministic figure compilation

The PVP compiler receives only validated UGS, GPG, figure intent, and versioned style tokens. It must deterministically produce:

- page/region bounds and hierarchy;
- primitive groups and source-mapped primitives;
- ports, connectors, and connector routes;
- labels, summaries, legends, and style tokens;
- collision-safe layout, readable hierarchy, and a grayscale-safe visual distinction;
- an eligibility/QA result.

The same confirmed inputs produce the same PVP. Language-model output never supplies final geometry. A human can change an explicit figure intent, label, or detail level; the request creates a new version and preserves source mappings.

Visual quality is evaluated before native rendering: geometry, overlap, routing, evidence mappings, label readability, contrast, grayscale distinction, density, and deterministic ordering are blocking checks. Browser SVG/PNG preview is the first acceptance artifact. A high-quality figure cannot be claimed solely from passing topology tests.

## 6. Rendering boundaries

The browser renderer reads a public, validated PVP projection and creates the review preview. It is the first product rendering target.

The future Visio adapter is a terminal adapter, not an analyzer or layout engine. It can consume only a sealed, QA-passing PVP with owner/device/revision binding. It must target the already open and selected Visio page, limit changes to the Agent-owned region, preserve user-created shapes, and support independent readback plus save/reopen verification. It must not open or create a replacement canvas as a fallback.

No existing model-specific bridge, snapshot, export route, worker payload, or real-host script is a compatibility requirement for this design.

## 7. Runtime lifecycle

```text
new input or changed source
  -> automatic analysis revision
  -> candidate or clarification when evidence is incomplete
  -> confirmed formal UGS/GPG/PVP
  -> deterministic preview
  -> user requests detail/style/revision
  -> targeted source/semantic re-analysis only where affected
  -> new revision and preview
```

Source hashes, evidence hashes, semantic graph hashes, PVP hashes, owner, device, and revision identity bind each artifact. This gives automatic behavior without non-deterministic re-drawing of an unchanged confirmed network.

## 8. Evaluation corpus

The automated corpus uses anonymous structural cases, never named architecture templates:

1. linear spatial hierarchy with repeated modules and downsampling;
2. residual/add branch;
3. encoder/decoder with concatenation cross-links;
4. multi-branch fusion;
5. token and cross-attention relation;
6. custom module with unknown internal operation;
7. hybrid multi-scale, residual, and attention topology;
8. ambiguous sketch/code contradiction requiring clarification.

Each case stores source input, evidence facts, expected UGS/GPG properties, allowed primitives/relations, formal-versus-candidate state, deterministic PVP hash, SVG preview, grayscale preview, and visual review record. The corpus checks generalization by structural variation, not by matching named examples.

## 9. Migration rules

1. Delete every model-name preset and fixed named-architecture node builder from the runtime local provider.
2. Delete every named-architecture-only bridge, snapshot, route, script, test, fixture, and executable plan.
3. Replace any runtime fallback that creates nodes from prompt keywords with an evidence-driven analysis result or a clarification.
4. Preserve generic UGS, GPG, PVP, preview, QA, authentication, and generic legacy boundaries only where they have non-template consumers.
5. Replace known-model fixtures with anonymous topology corpus cases. Tests may exercise generic structural semantics but must not introduce a named-architecture production branch.
6. Upgrade grammar selection from one exclusive family winner to a composable region/relation derivation process.
7. Do not implement new Visio lifecycle behavior until browser preview and visual acceptance prove the PVP quality boundary.

## 10. Acceptance criteria

This design is implemented only when:

1. runtime source has no architecture-name detection, preset, fixed known-topology builder, or named-architecture-only renderer;
2. a novel code sample with custom modules can produce either a source-backed formal UGS or one explicit clarification, never a guessed template;
3. a hybrid graph can combine tensor stages, branches, fusion, residual relations, and attention relations without selecting one named network family;
4. formal PVP generation is deterministic, source mapped, visually QA-passing, and rendered in the browser as SVG/PNG;
5. candidate/ambiguous input cannot produce a formal PVP, snapshot, Worker job, or Visio update;
6. the anonymous topology corpus passes structural, negative, determinism, SVG, grayscale, and manual visual-review gates;
7. only after those conditions, a separate Visio acceptance slice proves selected-current-page update, preservation of user shapes, save/reopen, and independent native readback.

## 11. Delivery order and architectural baseline

The product is delivered in dependency order, so drawing quality is never delayed by commercial, native-host, or model-catalogue work:

1. **Remove template paths.** Delete every named-architecture preset, fixture, script, bridge, snapshot, and export path that can still act as a runtime shortcut. A neutral anonymous topology corpus is the regression baseline.
2. **Recover meaning from structure.** Complete source-specific evidence extraction, reconciliation, UGS, and composable semantic-region derivation. This is the first generalization boundary: a previously unseen graph must be represented from its evidence, or explicitly request one clarification.
3. **Compile and prove visual quality.** Compose semantic regions into a GPG/PVP, render deterministic SVG/PNG previews, and pass automated geometry, contrast, grayscale, label, route, density, and source-mapping checks plus manual visual review. The evaluation corpus must include hybrid graphs so a figure can contain several region types at once.
4. **Apply an already accepted plan to Visio.** Only a sealed QA-passing PVP may reach the current-page Visio adapter. Native work cannot become a replacement analyzer, a fallback layout engine, or a reason to open a different document/page.

The codebase must preserve these boundaries as a compatibility rule: source-specific extraction may add evidence; reconciliation may decide formal versus candidate state; semantic derivation may add semantic regions; the PVP compiler may add geometry; renderers may materialize a PVP. No later stage may infer missing topology or replace an uncertainty with a named-model default. Model names may appear only as user-visible source evidence, never as a dispatch key, a topology input, a layout input, a grammar selector, or a renderer selector.

## 12. Non-goals

- No model-name catalogue, template library, or automatic model-family shortcut.
- No free-form LLM coordinates or direct Visio/COM/Worker generation.
- No execution of untrusted code.
- No claim that static code analysis supports dynamic code paths it cannot prove.
- No claim that current generic preview equals real Visio acceptance.
- No billing, Provider commercialization, or unrelated platform expansion in this drawing-core workstream.
