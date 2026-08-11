import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { RedisLeaseCoordinator } from "../apps/api/src/redis-lease-coordinator.ts";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const client = createClient({ url: redisUrl });
client.on("error", (error) => {
  console.error(`Redis client error: ${error.message}`);
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await client.connect();
const coordinator = new RedisLeaseCoordinator(client, { prefix: "synapse:smoke" });
const key = `lease-${randomUUID()}`;

try {
  const first = await coordinator.claim(key, "owner-a", 0.25);
  assert(first.acquired && first.fencingToken !== null, "owner-a should acquire the lease");

  const competing = await coordinator.claim(key, "owner-b", 0.25);
  assert(!competing.acquired && competing.fencingToken === null, "owner-b should be rejected while owner-a is active");

  const renewed = await coordinator.renew(key, "owner-a", first.fencingToken, 0.25);
  assert(renewed.acquired && renewed.fencingToken === first.fencingToken, "owner-a should renew with its fencing token");

  await sleep(350);
  const takeover = await coordinator.claim(key, "owner-b", 0.25);
  assert(takeover.acquired && takeover.fencingToken > first.fencingToken, "owner-b should take over with a larger fencing token");

  await coordinator.release(key, "owner-a", first.fencingToken);
  const afterStaleRelease = await coordinator.renew(key, "owner-b", takeover.fencingToken, 0.25);
  assert(afterStaleRelease.acquired, "a stale release must not remove the current owner lease");

  await coordinator.release(key, "owner-b", takeover.fencingToken);
  const afterRelease = await coordinator.renew(key, "owner-b", takeover.fencingToken, 0.25);
  assert(!afterRelease.acquired, "the current owner lease should be released");

  console.log(`Redis lease smoke OK: key=${key}, tokens=${first.fencingToken}->${takeover.fencingToken}`);
} finally {
  await client.quit();
}
