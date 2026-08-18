# Task 3 native VSDX/page identity and observable cleanup report

## Scope and baseline

- Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`
- Branch: `agent`
- Baseline: `afb7232450e5337edf4d8abaf03344590fb6e0e8`
- Baseline Worker suite before edits: 121 passed, 0 failed, 1 skipped.
- The skipped baseline test was the existing real-Visio acceptance test.
- Changes are limited to the Task 3 Core session model/manager, Host recovery manifest, Live COM session source, direct Worker tests, and this report.
- `Program.cs`, API/UI source, and the two user-untracked plan files were not changed.

## RED evidence

Before any production edit, the required fake-native/unit contracts were added for:

1. a replacement VSDX with the same path-derived document handle and numeric-page-derived page handle;
2. a wrong native page identity closing the unexpected recovered document;
3. recovery cleanup close failure preserving both the identity mismatch and cleanup failure;
4. adapter disposal surfacing native close failure and retaining the failed registration;
5. the current private manifest persisting native document/page identities.

The focused RED command was:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter "FullyQualifiedName~Recovery_rejects_a_replacement_vsdx_with_the_same_path_and_page_handle|FullyQualifiedName~Recovery_with_the_wrong_native_page_identity_closes_the_unexpected_document|FullyQualifiedName~Recovery_cleanup_close_failure_preserves_the_identity_mismatch_and_cleanup_failure|FullyQualifiedName~Disposal_reports_native_close_failure_and_retains_the_failed_session_registration|FullyQualifiedName~Save_and_load_round_trip_a_manifest_with_a_versioned_private_filename" --logger 'console;verbosity=minimal'
```

Result: 5 failed, 0 passed, 0 skipped. Four failures reported that the four-string `VisioSessionDocument` native-identity constructor was absent. The disposal failure reported `Assert.Throws() Failure: No exception was thrown`, proving the existing adapter swallowed native close failure.

The first post-implementation run stopped at compilation with `CS1976` and two nullable diagnostics because a `dynamic` argument caused the identity read result to remain dynamically bound. The fix was limited to restoring a statically typed `string?` result at that boundary. The same five-test command was then rerun successfully.

## Implementation

- `VisioSessionDocument` now carries bounded 128-bit hexadecimal `NativeDocumentIdentity` and `NativePageIdentity` values in addition to opaque live handles. The two-handle constructor remains only for legacy diagnostic manifest material.
- Native creation generates independent high-entropy identities and writes them through fixed internal Shape Data operations on `Document.DocumentSheet` and `Page.PageSheet`, then reads them back before registering the session. No generic COM, VBA, script, shell, protocol, or command-string surface was added.
- SaveAs reopens the final VSDX, verifies normalized `Document.FullName`, verifies the document identity, locates the page by its persisted native page identity, and retains the numeric `Page.ID`-derived handle as an additional consistency check.
- Recovery requires current native identities, verifies normalized path and document identity before page selection, and rejects replacement/mismatched VSDX or pages before any shape mutation.
- Unexpected recovered documents are explicitly closed. If identity verification and close both fail, the surfaced exception retains both failures through an `AggregateException`; COM reference finalisation remains best effort.
- Private recovery manifests are now strict format 4 and persist both native identities. Formats 1 through 3 remain loadable only for diagnostics; the v2 runtime rejects non-current manifests before native recovery.
- Explicit adapter close still removes registrations only after native close succeeds. Adapter/native disposal now reports close failures, retains failed registrations for observable retry/reconciliation, and aggregates independent close failures. Backend disposal no longer marks itself disposed or tears down the STA runner when adapter disposal reports a close failure.

## GREEN and verification evidence

Required native-identity/cleanup contracts:

```text
5 passed, 0 failed, 0 skipped
```

Focused Live/manager/manifest/runtime suites:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter "FullyQualifiedName~VisioSessionManagerTests|FullyQualifiedName~SessionRecoveryManifestStoreTests|FullyQualifiedName~VisioComSessionBackendTests|FullyQualifiedName~VisioComSessionOperationsTests|FullyQualifiedName~LongLivedWorkerRuntimeTests" --logger 'console;verbosity=minimal'
```

Result: 84 passed, 0 failed, 0 skipped.

Full Worker suite:

```powershell
dotnet test .\workers\visio-worker\VisioWorker.sln --no-restore --logger 'console;verbosity=minimal'
```

Result: 125 passed, 0 failed, 1 skipped. The skipped test remains `VisioComSessionLiveAcceptanceTests.Same_live_session_draws_updates_saves_closes_and_recovers_one_editable_vsdx`.

Release build:

```powershell
dotnet build .\workers\visio-worker\VisioWorker.sln --configuration Release --no-restore -clp:ErrorsOnly
```

Result: 0 warnings, 0 errors.

Working-tree whitespace check:

```powershell
git diff --check
```

Result: exit 0. Git emitted only the existing LF-to-CRLF working-copy warnings; it reported no whitespace error.

## Review

The final requirements-focused diff review found no Critical or Important issue in the allowed scope. It specifically rechecked strict manifest field sets for formats 1-4, current-format identity persistence, pre-mutation recovery ordering, exact-path comparison, page selection, mismatch cleanup, close-failure aggregation, registration retention, and preservation of the two unrelated untracked plans.

## Remaining real Visio gate

This task has fake-native/unit, full Worker, Release, and Git evidence only. It does not prove that installed Microsoft Visio persists DocumentSheet/PageSheet identities through a real SaveAs, that a real replacement VSDX is rejected, that real COM close failures surface as designed, or that a real VSDX can be saved, closed, reopened, and independently read back. The existing live acceptance test remains skipped, so the real Windows/Visio gate is still incomplete.

## 2026-08-18 Important native-identity review-fix supplement

### Scope

- Fixed only the two Important findings in `VisioComSessionOperations` and its focused fake-native tests.
- No `apps/api` or M2.5 file changed. The two user-owned untracked plan files remain unmodified and untracked.
- The native boundary still exposes no raw COM member, shell, script, VBA, or protocol-command surface.

### TDD RED evidence

The focused reproduction tests were written before the production change. The first test-only compile exposed the missing native close-transition seam (`CS0535`: the existing native interface had no `SaveAs(..., Action originalClosed)` contract). After the fake retained the existing three-argument shim so both reproductions could execute against the pre-fix production source, the focused RED command was:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter "FullyQualifiedName~FindExpectedPage_skips_an_untagged_candidate_before_the_matching_native_identity_page|FullyQualifiedName~SaveAs_reopen_identity_failure_removes_released_native_and_adapter_registrations_before_reconciliation" --logger "console;verbosity=minimal"
```

Result: 2 failed, 0 passed, 0 skipped. The first failure was `Native Visio session identity is missing or invalid.` when an ordinary untagged page preceded the matching page. The second was `Assert.Throws() Failure: No exception was thrown` for `Close(original)` after simulated reopened-identity failure, proving the stale adapter registration remained.

The related ambiguity guard was also test-first: with the duplicate-match branch removed, the three-test focused run reported 1 failed, 2 passed, 0 skipped because `FindExpectedPage` returned the first duplicate instead of rejecting it.

### GREEN implementation and verification

- `FindExpectedPage` now treats an absent Worker page marker as a non-match, continues scanning, rejects malformed present markers and COM read failures through the strict reader, and rejects duplicate native page identities.
- Native `SaveAs` removes the released original native registration and invokes the adapter transition immediately after `Document.Close()` succeeds, before reopening. The adapter then registers only a successfully reopened document. A reopen verification failure therefore leaves neither registry targeting the released original document; existing unexpected-reopen cleanup and failure aggregation remain in place.

Focused GREEN command:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter "FullyQualifiedName~FindExpectedPage_skips_an_untagged_candidate_before_the_matching_native_identity_page|FullyQualifiedName~FindExpectedPage_rejects_ambiguous_matching_native_identity_pages|FullyQualifiedName~SaveAs_reopen_identity_failure_removes_released_native_and_adapter_registrations_before_reconciliation" --logger "console;verbosity=minimal"
```

Result: 3 passed, 0 failed, 0 skipped.

Full Worker suite:

```powershell
dotnet test .\workers\visio-worker\VisioWorker.sln --no-restore --logger "console;verbosity=minimal"
```

Result: 128 passed, 0 failed, 1 skipped. The unchanged skipped test is `VisioComSessionLiveAcceptanceTests.Same_live_session_draws_updates_saves_closes_and_recovers_one_editable_vsdx`.

Release build:

```powershell
dotnet build .\workers\visio-worker\VisioWorker.sln --configuration Release --no-restore -clp:ErrorsOnly
```

Result: 0 warnings, 0 errors.

Git checks: the staged and working-tree `git diff --check` commands exited 0; Git emitted only LF-to-CRLF working-copy warnings. The required committed-range command also exited 0 after the implementation commit:

```powershell
git diff --check 482076a..HEAD
```

Result: `RANGE_DIFF_CHECK=PASS`.
