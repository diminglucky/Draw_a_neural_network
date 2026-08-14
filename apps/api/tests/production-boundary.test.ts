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

  it("contains the append-only FigureDraft revision migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/006_figure_drafts.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS figure_drafts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS figure_draft_revisions");
    expect(sql).toContain("PRIMARY KEY (draft_id, revision)");
    expect(sql).toContain("current_revision");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON figure_draft_revisions");
    expect(sql).toMatch(/RAISE EXCEPTION[^;]+append-only/i);
  });

  it("contains the durable Visio export idempotency index migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/005_visio_job_idempotency.sql"), "utf8");

    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS jobs_visio_idempotency_idx");
    expect(sql).toContain("input->>'idempotencyKey'");
    expect(sql).toContain("WHERE type = 'visio-export'");
  });

  it("admits the separate universal figure export Job type in both fresh and migrated schemas", () => {
    const foundation = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/007_universal_figure_export_jobs.sql"), "utf8");

    expect(foundation).toContain("'universal-figure-export'");
    expect(migration).toContain("'universal-figure-export'");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS jobs_type_check");
  });

  it("contains durable Universal snapshot, viewed-preview, confirmation, and idempotency records", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/008_universal_figure_state.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS plan_snapshots");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS viewed_plan_previews");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS plan_export_confirmation_nonces");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS universal_figure_export_requests");
    expect(sql).toContain("consumed_at TIMESTAMPTZ NULL");
    expect(sql).toContain("PRIMARY KEY (tenant_id, user_id, device_id, idempotency_key)");
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
