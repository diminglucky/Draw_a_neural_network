# DrawingRun Phase 1/2 closure — code evidence, deployment gate retained

**Recorded:** 2026-08-24  
**Scope:** DrawingRun trusted scope, durable `formalUgsHash`, forward migration `015`, authenticated resume, and migration-safety smoke.  
**Delivery range:** `deeb5a17d691c3724957b0e6b6f7495e3c237bee..a1354efab2f0d696085bfeacb7846a086256d406`

## Implemented boundary

- `formal_ugs_hash` is a nullable, SHA-256-constrained durable column in fresh schema and is persisted by create, CAS, transactional transition, and PostgreSQL row mapping.
- Migration `015` blocks legacy `awaiting_apply_confirmation`, invalid hashes, and incompatible existing column types. It normalizes compatible existing textual columns to nullable `TEXT` without rewriting legacy semantic state.
- The Coordinator passes a verified `{ runId, ownerId, deviceId }` scope to all reducer/public-projection calls. Device-scoped reads do not project foreign-device runs; identity corruption that claims the current device fails closed.
- Unauthenticated cold recovery intentionally schedules no persisted workflow. A device-authenticated `POST /api/drawing-runs/:runId/resume` is the only recovery trigger and enforces owner, device, revision, and idempotency binding.
- The migration smoke requires the exact disposable database `draw_a_neural_network_migration_safety`, verifies `current_database()` before destructive DDL, rolls back expected migration failures before inspecting them, and surfaces cleanup failures.

## Local verification

| Command | Result | Boundary proved |
|---|---:|---|
| `npx vitest run apps/api/tests/drawing-run apps/api/tests/agent-routes.test.ts apps/api/tests/postgres-store.test.ts apps/api/tests/production-boundary.test.ts` | 10 files / 166 tests passed | DrawingRun, authenticated route, persistence, and migration-contract regressions |
| `npx tsc --noEmit` | passed | Strict TypeScript compilation |
| `npm run api:check` | passed | Foundation boundary check |
| `npm run api:test` | 142 files / 1,051 tests passed in the current worktree | Full API regression; includes existing user-draft tests and is not by itself a remote-delivery claim |
| Independent final code review | PASS / APPROVED | No remaining code defect found in the Phase 1/2 closure scope |

## Deployment gate retained

The actual PostgreSQL migration matrix has **not** run. The local PostgreSQL endpoint was unreachable and Docker was unavailable. The no-configuration smoke guard was exercised and correctly failed before connecting or issuing DDL:

```text
DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL is required; this smoke never uses a shared or default PostgreSQL URL.
```

Before Phase 1/2 is treated as deployment-accepted, run:

```powershell
$env:DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL = "postgres://.../draw_a_neural_network_migration_safety"
npm run api:smoke:postgres:drawing-run-migration-safety
```

The URL must target that exact dedicated disposable database. The matrix checks legacy-state rollback, invalid-hash rollback, nullable normalization with valid-hash preservation, incompatible-type rejection, and fresh/rerunnable migration success.

## Non-claims

This record does not accept M2.12, start Provider/Harness work, or claim sketch intake, visual grammar, current-page Visio update, save/reopen, native readback, real-host acceptance, billing, or commercial readiness.
