import { describe, expect, it } from "vitest";
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
});
