# Redis Lease and Fencing Design

## Purpose

The foundation currently has PostgreSQL as the durable session source of truth and an in-memory lease coordinator for tests. This phase adds a real Redis lease coordinator for multi-process API deployments. Redis will coordinate short-lived ownership; PostgreSQL remains the durable session record and partial unique index backstop.

## Contract

```ts
interface LeaseResult {
  acquired: boolean;
  fencingToken: number | null;
}

interface LeaseCoordinator {
  claim(key: string, owner: string, ttlSeconds: number): Promise<LeaseResult>;
  renew(key: string, owner: string, fencingToken: number, ttlSeconds: number): Promise<LeaseResult>;
  release(key: string, owner: string, fencingToken: number): Promise<void>;
}
```

The fencing token is monotonically increasing per logical lease key. A new claim after expiry receives a larger token. Downstream workers can reject commands carrying an older token, preventing a delayed process from acting after its lease has expired.

## Redis data model

For logical key `session:user-1` and prefix `synapse:lease`:

```text
synapse:lease:session:user-1       HASH owner/token, volatile TTL
synapse:lease:session:user-1:seq   STRING counter, persistent during normal operation
```

The sequence key is kept after the lease expires so fencing tokens do not move backward. The lease hash has the TTL. All ownership checks and updates happen inside Lua scripts so a check cannot race with expiry or another process.

## Atomic operations

- Claim: if the lease hash exists, return `{ acquired: false }`; otherwise increment the sequence, write owner/token, set PX TTL, and return the new token.
- Renew: verify owner and token, refresh PX TTL, and return the same token; otherwise return `{ acquired: false }`.
- Release: verify owner and token, delete the lease hash; stale owners cannot release a newer lease.

Redis connection errors are propagated as infrastructure errors. There is no fallback to `InMemoryLeaseCoordinator` when Redis is configured.

## Runtime boundary

Add the official `redis` Node client behind a small `RedisClientLike` interface. The adapter receives an already-connected client so unit tests can assert scripts and arguments without a Redis server. A factory creates and connects the client from `REDIS_URL`, and the API startup closes it on shutdown when `LEASE_DRIVER=redis`.

`LEASE_DRIVER=memory` remains the default for development/tests. `LEASE_DRIVER=redis` requires `REDIS_URL`. Redis lease coordination is optional in the current API service until session-service wiring is explicitly enabled; the adapter itself is production-capable and independently verified.

## Acceptance

- Unit tests prove all Lua scripts use namespaced keys and owner/token checks.
- In-memory tests prove fencing tokens increase after expiry.
- Redis container smoke proves claim, competing claim rejection, renew, expiry takeover with a larger token, stale release rejection, and final release.
- A Redis outage produces an explicit connection error, never a successful in-memory claim.
