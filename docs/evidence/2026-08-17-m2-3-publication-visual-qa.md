# M2.3 Publication Visual QA Evidence

**Node:** `M2.3`
**Date:** 2026-08-17

## Scope

The v3 M2.2 plan now has a separate publication visual seam. Versioned style tokens are attached without changing semantic topology, and server-side QA rejects unsafe plans before any future preview or snapshot consumer.

## Focused evidence

- `apps/api/tests/publication-visual-qa.test.ts`: 7 tests passed.
- A valid deterministic plan passes token, bounds, routing, scale, contrast, grayscale, and source-mapping checks.
- Overflow, component collision, detached/crossing routes, missing source mappings, undersized components, missing style bindings, and mixed-transport grayscale collisions fail closed.

## Quality gates

- `npm run api:test`: 89 test files, 518 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run api:check`: passed.
- `npm run agent:verify-roadmap`: passed.
- `git diff --check`: passed.

## Boundary statement

This evidence accepts M2.3 only. It does not claim a browser preview route, immutable PlanSnapshot, export authorization, Vision migration, or Visio Worker acceptance. The v2 Vision/Canvas path remains compatibility-only.
