# Visio Neural Scene Compiler Rebuild

## Status

Approved direction. This design supersedes the box-oriented rendering portions
of the 2026-09-14 Visio architecture and semantic-shape designs.

## Goal

Rebuild the drawing pipeline as a model-agnostic compiler from grounded neural
network evidence to native, editable Microsoft Visio publication figures. The
renderer must express tensor geometry, scale, repetition, branching, fusion,
state and hierarchy instead of drawing every operator as a labeled flowchart
card.

No production rule may select geometry from an architecture or module name.

## Retained Boundaries

- Universal IR normalization, evidence, confidence and fail-closed validation.
- Source, prompt and image analysis through Agent Run.
- Shape inference where supported by explicit operator evidence.
- Existing-document Visio COM execution, save-close-reopen and readback.
- Stable source node, edge, port, container and lane identities.
- The browser remains a Visio control surface and never becomes a renderer.

## Removed Production Paths

- `universal-publication-figure/v1` as a renderer-facing contract.
- `publication-block` as the default processing-node representation.
- Uniform hexagonal or rectangular cards containing operator and tensor text.
- Large dashed compound frames as the default module representation.
- Automatic expansion of every internal operator into equal-weight cards.
- Legacy PublicationTensor and canvas/SVG compatibility dispatches that are no
  longer called by the Visio-only product.
- Renderer decisions based on YOLO, C2f, SPPF, ResNet, Transformer or any other
  display name.
- Tests that protect retired visual output instead of semantic behavior.

Legacy persisted Agent Run snapshots may be upgraded at the persistence
boundary, but retired render contracts are not accepted by production drawing.

## New Compiler Pipeline

```text
Universal IR
  -> Neural Semantic Graph
  -> Visual Grammar Selection
  -> Visio Scene IR
  -> Constraint Layout
  -> Native Visio Projection
  -> VSDX Readback + PNG Visual Acceptance
```

### Neural Semantic Graph

This layer derives renderer-independent facts only:

- tensor rank, spatial dimensions and channels;
- resolution transitions and scale hierarchy;
- main paths, branches, skips, feedback and cross-scale transfers;
- repeats and homogeneous operator sequences;
- merge semantics: add, concat, gate and selection;
- compound boundaries and evidenced internal topology;
- input/output modality and recurrent state ports.

Unknown facts stay unknown and never create decorative structure.

### Visual Grammar Selection

Selection uses graph evidence, not model names. Supported grammars are:

- `tensor-flow`: convolutional, residual and encoder-decoder structures;
- `multi-scale-flow`: pyramids, bidirectional fusion and multi-head output;
- `token-flow`: embedding, attention and feed-forward token transformations;
- `state-flow`: recurrent, iterative and memory-state structures;
- `dual-stream`: generator/discriminator, Siamese and multimodal streams;
- `graph-flow`: irregular message-passing and generic complex DAGs.

A figure may compose grammars by region. For example, a detector can use
`tensor-flow` in its backbone and `multi-scale-flow` in its neck.

### Visio Scene IR

Scene IR is the sole renderer contract. Its primitives are visual marks rather
than network nodes:

- `tensor-plane`, `tensor-volume`, `tensor-stack`;
- `operator-band`, `transition-wedge`, `sampling-marker`;
- `merge-add`, `merge-concat`, `split`, `gate`;
- `repeat-span`, `stage-caption`, `dimension-label`;
- `module-callout`, `state-cell`, `token-strip`, `output-head`;
- semantic connectors with explicit anchors and routed points.

Every primitive carries source identities for native Visio readback.

## Detail Policy

The compiler uses evidence-driven semantic zoom:

1. The main figure shows tensor flow, scale changes, branches and outputs.
2. Consecutive Conv/Norm/Activation operations become a tensor plus thin
   operator bands or a repeat span.
3. A compound is expanded only when its internal topology is evidenced and
   structurally important. Expansion is a callout or an inline composition,
   never a large box full of equal cards.
4. Opaque compounds remain a compact labeled module with explicit unresolved
   Shape Data.

## Geometry Rules

- Spatial dimensions control plane height with bounded logarithmic scaling.
- Channel count controls depth or stack thickness with bounded logarithmic
  scaling.
- Downsampling visibly reduces plane size; upsampling increases it.
- Same-scale tensors align to one baseline across sibling regions.
- Repeated homogeneous operations share one visual body and an `xN` span.
- Residual routes use a dedicated exterior corridor and terminate at an add
  glyph.
- Cross-scale routes use short orthogonal corridors and never cross unrelated
  tensor bodies.
- Containers use alignment, whitespace and captions by default; borders appear
  only when containment would otherwise be ambiguous.
- Labels remain outside dense geometry and cannot resize structural primitives.

## Visio Projection

Each Scene IR primitive maps to a native Visio group made from editable
rectangles, polylines, ovals and text shapes. ShapeSheet data records:

- scene primitive ID and kind;
- source node and edge IDs;
- tensor dimensions and scale lane;
- module and container ownership;
- route class and endpoint port IDs;
- grammar and detail policy.

The bridge does not infer semantics and does not inspect labels.

## Migration Sequence

1. Add Neural Semantic Graph tests and compiler.
2. Add `visio-scene-ir/v1` schema and validation.
3. Compile tensor-flow and multi-scale-flow to Scene IR.
4. Implement native Visio primitives and remove publication-block dispatch.
5. Add token-flow, state-flow, dual-stream and graph-flow.
6. Move Agent Run and Visio Diagram Plan to Scene IR.
7. Delete retired renderer code and compatibility tests after all callers move.
8. Update architecture documentation and examples.

Deletion occurs only after import/reference scans prove a path unreachable.

## Acceptance Matrix

Structural fixtures must cover:

- residual CNN and repeated residual stages;
- U-Net encoder-decoder with symmetric skips;
- FPN/PAN detector with three or more scales and output heads;
- Transformer with attention and residual normalization paths;
- recurrent cell with sequence and state ports;
- GAN or Siamese dual stream;
- irregular graph/message-passing network;
- an opaque unknown compound that remains fail-closed.

For every fixture the gate requires:

- deterministic Scene IR snapshot and geometric validation;
- no model-name branch in compiler or bridge;
- no unrelated node/label/connector overlap;
- native connector glue and source identity readback;
- save-close-reopen success for the VSDX;
- PNG export at publication size;
- automated pixel occupancy and whitespace checks;
- explicit human visual review against the reference grammar before acceptance.

Unit-test success without real Visio and PNG review is insufficient.

## Non-Goals

- Exact reproduction of one paper or one architecture template.
- Browser, SVG, canvas, TikZ or draw.io rendering.
- Executing arbitrary user model code to discover hidden topology.
- Inventing internal blocks from a familiar architecture name.
