# Drawing Run Event History Implementation Record

**Verification timestamp:** `2026-08-23T04:26:24Z`
**Branch:** `agent`
**Scope:** owner-scoped, public event projection for the LangGraph Drawing Run runtime

## Implemented

- Added `GET /api/drawing-runs/:runId/events`.
- Reused the Foundation/DrawingRun durable event store as the only event source; no parallel session history was introduced.
- Added a public event projection containing only `eventId`, `runId`, `revision`, `status`, `action`, `errorCategory`, and `occurredAt`.
- Excluded artifact hashes, request hashes, receipt identifiers, Provider references, source bytes, paths, and tenant-private fields.
- Preserved owner scoping and returned the same not-found behavior for an unknown or foreign run.

## Verification

- Focused Drawing Run/API tests: 42 passed.
- Full API/client suite: 141 files, 964 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run api:check`: passed.
- `npm run agent:verify-roadmap`: passed.
- `git diff --check`: passed.

## Boundary

This improves runtime observability and auditability. It does not constitute M2.12 acceptance, real Provider quality, Redis production durability, Windows/Visio mutation, save/reopen, or independent native readback evidence.
