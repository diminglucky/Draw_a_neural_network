import { describe, expect, it } from "vitest";
import { createFoundationStore } from "../src/store-factory.js";
import { loadConfig } from "../src/config.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { PostgresFoundationStore } from "../src/postgres-store.js";

describe("foundation store factory", () => {
  it("selects the memory store only for an explicit memory configuration", async () => {
    const handle = await createFoundationStore(loadConfig({ NODE_ENV: "test", STORAGE_DRIVER: "memory", SESSION_SECRET: "test-session-secret-test-session-secret" }));
    expect(handle.store).toBeInstanceOf(InMemoryFoundationStore);
    await handle.close();
  });

  it("selects PostgreSQL without silently falling back to memory", async () => {
    const handle = await createFoundationStore(loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio",
      SESSION_SECRET: "development-secret-development-secret",
    }));
    expect(handle.store).toBeInstanceOf(PostgresFoundationStore);
    await handle.close();
  });
});
