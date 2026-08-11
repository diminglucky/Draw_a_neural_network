import type { AppConfig } from "./config.js";

/**
 * Deliberately fails closed until the PostgreSQL/Redis store adapter is wired.
 * A production process must never silently fall back to InMemoryFoundationStore.
 */
export class ProductionStoreNotConfiguredError extends Error {
  constructor(config: Pick<AppConfig, "storageDriver">) {
    super(`Storage driver '${config.storageDriver}' is configured, but its production adapter is not installed`);
    this.name = "ProductionStoreNotConfiguredError";
  }
}
