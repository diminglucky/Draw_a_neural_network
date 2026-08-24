import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

  it("contains durable Drawing Run state, CAS revision, and append-only event records", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/010_drawing_runs.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_runs");
    expect(sql).toContain("PRIMARY KEY (owner_id, run_id)");
    expect(sql).toContain("drawing_runs_start_idempotency_idx");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_run_events");
    expect(sql).toContain("UNIQUE (owner_id, run_id, idempotency_key)");
    expect(sql).toContain("FOREIGN KEY (owner_id, run_id)");
    expect(sql).toContain("revision INTEGER NOT NULL");
    expect(sql).toContain("formal_ugs_hash TEXT NULL");
    expect(sql).toContain("formal_ugs_hash IS NULL OR formal_ugs_hash ~* '^[a-f0-9]{64}$'");
    expect(sql).not.toContain("awaiting_apply_confirmation");
  });

  it("fails closed before removing the legacy Drawing Run status and formalizes the durable UGS hash", () => {
    const migrationPath = resolve(process.cwd(), "apps/api/sql/015_drawing_run_formal_ugs_state.sql");
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("Migration 015 blocked");
    expect(migration).toContain("awaiting_apply_confirmation");
    expect(migration).toMatch(/RAISE EXCEPTION[\s\S]*awaiting_apply_confirmation/i);
    expect(migration).not.toMatch(/UPDATE\s+drawing_runs\s+SET\s+status/i);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS formal_ugs_hash TEXT NULL");
    expect(migration).toContain("drawing_runs_formal_ugs_hash_check");
    expect(migration).toContain("drawing_runs_status_check");
    expect(migration).toContain("'page_bound', 'applying'");
  });

  it("normalizes an existing formal UGS hash column and provides an executable disposable-PostgreSQL safety smoke", () => {
    const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/015_drawing_run_formal_ugs_state.sql"), "utf8");
    const smokePath = resolve(process.cwd(), "scripts/postgres-drawing-run-migration-safety-smoke.mjs");

    expect(migration).toContain("Migration 015 blocked: formal_ugs_hash has incompatible type");
    expect(migration).toContain("atttypid IN ('pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype, 'pg_catalog.bpchar'::regtype)");
    expect(migration).toContain("ALTER COLUMN formal_ugs_hash TYPE TEXT USING formal_ugs_hash::TEXT");
    expect(migration).toContain("ALTER COLUMN formal_ugs_hash DROP NOT NULL");
    expect(migration.indexOf("invalid_hash_count")).toBeLessThan(migration.indexOf("DROP NOT NULL"));

    expect(existsSync(smokePath)).toBe(true);
    if (!existsSync(smokePath)) return;

    const smoke = readFileSync(smokePath, "utf8");
    expect(smoke).toContain("DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL");
    expect(smoke).not.toContain("process.env.DATABASE_URL");
    expect(smoke).toContain("DROP SCHEMA public CASCADE");
    expect(smoke).toContain("legacy await state aborts and rolls back");
    expect(smoke).toContain("invalid existing hash aborts and rolls back");
    expect(smoke).toContain("NOT NULL formal hash becomes nullable, preserves valid hash, and accepts null");
    expect(smoke).toContain("fresh 010 plus 015 reruns safely");
  });

  it("requires and verifies one exact dedicated database before the migration smoke can drop public", () => {
    const smoke = readFileSync(resolve(process.cwd(), "scripts/postgres-drawing-run-migration-safety-smoke.mjs"), "utf8");

    expect(smoke).toContain('const requiredDedicatedDatabaseName = "draw_a_neural_network_migration_safety"');
    expect(smoke).toContain("function parsePostgresDatabaseTarget");
    expect(smoke).toContain("new URL(value)");
    expect(smoke).toContain('process.env["DATABASE_URL"]');
    expect(smoke).toContain("sameDatabaseTarget");
    expect(smoke).toContain("SELECT current_database() AS database_name");
    expect(smoke).toContain("await assertDedicatedDatabase(client)");
    expect(smoke.indexOf("await assertDedicatedDatabase(client)")).toBeLessThan(smoke.indexOf("await assertLegacyAwaitStateRollback(client)"));
    const execution = smoke.slice(smoke.indexOf("const client = new Client"));
    expect(execution.indexOf("await assertDedicatedDatabase(client)")).toBeLessThan(execution.indexOf("await assertLegacyAwaitStateRollback(client)"));
  });

  it("rolls back each expected migration failure before inspecting it and preserves a valid existing formal hash", () => {
    const smoke = readFileSync(resolve(process.cwd(), "scripts/postgres-drawing-run-migration-safety-smoke.mjs"), "utf8");
    const expectedFailure = smoke.match(/async function expectMigrationFailure[\s\S]*?\n}\n\nasync function assertLegacyAwaitStateRollback/);
    const expectedFailureSource = expectedFailure?.[0];

    expect(expectedFailureSource).toMatch(/finally\s*{\s*await client\.query\("ROLLBACK"\);\s*}/);
    if (expectedFailureSource === undefined) throw new Error("Could not find migration failure helper");
    expect(expectedFailureSource.indexOf('await client.query("ROLLBACK");')).toBeLessThan(expectedFailureSource.indexOf("assert(failure"));
    expect(expectedFailureSource.indexOf('await client.query("ROLLBACK");')).toBeLessThan(expectedFailureSource.indexOf("const hint"));
    expect(expectedFailureSource).toContain("Migration 015 failed with unexpected hint");
    expect(smoke).toContain('const existingValidHash = "b".repeat(64)');
    expect(smoke).toContain("formalUgsHash: existingValidHash");
    expect(smoke).toContain("Existing valid formal hash was not preserved during normalization");
    expect(smoke).not.toContain("await resetPublicSchema(client).catch(() => {})");
    expect(smoke).not.toContain("await client.end().catch(() => {})");
  });

  it("contains owner/device/revision-scoped LangGraph checkpoint storage", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/011_drawing_workflow_checkpoints.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_workflow_checkpoints");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_workflow_checkpoint_writes");
    expect(sql).toContain("PRIMARY KEY (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id)");
    expect(sql).toContain("checkpoint_data BYTEA NOT NULL");
    expect(sql).toContain("value_data BYTEA NOT NULL");
    expect(sql).toContain("FOREIGN KEY (owner_id, run_id) REFERENCES drawing_runs");
  });

  it("contains private receipt content and owner-scoped batch bindings", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/012_private_input_receipts.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS private_input_receipts");
    expect(sql).toContain("content BYTEA NOT NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS private_input_receipt_batches");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS private_input_receipt_batch_items");
    expect(sql).toContain("FOREIGN KEY (owner_id, receipt_id)");
  });

  it("contains durable EvidencePack and Provider-local proposal artifacts", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/013_drawing_input_artifacts.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_evidence_packs");
    expect(sql).toContain("evidence_pack_hash TEXT");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_local_proposals");
    expect(sql).toContain("proposal JSONB NOT NULL");
    expect(sql).toContain("REFERENCES users(id)");
  });

  it("contains durable owner-scoped UGS, PVP, and QA artifacts", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/014_drawing_artifacts.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drawing_artifacts");
    expect(sql).toContain("artifact_kind IN ('ugs', 'pvp', 'qa')");
    expect(sql).toContain("PRIMARY KEY (owner_id, artifact_kind, artifact_hash)");
    expect(sql).toContain("REFERENCES users(id)");
    expect(sql).toContain("drawing_local_proposals_legacy_unscoped");
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
