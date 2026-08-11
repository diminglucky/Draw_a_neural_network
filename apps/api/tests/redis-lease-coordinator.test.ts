import { describe, expect, it } from "vitest";
import { RedisLeaseCoordinator, type RedisClientLike } from "../src/redis-lease-coordinator.js";

function fakeRedis(result: unknown): { client: RedisClientLike; calls: Array<{ script: string; keys: string[]; arguments: string[] }> } {
  const calls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
  const client: RedisClientLike = {
    async eval(script, options) {
      calls.push({ script, keys: options.keys, arguments: options.arguments });
      return result;
    },
    async quit() {},
  };
  return { client, calls };
}

describe("RedisLeaseCoordinator", () => {
  it("claims with a fencing token using namespaced atomic Lua keys", async () => {
    const { client, calls } = fakeRedis([1, "7"]);
    const coordinator = new RedisLeaseCoordinator(client, { prefix: "synapse:test" });

    await expect(coordinator.claim("session:user-1", "owner-1", 30)).resolves.toEqual({ acquired: true, fencingToken: 7 });
    expect(calls[0].keys).toEqual(["synapse:test:session:user-1", "synapse:test:session:user-1:seq"]);
    expect(calls[0].arguments).toEqual(["owner-1", "30000"]);
    expect(calls[0].script).toContain("INCR");
    expect(calls[0].script).toContain("PEXPIRE");
  });

  it("rejects a competing claim and validates owner/token on renew and release", async () => {
    const responses = [[0, 0], [0, 7], 0];
    const calls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    const client: RedisClientLike = {
      async eval(script, options) { calls.push({ script, keys: options.keys, arguments: options.arguments }); return responses.shift(); },
      async quit() {},
    };
    const coordinator = new RedisLeaseCoordinator(client);

    await expect(coordinator.claim("k", "owner-a", 10)).resolves.toEqual({ acquired: false, fencingToken: null });
    await expect(coordinator.renew("k", "owner-a", 5, 10)).resolves.toEqual({ acquired: false, fencingToken: null });
    await expect(coordinator.release("k", "owner-a", 5)).resolves.toBeUndefined();
    expect(calls[1].script).toContain("HGET");
    expect(calls[2].script).toContain("DEL");
  });

  it("propagates Redis failures instead of claiming from memory", async () => {
    const client: RedisClientLike = {
      async eval() { throw new Error("Redis unavailable"); },
      async quit() {},
    };
    const coordinator = new RedisLeaseCoordinator(client);

    await expect(coordinator.claim("k", "owner-a", 10)).rejects.toThrow("Redis unavailable");
  });
});
