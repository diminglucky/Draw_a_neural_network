# M2.1 Figure Component Contract Implementation Plan

**Node:** `M2.1`
**Status:** implementation in progress

## Goal

Define the v3 semantic seam between validated `ArchitectureIRv3` and the future composable figure compiler. The contract must preserve semantic ports, module ownership, repetition, evidence IDs, and explicit unresolved state while excluding layout coordinates, colors, filesystem paths, renderer commands, and model-name branching.

## Interface

`createFigureComponentGraph(architectureIR)` accepts only validated v3 IR and returns either a ready semantic component graph or an unresolved result. The result is deterministic for the same IR and contains no presentation geometry. M2.2 will consume this graph to perform layout and FigureSet compilation.

## Acceptance

- CNN, residual, encoder-decoder, and token-transformer gold IR fixtures map through the same contract.
- Module ownership, semantic ports, repeat policy, and evidence IDs survive the mapping.
- Blocking unresolved questions remain unresolved and cannot produce a ready graph.
- Process nodes and feedback edges return explicit unsupported results.
- Focused tests, full API tests, strict TypeScript, roadmap verification, and diff checks pass.

## Deliberate non-goals

- No layout algorithm, coordinates, style tokens, SVG/PNG artifact, browser route, or PlanSnapshot.
- No model-name conditionals and no reuse of legacy v2 canvas geometry.
- No claim that the Vision image path has migrated to v3.
