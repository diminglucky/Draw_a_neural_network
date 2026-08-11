# PostgreSQL Session Fencing Design

## Goal

Bind the Redis distributed lease to the durable PostgreSQL session record so a stale API instance cannot update a session after another instance has taken over the account lease.

## Decision

Use Redis as the short-lived distributed coordination layer and PostgreSQL as the durable source of truth. Every active session receives a monotonically increasing Redis fencing token. The token is persisted on the session row and every session mutation that can be issued by a user or an API instance is conditioned on that token.

The existing PostgreSQL row lock and partial unique index remain in place. Redis does not replace the database invariant; it reduces cross-instance races and supplies a version that makes delayed writes rejectable.

## Data flow

### Login

1. Authenticate the user and device.
2. Claim `account:{userId}` in Redis with `session.id` as owner.
3. If Redis denies the claim, return `ACCOUNT_ALREADY_IN_USE`.
4. Insert the session with the returned fencing token inside the existing PostgreSQL transaction.
5. If PostgreSQL rejects the claim or fails, release the Redis lease with the same owner and token.

### Heartbeat and authenticated access

1. Load the session from PostgreSQL and check its durable status and expiry.
2. Renew the Redis lease with the persisted owner and fencing token.
3. Update PostgreSQL using `WHERE id = ? AND status = 'active' AND lease_fencing_token = ?`.
4. Treat a failed renew or conditional update as an expired/replaced session. Redis errors propagate as infrastructure failures; they never create a memory fallback.

### Logout and admin revoke

The session row is updated with its fencing token, and the Redis lease is released with owner/token validation. A stale release cannot remove a newer owner lease.

## Schema and contract changes

- Add `lease_fencing_token BIGINT NOT NULL` to `sessions`.
- Add `leaseFencingToken: number` to the domain `Session`.
- Persist and map the token in both stores.
- Keep `FoundationStore.claimActiveSession` as the durable one-active-session transaction.
- Extend session updates with a token-aware conditional path while retaining existing administrative behavior.
- Inject a `LeaseCoordinator` into `SessionService`; default development/test construction uses an in-memory coordinator.

## Failure handling

- Redis claim denied: return the existing account-in-use error.
- PostgreSQL claim denied or throws after Redis claim: release the provisional Redis lease, then return/propagate the database result.
- Redis renew denied: reject the session and do not write a heartbeat.
- Conditional PostgreSQL update affects zero rows: reject the stale session and do not treat it as active.
- Redis connection or script errors are visible to the API error boundary and do not silently switch drivers.

## Verification

- Unit tests cover login claim/release, heartbeat fencing, stale token rejection, and coordinator failures.
- Store tests cover token persistence, parameterized queries, and conditional updates.
- PostgreSQL smoke creates two session attempts for one user and verifies that the first token cannot update after the second token takes over.
- Existing memory, PostgreSQL, route, admin, and client-gate tests remain green.

## Explicit non-goals

This slice does not implement Windows DPAPI, Electron packaging, OpenAI/Agent execution, neural-network IR, Visio automation, billing, or provider quotas.
