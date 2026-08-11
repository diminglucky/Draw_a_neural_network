# Redis Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Add a Redis-backed distributed lease coordinator with monotonic fencing tokens and real Docker Redis verification.

**Architecture:** Upgrade the existing lease contract to return `LeaseResult`. Keep the in-memory implementation for tests. Add `RedisLeaseCoordinator` using three small Lua scripts and an injected Redis client interface. Add a factory that requires `REDIS_URL` for Redis mode and closes the client during application shutdown. Do not silently fall back to memory.

**Tech Stack:** Node.js ESM, TypeScript, official `redis` client, Redis 7, Vitest, Docker Compose.

## Global Constraints

- `LEASE_DRIVER=redis` requires `REDIS_URL`.
- Redis scripts must atomically validate owner and fencing token.
- Fencing tokens must increase for each new claim of the same logical key.
- Redis errors must propagate; they must not become successful memory leases.
- PostgreSQL remains the durable session source of truth and database invariant.
- Existing Agent, Visio, Electron, and billing boundaries are not changed in this phase.
- Every new behavior starts with a failing test.

---

### Task 1: Contract and dependency

**Files:**
- Create: `docs/superpowers/specs/2026-08-11-redis-lease-design.md`
- Create: `docs/superpowers/plans/2026-08-11-redis-lease.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/tests/lease-config.test.ts`

- [x] Write the design and plan.
- [x] Add the official `redis` runtime dependency.
- [x] Add a failing test that `LEASE_DRIVER=redis` requires `REDIS_URL`.
- [x] Implement the config field and validation.
- [x] Run the focused test and TypeScript check.
- [x] Commit with `feat: prepare redis lease configuration`.

### Task 2: Fencing contract and memory implementation

**Files:**
- Modify: `apps/api/src/lease-coordinator.ts`
- Modify: `apps/api/tests/lease-coordinator.test.ts`

- [x] Change claim/renew to return `{ acquired, fencingToken }` and release to require the token.
- [x] Write failing tests for monotonic tokens, stale renew, stale release, and expired takeover.
- [x] Update `InMemoryLeaseCoordinator` with a per-key sequence counter.
- [x] Run focused tests and all existing tests.
- [x] Commit with `feat: add fencing tokens to lease contract`.

### Task 3: Redis Lua adapter

**Files:**
- Create: `apps/api/src/redis-lease-coordinator.ts`
- Create: `apps/api/tests/redis-lease-coordinator.test.ts`

- [x] Write failing fake-client tests for claim, competing claim, renew, release, namespaced keys, and Redis error propagation.
- [x] Implement `RedisClientLike`, `RedisLeaseCoordinator`, and claim/renew/release Lua scripts.
- [x] Parse Redis array responses into `LeaseResult` without treating malformed responses as success.
- [x] Run focused tests and TypeScript checking.
- [x] Commit with `feat: add redis lua lease coordinator`.

### Task 4: Redis factory and shutdown

**Files:**
- Create: `apps/api/src/lease-factory.ts`
- Create: `apps/api/tests/lease-factory.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`

- [x] Write failing factory tests for memory mode, Redis mode, missing URL, and close behavior.
- [x] Implement a Redis client factory using `createClient({ url })`.
- [x] Register shutdown cleanup without changing the existing Store factory.
- [x] Ensure Redis mode cannot silently instantiate the memory coordinator.
- [x] Run focused and full tests.
- [x] Commit with `feat: wire redis lease lifecycle`.

### Task 5: Real Redis smoke and documentation

**Files:**
- Create: `scripts/redis-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/verification-foundation.md`

- [x] Write a smoke script that claims, rejects a competitor, renews, waits for expiry, claims with a larger fencing token, rejects stale release, and releases the current lease.
- [x] Run it against Redis in `infra/docker-compose.yml`.
- [x] Add the command to README and record the acceptance result.
- [x] Run all source checks and `git diff --check`.
- [ ] Commit with `feat: add redis lease smoke verification`.

## Self-review

- Contract, memory behavior, Redis adapter, factory lifecycle, smoke test, and documentation each have a task.
- No Redis fallback is described as production behavior.
- Fencing token parameters are consistent across contract, scripts, tests, and smoke command.
