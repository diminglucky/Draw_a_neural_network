import { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { PostgresFoundationStore, type PoolLike } from "./postgres-store.js";
import { InMemoryFoundationStore } from "./store.js";
import type { FoundationStore } from "./store.js";

export interface FoundationStoreHandle {
  store: FoundationStore;
  close(): Promise<void>;
}

export async function createFoundationStore(config: AppConfig): Promise<FoundationStoreHandle> {
  if (config.storageDriver === "memory") {
    return { store: new InMemoryFoundationStore(), close: async () => {} };
  }
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  const store = new PostgresFoundationStore(pool as unknown as PoolLike);
  return { store, close: () => store.close() };
}
