# M2.2 Composable DAG Figure Compiler Implementation Plan

**Node:** `M2.2`
**Status:** implementation in progress

## Goal

Compile a validated v3 semantic DAG into a deterministic, presentation-ready layout plan while keeping topology, typed ports, repetition, module ownership, and evidence traceability intact. The compiler is the seam between the M2.1 Figure Component contract and later publication preview work.

## Interface

`compileComposableDagFigure({ architectureIr, intent, layoutSeed })` accepts only v3 IR, a validated `FigureIntent`, and a bounded deterministic seed. It returns either a ready plan containing semantic component bounds and connection routes or an explicit unresolved result. The implementation derives a stable topological order, rejects cycles and unreachable components, places components by rank, and routes connections from component bounds.

## Determinism rules

- Component and connection IDs are the only tie-breakers; no wall clock, random source, object enumeration order, or model-name template is consulted.
- Density and orientation are controlled by the validated `FigureIntent`; the seed is recorded in the plan for later manifest binding.
- Horizontal plans route right-to-left between ranks; portrait plans route bottom-to-top between ranks, with deterministic elbows for reverse edges.
- Layout output contains stable bounds/routes and semantic source mappings, but no SVG/PNG, file path, Canvas geometry, Provider text, shell/COM command, or Visio protocol field.

## Explicit limits

- M2.1 contract failures, blocking unresolved questions, unsupported node kinds, and unsupported edge transports remain unresolved.
- Cycles and components unreachable from an input are unresolved; the compiler never invents a feedback or disconnected layout.
- This module does not create a browser preview, `PlanSnapshot`, export token, or Visio job. Those are later M2/M3 seams.

## Acceptance

- CNN, residual, encoder-decoder, and token-transformer gold IRs compile through one semantic implementation.
- Repeated compilation of the same IR, intent, and seed is byte-equivalent.
- Repeat semantics, module ownership, typed port IDs, evidence IDs, and connection routes survive compilation.
- Blocking unresolved input and cyclic topology return explicit unresolved results.
- Focused tests, full API tests, strict TypeScript, roadmap verification, and diff checks pass.
