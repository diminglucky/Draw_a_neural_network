import { describe, expect, it } from "vitest";
import type { Session } from "../src/domain.js";
import { PostgresFoundationStore, type PoolLike, type QueryResult } from "../src/postgres-store.js";

const userRow = {
  id: "user-1",
  email: "user@example.com",
  password_hash: "argon-hash",
  status: "active",
  roles: ["user"],
  created_at: "2026-08-11T00:00:00.000Z",
  last_login_at: null,
};

function fakePool(result: QueryResult = { rows: [userRow], rowCount: 1 }) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: PoolLike = {
    async query(text, values = []) {
      calls.push({ text, values });
      return result;
    },
    async connect() {
      return {
        query: async (text: string, values: readonly unknown[] = []) => {
          calls.push({ text, values });
          return result;
        },
        release() {},
      };
    },
    async end() {},
  };
  return { pool, calls };
}

describe("PostgresFoundationStore", () => {
  it("maps a user row and uses parameterized SQL for writes", async () => {
    const { pool, calls } = fakePool();
    const store = new PostgresFoundationStore(pool);

    const user = await store.createUser({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "argon-hash",
      status: "active",
      roles: ["user"],
      createdAt: "2026-08-11T00:00:00.000Z",
      lastLoginAt: null,
    });

    expect(user).toMatchObject({ id: "user-1", email: "user@example.com", passwordHash: "argon-hash", roles: ["user"] });
    expect(calls[0].text).toContain("INSERT INTO users");
    expect(calls[0].text).toContain("$1");
    expect(calls[0].text).not.toContain("user@example.com");
    expect(calls[0].values).toContain("user@example.com");
  });

  it("returns null for a missing user and maps nullable timestamps", async () => {
    const { pool } = fakePool({ rows: [], rowCount: 0 });
    const store = new PostgresFoundationStore(pool);

    await expect(store.findUserByEmail("missing@example.com")).resolves.toBeNull();
  });

  it("writes the required created_at field for subscriptions", async () => {
    const { pool, calls } = fakePool({
      rows: [{ id: "sub-1", user_id: "user-1", plan_id: "trial", status: "trialing", starts_at: "2026-08-11T00:00:00.000Z", ends_at: null }],
      rowCount: 1,
    });
    const store = new PostgresFoundationStore(pool);
    await store.createSubscription({
      id: "sub-1", userId: "user-1", plan: "trial", status: "trialing",
      startsAt: "2026-08-11T00:00:00.000Z", endsAt: null, features: ["foundation"], limits: { foundationJobsPerMonth: 10 },
    });

    expect(calls[0].text).toContain("created_at");
    expect(calls[0].text).toContain("NOW()");
  });

  it("persists and atomically consumes device challenges", async () => {
    const challengeRow = {
      id: "challenge-1", user_id: "user-1", device_id: "device-1", challenge: "opaque-challenge",
      expires_at: "2026-08-11T00:02:00.000Z", consumed_at: "2026-08-11T00:01:00.000Z", created_at: "2026-08-11T00:00:00.000Z",
    };
    const { pool, calls } = fakePool({ rows: [challengeRow], rowCount: 1 });
    const store = new PostgresFoundationStore(pool);
    await expect(store.createDeviceChallenge({
      id: "challenge-1", userId: "user-1", deviceId: "device-1", value: "opaque-challenge",
      expiresAt: "2026-08-11T00:02:00.000Z", consumedAt: null, createdAt: "2026-08-11T00:00:00.000Z",
    })).resolves.toMatchObject({ value: "opaque-challenge" });
    await expect(store.consumeDeviceChallenge("challenge-1", new Date("2026-08-11T00:01:00.000Z"))).resolves.toMatchObject({ id: "challenge-1" });
    expect(calls[0].text).toContain("INSERT INTO device_challenges");
    expect(calls[1].text).toContain("consumed_at IS NULL");
    expect(calls[1].text).toContain("expires_at > $2");
  });

  it("claims an active session inside a transaction with a user row lock", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("SELECT id FROM users")) return { rows: [{ id: "user-1" }], rowCount: 1 };
        if (text.includes("FROM sessions")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
    };
    const store = new PostgresFoundationStore(pool);
    const session: Session = {
      id: "session-1",
      userId: "user-1",
      deviceId: "device-1",
      status: "active",
      accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
      leaseExpiresAt: "2026-08-11T00:01:00.000Z",
      leaseFencingToken: 1,
      revokedAt: null,
    };

    await expect(store.claimActiveSession("user-1", session, new Date("2026-08-11T00:00:00.000Z"))).resolves.toBe(true);
    expect(calls[0]).toBe("BEGIN");
    expect(calls.some((text) => text.includes("FOR UPDATE"))).toBe(true);
    expect(calls.at(-1)).toBe("COMMIT");
    expect(released).toBe(true);
  });

  it("writes the fencing token and rejects a conditional update when no token-matching row exists", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool: PoolLike = {
      async query(text, values = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return { async query(text, values = []) { calls.push({ text, values }); return { rows: [], rowCount: 0 }; }, release() {} };
      },
    };
    const store = new PostgresFoundationStore(pool);
    const session: Session = {
      id: "session-1", userId: "user-1", deviceId: "device-1", status: "active", accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", leaseFencingToken: 7, revokedAt: null,
    };

    await expect(store.updateSession(session, 7)).resolves.toBeNull();
    expect(calls[0].text).toContain("lease_fencing_token");
    expect(calls[0].text).toContain("status = 'active'");
    expect(calls[0].values).toContain(7);
  });

  it("rolls back and releases the client when session insertion fails", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("INSERT INTO sessions")) throw Object.assign(new Error("database unavailable"), { code: "XX000" });
        if (text.includes("SELECT id FROM users")) return { rows: [{ id: "user-1" }], rowCount: 1 };
        if (text.includes("FROM sessions")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.claimActiveSession("user-1", {
      id: "session-1", userId: "user-1", deviceId: "device-1", status: "active", accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", leaseFencingToken: 1, revokedAt: null,
    }, new Date("2026-08-11T00:00:00.000Z"))).rejects.toThrow("database unavailable");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });

  it("reserves agent usage inside a locked transaction and inserts a ledger row", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    let released = false;
    const periodRow = {
      user_id: "user-1",
      metric: "agentChatRequests",
      period_start: "2026-08-01T00:00:00.000Z",
      limit_snapshot: 2,
      consumed: 0,
      updated_at: "2026-08-11T00:00:00.000Z",
    };
    const reservationRow = {
      id: "usage-1",
      user_id: "user-1",
      metric: "agentChatRequests",
      period_start: "2026-08-01T00:00:00.000Z",
      idempotency_key: "req-1",
      request_hash: "hash-1",
      amount: 1,
      limit_snapshot: 2,
      consumed: 1,
      state: "accepted",
      outcome: null,
      provider: null,
      error_code: null,
      created_at: "2026-08-11T00:00:00.000Z",
      finalized_at: null,
    };
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (text.includes("FROM agent_usage_periods") && text.includes("FOR UPDATE")) return { rows: [periodRow], rowCount: 1 };
        if (text.includes("FROM agent_usage_ledger")) return { rows: [], rowCount: 0 };
        if (text.includes("UPDATE agent_usage_periods")) return { rows: [{ ...periodRow, consumed: 1 }], rowCount: 1 };
        if (text.includes("INSERT INTO agent_usage_ledger")) return { rows: [reservationRow], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.reserveAgentUsage({
      userId: "user-1",
      metric: "agentChatRequests",
      periodStart: "2026-08-01T00:00:00.000Z",
      idempotencyKey: "req-1",
      requestHash: "hash-1",
      amount: 1,
      limit: 2,
    })).resolves.toMatchObject({ id: "usage-1", consumed: 1, remaining: 1, state: "accepted" });

    expect(calls[0].text).toBe("BEGIN");
    expect(calls.some((call) => call.text.includes("FROM agent_usage_periods") && call.text.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some((call) => call.text.includes("consumed + $"))).toBe(true);
    expect(calls.some((call) => call.text.includes("FROM agent_usage_ledger"))).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");
    expect(released).toBe(true);
  });

  it("rolls back an agent usage reservation when the monthly quota is exhausted", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("FROM agent_usage_periods") && text.includes("FOR UPDATE")) {
          return {
            rows: [{ user_id: "user-1", metric: "agentChatRequests", period_start: "2026-08-01T00:00:00.000Z", limit_snapshot: 1, consumed: 1, updated_at: "2026-08-11T00:00:00.000Z" }],
            rowCount: 1,
          };
        }
        if (text.includes("UPDATE agent_usage_periods")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.reserveAgentUsage({
      userId: "user-1",
      metric: "agentChatRequests",
      periodStart: "2026-08-01T00:00:00.000Z",
      idempotencyKey: "req-2",
      requestHash: "hash-2",
      amount: 1,
      limit: 1,
    })).resolves.toBeNull();

    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });

  it("finalizes only an accepted agent usage ledger row", async () => {
    const { pool, calls } = fakePool({
      rows: [{
        id: "usage-1", user_id: "user-1", metric: "agentChatRequests", period_start: "2026-08-01T00:00:00.000Z",
        idempotency_key: "req-1", request_hash: "hash-1", amount: 1, limit_snapshot: 2, consumed: 1,
        state: "failed", outcome: "provider_error", provider: "local-deterministic", error_code: "AGENT_PROVIDER_FAILED",
        created_at: "2026-08-11T00:00:00.000Z", finalized_at: "2026-08-11T00:01:00.000Z",
      }],
      rowCount: 1,
    });
    const store = new PostgresFoundationStore(pool);

    await expect(store.finalizeAgentUsage({ id: "usage-1", state: "failed", outcome: "provider_error", provider: "local-deterministic", errorCode: "AGENT_PROVIDER_FAILED" })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
    expect(calls[0].text).toContain("UPDATE agent_usage_ledger");
    expect(calls[0].text).toContain("state = 'accepted'");
  });
});
