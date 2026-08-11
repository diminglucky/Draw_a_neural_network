import { describe, expect, it } from "vitest";
import { InMemoryFoundationStore } from "../src/store.js";
import type { DeviceChallenge } from "../src/domain.js";

function challenge(overrides: Partial<DeviceChallenge> = {}): DeviceChallenge {
  return {
    id: "challenge-1",
    userId: "user-1",
    deviceId: "device-1",
    value: "opaque-random-challenge",
    expiresAt: "2026-08-11T00:02:00.000Z",
    consumedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("device challenge store", () => {
  it("consumes a valid challenge once and rejects replay", async () => {
    const store = new InMemoryFoundationStore();
    await store.createDeviceChallenge(challenge());

    await expect(store.consumeDeviceChallenge("challenge-1", new Date("2026-08-11T00:01:00.000Z"))).resolves.toMatchObject({ id: "challenge-1" });
    await expect(store.consumeDeviceChallenge("challenge-1", new Date("2026-08-11T00:01:01.000Z"))).resolves.toBeNull();
  });

  it("rejects an expired challenge without marking it consumed", async () => {
    const store = new InMemoryFoundationStore();
    await store.createDeviceChallenge(challenge({ expiresAt: "2026-08-11T00:00:30.000Z" }));

    await expect(store.consumeDeviceChallenge("challenge-1", new Date("2026-08-11T00:01:00.000Z"))).resolves.toBeNull();
    await expect(store.getDeviceChallenge("challenge-1")).resolves.toMatchObject({ consumedAt: null });
  });
});
