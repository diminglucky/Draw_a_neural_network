# Task 4 review-fix report

## Scope

Implemented exactly the four Task 4 review fixes in `workers/visio-worker`:

1. The v1 `protocolVersion` classifier now matches the legacy serializer case-insensitively and rejects duplicate case-variant properties before dispatching. v2 continues through its existing strict parser only.
2. A v2 failure after strict parsing now returns the parsed, validated `requestId`; classification and parser failures still return `unknown`; cancellation remains rethrown.
3. The host loop preserves one-shot v1 exit compatibility: EOF with no nonblank request is exit `2`, any failed v1 response is exit `1`, and v2 failures remain per-line responses with host exit `0`.
4. The Program input/output loop now has an internal host-loop seam that owns the line processor lifetime. The integration test drives multiple lines through it, checks per-line flushes and continuation after malformed v2, and proves EOF disposes the opened session.

No API, COM, or script surface was expanded. The two pre-existing untracked plan files under `docs/superpowers/plans/` were not modified or staged.

## TDD evidence

Four focused regression tests were added before production changes. The initial RED command was:

```text
dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore
```

It exited `1`: 4 failed, 3 passed. The failures proved the intended gaps:

- case-insensitive v1 discriminator returned `failed` instead of `succeeded`;
- a post-parse v2 initialization failure returned `requestId: unknown` rather than `runtime-failure`;
- no host-loop integration seam existed for the exit-contract and EOF-lifecycle tests.

After the minimal Host changes, the same focused command passed: 7 passed, 0 failed, 0 skipped.

## Verification

| Command | Result |
| --- | --- |
| Focused Host regressions: `dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore` | Exit 0; 7 passed, 0 failed, 0 skipped. |
| Full Worker suite: `dotnet test .\VisioWorker.sln --no-restore` | Exit 0; 137 passed, 0 failed, 1 skipped (`VisioComSessionLiveAcceptanceTests` is the existing live acceptance skip). |
| Release build: `dotnet build .\VisioWorker.sln -c Release --no-restore` | Exit 0; 0 warnings, 0 errors. |
| Staged diff check: `git diff --cached --check` | Exit 0; no whitespace errors. |

## Files

- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLoop.cs`
- `workers/visio-worker/src/VisioWorker.Host/Program.cs`
- `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`
- `.superpowers/sdd/task-4-report.md`

The report target was an ignored stale artifact for an unrelated static-PyTorch task, so it was explicitly replaced as authorized by the review-fix brief.

## Independent review follow-up: idle tick, owned-engine cleanup, and v2 candidate classification

### Scope and implementation commit

Independent review added three Host-only reliability findings. The implementation and regression commit is:

```text
1374f4b fix: harden long-lived worker host lifecycle
```

Changed implementation/test files:

- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLoop.cs`
- `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`

The two pre-existing untracked `docs/superpowers/plans/` files remained unmodified and unstaged. No push was performed.

### Fixes

1. **Idle checkpoint scheduling:** `WorkerHostLoop` now owns one cancellable scheduler task. Its default wait is one minute; the internal overload accepts a `Func<CancellationToken, Task>` wait seam for deterministic tests. Every tick calls the same line processor's `CheckpointIdleSessionsAsync`. EOF, external cancellation, scheduler failure, and write failure enter one `finally` that cancels and awaits the scheduler before processor disposal. A linked lifecycle token also cancels an abandoned stdin wait if the scheduler faults.
2. **Owned native-engine construction:** live v2 setup now creates the owned engine/backend/manifest/runtime locally. It publishes `_ownedEngine` and `_v2Runtime` only after full construction. A failed runtime initialization disposes that attempt's engine while fields remain unset, so the next v2 request creates and cleans up a fresh engine. Cleanup failures are aggregated with the original initialization failure. The default engine factory also cleans up if `CreateSessionBackend()` itself fails. The factory seam is `internal`, so browser/API/script surfaces do not expand.
3. **Trusted v2 candidate outcome:** line processing now returns internal protocol metadata to the host loop. Any discriminator set containing numeric version `2`, including exact and case-variant duplicate discriminator properties, enters the strict v2 parser and receives the safe v2 failure (`WorkerV2Response`, `requestId: unknown`, `status: failed`) when parsing fails. Duplicate v1 discriminators remain fail-closed v1 failures. Host exit status uses that trusted classification metadata rather than the CLR response type. No v2 field other than the legacy discriminator classification gained case-insensitivity; the strict v2 allowlist remains the sole v2 validator.

### TDD RED evidence

The new Host regressions were added before production changes. The initial focused command was:

```text
dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore
```

After making the test's missing-scheduler-seam assertion terminate before it could wait forever on the old stdin-only loop, RED exited `1`: **6 failed, 8 passed**. The failures proved:

- both exact and case-variant duplicate v2 discriminators returned `WorkerResponse` instead of `WorkerV2Response`;
- their Host EOF path returned exit `1` instead of `0`;
- the tick scheduler overload was absent;
- the owned-engine factory/cleanup seam was absent.

The cancellation regression was included in the same RED batch and passed on the pre-fix code, documenting the pre-existing processor cancellation behavior that the Host-loop refactor had to preserve.

### GREEN and verification evidence

| Command | Result |
| --- | --- |
| Focused Host regressions: `dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore` | Exit 0; **14 passed**, 0 failed, 0 skipped. Covers fake-clock 15-minute checkpoint save/close while stdin blocks, EOF/cancellation scheduler shutdown, two consecutive owned-engine setup failures with immediate disposal, duplicate v1/v2 discriminator semantics, true `launchShell` v2 parse failure exit 0, and cancellation rethrow. |
| Task 4 selected filter: `dotnet test .\VisioWorker.sln --no-restore --filter "FullyQualifiedName~ProtocolRoundTripTests\|FullyQualifiedName~WorkerHostLineProcessorTests\|FullyQualifiedName~WorkerV2ProtocolTests\|FullyQualifiedName~LongLivedWorkerRuntimeTests"` | Exit 0; **71 passed**, 0 failed, 0 skipped. The requested filter now contains 71 tests rather than the earlier 64 because of current and newly added coverage. |
| Full Worker suite: `dotnet test .\VisioWorker.sln --no-restore` | Exit 0; **144 passed**, 0 failed, 1 skipped. The sole skip remains the manually gated installed-Visio live acceptance test. |
| Release build: `dotnet build .\VisioWorker.sln -c Release --no-restore` | Exit 0; 0 warnings, 0 errors. |
| Working diff check: `git diff --check` | Exit 0; no whitespace errors (only Git LF/CRLF notices). |
| Staged implementation diff check: `git diff --cached --check` | Exit 0; no whitespace errors before `1374f4b`. |

### Remaining risk

Unit/Host tests prove the scheduler and owned-engine lifecycle using fake clock, controlled stdin, and a tracked non-COM owned engine. The existing real installed-Visio acceptance remains explicitly skipped; therefore this follow-up does not claim live COM/Visio runtime acceptance on an installed host.

## Stability follow-up: complete discriminator accounting and writer-failure lifecycle proof

### Scope

This follow-up closes the remaining Task 4 stability findings without changing API/browser input, raw COM, shell/script, or strict v2 parser surfaces.

1. **Complete discriminator accounting:** `ReadProtocolVersion` now records every `protocolVersion` property using `OrdinalIgnoreCase` before it interprets any value. A numeric integer `2` anywhere makes the line a v2 candidate and leaves the original JSON for the strict v2 parser. Otherwise, zero/multiple properties, or a single property that is not integer `1`, are a safe v1 failure before legacy case-insensitive deserialization. This prevents malformed `null`/string/overflow duplicates from bypassing the duplicate guard.
2. **Writer-failure lifecycle proof:** Host-loop regressions now inject both `WriteLineAsync` and `FlushAsync` failures after a controlled v2 `open`. They prove that the original writer exception remains observable only after the scheduler observes cancellation, the active session is checkpointed/saved and closed through processor disposal, and a later manual tick cannot checkpoint again.
3. **Owned-engine construction proof:** The internal owned-engine seam now supplies an engine and its backend factory separately, so the same production construction transaction disposes an engine if backend creation fails. Tests prove that the primary backend initialization exception survives successful cleanup and that an `AggregateException` retains both primary and cleanup exceptions when disposal fails. This exercises the same cleanup branch used by the default `VisioComEngine.CreateSessionBackend()` call without needing installed Microsoft Visio.

### TDD RED evidence

Only the Host test file was changed before production code. The first compile attempt exposed a test-only nested-enum accessibility error; it was corrected without changing production code. The actual behavioral RED command was:

```text
dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore
```

It exited `1`: **8 failed, 22 passed**. Five failures showed that `null`/string/overflow plus numeric v1 duplicates were classified as an ordinary v1 request rather than a safe failure. Three failures showed that the required engine/backend creation transaction seam did not yet exist. The writer-failure regressions passed against the existing Host `finally` path, recording proof for an already-correct lifecycle guarantee rather than motivating an unnecessary control-flow change.

### GREEN and verification

| Command | Result |
| --- | --- |
| Focused Host regressions: `dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore` | Exit 0; **39 passed**, 0 failed, 0 skipped. Includes exact/case duplicate v1 and v2, both property orders for null/string/overflow with v1 and v2, single null/string/overflow/unsupported v1 discriminators, explicit exact v2 duplicate EOF exit 0, no v1 draw/backend open, writer and flush failure lifecycle, and owned-engine initialization cleanup. |
| Full Worker suite: `dotnet test .\VisioWorker.sln --no-restore` | Exit 0; **169 passed**, 0 failed, 1 skipped. The sole skip is the existing installed-Visio live acceptance test. |
| Release build: `dotnet build .\VisioWorker.sln -c Release --no-restore` | Exit 0; **0 warnings, 0 errors**. |

### Files in this follow-up

- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`
- `.superpowers/sdd/task-4-report.md`

The two existing untracked plan documents remain outside this allowlist. No push is authorized or performed by this follow-up.

## Numeric-2 protocol candidate correction

### Scope

This narrowly corrects the Host protocol classifier before the existing strict v2 parser. `JsonElement.TryGetInt32` recognized only the integer spelling `2`, so JSON Number tokens such as `2.0`, `2.00`, `2e0`, and `2E+0` were incorrectly treated as legacy v1 safe failures. With a duplicate `ProtocolVersion: 1`, that produced a v1 response and EOF exit `1` instead of the required v2 safe failure and exit `0`.

The classifier now interprets a JSON Number token's original number lexeme exactly, without `double`, `decimal`, or an approximate comparison. It regards a token as a v2 candidate only when its mathematical value is exactly two: its single non-zero significand digit is `2`, and its fractional scale and signed exponent cancel exactly. The original JSON is then still passed unchanged to `WorkerV2RequestParser`; non-integer spellings are deliberately rejected there as `WorkerV2Response(requestId: "unknown", status: "failed")`. The v2 parser and its strict field/command allowlists are unchanged. Non-number and non-two discriminator values retain the existing fail-closed v1 behavior.

### TDD evidence

Only `WorkerHostLineProcessorTests.cs` was changed before the production classifier. The focused RED command was:

```text
dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore
```

It exited `1`: **36 failed, 39 passed**. Every new failure asserted a required v2 classification but observed v1, including standalone `2.0`, `2.00`, `2e0`, and `2E+0`, plus both property orders when each was paired with `null`, a string, an `Int32` overflow literal, or integer `1`.

After the minimal exact-lexeme classifier was added, the same focused command exited `0`: **75 passed, 0 failed, 0 skipped**. Every new case asserts the response type is `WorkerV2Response`, `requestId` is `unknown`, status is `failed`, Host EOF exit is `0`, and the v1 backend performs no `OpenOrCreate` call.

### Verification

| Command | Result |
| --- | --- |
| Focused Host regression: `dotnet test .\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --filter "FullyQualifiedName~WorkerHostLineProcessorTests" --no-restore` | Exit 0; **75 passed**, 0 failed, 0 skipped. |
| Full Worker suite: `dotnet test .\VisioWorker.sln --no-restore` | Exit 0; **205 passed**, 0 failed, 1 skipped. The sole skip is the existing installed-Visio live acceptance test. |
| Release build: `dotnet build .\VisioWorker.sln -c Release --no-restore` | Exit 0; **0 warnings, 0 errors**. |

### Files

- `workers/visio-worker/src/VisioWorker.Host/WorkerHostLineProcessor.cs`
- `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`
- `.superpowers/sdd/task-4-report.md`

The two pre-existing untracked plan documents remain unmodified and unstaged. This follow-up does not push and does not claim real installed-Microsoft-Visio/VSDX acceptance.
