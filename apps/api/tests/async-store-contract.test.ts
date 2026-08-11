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

  it("does not allow a stale fencing token to update a session", async () => {
    const store = new InMemoryFoundationStore();
    const session = {
      id: "session-1", userId: "user-1", deviceId: "device-1", status: "active" as const, accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", leaseFencingToken: 2, revokedAt: null,
    };
    await expect(store.claimActiveSession("user-1", session, new Date("2026-08-11T00:00:00.000Z"))).resolves.toBe(true);
    await expect(store.updateSession({ ...session, status: "logged_out" }, 1)).resolves.toBeNull();
    await expect(store.updateSession({ ...session, status: "expired" }, 2)).resolves.toMatchObject({ status: "expired" });
    await expect(store.updateSession({ ...session, status: "active" }, 2)).resolves.toBeNull();
  });
});
