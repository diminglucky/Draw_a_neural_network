# M2.5 Recursive Safe-Boundary Fix Report

## Status and scope

- Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`
- Branch: `agent`
- Starting HEAD: `7fdb09157d146a340002ecfc86eb9c650580cf17`
- Scope: `apps/api` AnalysisPlanSnapshot and v3 publication-preview safe boundaries, focused tests, and this report.
- Worker files were not edited, staged, or included. A separate task began modifying two Worker files while this work was in progress; those changes remain outside this task.
- Preserved user-owned untracked plans:
  - `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md`
  - `docs/superpowers/plans/2026-08-17-agent-roadmap-continuity-r0.md`
- The user initially prohibited push, then explicitly authorized push after a clean verification. The final remote SHA is verified in the handoff after the commit is created.

## Root-cause confirmation

The failed review was reproduced at two API boundaries:

1. `analysis-plan-snapshot.ts` treated string vocabulary as a provenance signal. Its stable-identifier grammar admitted drive-relative `C:` seeds, and the display-text denylist missed valid-looking shell, COM, evidence, source, and endpoint phrases. The direct snapshot factory therefore accepted non-canonical retained values even though the service separately compared submitted output with a deterministic compiler result.
2. `projectPublicComposableDagPublicationPlan` reconstructed only the top-level component and connection objects. It used `structuredClone` for nested bounds, ports, shape data, repeat data, endpoints, route points, intent, and visual specification objects, so unknown runtime properties attached below the first level crossed the public boundary.

The implementation hypothesis was that provenance must come from compiler-owned structure and deterministic service comparison, while the direct factory must enforce a positive, strict recursive schema. Public preview projection must reconstruct each allowed nested field explicitly.

## TDD evidence

### Clean baseline

Before test or production edits, the existing M2.5 suite passed:

```text
npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/analysis-plan-snapshot-store.test.ts apps/api/tests/analysis-plan-snapshot-service.test.ts apps/api/tests/figure-analysis-preview-service.test.ts apps/api/tests/figure-analysis-preview-routes.test.ts apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/plan-snapshot.test.ts apps/api/tests/plan-snapshot-store.test.ts
```

Result: exit `0`; 9 files passed, 53 tests passed.

### Primary RED before production edits

Only these test files were modified before the RED run:

- `apps/api/tests/analysis-plan-snapshot.test.ts`
- `apps/api/tests/figure-analysis-preview-service.test.ts`

Command:

```text
npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/figure-analysis-preview-service.test.ts
```

Refined RED result: exit `1`; 2 files failed; 7 required tests failed and 17 existing tests passed.

Observed failures:

| Required behavior | Actual RED evidence |
| --- | --- |
| Reject `C:private:layout-seed` | `expected [Function] to throw an error` |
| Reject `whoami` as a retained layout seed | `expected [Function] to throw an error` |
| Reject `evidence:private:1` in a retained semantic role | `expected [Function] to throw an error` |
| Reject `return model output` in retained label text | `expected [Function] to throw an error` |
| Reject `Visio.Documents.Add` in retained QA | `expected [Function] to throw an error` |
| Reject `secret endpoint response` in retained QA | `expected [Function] to throw an error` |
| Strip nested bounds/port/endpoint/route injections | projected bounds still contained `workerPath: C:\private\worker.exe` |

The valid deterministic compiler-plan assertion passed during RED, proving the failures were specific to the missing restrictions rather than a broken fixture.

### Review-fix RED

The independent review identified two Important edge cases. Tests were added before their production fixes:

```text
npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/figure-analysis-preview-service.test.ts
```

Result: exit `1`; 2 required tests failed and 23 tests passed.

- `m2-999-analysis-1` was accepted instead of being rejected outside the current `m2-4` namespace.
- A missing required component style produced raw `Cannot read properties of undefined (reading 'fill')` instead of the typed safe-preview error.

Each review fix was then applied and its covering test was run independently: snapshot 17/17 and preview service 8/8.

## Minimal GREEN implementation

### AnalysisPlanSnapshot direct boundary

- Removed vocabulary-based `safeDisplayText` filtering entirely.
- Added positive compiler semantic-token validation for retained semantic roles and labels.
- Restricted the layout seed to the currently supported deterministic namespaces: `m2-4-*` and `seed-*`; colon, path separators, whitespace, unprefixed command text, and other `m2-*` namespaces are rejected.
- Restricted compiler, layout, and QA versions to the current known compiler literals.
- Replaced arbitrary visual-QA text acceptance with the exact deterministic passing compiler checklist: exact status, count, order, IDs, severity, pass state, and messages.
- Kept all nested public-plan schemas strict and returned the schema-parsed graph instead of applying another `structuredClone` to boundary input.
- The service's existing deterministic comparison remains authoritative: submitted public plan and visual QA must match the compiler output for the validated IR, intent, manifest seed, and compiler versions.

### Recursive public preview projection

`projectPublicComposableDagPublicationPlan` now reconstructs all retained nested values field by field:

- FigureIntent and emphasis values;
- page and component bounds;
- input/output ports;
- tensor axes, recursive shape expressions, and batch semantics;
- repeat count, unit IDs, and expansion policy;
- source/target endpoint references;
- every route point;
- visual page settings;
- fixed component and connection style branches;
- labels and label bounds.

Unknown runtime properties are never copied. Missing required style branches now fail with `FIGURE_ANALYSIS_PREVIEW_INVALID` rather than a raw null/undefined property error.

## Independent review

A separate read-only Codex `gpt-5.3-codex` review received only the exact API/test diff and was explicitly barred from repository, Worker, and user-plan inspection.

Initial verdict:

- Critical: none.
- Important: narrow `m2-*` to current `m2-4`; replace style non-null assertions with controlled safe-preview rejection.
- Minor: broaden recursive mutation coverage beyond the brief's exact four surfaces; rename one stale QA test description.

The two Important findings were fixed under RED/GREEN. The stale test description was corrected. The exact four required nested injections remain covered, while the implementation reconstructs the additional shape/repeat/intent/visualSpec surfaces explicitly.

Final re-review verdict:

- Spec: pass.
- Quality: pass.
- Critical: none.
- Important: none.
- Minor note: the seed policy intentionally uses positive namespace/format validation and does not reintroduce a command-word blacklist for strings such as `seed-powershell`.

## Final verification

| Gate | Command | Result |
| --- | --- | --- |
| Focused M2.5 | `npx.cmd vitest run` with the 9 snapshot/preview/route/publication files | exit `0`; 9 files, 62 tests passed |
| Strict TypeScript | `npx.cmd tsc --noEmit` | exit `0`; no diagnostics |
| Foundation boundary | `npm.cmd run api:check` | exit `0`; `Foundation boundary OK` |
| Full API suite | `npm.cmd run api:test` | exit `0`; 95 files, 593 tests passed |
| Exact diff check | `git diff --check -- <five API files>` | exit `0`; no whitespace errors; LF/CRLF normalization warnings only |

## Exact commit allowlist

Production:

- `apps/api/src/analysis-plan-snapshot.ts`
- `apps/api/src/figure-analysis-preview-service.ts`

Tests:

- `apps/api/tests/analysis-plan-snapshot.test.ts`
- `apps/api/tests/analysis-plan-snapshot-store.test.ts`
- `apps/api/tests/figure-analysis-preview-service.test.ts`

Required report:

- `.superpowers/sdd/analysis-plan-snapshot-m2-5-recursive-boundary-fix-report.md`

No Worker file, user-owned plan, legacy PlanSnapshot file, route contract, generated review artifact, or unrelated worktree change belongs to this commit.

## Remaining boundaries

- This is API schema/projection, deterministic compiler binding, and automated verification evidence only.
- It does not execute a Worker, call Visio COM, create/read back VSDX/PDF/PNG, run a live Provider, or validate PostgreSQL/Redis deployment behavior.
- Future compiler/QA versions or seed namespaces require an explicit schema update and matching regression evidence; they do not pass through automatically.
