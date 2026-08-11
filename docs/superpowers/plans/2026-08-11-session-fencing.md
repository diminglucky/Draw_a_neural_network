# PostgreSQL Session Fencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind Redis fencing tokens to PostgreSQL-backed sessions so delayed or stale API writes cannot revive or mutate a replaced session.

**Architecture:** Keep PostgreSQL as the durable session source of truth and its row lock/partial unique index as the one-active-session invariant. Redis provides a short-lived account lease and monotonically increasing fencing token; SessionService renews Redis before conditional PostgreSQL session writes.

**Tech Stack:** TypeScript/NodeNext, Fastify, PostgreSQL 16, Redis 7, Vitest, Docker Compose.

## Global Constraints

- Redis errors must propagate and must never instantiate the memory coordinator as a fallback.
- PostgreSQL remains the durable session source of truth and database invariant.
- Every new behavior starts with a failing test.
- Existing API error codes and route shapes remain backward compatible except for the internal session token field.
- Do not implement Electron, OpenAI, Visio, billing, or neural-network IR in this slice.

---

### Task 1: Session token contract and migration

**Files:**
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/sql/001_foundation.sql`
- Test: `apps/api/tests/domain.test.ts`

- [x] Add a failing assertion that a session carries a positive `leaseFencingToken`.
- [x] Run `npm run api:test -- apps/api/tests/domain.test.ts` and observe the contract failure.
- [x] Add `leaseFencingToken: number` to `Session` and add `lease_fencing_token BIGINT NOT NULL` to the schema.
- [x] Run the focused test and `npx tsc --noEmit`.
- [x] Commit `feat: persist session fencing tokens`.

### Task 2: Store persistence and conditional updates

**Files:**
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Modify: `apps/api/tests/postgres-store.test.ts`
- Modify: `apps/api/tests/async-store-contract.test.ts`
- Modify: `apps/api/tests/session-service.test.ts` fixtures

- [x] Add failing tests that map the token, insert it during claim, and require it in conditional session updates.
- [x] Run the focused store tests and confirm failure because SQL and memory contracts do not yet include the token.
- [x] Update both stores and all test fixtures; make `updateSession(session, fencingToken?)` conditionally update active rows when a token is supplied.
- [x] Run all store/session tests and the TypeScript check.
- [x] Commit `feat: fence session store writes`.

### Task 3: SessionService distributed lease integration

**Files:**
- Modify: `apps/api/src/session-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/tests/session-service.test.ts`
- Create or modify: `apps/api/tests/session-fencing.test.ts`

- [x] Add failing tests with a fake LeaseCoordinator for login claim, provisional release, heartbeat renew, stale renew rejection, and stale token rejection.
- [x] Run the focused tests and confirm failure because SessionService does not call the coordinator.
- [x] Inject a coordinator into SessionService, claim Redis before durable session insertion, release on failed insertion, renew before heartbeat/access, and release on logout/revoke.
- [x] Convert failed renew or zero-row token updates into `SESSION_EXPIRED`; preserve infrastructure errors.
- [x] Pass the factory-created coordinator from `buildDefaultApp` into `buildApp` and keep test/default construction on memory leases.
- [x] Run full tests and TypeScript checking.
- [x] Commit `feat: bind redis fencing to sessions`.

### Task 4: PostgreSQL takeover smoke

**Files:**
- Modify: `scripts/postgres-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/verification-foundation.md`

- [x] Extend the smoke with two active-session attempts using distinct fencing tokens and verify token-1 cannot update the token-2 session.
- [x] Run `npm run api:smoke:postgres` against the Docker PostgreSQL service.
- [x] Record the accepted behavior in README and the verification plan.
- [x] Run `npm run api:test`, `npm run api:check`, `npx tsc --noEmit`, all syntax checks, and `git diff --check`.
- [x] Commit `test: verify postgres session fencing`.

## Self-review

- Redis coordination, durable token storage, conditional writes, service orchestration, and real PostgreSQL acceptance are separate tasks.
- PostgreSQL remains authoritative if Redis and database state disagree.
- The plan does not claim that the client is secure against machine compromise; Windows DPAPI remains a later phase.
