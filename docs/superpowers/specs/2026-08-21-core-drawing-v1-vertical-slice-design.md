# Core Drawing V1: Universal Neural-Network-to-Visio Design

**Status:** Revised product architecture proposed for owner review. Designing a capability does not mark it implemented or accepted.

**Supersedes in sequencing:** The previous roadmap order that separated unfamiliar-network interpretation, publication visual quality, sketch understanding, and current-document Visio work into distant tracks.

**Preserves:** UniversalGraphSpec (UGS), General Publication Graph (GPG), PublicationVisualPlan (PVP), static non-execution, evidence lineage, owner/device binding, Snapshot trust, and restricted native-intent mapping. The existing evidence-constrained drawing-session specification remains the implementation contract for its pure-session component.

## 1. Product decision

Core Drawing V1 is one visible and verifiable user loop, not a library of named-model templates and not a broad desktop-control Agent.

```text
code / architecture description / future sketch
  -> bounded evidence and structural interpretation
  -> clarification when topology is not provable
  -> UGS -> GPG -> publication visual grammar -> PVP
  -> browser preview
  -> controlled incremental update of the current Visio page
  -> save, reopen, and independent readback
```

An unfamiliar operation with explicit ports is drawable as `custom_operator` or `custom_module`. A model name, paper name, filename, or template label never selects drawing grammar. Missing topology, merge semantics, edge direction, repetition, or tensor hierarchy is a clarification condition, never a guess.

## 2. V1 outcome and exclusions

### V1 outcome

For supported PyTorch source or an architecture description, a user can inspect a publication-oriented preview, answer only necessary questions, and update a previously bound selected region of the currently open Visio document. The Agent preserves unrelated shapes, does not repeatedly create pages or canvases, and proves the result through save/reopen/readback. A current-page update is unavailable until the Worker has discovered an existing document/page and the user has selected it; the Agent never substitutes a newly created document for that binding.

### Excluded from V1

- Billing, pricing, subscriptions, and broad account operations.
- Autonomous pattern learning or PatternLibrary promotion.
- Arbitrary desktop control unrelated to neural-network drawing.
- Raw SVG, coordinates, VBA, COM, shell, Python, filesystem paths, or export authority from a model or browser request.
- Keras/ONNX before the PyTorch/description lane has accepted visual and Visio evidence.
- Any claim that browser preview alone proves editable Visio output or publication quality.

## 3. Five bounded layers

| Layer | Responsibility | Allowed output | Forbidden action |
|---|---|---|
| Evidence intake | Normalize source, typed declarations, descriptions, and future sketch observations | source hashes, facts, observations | execute code or expose raw source publicly |
| Structural interpretation | Combine proven facts with constrained proposals | UGS or clarification | emit renderer controls or silently resolve uncertainty |
| Publication composition | Select semantic visual grammar and compile PVP | PVP and visual diagnostics | branch on model names or accept browser geometry |
| Presentation | Render exact PVP in browser and native adapters | preview DTO and native intent | mutate Visio directly from untrusted input |
| Controlled Visio execution | Apply a sealed formal plan to an existing page | readback-backed incremental update | create arbitrary pages or overwrite unrelated shapes |

Each boundary is one-way. A renderer never repairs topology. A model never owns Visio coordinates. Native readback never becomes structural truth without a separately reviewed reconciliation rule.

## 4. Understanding unfamiliar code and descriptions

### 4.1 Inputs and facts

The V1 intake lane supports typed declarations, non-executed static PyTorch source, bounded architecture descriptions, and later sketch observations. Static analysis remains the source of provable source facts. Dynamic control flow, module reuse, unknown calls, contradictory descriptions, and unproven merge relations remain unresolved.

### 4.2 Evidence-augmented interpretation

To handle unfamiliar architectures, add a constrained proposal lane:

```text
InterpretationRequest { bounded evidence, source descriptors, detail }
  -> InterpreterProposal { nodes, ports, edges, evidence references, confidence, unresolved }
  -> Harness validation
  -> UGS or one deterministic clarification
```

The interpreter may use a model provider, but is untrusted. It receives bounded evidence, never Renderer/Worker/COM controls. It can propose only data needed for UGS. The Harness rejects unknown fields, dangling ports, duplicate IDs, unsupported evidence references, invalid confidence, hidden topology, raw-source leakage, and renderer or filesystem controls.

#### 4.2.1 Exact proposal boundary

The Provider boundary is deliberately small and replaceable. `ArchitectureInterpreter` is optional infrastructure, not an authority and not a prerequisite for static facts already proven by the parser.

```ts
type BoundedInterpretationRequest = {
  requestId: string;
  evidence: readonly PublicArchitectureEvidence[];
  detail: "overview" | "architecture" | "operator_detail";
  maxNodes: number;
  maxEdges: number;
};

type InterpreterProposal = {
  version: 1;
  nodes: readonly ProposedNode[];
  ports: readonly ProposedPort[];
  edges: readonly ProposedEdge[];
  evidenceRefs: readonly string[];
  unresolved: readonly ProposedUnresolved[];
};

interface ArchitectureInterpreter {
  propose(input: BoundedInterpretationRequest): Promise<InterpreterProposal>;
}
```

`PublicArchitectureEvidence` contains only a bounded, hash-bound source descriptor, parser fact, user-declared architecture fact, or previously verified sketch observation. It never contains raw source, image bytes, provider credentials, filesystem paths, renderer data, native commands, or arbitrary JSON. Each proposed node, port, edge, and unresolved item references one or more supplied evidence IDs. The Harness reconstructs the public response from allowlisted fields rather than returning a Provider object.

Confidence cannot upgrade uncertainty. Low confidence for input/output, `add`, `concat`, residual, cross-attention, or edge direction becomes a blocking clarification. The model may preserve an unknown operator, but cannot infer the missing connection around it.

### 4.3 Clarification

The session presents the stable first blocking UGS item. Confirmation resolves only that item, creates a new owner/device/target/UGS-bound revision, and then either asks the next question or recomputes PVP. Candidate and blocking states never acquire native authority.

### 4.4 Input availability and deterministic fallback

The first Core Drawing V1 implementation accepts three evidence sources with separate contracts:

| Source | Intake output | When it can become formal | When it must clarify |
|---|---|---|---|
| Static PyTorch | parser facts plus source digest | parser proves ports and topology, or the Harness validates evidence-backed completion | dynamic control flow, reuse, unknown call, or unproven merge/edge |
| Architecture description | bounded `ArchitectureDeclaration` facts plus optional `InterpreterProposal` | every proposed structural relation has accepted declaration/fact evidence | a required port, direction, merge, repeat count, or tensor hierarchy is missing or conflicts |
| Sketch | `SketchObservationSet` only | never from observation alone; formalization requires explicit user confirmation of every blocking relation | any unobserved direction, merge, repeat count, label identity, or port relation |

Natural-language interpretation is therefore an enhancement, not a hidden dependency. If `ArchitectureInterpreter` is unavailable, times out, returns invalid data, or disagrees with parser facts, the Harness returns a deterministic clarification or accepts only the independently proven subset. It never substitutes a guessed topology. The first implementation must record request/proposal hashes and error category, but must not persist raw source or image bytes in the public DTO, roadmap, or audit summary.

## 5. Publication visual grammar is a first-class subsystem

PVP quality is evaluated by topology and semantic family, not by named-model snapshots. A grammar selector consumes UGS/GPG roles, branching, repetition, tensor cues, and requested detail.

| Semantic family | Required visual treatment |
|---|---|
| Convolutional hierarchy | tensor volumes or trapezoid-like blocks, scale progression, concise tensor labels |
| Residual backbone | main lane, distinct skip lane, explicit merge marker, controlled crossings |
| Multi-branch fusion | parallel lanes, aligned entry/exit, explicit concat or add convergence |
| Encoder-decoder | mirrored scale hierarchy and visible cross-scale skip links |
| Token/attention | sequence representation, attention/QKV relation, repeat markers instead of copied blocks |
| Dual tower | independent modality towers and explicit fusion/interactions |
| Custom module | neutral custom block with preserved ports, semantic label, and evidence mapping |

The selector may compose grammars but cannot depend on VGG, ResNet, paper names, source filenames, or user layout commands.

### 5.1 Quality contract

Every formal preview must pass deterministic checks for topology mapping, hierarchy readability, connector direction/endpoints/lanes, bounded labels, collision avoidance, grayscale readability, and semantic PVP identity. It must also have browser fixtures and recorded human review for zero-template examples. Unit tests and SVG rubric scores do not alone prove top-journal quality.

### 5.2 Publication visual acceptance corpus

Visual acceptance is a versioned corpus, not an assertion about one named network. Each corpus fixture records its UGS hash, GPG hash, PVP hash, deterministic browser-render hash, expected grammar family, human-review record, and any explicitly accepted visual deviation. The minimum V1 corpus is:

| Family | Minimum formal fixtures | Required review points |
|---|---:|---|
| Convolutional hierarchy | 2 | tensor/trapezoid progression, scale hierarchy, concise labels |
| Residual backbone | 2 | main lane, skip lane, merge marker, controlled crossings |
| Multi-branch fusion | 2 | parallel alignment, add/concat semantics, converged exit |
| Encoder-decoder | 2 | mirrored scales, cross-scale skip links, decoder direction |
| Token/attention | 2 | sequence direction, Q/K/V relation, repeat marker |
| Dual tower | 1 | independent towers, modality labels, explicit fusion |
| Custom module | 2 | stable unknown-module ports, semantic label, evidence mapping |

The corpus is reviewed at overview and architecture detail levels. A deterministic QA pass proves only geometry and semantic consistency. A fixture becomes a visual acceptance record only after a reviewer records readability, topology legibility, semantic-family treatment, label density, and grayscale result against the viewed PVP. VGG16 may appear only as one regression fixture; it cannot satisfy a family by itself.

## 6. Current-document Visio behavior

Visio is a controlled presentation adapter, not an architecture source of truth.

### 6.1 Existing-page discovery and binding

An interactive update starts with Worker-owned discovery, not with a browser-supplied document or page identifier. The discovery path lists only documents/pages already open in the authorized visible Visio session, returns opaque Worker handles plus native identities and page geometry, and requires an explicit user choice when more than one target exists. If no existing document/page is available, the update fails with `VISIO_TARGET_NOT_BOUND`; it must not call `OpenOrCreate`, create a document, create a page, or silently select another target.

After selection, the server derives and seals an immutable `ExistingVisioPageBinding`:

```ts
type ExistingVisioPageBinding = {
  ownerId: string;
  deviceId: string;
  workflowId: string;
  documentHandle: string;
  nativeDocumentIdentity: string;
  pageHandle: string;
  nativePageIdentity: string;
  pageReadbackRevision: number;
  pageReadbackHash: string;
  agentRegionId: string;
  agentRegionBounds: Bounds;
};
```

The Worker, not the browser, issues opaque handles and measured `Bounds`. The PVP compiler receives only the server-derived agent-region layout context; models and browsers still never provide Visio coordinates. A first region can be created only after an explicit user confirmation naming the selected page and bounds. Thereafter, the same binding is required for every update.

### 6.2 Incremental update rules

- Update the selected existing page; never default to a new document or page.
- Group or region-tag Agent-owned shapes with stable semantic identifiers, `agentRegionId`, PVP plan ID, PVP hash, and ownership version.
- Preserve non-Agent shapes and connectors outside the Agent-owned region.
- Apply only changed PVP primitives, connectors, annotations, and regions.
- Use allowlisted native primitives and connectors only.
- Reject stale owner/device/page/revision/PVP bindings before mutation.
- Read the selected page immediately before mutation, compare it with `pageReadbackHash`, and reject `PAGE_CHANGED`, `OWNED_SHAPE_MISSING`, `OWNED_SHAPE_MODIFIED`, or `REGION_CONFLICT` rather than overwriting user edits.
- Advance `pageReadbackRevision` only after successful mutation and independent readback; bind the next request to the new readback hash.
- Keep the user document and visible Visio instance open during ordinary draw/update operations. `save`, `close`, and `reopen` are explicit lifecycle actions, never an implementation shortcut for normal drawing.
- Use a copied, explicitly chosen test document for close/reopen acceptance unless the user has explicitly authorized lifecycle testing against the selected document.

Only formal PVPs enter this lane. Candidate and clarification states have no Worker or Visio authority.

### 6.3 Mutation and recovery protocol

The sealed update sequence is fixed:

```text
discover current visible targets
  -> user selects document/page and confirms initial Agent region when needed
  -> Worker readback creates ExistingVisioPageBinding
  -> server resolves trusted formal PVP/Snapshot and derives semantic diff
  -> Worker re-reads exact target and validates binding/ownership/readback hash
  -> allowlisted applyDiff inside Agent region only
  -> independent native shape/text/connector readback
  -> persist the next binding only after readback agrees with the PVP
```

Cancellation, COM failure, user document closure, target disappearance, and a mismatched readback leave the prior binding unchanged and return a retryable failure. Recovery may reopen only an explicitly saved document locator held by the Worker; it may not create a replacement canvas. A user edit to an Agent-owned shape is a conflict requiring user choice to keep, reset, or create a new Agent region; the Agent never silently overwrites it.

## 7. Delivery sequence

### CD0 — Accept existing generic foundation

Before creating a new active ledger node, independently review the committed Prompt-to-UGS, Static-code-to-UGS, and evidence-constrained drawing-session slices. This is governance, not a new capability. Until the review records resolvable evidence and owner acceptance, M2.8, M2.10, and M2.11 remain `awaiting_acceptance` and M2.12/M2.13 cannot become active.

### 7.1 Proposed ledger mapping

The following records are part of this approved design vocabulary but remain absent from the ledger until CD0 adds them with status `planned`. Their existence does not claim implementation or acceptance.

| Proposed node | Title | Depends on | Activation and acceptance |
|---|---|---|---|
| M2.12 | Evidence-augmented architecture interpretation | M2.8, M2.10, M2.11 | Becomes active only after all dependencies are accepted; acceptance requires bounded-proposal/Harness tests, non-execution tests, and an implementation record. |
| M2.13 | Publication visual grammar and acceptance corpus | M2.12 | Becomes active only after M2.12 is accepted; acceptance requires all 13 corpus fixtures, deterministic browser identity, recorded human review, and an implementation record. |
| M4.5 | Confidence-bounded Sketch-to-UGS understanding | M2.13 | Retains its existing ledger identity; acceptance requires bounded intake, candidate-only projection, and negative native-authority tests. |
| M3.2–M3.5 | Sealed current-page Visio execution and real-host lifecycle | M2.5, M3.1, M2.13 | Existing M3 records retain their identities. M3.2 resumes only after M2.13 acceptance; M3.3–M3.5 then prove attach, Worker, readback, and real-host lifecycle separately. |

CD0 may add M2.12 and M2.13 as planned records only after their exact title, dependency, acceptance, evidence, successor, and next-action fields are validated by the ledger schema. It must leave `currentFocus` at M2.11 while M2.11 is awaiting acceptance.

### CD1 — Evidence-augmented unfamiliar-architecture interpretation

Implement `ArchitectureDeclaration`, the bounded interpreter request/proposal schema, request/proposal hashing, constrained proposal parsing, and Harness validation for architecture descriptions and parser-limited code. The only valid outputs are formal UGS with evidence or clarification; Provider availability cannot alter this rule.

### CD2 — Publication visual grammar and quality loop

Implement semantic grammar selection, PVP diagnostics, browser fixtures, deterministic rendered artifacts, and the complete visual acceptance corpus in section 5. A grammar family is not accepted until its required formal fixtures have deterministic and recorded human-review evidence.

### CD3 — Sketch observations as candidate evidence

Add `SketchIntakeReceipt -> SketchObservationSet -> candidate UGS` after CD2 semantics are accepted. Intake validates MIME, bytes, dimensions, digest, and ephemeral handling; the extractor sees only a bounded receipt and emits observations, never UGS/PVP/Visio controls. Observations may create candidate blocks and questions, never formal topology, Snapshot, export, or Visio work without confirmation.

### CD4 — Sealed incremental Visio update

Add existing-page discovery/selection, initial-region confirmation, sealed page binding, Agent-owned-region conflict detection, restricted Worker execution, and native readback together as one user-visible vertical slice. Replace the current `OpenOrCreate` path for this slice with explicit attach-to-existing-document behavior.

### CD5 — Real-host lifecycle acceptance

Prove a cross-family Windows/Visio matrix: initial draw, incremental update, save, close, reopen, edit, independent text/shape/connector readback, cancellation, and visual review against the viewed PVP.

Keras/ONNX, billing, durable operations, Electron delivery, and PatternLibrary stay outside Core Drawing V1.

## 8. Parallelization constraints

| Lane | Owns | Consumes and produces |
|---|---|---|
| Interpretation | evidence normalization, proposal schema, UGS validation, clarification tests | consumes evidence, produces parsed UGS only |
| Visual quality | grammar registry, PVP compiler, browser fixtures | consumes parsed UGS/GPG, produces PVP only |
| Visio harness | sealed binding, current-page ownership, Worker/readback tests | consumes formal PVP/native intent only |

No lane bypasses a preceding boundary. The Visio lane cannot accept model text or browser geometry. The visual lane cannot clear unresolved topology.

## 9. Acceptance matrix

| Gate | Required evidence | Proves | Does not prove |
|---|---|---|---|
| Structural correctness | formal/candidate/negative UGS fixtures | unfamiliar structures are not guessed | visual quality |
| Interpreter containment | source-execution, bad-evidence, forbidden-field, confidence tests | proposals are constrained by the Harness | universal model accuracy |
| Visual grammar | deterministic PVP/browser fixtures and human review | zero-template figures are readable | native Visio editability |
| Incremental Visio | discovery ambiguity, no-target rejection, binding, preservation, conflict, allowlist, readback tests | no new-canvas, no unrelated-shape mutation, no silent overwrite | real-host lifecycle |
| Real host | save/reopen/edit/readback/cancel matrix on an explicitly selected test document | editable long-lived Visio behavior | commercial release readiness |

## 10. Migration decisions

- The committed M2.11 drawing session remains the CD1 session authority.
- M2.8 and M2.10 remain deterministic fact providers.
- M2.6 and M2.5 remain the canonical graph and trusted Snapshot contracts.
- M3.1 remains the only allowed PVP-to-native mapping basis.
- The existing Worker `OpenOrCreate` lifecycle is not a Core Drawing V1 current-page attachment mechanism. It remains isolated until CD4 introduces an explicit discovery-and-attach protocol with negative tests proving that no-target and ambiguous-target cases create nothing.
- The VGG bridge is a regression fixture only and is not the generic execution design.
- Existing visual-rubric drafts are independent work; they do not count as Core Drawing V1 visual acceptance until reviewed and connected to zero-template evidence.

## 11. Owner decision for implementation

Implementation may begin only after the owner accepts these design choices:

1. constrained model interpretation belongs in Core Drawing V1 while the Harness retains final authority;
2. zero-template browser visual quality and current-document Visio update are both V1 deliverables;
3. sketch understanding is candidate-and-clarification-only;
4. ordinary Visio updates attach to a selected existing page and never close or replace the user document; lifecycle close/reopen acceptance uses an explicit, separately chosen target;
5. billing, broad Provider operations, Keras/ONNX, PatternLibrary, and unrelated desktop automation remain deferred.
