# Analysis-Scoped Immutable PlanSnapshot Design

## Goal

Create an immutable, owner-scoped snapshot for a validated v3 `FigureAnalysisRecord` and its deterministic publication plan without pretending that the v3 analysis is an old draft revision.

## Scope and boundary

This phase adds a new analysis snapshot contract beside the existing draft snapshot contract. Existing `PlanSnapshot`, draft preview, and export-confirmation callers remain source-compatible. A candidate analysis, a failed analysis, a plan with failed blocking visual QA, or a plan with unresolved critical IR cannot produce a snapshot.

The public preview route remains a safe projection. The new snapshot contains only deterministic plan identity, compiler/layout/style inputs, visual QA results, and preview artifact hashes. It never contains source bytes, provider payloads, evidence locators, worker paths, shell commands, or COM instructions.

## Snapshot identity

`AnalysisPlanSnapshot` is keyed by:

```text
tenantId + userId + analysisId + architectureIrHash + figureIntentHash
  + publicationPlanHash + compilerManifest + layoutSeed
  + visualQaVersion/status/checks + previewArtifactHashes
```

The identity is the SHA-256 of canonical JSON with sorted object keys and preserved array order. `snapshotId` is `analysis-plan-` plus the first 32 hexadecimal characters. Any change to IR, intent, publication plan, compiler/layout/style versions, layout seed, QA result, or artifact hash produces a different identity. The owner is part of the identity so a snapshot cannot be copied across tenants.

## Components

- `analysis-plan-snapshot.ts`: validated input, canonical identity, deep-cloned/deep-frozen output, and safe internal snapshot type.
- `analysis-plan-snapshot-store.ts`: owner-scoped insert/get with duplicate rejection and clone isolation.
- `analysis-plan-snapshot-service.ts`: accepts only a ready analysis plus a ready publication plan and passing visual QA; candidate and failed states return a typed domain error before store insertion.
- Focused Vitest tests cover candidate rejection, QA rejection, deterministic identity, all identity inputs, duplicate rejection, owner isolation, safe projection, and mutation isolation.

## Failure and replay rules

Snapshot creation is fail-closed. A repeated request with the same canonical input returns the existing snapshot only through an explicit `get`/replay path; `insert` never overwrites an existing record. A caller from a different owner receives `null`/not found and cannot infer the foreign snapshot.

## Acceptance evidence

- RED tests fail before the new types/service exist.
- GREEN focused tests prove the full identity and isolation contract.
- TypeScript and API checks pass after integration.
- Snapshot success is not evidence of Visio COM execution, VSDX save, close/reopen, or native readback.
