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
});
