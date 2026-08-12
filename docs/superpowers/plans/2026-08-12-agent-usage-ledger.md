# Agent Usage Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostgreSQL-backed, auditable, idempotent monthly Agent request quota without treating an in-memory counter or Redis key as the production source of truth.

**Architecture:** The API reserves one `agentChatRequests` unit inside a PostgreSQL transaction that locks a monthly aggregate row and inserts an immutable usage-ledger row. The request carries a bounded `Idempotency-Key`; the same user/key/request hash cannot consume quota or invoke the provider twice. The existing in-memory store implements the same contract for tests and development. Provider outcome is finalized separately as `completed`, `failed`, or `unknown`, while raw messages and attachments remain out of the usage tables and audit metadata.

**Tech Stack:** Node.js ESM, Fastify, TypeScript, Vitest, PostgreSQL JSONB/TIMESTAMPTZ, existing `FoundationStore` abstraction, vanilla browser JavaScript.

## Global Constraints

- PostgreSQL is the durable usage source of truth; Redis is not used for quota correctness.
- Quota metric is `agentChatRequests`, measured in UTC calendar months.
- Trial subscriptions expose `agentChatsPerMonth: 10` in addition to the existing foundation job limit.
- A provider attempt consumes quota even when the provider later fails; the ledger records the outcome separately.
- Usage and audit records must never contain message text, attachment names/content, base64, images, or provider raw responses.
- `Idempotency-Key` is required for `/api/agent/chat`, limited to 128 safe ASCII characters, and bound to a SHA-256 request hash.
- No token pricing, provider billing, asynchronous worker, webhook, or response-replay subsystem is part of this slice.
- Do not commit or push; preserve all unrelated existing worktree changes.

---

### Task 1: Domain and Store usage contract

**Files:**

- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Test: `apps/api/tests/usage-store.test.ts`

**Interfaces:**

- `FoundationStore.reserveAgentUsage(input): Promise<AgentUsageReservation | AgentUsageDuplicate | null>` atomically reserves a unit or returns `null` when the monthly limit is exhausted.
- `FoundationStore.finalizeAgentUsage(input): Promise<AgentUsageReservation | null>` records the terminal/request outcome once.
- `AgentUsageReservation` contains `id`, `userId`, `metric`, `periodStart`, `idempotencyKey`, `requestHash`, `amount`, `limit`, `consumed`, `remaining`, `state`, `outcome`, `provider`, `errorCode`, `createdAt`, and `finalizedAt`.
- `AgentUsageDuplicate` contains the existing reservation and a `requestHashMatches` boolean.

- [ ] **Step 1: Write the failing in-memory contract tests.**

```ts
it("reserves one monthly agent request and rejects the next request at the limit", async () => {
  const store = new InMemoryFoundationStore();
  const base = { userId: "user-1", metric: "agentChatRequests", periodStart: "2026-08-01T00:00:00.000Z", idempotencyKey: "req-1", requestHash: "hash-1", amount: 1, limit: 1 };

  await expect(store.reserveAgentUsage(base)).resolves.toMatchObject({ consumed: 1, remaining: 0, state: "accepted" });
  await expect(store.reserveAgentUsage({ ...base, idempotencyKey: "req-2", requestHash: "hash-2" })).resolves.toBeNull();
});

it("does not consume twice for a repeated idempotency key", async () => {
  const store = new InMemoryFoundationStore();
  const input = { userId: "user-1", metric: "agentChatRequests", periodStart: "2026-08-01T00:00:00.000Z", idempotencyKey: "req-1", requestHash: "hash-1", amount: 1, limit: 2 };

  const first = await store.reserveAgentUsage(input);
  const duplicate = await store.reserveAgentUsage(input);

  expect(first).toMatchObject({ consumed: 1 });
  expect(duplicate).toMatchObject({ duplicate: true, requestHashMatches: true, reservation: { consumed: 1 } });
});

it("finalizes a reservation once without changing the consumed quota", async () => {
  const store = new InMemoryFoundationStore();
  const reservation = await store.reserveAgentUsage({ userId: "user-1", metric: "agentChatRequests", periodStart: "2026-08-01T00:00:00.000Z", idempotencyKey: "req-1", requestHash: "hash-1", amount: 1, limit: 2 });

  await expect(store.finalizeAgentUsage({ id: reservation!.id, state: "failed", outcome: "provider_error", provider: "local-deterministic", errorCode: "AGENT_PROVIDER_FAILED" })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
  await expect(store.finalizeAgentUsage({ id: reservation!.id, state: "completed", outcome: "completed" })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
});
```

- [ ] **Step 2: Run the focused test to verify it fails for the missing contract.**

Run: `npx vitest run apps/api/tests/usage-store.test.ts`

Expected: FAIL because `reserveAgentUsage` and `finalizeAgentUsage` do not exist yet.

- [ ] **Step 3: Add the domain types and Store methods.**

Add `AgentUsageState = "accepted" | "completed" | "failed" | "unknown"`, `AgentUsageReservation`, and `AgentUsageDuplicate` to `domain.ts`. Add both methods to `FoundationStore`. In `InMemoryFoundationStore`, keep a `Map` keyed by `userId + metric + periodStart` for aggregates and a second `Map` keyed by `userId + idempotencyKey` for ledger rows. Perform all map checks and updates before the first `await` so the single-process implementation cannot interleave a reservation.

- [ ] **Step 4: Run the focused tests to verify the in-memory implementation passes.**

Run: `npx vitest run apps/api/tests/usage-store.test.ts`

Expected: 3 tests pass.

### Task 2: PostgreSQL migration and atomic Store implementation

**Files:**

- Create: `apps/api/sql/004_agent_usage_ledger.sql`
- Modify: `apps/api/src/postgres-store.ts`
- Test: `apps/api/tests/postgres-store.test.ts`

**Interfaces:**

- PostgreSQL implements the exact `FoundationStore` methods from Task 1.
- Reservation transaction order is `BEGIN` → insert period if missing → lock period row → check existing idempotency row → conditional aggregate update → ledger insert → `COMMIT`; every thrown error executes `ROLLBACK` and releases the client.

- [ ] **Step 1: Write failing PostgreSQL SQL-contract tests.**

Assert that `reserveAgentUsage` uses a transaction, `FOR UPDATE`, parameterized values, a unique idempotency lookup, and a conditional `consumed + amount <= limit_snapshot` update. Assert that quota exhaustion rolls back and returns `null`. Add a finalization test asserting only an `accepted` ledger row can transition to a terminal state.

- [ ] **Step 2: Run the focused PostgreSQL tests to verify they fail.**

Run: `npx vitest run apps/api/tests/postgres-store.test.ts`

Expected: FAIL because the Store methods and migration do not exist.

- [ ] **Step 3: Add migration `004_agent_usage_ledger.sql`.**

Create `agent_usage_periods` with a composite primary key `(user_id, metric, period_start)`, a non-negative `consumed` check, a positive `limit_snapshot` check, and an update timestamp. Create `agent_usage_ledger` with an API id, foreign key to users, the idempotency key/hash, amount, state/outcome, provider/error fields, timestamps, and a unique `(user_id, idempotency_key)` constraint. Add indexes for `(user_id, period_start)` and `(state, created_at)`.

- [ ] **Step 4: Implement the transaction and finalization methods.**

Use `PoolLike.connect()`, parameterized SQL, and explicit rollback/release. Return an `AgentUsageDuplicate` for an existing key instead of changing its consumed value. Return `null` only for an exhausted quota. `finalizeAgentUsage` updates state/outcome/provider/error only where `state = 'accepted'`, then maps the returned row.

- [ ] **Step 5: Run the focused PostgreSQL tests.**

Run: `npx vitest run apps/api/tests/postgres-store.test.ts apps/api/tests/usage-store.test.ts`

Expected: all focused Store tests pass.

### Task 3: Error codes, request hashing, and quota reservation service boundary

**Files:**

- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/routes.ts`
- Test: `apps/api/tests/agent-routes.test.ts`

**Interfaces:**

- Add `AGENT_QUOTA_EXCEEDED` with HTTP 429 and `AGENT_IDEMPOTENCY_KEY_REUSED` with HTTP 409.
- Read `Idempotency-Key` from the request headers and validate it before the provider call.
- Build the request hash from a canonical object containing message, conversation id, attachment kind, MIME type, and attachment data; persist only the SHA-256 digest.
- Derive `periodStart` as the first day of the current UTC month.

- [ ] **Step 1: Add failing route tests.**

Add tests that assert the request requires the header, an exhausted subscription returns 429 without calling the provider, the same key is not charged twice, and reusing a key with a different request hash returns 409.

- [ ] **Step 2: Run the focused route tests to verify they fail.**

Run: `npx vitest run apps/api/tests/agent-routes.test.ts`

Expected: FAIL because the route currently accepts no idempotency key and performs no usage reservation.

- [ ] **Step 3: Implement validation and reservation wiring.**

Add bounded header validation, canonical SHA-256 hashing, UTC period calculation, subscription-required handling, and `reserveAgentUsage` invocation before `agent.chat.requested`. On `null`, write `agent.chat.rejected` with safe quota metadata and throw `AGENT_QUOTA_EXCEEDED`. On a duplicate, write a safe rejection audit and throw `AGENT_IDEMPOTENCY_KEY_REUSED` without invoking the provider.

- [ ] **Step 4: Run the route tests.**

Run: `npx vitest run apps/api/tests/agent-routes.test.ts`

Expected: all existing and new route tests pass.

### Task 4: Provider outcome finalization and client idempotency header

**Files:**

- Modify: `apps/api/src/routes.ts`
- Modify: `chat-agent.js`
- Test: `apps/client/chat-agent.test.js`
- Test: `apps/api/tests/agent-routes.test.ts`

**Interfaces:**

- Every accepted request calls `finalizeAgentUsage` exactly once with `completed` or `failed`; unexpected process termination remains represented by the accepted ledger row.
- The browser generates one idempotency key per send attempt and reuses it if the same fetch is retried.

- [ ] **Step 1: Add failing finalization and client payload tests.**

Assert that successful provider calls finalize as `completed`, provider failures finalize as `failed`, failed requests still consume one quota unit, and the client fetch includes `Idempotency-Key` without exposing any provider credential.

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run: `npx vitest run apps/api/tests/agent-routes.test.ts apps/client/chat-agent.test.js`

Expected: FAIL because the route does not finalize usage and the client does not send the header.

- [ ] **Step 3: Implement finalization and client header generation.**

Wrap the provider call in a flow that finalizes the accepted reservation once, preserves the original provider error, and keeps audit metadata redacted. Add a small client-side key generator using `crypto.randomUUID()` when available, with a non-secret fallback for browser tests.

- [ ] **Step 4: Run the focused tests.**

Run: `npx vitest run apps/api/tests/agent-routes.test.ts apps/client/chat-agent.test.js`

Expected: all focused tests pass.

### Task 5: Subscription defaults, documentation, and verification

**Files:**

- Modify: `apps/api/src/session-service.ts`
- Modify: `apps/api/sql/001_foundation.sql`
- Modify: `README.md`
- Test: `apps/api/tests/session-service.test.ts`
- Test: `apps/api/tests/production-boundary.test.ts`

- [ ] **Step 1: Add failing subscription-limit assertions.**

Assert that newly registered trial users receive `agentChatsPerMonth: 10` and that the SQL seed contains the same limit.

- [ ] **Step 2: Run the focused tests to verify the expected failure.**

Run: `npx vitest run apps/api/tests/session-service.test.ts apps/api/tests/production-boundary.test.ts`

Expected: FAIL because the trial limits currently contain only `foundationJobsPerMonth`.

- [ ] **Step 3: Update the trial limits and documentation.**

Add the Agent limit to the service-created subscription and SQL seed. Document the durable source of truth, UTC period semantics, idempotency behavior, and the explicit boundary that token/cost accounting is not yet implemented.

- [ ] **Step 4: Run the full verification suite.**

Run:

```powershell
npm run api:test
npx tsc --noEmit
node --test publication-layout.test.js
node --check chat-agent.js
node --check publication-layout.js
node --check app.js
npm run api:check
git diff --check
```

Expected: all tests and checks exit successfully; only normal Windows LF/CRLF warnings may appear from Git.

- [ ] **Step 5: Run the local HTTP smoke with an `Idempotency-Key`.**

Register, log in, call `/api/agent/chat` with a fixed key, verify the deterministic diagram remains valid, resend the same key and verify the provider is not called a second time, then stop the test API process. Do not claim PostgreSQL durable acceptance unless Docker/PostgreSQL is actually running; the local smoke proves only the in-memory contract.

## Review and handoff

The implementation is not committed or pushed in this worktree. Report focused tests, full tests, local smoke, PostgreSQL/Docker acceptance, Electron acceptance, Visio acceptance, and external OpenAI acceptance as separate gates.
