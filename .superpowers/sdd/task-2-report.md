# Task 2 Report: Renderer-neutral Figure Plan

## Status

Implemented and committed. The Figure Plan is a pure contract/adapter over the existing Universal Figure layout. Browser and Visio projections preserve source identities and routes; Visio retains native Shape/Connector planning.

## Changed files

- `figure-plan.mjs` — added `createFigurePlan`, `validateFigurePlan`, `figurePlanForBrowser`, and `figurePlanForVisio`.
- `figure-plan.test.mjs` — added TDD coverage for recurrent/state/loop topology, unresolved nodes, validation, and browser/Visio identity parity.
- `universal-figure.mjs` — propagated source identities and preserved/routed recurrent self-loop edges.
- `visio-bridge.mjs` — consumed stable Figure Plan source identities, nested geometry, shape kinds, and source-to-layout shape mappings while preserving native output fields.
- `visio-bridge.test.mjs` — added Figure Plan identity consumption regression coverage.
- `.superpowers/sdd/task-2-report.md` — this report.

`universal-figure.test.mjs` was not modified because its existing coverage passed without changes.

## TDD evidence

1. Added the failing contract tests before implementation.
2. Ran `node --test figure-plan.test.mjs visio-bridge.test.mjs`.
3. Observed the expected RED failure: `ERR_MODULE_NOT_FOUND` for `figure-plan.mjs`.
4. Implemented the adapter and identity propagation.
5. The first GREEN attempt exposed an actual dropped self-loop in `condenseLinearConvRuns`; the layout was corrected narrowly and the loop regression was retained.

## Commands and output

- `node --test figure-plan.test.mjs universal-figure.test.mjs visio-bridge.test.mjs` — PASS, 45 tests, 45 passed, 0 failed.
- `node --test (rg --files -g '*.test.mjs' | ForEach-Object { $_ })` — PASS, 118 tests, 118 passed, 0 failed.
- `node --check figure-plan.mjs` — PASS.
- `node --check universal-figure.mjs` — PASS.
- `node --check visio-bridge.mjs` — PASS.
- PowerShell parser check for `visio-bridge.ps1` — PASS, no parse errors.
- `git diff --check` — PASS.
- Scope search for `models.js`, `agent-pipeline`, and `server.js` in the changed Task 2 files — no matches.

## Concerns and boundaries

- Live Visio COM rendering, current-document PNG export, and independent VSDX readback were not run in this contract/adapter task. Existing native bridge behavior remains covered by the repository tests, but live host acceptance is a separate gate.
- Existing unrelated untracked content was preserved and not staged: `.superpowers/sdd/review-task1.diff`, `.superpowers/sdd/task-1-brief.md`, `artifacts/`, `docs/research/`, and `tmp/`.
- The implementation commit contains five code/test files because `universal-figure.test.mjs` required no change; this report is committed separately.

## Commits

- Implementation: `90ac6b40e6f44fc921ac419b865c78c7c38c6d41` (`feat: add renderer-neutral figure plan`)
