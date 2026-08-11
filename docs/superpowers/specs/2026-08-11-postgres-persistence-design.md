# PostgreSQL Persistence and Lease Boundary Design

## Purpose

The commercial foundation currently uses `InMemoryFoundationStore` for development. That implementation proves the domain behavior but loses users, devices, sessions, subscriptions, jobs, and audit records whenever the API restarts. This phase adds a real PostgreSQL store without changing the public domain objects and adds a lease-coordination boundary that can later be backed by Redis.

This phase does not implement OpenAI, Visio, billing webhooks, or Windows DPAPI. It also does not silently select the memory store when `STORAGE_DRIVER=postgres`.

## Recommended approach

Use one asynchronous `FoundationStore` contract for both stores. The in-memory implementation becomes an async test double, while `PostgresFoundationStore` uses `pg.Pool` and parameterized SQL. Services and routes await the contract uniformly, so switching storage does not create a second behavior path.

The active-session claim is a single PostgreSQL transaction:

1. lock the user row with `SELECT ... FOR UPDATE`;
2. find an active session for that user;
3. if its lease is still live, reject the claim;
4. if its lease is expired, mark it `expired`;
5. insert the new active session;
6. commit.

The partial unique index remains the database backstop for races from other processes. A unique-violation result is translated into `false`, not exposed as an internal error.

## Store boundary

`FoundationStore` methods return `Promise<T>` or `Promise<T | null>`. The existing domain types remain plain serializable objects. PostgreSQL row mapping is isolated inside `postgres-store.ts`; JSONB columns map to `roles`, `features`, `limits`, `input`, `output`, `metadata`, and entitlement values.

The store owns a pool-like dependency with `query` and `connect` methods. This permits deterministic SQL/transaction unit tests without requiring Docker, while the Docker Compose PostgreSQL service provides an optional real integration target.

## Lease boundary

Introduce:

```ts
interface LeaseCoordinator {
  claim(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  renew(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, value: string): Promise<void>;
}
```

The default development implementation is `InMemoryLeaseCoordinator`. The PostgreSQL store remains the source of truth for the session row and unique active-session rule. The coordinator is an extension point for Redis fencing/lease behavior; no fake Redis production claim is made in this phase.

## Startup behavior

`buildDefaultApp()` selects `InMemoryFoundationStore` only for `development` and `test` with `STORAGE_DRIVER=memory`. For `STORAGE_DRIVER=postgres`, it creates a PostgreSQL pool from `DATABASE_URL` and closes it when the Fastify process shuts down. If the driver is PostgreSQL but the dependency or URL is unavailable, startup fails with an explicit configuration error.

## Error and transaction behavior

- Database unique violations on email, access token id, or active-session claim are translated to domain-safe results/errors.
- Database connectivity errors are not converted into successful fallback behavior.
- Session claim, expiry marking, and insertion are atomic.
- Password hashes and access tokens are never logged.
- Store tests assert parameterized queries and transaction release/rollback behavior.

## Verification acceptance

- Existing service and route tests pass after async migration.
- PostgreSQL store tests cover row mapping, parameterized writes, not-found reads, and rollback.
- Session concurrency tests demonstrate that two simultaneous claims result in one active session.
- With Docker PostgreSQL running, a real migration/store smoke test can register a user, restart the store, and read the same user back.
- Production configuration with `STORAGE_DRIVER=postgres` no longer falls back to memory.
