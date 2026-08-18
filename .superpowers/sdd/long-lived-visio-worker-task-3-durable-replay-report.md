# Task 3 durable replay and cancellation safety report

## Scope and baseline

- Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`
- Branch: `agent`
- Baseline: `08d06d8`
- Changed only the Task 3 Core/Host allowlist, the two focused test files, and this report.
- `Program.cs`, Live COM, API/UI, and the two user-untracked plan files were not changed.

## RED evidence

Before production edits, focused execution ran:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter 'FullyQualifiedName~LongLivedWorkerRuntimeTests|FullyQualifiedName~SessionRecoveryManifestStoreTests' --logger 'console;verbosity=minimal'
```

The final RED run compiled and executed 46 tests: 32 passed and 14 failed. The failures established the missing requirements: no typed replay command or exposed manifest format version; legacy manifest open was accepted; all six non-close persisted replay paths returned response-only instead of recovering; `apply` neither saved nor rejected persistence failure/cancellation; and idle/capacity checkpoint cancellation left the actual candidate non-uncertain.

## Implementation

- Added the Core `VisioSessionReplayCommand` type to every command replay entry. `Unknown` remains only for optional legacy diagnostic parsing and is rejected on current manifest save/runtime use.
- Bumped recovery manifests to format 3. Every format-3 persisted replay record has an allowlisted `command` field. `StoredSessionRecoveryManifest` now exposes `FormatVersion`; formats 1 and 2 can still load for diagnostics, but runtime open/recover/replay rejects them before native work.
- Changed fresh-process replay: `open`, `apply`, `applyDiff`, `save`, `snapshot`, and `recover` restore the durable session before returning their original response. Only a persisted `close` response returns without recovery. Fingerprint mismatch remains checked before recovery/native work.
- Changed `apply` and `applyDiff` to save the VSDX and atomically persist the replay entry before reporting success. Save, manifest persistence, and cancellation after native work mark the session uncertain and do not return success.
- Marked the precise checkpoint candidate uncertain for `OperationCanceledException`, covering both idle checkpointing and capacity-driven eviction. Such sessions stay active capacity occupants.
- Preserved strict property validation, duplicate rejection, bounded journals, and the existing worker command allowlist.

## GREEN and build evidence

Focused durable replay suites:

```powershell
dotnet test .\workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore --filter 'FullyQualifiedName~LongLivedWorkerRuntimeTests|FullyQualifiedName~SessionRecoveryManifestStoreTests' --logger 'console;verbosity=minimal'
```

Result: 46 passed, 0 failed, 0 skipped.

Full Worker solution suite:

```powershell
dotnet test .\workers\visio-worker\VisioWorker.sln --no-restore --logger 'console;verbosity=minimal'
```

Result: 119 passed, 0 failed, 1 skipped. The skipped test is the existing `VisioComSessionLiveAcceptanceTests.Same_live_session_draws_updates_saves_closes_and_recovers_one_editable_vsdx`; no Live COM work was run or changed in this task.

Release build:

```powershell
dotnet build .\workers\visio-worker\VisioWorker.sln --configuration Release --no-restore -clp:ErrorsOnly
```

Result: 0 warnings, 0 errors.

## Remaining acceptance boundary

This Task 3 delivery supplies Core/Host source and automated-worker evidence. The brief explicitly excludes Live COM and native document/page metadata, so real Visio COM/VSDX acceptance is not claimed here.
