import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("storage configuration", () => {
  it("requires DATABASE_URL whenever PostgreSQL storage is selected", () => {
    expect(() => loadConfig({ NODE_ENV: "development", STORAGE_DRIVER: "postgres", SESSION_SECRET: "development-secret-development-secret" })).toThrow(/DATABASE_URL/);
  });

  it("enables device proof when explicitly requested", () => {
    expect(loadConfig({ NODE_ENV: "development", STORAGE_DRIVER: "memory", REQUIRE_DEVICE_PROOF: "true", SESSION_SECRET: "development-secret-development-secret" }).requireDeviceProof).toBe(true);
  });
});
