# M2.3 Publication Visual QA Implementation Plan

**Node:** `M2.3`
**Status:** implementation in progress

## Goal

Add a server-side visual quality seam for the deterministic M2.2 plan. The seam applies versioned publication style tokens and evaluates the plan before any future Preview or PlanSnapshot consumer can use it.

## Interface

`applyPublicationVisualTokens(plan)` returns an immutable-by-convention visual plan containing the M2.2 semantic plan, a versioned token manifest, and stable component/connection token bindings. `runPublicationVisualQa(visualPlan)` returns a structured pass/fail result with blocking checks and never mutates its input.

## Checks

- page crop and route bounds;
- component collision and minimum scale for density;
- orientation-aware connection endpoints and route clearance;
- one evidence-backed source mapping per component;
- style-token coverage and minimum contrast ratio;
- distinct grayscale relation styles when data and condition transports coexist.

## Explicit limits

- This module does not render SVG/PNG, serve a browser route, create a PlanSnapshot, or invoke a Worker.
- It does not inspect v2 Canvas geometry or infer topology from model names, Provider text, files, or images.
- Passing QA is evidence for M2.3 only; Preview and Snapshot remain separate M2.4/M2.5 gates.

## Acceptance

- A valid CNN publication plan receives deterministic tokens and passes all checks.
- Overflow, collision, detached/crossing routes, missing mappings, undersized components, missing style bindings, and grayscale collisions fail closed.
- Focused tests, full API tests, strict TypeScript, `api:check`, roadmap verification, and diff checks pass.
