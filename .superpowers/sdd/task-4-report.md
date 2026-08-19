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
