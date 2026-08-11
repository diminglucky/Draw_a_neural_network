import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("storage configuration", () => {
  it("requires DATABASE_URL whenever PostgreSQL storage is selected", () => {
    expect(() => loadConfig({ NODE_ENV: "development", STORAGE_DRIVER: "postgres", SESSION_SECRET: "development-secret-development-secret" })).toThrow(/DATABASE_URL/);
  });
});
