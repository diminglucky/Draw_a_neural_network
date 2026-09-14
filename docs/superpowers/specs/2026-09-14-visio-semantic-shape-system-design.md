# Visio Semantic Shape System Design

## Goal

Replace the current box-heavy renderer with a model-agnostic neural-network
visual vocabulary. The change is limited to native Visio shapes and their plan
contract. It does not add model-name branches and does not execute a new Visio
render during implementation.

## Problems Being Removed

- `Draw-InputTensor` always draws three channel planes regardless of modality.
- `Draw-FeatureMapStack` makes PublicationTensor-style 3D boxes the default.
- named and compound modules differ mainly by text and fill color.
- internal graphs shrink arbitrary nodes into unreadable rectangles.
- the legend repeats every named module and adds visual noise.

## Visual Vocabulary

### Inputs

- Image: one flat image plane with a subtle pixel/grid cue.
- Tensor: one dimensioned plane; depth is shown only when rank and channel
  evidence justify it.
- Sequence: token marks on a horizontal rail.
- State: a compact state capsule with a state port.
- Graph: node-link glyph.
- Unknown: a neutral dashed input boundary.

No input renderer may assume three channels without explicit evidence.

### Data And Operators

- Feature maps are clean 2D planes with a small scale/channel caption.
- Atomic operators are compact flat symbols placed on the data-flow line.
- Upsample and downsample are directional transition markers, not large nodes.
- Add uses a circled plus; concat uses a narrow merge bar.
- Outputs use a terminal shape appropriate to tensor/vector/prediction evidence.

### Modules

- A named opaque module is one restrained rounded block with a semantic accent.
- A repeated stage is one module plus an external `xN` repeat marker.
- A compound with internal evidence uses a frame with ports and an internal
  mini-layout; child labels must meet a minimum readable size.
- Residual, multi-branch, attention, and recurrent modules are compositions of
  the same ports, operators, merge symbols, and route classes.
- A module without internal evidence remains opaque and is never fabricated.

## Plan Contract

`Visio Diagram Plan` supplies `visualRole`, `styleProfile`, `labelSlots`,
`geometryData`, ports, repetition, and optional internal topology. PowerShell
dispatches only on these semantic fields. Display labels and model names never
select geometry.

New optional shape data:

- `tensorRank`, `channelCount`, and `spatialSize` for dimensional glyphs.
- `modulePattern` for evidence-derived compositions such as `residual`,
  `parallel`, `attention`, or `recurrent`.
- `repeatCount` for one external repeat badge.
- `internalDetail` with values `opaque`, `summary`, or `expanded`.

## Styling

- Flat, low-saturation fills and dark neutral outlines.
- Color identifies semantic role, not individual layer identity.
- No bevel, pseudo-3D face, or repeated channel plane is a default.
- Module labels stay inside modules; tensor dimensions stay outside data glyphs.
- Legends contain semantic categories only and are omitted when redundant.

## Implementation Boundary

1. Add semantic shape-plan helpers and contract tests in JavaScript.
2. Replace the default input, feature-map, named-module, and repeat renderers in
   `visio-bridge.ps1`.
3. Keep the old PublicationTensor renderer only as an explicit legacy role; no
   production semantic role selects it by default.
4. Add static PowerShell tests proving dispatch is semantic and contains no
   architecture-name matching.
5. Run JavaScript tests, PowerShell parser validation, and `git diff --check`.
6. Do not generate or claim a visually accepted `.vsdx` in this implementation
   phase. Visual acceptance is a separate review after the primitives pass.

## Acceptance Criteria

- Image/tensor input does not always produce three rectangles.
- A normal feature stage does not invoke PublicationTensor geometry.
- Named modules have one clean primary shape and no per-module legend entry.
- Repeat count is represented once as `xN`.
- Expanded internals require explicit topology evidence and remain readable.
- No renderer checks YOLO, C2f, SPPF, ResNet, Transformer, GAN, or other model
  names to select a shape.
- Existing source identity, ports, Shape Data, and connector glue are retained.
