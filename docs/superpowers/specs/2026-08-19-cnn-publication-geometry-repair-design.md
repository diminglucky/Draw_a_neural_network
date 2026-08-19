# CNN Publication Geometry Repair Design

## Decision

Repair the existing VGG16 Figure Plan and native Visio renderer before adding code or sketch inputs. VGG16 is the acceptance fixture for a reusable CNN tensor-plate grammar, not a model-specific drawing template.

## Observed defects

- Feature-map fronts are native rectangles, so their added top and side faces do not form a consistent tensor projection.
- Pooling groups are positioned as independent linear-layout items instead of being geometric contractions between adjacent feature-map stages.
- The Worker decodes UTF-8 JSON through the Windows console code page, corrupting `×` and `·` in native Visio labels.
- Local labels have no collision or connector-clearance validation and do not narrate VGG stages.

## Scope

- Keep the existing Agent authorization, immutable execution snapshot, v2 Worker session protocol, output ownership, save/reopen, and readback boundaries unchanged.
- Keep native editable Visio Shapes. No screenshots, SVGs, VBA, or model-authored geometry are permitted.
- Touch only the CNN Figure Plan, its focused tests, the native Visio geometry renderer/tests, and the Worker UTF-8 entry point/test seam required by this repair.

## Target visual contract

### Tensor slabs

Every CNN feature-map plane is a native closed polygon set with a single oblique projection vector. A plane has a front, top, and side face whose endpoints are shared exactly. A CNN feature-map plane must never silently fall back to `DrawRectangle`. Stacked planes use the same projection and bounded, repeat-count-derived offsets.

### Stage-to-stage contraction

Each pool is a transition owned by its neighboring tensor stages. Its left boundary matches the source stage's right visual anchor; its right boundary matches the target stage's left visual anchor. The resulting native frustum encodes the spatial reduction, rather than appearing as an isolated pale plate.

### CNN narrative

The composition has an input area, five `Block N` feature-extraction stages, and a classifier area. The block title identifies its VGG stage; its one detail label encodes convolution repetition and tensor size. Pool labels occupy a dedicated annotation track. Flatten is a continuous ribbon from Block 5 to the classifier, which contains FC6, FC7, and FC8.

### Typography and encoding

The Worker process boundary is explicitly UTF-8 for input, output, and error streams. Unicode labels such as `3×3 · 64 ×2` must round-trip from the Figure Plan to native Visio text exactly. The label font must be Unicode-capable on the Windows host.

## Deterministic layout contract

- The Figure Plan uses a 1800 by 720 figure-unit landscape artboard with explicit input, feature-extraction, and classifier regions.
- Stage geometry is placed from semantic anchors, not a generic `cursorX + gap` loop.
- Feature-map size is strictly decreasing after each VGG pool. Adjacent equal-resolution convolution layers are represented as planes of the same stage, never as visually unrelated boxes.
- Labels must be inside dedicated annotation tracks. Label-to-label overlap and label-to-connector intersection are invalid.
- CNN geometry, label placement, and visual role must be checked by the Figure Plan validator before export.

## Acceptance

1. Figure Plan unit tests prove stage anchors, contraction ownership, no primitive fallback kind, semantic stage labels, and non-overlapping annotation tracks.
2. Worker unit tests prove native tensor planes use closed polygon geometry and the host accepts/emits UTF-8 labels without corruption.
3. Existing API and Worker suites remain green.
4. A fresh hidden VSDX is saved, independently reopened, and checked for expected native primitives and exact Unicode labels.
5. A fresh visible VSDX remains open for user inspection. Its screenshot is reviewed for coherent projection, visible spatial contraction, readable labels, and a unified classifier panel.

## Explicit non-goals

- No code-upload, sketch-upload, image understanding, or generic architecture-family expansion in this repair.
- No arbitrary user-selected coordinates or untrusted renderer commands.
- No claim that a source-level test suite establishes visual acceptance without a new real-Visio screenshot review.
