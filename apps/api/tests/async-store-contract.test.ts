import { describe, expect, it } from "vitest";
import { InMemoryFoundationStore } from "../src/store.js";

describe("foundation store async contract", () => {
  it("returns promises for durable-store-compatible writes", async () => {
    const store = new InMemoryFoundationStore();
    await expect(store.createUser({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "hash",
      status: "active",
      roles: ["user"],
      createdAt: "2026-08-11T00:00:00.000Z",
      lastLoginAt: null,
    })).resolves.toMatchObject({ id: "user-1" });
  });
});
