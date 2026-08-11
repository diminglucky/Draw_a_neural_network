import { createClient } from "redis";
import type { AppConfig } from "./config.js";
import { InMemoryLeaseCoordinator, type LeaseCoordinator } from "./lease-coordinator.js";
import { RedisLeaseCoordinator, type RedisClientLike } from "./redis-lease-coordinator.js";

export interface LeaseCoordinatorHandle {
  coordinator: LeaseCoordinator;
  close(): Promise<void>;
}

export interface LeaseFactoryDependencies {
  createClient?: (url: string) => Promise<RedisClientLike>;
}

async function createRedisClient(url: string): Promise<RedisClientLike> {
  const client = createClient({ url });
  await client.connect();
  return client as unknown as RedisClientLike;
}

export async function createLeaseCoordinator(
  config: AppConfig,
  dependencies: LeaseFactoryDependencies = {},
): Promise<LeaseCoordinatorHandle> {
  if (config.leaseDriver === "memory") {
    return { coordinator: new InMemoryLeaseCoordinator(), close: async () => {} };
  }

  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required when LEASE_DRIVER=redis");
  }

  const client = await (dependencies.createClient ?? createRedisClient)(config.redisUrl);
  const coordinator = new RedisLeaseCoordinator(client);
  return {
    coordinator,
    close: async () => {
      await client.quit();
    },
  };
}
