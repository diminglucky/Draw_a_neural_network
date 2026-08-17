# M2.2 Composable DAG Figure Compiler Evidence

**Node:** `M2.2`
**Date:** 2026-08-17

## Scope

The v3 `ArchitectureIRv3` to semantic Figure Component graph seam is now compiled by one deterministic `ComposableDagFigureCompiler` implementation. The compiler performs stable topological ordering, rank-based layout, endpoint routing, and explicit rejection of cycles, unreachable components, invalid connections, blocking unresolved questions, and unsupported component-contract inputs.

The plan retains typed ports, repeat semantics, module ownership, evidence IDs, and stable source mappings. It contains no legacy Canvas geometry, model-name branch, Provider content, file path, SVG/PNG artifact, shell/COM command, or Visio Worker field. Preview routes, PlanSnapshot creation, visual QA, and export remain later milestones.

## Focused evidence

- `apps/api/tests/composable-dag-figure-compiler.test.ts`: 11 tests passed.
- CNN, residual, encoder-decoder, and token-transformer gold IRs compile through the same implementation.
- Same IR, FigureIntent, and seed produce byte-equivalent plans.
- Blocking unresolved IR and cyclic topology return explicit unresolved results.
- Portrait routes use bottom/top endpoints, and unreachable components return an explicit unresolved result.

## Quality gates

- `npm run api:test`: 88 test files, 511 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run api:check`: passed.
- `npm run agent:verify-roadmap`: passed.
- `git diff --check`: passed.

## Boundary statement

This evidence accepts M2.2 only. It does not claim publication visual QA, browser preview, immutable PlanSnapshot, Vision image understanding, or Visio export migration. The v2 Vision/Canvas path remains compatibility-only until a later migration gate.
