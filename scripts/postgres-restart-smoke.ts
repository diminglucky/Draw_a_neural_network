import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migrations = Array.from({ length: 14 }, (_, index) => readFileSync(resolve(process.cwd(), "apps/api/sql", `${String(index + 1).padStart(3, "0")}_${[
  "foundation", "session_fencing", "device_challenges", "agent_usage_ledger", "visio_job_idempotency", "figure_drafts", "universal_figure_export_jobs", "universal_figure_state", "figure_analyses", "drawing_runs", "drawing_workflow_checkpoints", "private_input_receipts", "drawing_input_artifacts", "drawing_artifacts",
][index]}.sql`), "utf8"));
const ownerId = `restart-smoke-owner-${randomUUID()}`;
const deviceId = `restart-smoke-device-${randomUUID()}`;
const runId = `restart-smoke-run-${randomUUID()}`;
const childOwnerId = process.env.RESTART_SMOKE_OWNER_ID || ownerId;
const childDeviceId = process.env.RESTART_SMOKE_DEVICE_ID || deviceId;
const childRunId = process.env.RESTART_SMOKE_RUN_ID || runId;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runChild(): Promise<string> {
  const child = spawn(process.execPath, [resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"), resolve(process.cwd(), "scripts/postgres-restart-smoke.ts"), "--child"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "development",
      STORAGE_DRIVER: "postgres",
      SESSION_SECRET: "restart-smoke-session-secret-1234567890",
      REQUIRE_DEVICE_PROOF: "false",
      RESTART_SMOKE_OWNER_ID: ownerId,
      RESTART_SMOKE_DEVICE_ID: deviceId,
      RESTART_SMOKE_RUN_ID: runId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise<number>((resolveExit) => child.once("close", (code) => resolveExit(code ?? 1)));
  if (exitCode !== 0) throw new Error(`Replacement API process failed (${exitCode}): ${stderr || stdout}`);
  return stdout.trim();
}

if (process.argv.includes("--child")) {
  const { buildDefaultApp } = await import("../apps/api/src/app.ts");
  const client = new Client({ connectionString: databaseUrl });
  let app;
  try {
    app = await buildDefaultApp();
    await app.ready();
    await client.connect();
    const result = await client.query(
      `SELECT r.status, COUNT(c.checkpoint_id)::int AS checkpoint_count
       FROM drawing_runs r
       LEFT JOIN drawing_workflow_checkpoints c
         ON c.owner_id = r.owner_id AND c.run_id = r.run_id AND c.revision = r.revision
       WHERE r.owner_id = $1 AND r.run_id = $2
       GROUP BY r.status`,
      [childOwnerId, childRunId],
    );
    assert(result.rowCount === 1, "Replacement API process could not read the Drawing Run");
    assert(result.rows[0].status === "received", "Recovery smoke changed the input-waiting run unexpectedly");
    assert(Number(result.rows[0].checkpoint_count) >= 1, "Replacement API process did not persist a LangGraph checkpoint");
    process.stdout.write(JSON.stringify({ status: result.rows[0].status, checkpoints: Number(result.rows[0].checkpoint_count) }));
  } finally {
    await client.end().catch(() => {});
    await app?.close().catch(() => {});
  }
} else {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const schema = await client.query("SELECT to_regclass('public.users') AS users_table");
    if (!schema.rows[0]?.users_table) {
      for (const migration of migrations) await client.query(migration);
    }
    await client.query(
      `INSERT INTO users (id, email, password_hash, status, roles, created_at)
       VALUES ($1, $2, 'restart-smoke', 'active', '[]'::jsonb, NOW())`,
      [ownerId, `${ownerId}@example.com`],
    );
    await client.query(
      `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at)
       VALUES ($1, $2, 'Restart Smoke Device', $3, 'active', '0.1.0', 'Windows 11', NOW())`,
      [deviceId, ownerId, `${deviceId}-fingerprint`],
    );
    await client.query(
      `INSERT INTO drawing_runs
       (run_id, owner_id, device_id, status, revision, intent, artifact_hashes, private_receipt_ids,
        start_idempotency_key, start_request_hash, error_category, created_at, updated_at)
       VALUES ($1, $2, $3, 'received', 0,
        '{"action":"create_figure","requestedDetail":"overview","target":"browser_preview","sourceKinds":["typed_text"]}'::jsonb,
        '[]'::jsonb, '[]'::jsonb, $4, $5, 'none', NOW(), NOW())`,
      [runId, ownerId, deviceId, `${runId}-start`, "a".repeat(64)],
    );
  } finally {
    await client.end();
  }

  const first = await runChild();
  const second = await runChild();
  const verify = new Client({ connectionString: databaseUrl });
  try {
    await verify.connect();
    const result = await verify.query(
      `SELECT COUNT(*)::int AS checkpoint_count
       FROM drawing_workflow_checkpoints
       WHERE owner_id = $1 AND device_id = $2 AND run_id = $3 AND revision = 0`,
      [childOwnerId, childDeviceId, childRunId],
    );
    const firstState = JSON.parse(first) as { status: string; checkpoints: number };
    const secondState = JSON.parse(second) as { status: string; checkpoints: number };
    assert(firstState.status === "received" && secondState.status === "received", "Replacement API processes changed the persisted run state");
    assert(firstState.checkpoints >= 1 && secondState.checkpoints === firstState.checkpoints, "Replacement API processes did not reuse the durable checkpoint state");
    assert(Number(result.rows[0].checkpoint_count) === secondState.checkpoints, "Checkpoint readback count disagrees with replacement process state");
    console.log(`PostgreSQL restart smoke OK: two replacement API processes recovered one scoped run (${first}; ${second})`);
  } finally {
    await verify.query("DELETE FROM users WHERE id = $1", [ownerId]).catch(() => {});
    await verify.end();
  }
}
