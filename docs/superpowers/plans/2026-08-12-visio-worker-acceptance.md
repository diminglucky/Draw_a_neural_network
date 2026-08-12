# Visio Worker Acceptance Runbook

This runbook keeps the standalone Visio integration's evidence gates separate. A passing mock test proves the protocol and headless engine only; it does not prove Microsoft Visio COM availability or visual correctness.

## Automated gates

Run these commands from the repository root:

```powershell
npx tsc --noEmit
npm run api:test
dotnet test workers/visio-worker/VisioWorker.sln --no-restore
powershell -ExecutionPolicy Bypass -File scripts/visio-worker-mock-smoke.ps1
```

The mock smoke must report `Visio Worker mock smoke OK` and a succeeded readback. Its output is a deterministic diagnostic artifact and is not a live `.vsdx` acceptance result.

To verify the Node API-side Worker client against the real live Worker, run:

```powershell
npx tsx scripts/visio-api-live-smoke.ts
```

This command proves the Node child-process adapter boundary in addition to the direct C# Worker smoke.

To exercise the complete authenticated API route with the real live Worker:

```powershell
npx tsx scripts/visio-api-route-live-smoke.ts
```

## Live COM gate

Run this only on a Windows machine where Microsoft Visio is installed and the `Visio.Application` COM ProgID is registered:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/visio-com-smoke.ps1
```

Pass `-KeepOutput` when an operator needs to inspect the generated artifact after the smoke:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/visio-com-smoke.ps1 -KeepOutput
```

Expected live evidence includes:

- `Visio COM smoke OK`;
- a succeeded Worker response with `valid=true`, shape count, and connector count;
- an existing `.vsdx` containing a Visio page package entry.

If Visio is not installed, the script must report `VISIO_UNAVAILABLE` and exit non-zero. That is an environment result, not a source-code success or failure claim.

## Independent artifact gate

After a successful live smoke, open the reported `.vsdx` in Microsoft Visio and verify the following separately from the command output:

1. The network nodes and connectors are visible and editable.
2. The document can be closed without a save prompt caused by corruption.
3. The same file can be reopened and still contains the nodes and connectors.
4. The Worker did not close a Visio instance that it did not launch.

The repeatable COM inspection helper opens, exports, closes, and reopens an artifact:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/visio-artifact-inspect.ps1 `
  -Path "C:\path\to\job-live-smoke.vsdx" `
  -PreviewPath "C:\path\to\job-live-smoke-preview.png"
```

Record the operator, machine, Visio version, output hash, and observations in the release evidence. Current-session execution alone is not close/reopen proof.

## Evidence status for this implementation slice

- Source/design: implemented in the standalone repository.
- Focused API and Worker tests: completed on 2026-08-12; API and client Vitest passed 35 files/144 tests and Worker xUnit passed 9 tests.
- Worker build/package: completed on 2026-08-12 with 0 warnings and 0 errors after restoring the standalone solution using `workers/visio-worker/NuGet.Config`.
- Live Visio COM acceptance: completed on the current Windows host; smoke readback was `shapeCount=5`, `connectorCount=1`.
- Independent `.vsdx` inspection: the generated package contained `visio/pages/page1.xml`, and an independent Visio COM reopen found 5 shapes. A human visual/editability review remains a separate operator gate.
- Retained artifact evidence: SHA-256 `730FCA6FE0E2628E3C3158ED8BDA964472AD45B87A3BB34100FAF1DB9A50F6A9` for the `-KeepOutput` smoke artifact.
- Git delivery: record commit and tag only after the above source and focused checks are reviewed.
