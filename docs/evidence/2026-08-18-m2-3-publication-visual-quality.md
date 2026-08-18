# M2.3 Publication Visual Quality Evidence

Date: 2026-08-18
Branch: `agent`
Implementation commit: `7262ce859ca439ce8f58fda00fbffa0c343bc68e`

## Accepted implementation boundary

M2.3 adds a v3 `ComposableDagPublicationPlan` wrapper and a pure,
server-side `runComposableDagVisualQa` boundary. The wrapper carries the
deterministic M2.2 composable DAG plan, bounded visual styles and labels, and
the copied evidence index. Visual QA fails closed for unsupported versions,
invalid geometry, page overflow and margins, collisions, invalid routes and
ports, missing evidence, invalid source mappings, unsupported style tokens,
invalid colors, insufficient contrast, grayscale collisions, invalid line
thickness, and invalid label identity or text.

The validator is non-mutating and deterministic. It returns only the
snapshot-compatible `VisualQaResult` shape and does not return source excerpts,
raw evidence payloads, provider content, paths, commands, or renderer output.
The legacy v2 `visual-qa.ts` contract is unchanged.

## Focused verification

Command:

```text
npx.cmd vitest run apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/composable-dag-visual-qa.test.ts apps/api/tests/composable-dag-figure-compiler.test.ts apps/api/tests/figure-components.test.ts apps/api/tests/visual-qa.test.ts
```

Result: 5 test files passed, 61 tests passed.

The focused suite covers CNN, residual, encoder-decoder, and token-transformer
gold plans; deterministic publication wrapping; unresolved compiler results;
non-mutating QA; component and label geometry; route endpoints and page bounds;
component/port references; evidence and source mappings; style completeness;
hex colors; contrast; grayscale patterns and collisions; line thickness;
label identity/text; page thresholds; and the unchanged v2 QA suite.

## Repository verification

| Gate | Result |
| --- | --- |
| `npm.cmd run api:test` | 90 test files passed, 551 tests passed |
| `npx.cmd tsc --noEmit` | passed, exit code 0 |
| `npm.cmd run api:check` | passed: Foundation boundary OK |
| `npm.cmd run agent:verify-roadmap` | passed after the controlled M2.3 state transition and roadmap regeneration |
| `git diff --check` | passed, exit code 0 |
| `npm.cmd run agent:status -- --strict` | non-zero only for local branch divergence from upstream and the intentionally dirty worktree; roadmap parity was `ok` |

The strict roadmap command reported `HEAD 7262ce8`, `Status: planned`, and
`Roadmap parity: ok` before the controlled M2.3 state transition. Its branch
divergence warning is expected for this isolated implementation branch and is
not a test, typecheck, foundation, or roadmap-content failure.

## Scope not accepted by M2.3

The following remain explicitly outside this evidence and are not claimed:

- browser screenshot comparison or pixel-level visual QA;
- manual visual review;
- Preview Route integration;
- PlanSnapshot persistence or export-job creation;
- Provider/model calls, ONNX, Keras, or GNN behavior;
- live PostgreSQL or Redis acceptance;
- Electron or live Worker execution;
- Visio COM automation;
- VSDX save, close, reopen, editability, or independent native readback;
- real Windows host acceptance.

Those gates belong to later milestones and must be evidenced independently.
