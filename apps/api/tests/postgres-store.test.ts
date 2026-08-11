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
      revokedAt: null,
    };

    await expect(store.claimActiveSession("user-1", session, new Date("2026-08-11T00:00:00.000Z"))).resolves.toBe(true);
    expect(calls[0]).toBe("BEGIN");
    expect(calls.some((text) => text.includes("FOR UPDATE"))).toBe(true);
    expect(calls.at(-1)).toBe("COMMIT");
    expect(released).toBe(true);
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
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", revokedAt: null,
    }, new Date("2026-08-11T00:00:00.000Z"))).rejects.toThrow("database unavailable");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });
});
