# Universal Neural Architecture to Visio Compiler

## Status and Contract

Draft for review. This replaces the box-oriented rendering direction in the
2026-09-14 documents. It does not authorize deletion until migration gates pass.

The product creates native, editable Microsoft Visio figures. Its support
contract is:

> Any architecture representable in Universal IR can be projected to Visio
> without selecting a template from its model name. Known topology with unknown
> operators uses generic primitives; unknown internals remain opaque; uncertain
> topology blocks rendering and requests confirmation.

## Principles

1. Acquire evidence before drawing.
2. Universal IR is the sole source of network facts.
3. Semantic facts are immutable derived indexes, not a second graph of record.
4. Local visual rules compose facts; architecture renderers are forbidden.
5. Layout solves constraints and never recognizes model names.
6. The Visio bridge mechanically projects laid-out primitives.
7. Every collapse and visible relation remains traceable to source evidence.
8. Real VSDX readback and PNG review are mandatory acceptance evidence.

## Pipeline

```text
Request / source / repository / config / artifact / image
  -> Architecture Resolver -> Trusted Acquisition
  -> Static Analysis or optional Isolated Trace
  -> Evidence Package -> Universal IR -> Derived Semantic Facts
  -> Projection Mapping -> Composable Visual Rules
  -> Semantic Scene IR -> Figure Intent and Profiles
  -> Constraint Layout -> Laid-out Scene IR
  -> Visio Diagram Plan v1 -> Visio COM -> Readback and PNG QA
```

## Architecture Resolution

Accepted inputs are `ir`, `source`, `repository`, `config`, `artifact`, `image`
and `prompt`. Structural authority is ranked:

1. explicit Universal IR;
2. declarative graph artifact such as ONNX;
3. user source and configuration;
4. official repository pinned to an immutable revision;
5. official documentation or paper;
6. model name or architecture image.

Lower-ranked evidence may explain but never silently override stronger
topology. A request such as `YOLO` produces candidates. A precise request such
as `Ultralytics YOLOv8n` must resolve repository, revision, configuration and
entry point before extraction. An alias catalog stores source locators only,
never node lists, layouts or visual templates.

Repository content is untrusted and read-only. Acquisition records URL,
revision, path, SHA-256, license and retrieval time. Remote Python is not
executed in the Agent process. Pickle-backed `.pt/.pth` files are not loaded by
default. ONNX and declarative graphs are parsed directly.

Optional runtime tracing requires a disposable process, no network, fixed
dependencies, resource/time limits, synthetic input, no inherited secrets and
structured graph output only. Prefer `torch.export`, FX or TorchScript over
arbitrary module execution.

## Evidence Package

```js
{
  version: "architecture-evidence-package/v1",
  request: { kind, requestedIdentity },
  identity: { resolvedName, provider, repository, revision, configPath, entryPoint },
  sources: [{ id, kind, uri, revision, path, sha256, license, authority }],
  claims: [{ id, subjectId, predicate, value, sourceIds, confidence, status }],
  graph: { nodes, edges, ports, tensors, containers },
  diagnostics: [],
  unresolvedQuestions: []
}
```

`status` is `grounded`, `inferred`, `unresolved` or `contradicted`. Before
rendering, the package must identify the exact architecture revision, defining
files, grounded modules and edges, tensor-shape provenance and unresolved
conflicts. Conflicts affecting topology, ports or shapes block rendering.

## Universal IR and Fallback

Universal IR retains stable node/edge/port identities, attributes, tensor
shapes, hierarchy, repetition, internal graphs, evidence and confidence. It
contains no Visio coordinates, colors, profile or model-name drawing hint.

- Known topology, unknown operator semantics: generic operator.
- Known topology, unknown tensor shape: unscaled data primitive.
- Known outer topology, unknown internals: opaque module.
- Uncertain node or edge existence: block and request confirmation.

## Derived Semantic Facts

```js
{
  version: "neural-semantic-facts/v1",
  irVersion,
  nodeFacts: { [nodeId]: NodeFacts },
  edgeFacts: { [edgeId]: EdgeFacts },
  regionFacts: { [regionId]: RegionFacts },
  diagnostics: []
}
```

Independent dimensions are: data domain (`spatial`, `sequence`, `vector`,
`set`, `graph`, `state`, `scalar`, `unknown`), operation effect (`preserve`,
`project`, `reduce`, `expand`, `reshape`, `aggregate`, `route`, `unknown`),
topology facts (degree, branch, merge, bypass, cycle, conditional, cross-scale),
structural role and certainty. Each property carries evidence and confidence.
Display labels are never classifier features.

## Projection Mapping

```js
{
  version: "neural-projection-map/v1",
  projections: [{
    id, kind, orderedNodeIds, internalEdgeIds, visibleEdgeIds, hiddenEdgeIds,
    entryPorts, exitPorts, reason, evidenceIds
  }],
  nodeToProjection: {}, edgeToProjection: {}, diagnostics: []
}
```

`kind` is direct, sequence-collapse, repeat-collapse, opaque-module,
inline-expansion or callout-expansion. Every Universal IR node and edge must be
direct, visible, internal or explicitly hidden. External edges are remapped to
entry/exit ports. Expansion requires grounded internal branch, merge, bypass,
state, scale transition or another relation a single primitive cannot preserve.

## Visual Rule Model

There are no YOLO, ResNet, U-Net, Transformer, GAN or RNN renderers. The first
implementation is a static JavaScript rule registry, not a DSL:

```js
{ id, phase, priority, match: context => boolean, emit: context => primitives }
```

Phases are `body`, `structure`, `relation`, `decoration`, then `normalize`.
Exactly one primary body is allowed per projection. Additive decorations may
compose. Equal-priority exclusive matches are errors. Rules cannot call Visio
or emit coordinates.

## Scene Contracts

Semantic Scene IR is layout-free:

```js
{
  version: "semantic-neural-scene/v1",
  primitives: [{
    id, category, form, semanticTags, sourceNodeIds, sourceEdgeIds,
    projectionId, ports, labels, data, derivedFrom
  }],
  relations: [{ id, sourcePrimitiveId, targetPrimitiveId,
    sourcePortId, targetPortId, relationTags, sourceEdgeIds }],
  constraints: [], diagnostics: []
}
```

Categories are data, operator, structure, annotation and boundary. Forms are a
small native algebra: plane, volume, stack, band, wedge, glyph, cell, strip,
text and callout. Tags are extensible. Decorations without source IDs require
`derivedFrom`; fabricated identities are forbidden.

Laid-out Scene IR adds geometry only:

```js
{
  version: "laid-out-neural-scene/v1", units: "layout-unit",
  primitives: [{ ...semanticPrimitive, bounds, anchors, zIndex }],
  connectors: [{ ...semanticRelation, points, routeClass }],
  groups: [{ id, parentId, primitiveIds, bounds, role }],
  page: { x, y, width, height }, diagnostics: []
}
```

The bridge is the only component converting layout units to inches.

## Figure Intent and Profiles

Figure intent is bounded: detail (`overview`, `balanced`, `full`), emphasized
node/edge IDs, page profile, color mode, label density and preferred direction.
It contains no coordinates or commands.

Composable profiles (`spatial`, `sequence`, `stateful`, `multiscale`,
`dual-stream`, `sparse-graph`) supply scaling, spacing, route and label
preferences. They never emit topology and are not architecture templates.

## Constraint Layout

Hard constraints: valid containment and anchors, page bounds, no unrelated
primitive overlap, no connector through unrelated bodies, and preserved DAG
direction. Soft objectives, in order: minimize crossings, bends and length;
align equal scales/streams; keep related marks close; preserve evidenced
symmetry; minimize page area with consistent whitespace.

Complexity budgets are 120/180/100 primary primitives/connectors/labels for
overview, 300/500/260 for balanced and 800/1400/700 for full. Budget overflow
triggers grounded collapse or callouts; it never silently drops branches,
states, outputs or source coverage.

## Visio Boundary

`visio-diagram-plan/v1` remains the public Agent/service contract and embeds
the laid-out scene as `scene`. Existing node/edge indexes remain for API,
persistence and readback. Scene is the only visual source of truth when present;
the bridge must not reconstruct shapes from plan nodes.

Native projection is mechanical: a data volume becomes editable faces grouped
as one unit; bands/wedges/glyphs/cells/outputs are native shapes; label intents
become text shapes; relations become glued connectors using supplied points.
Groups are allowed only for an editable tensor unit or intentional callout, not
as generic module frames. Shape Data stores primitive, projection and source
identities, tensor facts, ports, lanes and intent.

## Migration and Deletion

1. Freeze current plan/readback fixtures.
2. Add resolver and Evidence Package for current inputs.
3. Add repository/config/artifact adapters and provenance validation.
4. Add semantic facts and projection mapping.
5. Add both Scene IR validators.
6. Add phased rules and constraint layout.
7. Embed scene behind an internal feature flag.
8. Validate generic spatial, branch, merge, repeat and cross-scale composition.
9. Add sequence, state, dual-stream, conditional and graph properties using the
   same primitives.
10. Cut production projection over to scene.
11. Delete only code proven unreachable.

Deletion requires zero production references, no persisted/API dependency,
equivalent or stronger identity/readback coverage, full tests, PowerShell parse,
real VSDX save-close-reopen/readback and PNG review. `universal-figure.mjs` is
not deleted by name; responsibilities are migrated first. No commit may change
the public plan version while deleting its fallback.

## Acceptance

Fixtures test capabilities, not model templates: spatial sampling and repeats;
branch/bypass/add; encoder-decoder scale symmetry; three-scale bidirectional
fusion; sequence attention; recurrent state; peer streams; conditional sparse
branches; irregular graph message passing; unknown operators; and uncertain
topology blocking.

Known architectures may be pinned external acceptance inputs, but assertions
target provenance and structural facts. Every production fixture requires a
deterministic Evidence Package, Universal IR, projection coverage, both scenes,
zero hard-layout violations, no name-based conditions, connector glue, VSDX
readback, PNG export and recorded human review.

Overlap, identity loss, missing glue and connector/body intersection are hard
failures. Occupancy, margins and label density are profile-specific warnings
until calibrated from accepted fixtures.

## Delivery Phases

- Phase A Grounding: resolver, repository/config/artifact inputs and evidence.
- Phase B Visual Core: facts, projection, rules, scenes and generic layout.
- Phase C Composition: sequence, state, dual-stream, conditional and graph facts.
- Phase D Cutover: production Visio scene projection and proven cleanup.

## Non-Goals

- Named architecture topology or layout templates.
- README images as authoritative graph definitions.
- Arbitrary downloaded code execution in the Agent process.
- Pixel-perfect paper reproduction without source and figure intent.
- Browser or non-Visio rendering.
- A user-programmable rule language in the first release.
