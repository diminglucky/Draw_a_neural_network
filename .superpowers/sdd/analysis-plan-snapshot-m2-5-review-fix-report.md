# M2.5 Review Fix Report — AnalysisPlanSnapshot and v3 Preview Boundaries

## Scope and isolation

- Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`
- Branch at start: `agent` (`afb7232`)
- Worker files: not read for implementation, not edited, and will not be staged. Their pre-existing modifications remain owned by the separate active agent.
- Preserved user-owned untracked roadmap plans: `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md` and `docs/superpowers/plans/2026-08-17-agent-roadmap-continuity-r0.md`.
- Legacy `PlanSnapshot` files, HTTP routes, and public response contracts are out of scope.

## Root-cause audit

The review issues reproduce at four API seams:

1. `AnalysisPlanSnapshotService.create` checked only `analysis.status`, so a ready record with a blocking top-level `unresolved` entry or non-null `blockingQuestion` compiled and inserted.
2. `analysis-plan-snapshot.ts` used arbitrary bounded strings for `layoutSeed` and retained visual-QA text, which allowed path- and shell-like values.
3. `projectPublicComposableDagPublicationPlan` removed only `evidenceIds` with object rest syntax; injected runtime fields crossed into the v3 DTO.
4. The service wrapped every non-domain exception as `ANALYSIS_PLAN_SNAPSHOT_INVALID`/400, including duplicate insert conflicts and unexpected storage failures.

## RED — regression tests written before production changes

Command run before any production edit:

```text
npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/analysis-plan-snapshot-service.test.ts apps/api/tests/figure-analysis-preview-service.test.ts
```

Actual result: exit code `1`; 3 files failed, 7 tests failed, 19 tests passed.

| Behavior | RED assertion observed |
| --- | --- |
| Ready record plus blocking top-level unresolved | `promise resolved ... instead of rejecting` in `never inserts a ready record with a blocking top-level unresolved item`. |
| Ready record plus non-null blocking question | `promise resolved ... instead of rejecting` in `never inserts a ready record with a non-null blocking question`. |
| Path/shell layout seed | `expected [Function] to throw an error` for `C:\\private\\layout-seed`; construction returned `undefined`. |
| Unsafe visual-QA retained text | `expected [Function] to throw an error` for `powershell -Command Invoke-WebRequest ...`; construction returned `undefined`. |
| Injected component/connection runtime fields | `expected ... not to have property "workerPath"`; received `"C:\\private\\worker.exe"`. |
| Duplicate insert | expected `ANALYSIS_PLAN_SNAPSHOT_CONFLICT` / 409; received `ANALYSIS_PLAN_SNAPSHOT_INVALID` / 400. |
| Unexpected store failure | expected `ANALYSIS_PLAN_SNAPSHOT_STORE_FAILURE` / 500; received `ANALYSIS_PLAN_SNAPSHOT_INVALID` / 400. |

No production files were changed before the above RED run.

## Minimal GREEN changes

1. `AnalysisPlanSnapshotService.create` now rejects a `ready_for_preview` record with either a non-null `blockingQuestion` or any top-level `unresolved` item of severity `blocking`, before IR compilation and store insertion.
2. `AnalysisPlanSnapshotStoreConflictError` marks only the known immutable duplicate condition. The service maps it to `ANALYSIS_PLAN_SNAPSHOT_CONFLICT` (409); any other insert exception maps to `ANALYSIS_PLAN_SNAPSHOT_STORE_FAILURE` (500) with the generic message `AnalysisPlanSnapshot could not be persisted`.
3. Snapshot retention now has an explicit value-level policy:
   - compiler, layout, QA versions and `layoutSeed` use the stable identifier grammar;
   - retained color values are exact six-digit hexadecimal tokens;
   - component captions and labels, plus Visual-QA diagnostics, are bounded single-line display text and reject path separators, command vocabulary, source-code prefixes, and provider/credential vocabulary.
   This preserves the deterministic diagnostics emitted by `runComposableDagVisualQa` while rejecting shell/path-like retained text.
4. `projectPublicComposableDagPublicationPlan` now reconstructs components and connections field-by-field. It retains only the documented DTO fields, including the established connection endpoint `source`/`target` port references and `repeat`, and omits injected runtime fields.

Focused GREEN command:

```text
npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/analysis-plan-snapshot-store.test.ts apps/api/tests/analysis-plan-snapshot-service.test.ts apps/api/tests/figure-analysis-preview-service.test.ts apps/api/tests/composable-dag-publication-plan.test.ts
```

Result: exit code `0`; 5 files passed, 35 tests passed.

## Verification

| Command | Result |
| --- | --- |
| `npx.cmd vitest run apps/api/tests/analysis-plan-snapshot.test.ts apps/api/tests/analysis-plan-snapshot-store.test.ts apps/api/tests/analysis-plan-snapshot-service.test.ts apps/api/tests/figure-analysis-preview-service.test.ts apps/api/tests/figure-analysis-preview-routes.test.ts apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/composable-dag-publication-plan.test.ts apps/api/tests/plan-snapshot.test.ts apps/api/tests/plan-snapshot-store.test.ts` | exit `0`; 9 files passed, 53 tests passed. |
| `npx.cmd tsc --noEmit` | exit `0`. |
| `npm.cmd run api:check` | exit `0`: `Foundation boundary OK: durable schema, PostgreSQL/Redis services, and explicit store factory are present.` |
| `git diff --check` | exit `0`; no whitespace errors. Git emitted only LF/CRLF normalization warnings. |

The first TypeScript run identified a required `repeat` DTO field omitted by the explicit projection and an incomplete code-locator test fixture. Both were corrected before the final TypeScript and verification runs above.

## Changed-file allowlist

Implementation and tests:

- `apps/api/src/analysis-plan-snapshot.ts`
- `apps/api/src/analysis-plan-snapshot-store.ts`
- `apps/api/src/analysis-plan-snapshot-service.ts`
- `apps/api/src/figure-analysis-preview-service.ts`
- `apps/api/tests/analysis-plan-snapshot.test.ts`
- `apps/api/tests/analysis-plan-snapshot-service.test.ts`
- `apps/api/tests/figure-analysis-preview-service.test.ts`

Required report:

- `.superpowers/sdd/analysis-plan-snapshot-m2-5-review-fix-report.md`

No Worker file, legacy `PlanSnapshot` file, route, public HTTP response contract, or user-owned roadmap plan is included.

## Commit

Implementation commit SHA: `aa03496` (`fix: harden analysis plan snapshot boundary`).

## Remaining limitations

- The safety policy is intentionally a fail-closed snapshot/preview retention boundary. It does not render SVG/PNG previews or assess pixels.
- This change does not perform a provider call, access source retention storage, issue a Worker request, execute Visio COM, produce a VSDX, or validate live PostgreSQL/Redis persistence.
- The report is ignored by repository policy; it will be force-added explicitly as required by this brief without changing `.gitignore`.
