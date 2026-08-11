import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("lease configuration", () => {
  it("requires REDIS_URL when Redis leases are selected", () => {
    expect(() => loadConfig({
      NODE_ENV: "development",
      SESSION_SECRET: "development-secret-development-secret",
      STORAGE_DRIVER: "memory",
      LEASE_DRIVER: "redis",
    })).toThrow(/REDIS_URL/);
  });
});
