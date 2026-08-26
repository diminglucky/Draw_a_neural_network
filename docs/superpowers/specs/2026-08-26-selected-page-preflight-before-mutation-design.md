# Selected-Page Preflight-Before-Mutation Design

**Status:** approved continuation of the 2026-08-25 selected-page publication-presentation design

## Goal

Prevent a page-fit, content-bounds, or minimum-readability failure from deleting the last verified Agent-owned region on the user's currently selected Visio page.

## Root cause

`SelectedPageVisioComNative.ApplyOwnedRegion` currently deletes shapes in the requested ownership namespace before `VisioComEngine.DrawSelectedPageRegion` reads the real page dimensions and calls `FitSelectedPageDocument`. A deterministic precondition failure can therefore destroy the previous owned region even though no replacement can be drawn.

## Decision

Use a two-phase native boundary:

1. `PrepareOwnedRegion` revalidates the selected target, reads the actual page dimensions, validates the figure plan and content bounds, applies the bounded affine fit, and returns a `PreparedSelectedPageRegion` bound to the exact `SelectedPageTarget`.
2. Only after preparation succeeds may `ApplyOwnedRegion` delete shapes in the exact ownership namespace, render the prepared plan without recomputing fit, and attach ownership/source-mapping data to new shapes.
3. The public selected-page session command remains one `applyOwnedRegion` operation. Preparation is an internal Worker/COM safety phase; no browser, API, Provider, or model receives page dimensions or native controls.
4. The apply phase rejects a prepared region whose target does not equal the currently requested target.

## Preserved boundaries

- The Worker does not create or open a document or page, resize the selected page, call `SaveAs`, infer topology, or reflow an approved PVP.
- PVP remains the approved geometry source. Preparation performs only the already-authorized deterministic affine fit.
- User-created shapes and shapes belonging to another ownership namespace remain untouched.
- Existing selected-page target/fingerprint validation still runs before preparation and again before mutation.
- The protocol schema and TypeScript API remain unchanged.

## Failure behavior

- Invalid/missing figure plan, unavailable page dimensions, invalid content bounds, or unreadable fit: preparation throws and mutation is never entered.
- Selected target changes between preparation and apply: apply rejects before deletion.
- Drawing or ownership tagging fails after deletion: this slice does not provide transaction rollback. A later staged-namespace replacement slice must draw, verify, swap, and clean up without sacrificing the last verified region.

## Acceptance

- A fake native operation records `prepare` before `apply`.
- A preparation exception results in zero apply calls.
- The native preparation helper returns the same deterministic fitted plan covered by existing selected-page fitting tests.
- The prepared draw helper rejects an unfitted or invalid figure plan before invoking the renderer.
- Focused backend/rendering tests, the complete Worker test suite, Release build, TypeScript checks, and `git diff --check` are reported separately.

## Non-goals

This slice does not implement page-layout observation in the API, page-layout hashes, user-shape obstacle avoidance, portrait/landscape reflow, staged replacement rollback, real-host Visio acceptance, save/reopen evidence, or publication-quality visual approval.
