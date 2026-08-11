import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";

describe("production persistence boundary", () => {
  it("contains durable tables and a unique active-session rule", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");

    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("CREATE TABLE devices");
    expect(sql).toContain("CREATE TABLE sessions");
    expect(sql).toContain("CREATE UNIQUE INDEX sessions_one_active_per_user");
  });

  it("rejects memory storage in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "production-secret-production-secret", STORAGE_DRIVER: "memory" })).toThrow(/development-only/);
  });
});
