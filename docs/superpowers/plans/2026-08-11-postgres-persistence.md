# PostgreSQL Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Replace the production memory-store boundary with an asynchronous PostgreSQL `FoundationStore`, preserve the one-active-session invariant transactionally, and expose a Redis-ready lease interface.

**Architecture:** Migrate the shared store contract and all consumers to `Promise` methods. Keep `InMemoryFoundationStore` as an async development/test implementation. Add a parameterized `PostgresFoundationStore` backed by `pg.Pool`, with a row-mapping module and a transaction around active-session claims. Add a separate `LeaseCoordinator` contract with an in-memory implementation; Redis remains an explicitly future adapter.

**Tech Stack:** Node.js ESM, TypeScript, `pg`, Fastify, Vitest, PostgreSQL 16, Docker Compose.

## Global Constraints

- `STORAGE_DRIVER=memory` is development/test only.
- `STORAGE_DRIVER=postgres` must use `DATABASE_URL` and must never silently instantiate `InMemoryFoundationStore`.
- PostgreSQL queries must be parameterized; user input must never be interpolated into SQL.
- One user may have at most one non-expired active session.
- The database partial unique index is a required invariant, not an optimization.
- Existing domain object shapes remain serializable and stable for routes and clients.
- Redis is an interface boundary in this phase; do not claim a Redis adapter without a real implementation and tests.
- Every new behavior starts with a failing test.

---

### Task 1: Add persistence design and database dependency

**Files:**
- Create: `docs/superpowers/specs/2026-08-11-postgres-persistence-design.md`
- Create: `docs/superpowers/plans/2026-08-11-postgres-persistence.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `apps/api/tests/config.test.ts`

**Interfaces:**
- `loadConfig` continues to expose `storageDriver` and `databaseUrl`.
- `pg` becomes the runtime PostgreSQL client dependency.

- [x] Document the selected async store and transaction design.
- [x] Add `pg` as a runtime dependency and `@types/pg` only if the installed package requires it.
- [ ] Add a failing configuration test proving `STORAGE_DRIVER=postgres` requires a valid `DATABASE_URL`.
- [ ] Run `npm run api:test -- apps/api/tests/config.test.ts` and observe the missing test behavior before implementing any new configuration behavior.
- [ ] Implement only the missing configuration assertion and run the focused test.
- [ ] Commit with `feat: prepare postgres persistence dependencies`.

### Task 2: Migrate the store contract to asynchronous methods

**Files:**
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/session-service.ts`
- Modify: `apps/api/src/admin-service.ts`
- Modify: `apps/api/src/job-service.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: existing API tests under `apps/api/tests/`

**Interfaces:**
- Every `FoundationStore` method returns `Promise`.
- `InMemoryFoundationStore` preserves behavior but uses `async` methods.
- `SessionService`, `AdminService`, and `JobService` public methods become async where they access the store.

- [ ] Add a compile/test assertion that service calls await an async store implementation rather than accepting synchronous-only values.
- [ ] Run focused service and route tests and observe failures from the old sync signatures.
- [ ] Convert the contract, memory implementation, services, and routes in small batches; preserve all domain error codes.
- [ ] Run all existing API tests and TypeScript checking.
- [ ] Commit with `refactor: make foundation store asynchronous`.

### Task 3: Add row mapping and PostgreSQL store CRUD

**Files:**
- Create: `apps/api/src/postgres-store.ts`
- Create: `apps/api/src/postgres-row-mappers.ts`
- Create: `apps/api/tests/postgres-store.test.ts`
- Modify: `apps/api/src/store.ts`

**Interfaces:**
- `new PostgresFoundationStore(pool: PoolLike): FoundationStore & { close(): Promise<void> }`.
- `PoolLike.query(text, values)` returns `{ rows, rowCount }`.
- `PoolLike.connect()` returns a client with `query`, `release`, and transaction support.

- [ ] Write failing tests for user/device/session/subscription/job/audit row mapping and parameterized inserts.
- [ ] Run the focused tests and confirm the module is missing.
- [ ] Implement explicit mappers for timestamps, JSONB, nullable columns, and public-key/device fields.
- [ ] Implement CRUD methods using parameter placeholders and safe fixed SQL strings.
- [ ] Verify not-found reads return `null`, list methods return stable arrays, and writes return domain objects.
- [ ] Run focused store tests and TypeScript checking.
- [ ] Commit with `feat: add postgres foundation store`.

### Task 4: Implement transactional active-session claim and lease interface

**Files:**
- Create: `apps/api/src/lease-coordinator.ts`
- Create: `apps/api/tests/lease-coordinator.test.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Modify: `apps/api/tests/postgres-store.test.ts`

**Interfaces:**
- `LeaseCoordinator.claim(key, value, ttlSeconds): Promise<boolean>`.
- `LeaseCoordinator.renew(key, value, ttlSeconds): Promise<boolean>`.
- `LeaseCoordinator.release(key, value): Promise<void>`.
- `InMemoryLeaseCoordinator` implements the interface for tests.

- [ ] Write failing tests for lease ownership, renewal by the owner, rejection by another owner, and release.
- [ ] Write a failing transaction test asserting `BEGIN`, user row lock, expired-session update, insert, and `COMMIT` on a successful claim.
- [ ] Write a failing rollback test asserting `ROLLBACK` and client release on insert failure.
- [ ] Implement the in-memory lease coordinator and PostgreSQL transaction.
- [ ] Translate duplicate active-session unique violations into `false`.
- [ ] Run focused tests and the complete API suite.
- [ ] Commit with `feat: add transactional session claim boundary`.

### Task 5: Select PostgreSQL at startup and add integration smoke test

**Files:**
- Create: `apps/api/src/store-factory.ts`
- Create: `apps/api/tests/store-factory.test.ts`
- Create: `scripts/postgres-smoke.mjs`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- `createFoundationStore(config): Promise<{ store: FoundationStore; close(): Promise<void> }>`.
- Memory driver returns the in-memory store and a no-op close.
- PostgreSQL driver creates `pg.Pool({ connectionString: config.databaseUrl })` and `PostgresFoundationStore`.

- [ ] Write failing factory tests for memory selection, missing PostgreSQL URL, and PostgreSQL adapter selection.
- [ ] Implement the factory without fallback from PostgreSQL to memory.
- [ ] Register Fastify shutdown cleanup for the pool.
- [ ] Add `api:smoke:postgres` that checks `DATABASE_URL`, runs the migration if needed, persists a user, closes the store, reopens it, and reads the user back.
- [ ] Run factory tests and all source checks.
- [ ] If Docker is available, run the smoke test against `infra/docker-compose.yml`; otherwise report the external Docker gate as unexecuted.
- [ ] Commit with `feat: select durable foundation store at startup`.

### Task 6: Final verification and delivery report

**Files:**
- Modify: `docs/superpowers/plans/verification-foundation.md`
- Modify: `README.md`

- [ ] Run `npm run api:test`.
- [ ] Run `npm run api:check`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run all JavaScript syntax checks.
- [ ] Run `git diff --check`.
- [ ] Run the real PostgreSQL smoke test when Docker and PostgreSQL are available.
- [ ] Inspect `git status --short`, commit history, and staged diff.
- [ ] Commit with `docs: document postgres persistence verification`.

## Plan self-review

- Spec coverage: async store migration, PostgreSQL CRUD, transaction claim, lease interface, startup selection, smoke test, and delivery verification each have a task.
- Placeholder scan: no TBD/TODO or vague implementation steps are used; Redis is explicitly a bounded interface rather than an unimplemented production claim.
- Type consistency: all store methods are awaited by services; the factory returns a `FoundationStore` plus close handle; `PoolLike` is defined before the PostgreSQL implementation task.
