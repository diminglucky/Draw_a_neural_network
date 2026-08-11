import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createLeaseCoordinator } from "../src/lease-factory.js";
import { InMemoryLeaseCoordinator } from "../src/lease-coordinator.js";
import { RedisLeaseCoordinator, type RedisClientLike } from "../src/redis-lease-coordinator.js";

function config(leaseDriver: "memory" | "redis", redisUrl?: string) {
  return loadConfig({ NODE_ENV: "test", STORAGE_DRIVER: "memory", SESSION_SECRET: "test-session-secret-test-session-secret", LEASE_DRIVER: leaseDriver, REDIS_URL: redisUrl });
}

describe("lease factory", () => {
  it("uses the in-memory coordinator for memory mode", async () => {
    const handle = await createLeaseCoordinator(config("memory"));
    expect(handle.coordinator).toBeInstanceOf(InMemoryLeaseCoordinator);
    await handle.close();
  });

  it("connects a Redis client and closes it in Redis mode", async () => {
    let connected = false;
    let quit = false;
    const client: RedisClientLike = {
      async eval() { return [0, 0]; },
      async quit() { quit = true; },
    };
    const handle = await createLeaseCoordinator(config("redis", "redis://127.0.0.1:6379"), {
      async createClient(url) { connected = url === "redis://127.0.0.1:6379"; return client; },
    });
    expect(connected).toBe(true);
    expect(handle.coordinator).toBeInstanceOf(RedisLeaseCoordinator);
    await handle.close();
    expect(quit).toBe(true);
  });
});
