import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";

describe("production persistence boundary", () => {
  it("contains durable tables and a unique active-session rule", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");

    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("CREATE TABLE devices");
    expect(sql).toContain("CREATE TABLE sessions");
    expect(sql).toContain("CREATE UNIQUE INDEX sessions_one_active_per_user");
    expect(sql).toContain('"agentChatsPerMonth": 10');
  });

  it("contains the durable Agent usage ledger migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/004_agent_usage_ledger.sql"), "utf8");

    expect(sql).toContain("CREATE TABLE agent_usage_periods");
    expect(sql).toContain("CREATE TABLE agent_usage_ledger");
    expect(sql).toContain("UNIQUE (user_id, idempotency_key)");
    expect(sql).toContain("UPDATE plans");
    expect(sql).toContain("agentChatsPerMonth");
  });

  it("contains the durable Visio export idempotency index migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/005_visio_job_idempotency.sql"), "utf8");

    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS jobs_visio_idempotency_idx");
    expect(sql).toContain("input->>'idempotencyKey'");
    expect(sql).toContain("WHERE type = 'visio-export'");
  });

  it("rejects memory storage in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "production-secret-production-secret", STORAGE_DRIVER: "memory" })).toThrow(/development-only/);
  });

  it("does not let a PostgreSQL config silently create an in-memory app", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio",
      SESSION_SECRET: "development-secret-development-secret",
    });
    expect(() => buildApp({ config })).toThrow(/FoundationStore|storage/i);
  });
});
