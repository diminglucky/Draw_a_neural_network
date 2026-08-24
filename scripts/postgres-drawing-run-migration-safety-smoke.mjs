import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const disposableDatabaseUrl = process.env.DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL;
const ambientDatabaseUrl = process.env["DATABASE_URL"];
const requiredDedicatedDatabaseName = "draw_a_neural_network_migration_safety";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parsePostgresDatabaseTarget(value, variableName) {
  assert(value, `${variableName} is required; this smoke never uses a shared or default PostgreSQL URL.`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  assert(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:", `${variableName} must use the postgres or postgresql protocol.`);
  assert(parsed.hostname, `${variableName} must include a PostgreSQL host.`);
  const databasePathSegments = parsed.pathname.split("/").filter(Boolean);
  assert(databasePathSegments.length === 1, `${variableName} must identify exactly one PostgreSQL database.`);

  let databaseName;
  try {
    databaseName = decodeURIComponent(databasePathSegments[0]);
  } catch {
    throw new Error(`${variableName} contains an invalid encoded database name.`);
  }
  assert(databaseName, `${variableName} must include a PostgreSQL database name.`);

  return {
    connectionString: value,
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    databaseName,
  };
}

function sameDatabaseTarget(left, right) {
  return left.host === right.host && left.port === right.port && left.databaseName === right.databaseName;
}

function requiredDatabaseUrl() {
  const disposableTarget = parsePostgresDatabaseTarget(disposableDatabaseUrl, "DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL");
  assert(disposableTarget.databaseName === requiredDedicatedDatabaseName, `DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL must name the exact dedicated database ${requiredDedicatedDatabaseName}.`);

  if (ambientDatabaseUrl) {
    const ambientTarget = parsePostgresDatabaseTarget(ambientDatabaseUrl, "DATABASE_URL");
    assert(!sameDatabaseTarget(disposableTarget, ambientTarget), "DRAWING_RUN_MIGRATION_SAFETY_DATABASE_URL must not identify the same host, port, and database as DATABASE_URL.");
  }

  return disposableTarget.connectionString;
}

const migrations = {
  foundation: readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8"),
  drawingRuns: readFileSync(resolve(process.cwd(), "apps/api/sql/010_drawing_runs.sql"), "utf8"),
  formalUgsState: readFileSync(resolve(process.cwd(), "apps/api/sql/015_drawing_run_formal_ugs_state.sql"), "utf8"),
};

async function resetPublicSchema(client) {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
}

async function assertDedicatedDatabase(client) {
  const result = await client.query("SELECT current_database() AS database_name");
  const databaseName = result.rows[0]?.database_name;
  assert(databaseName === requiredDedicatedDatabaseName, `Connected PostgreSQL database must be ${requiredDedicatedDatabaseName}; refusing destructive migration smoke work.`);
}

async function installFreshDrawingRuns(client) {
  await client.query(migrations.foundation);
  await client.query(migrations.drawingRuns);
}

async function insertPrincipalAndRun(client, { status = "received", formalUgsHash = null } = {}) {
  const ownerId = `migration-safety-owner-${randomUUID()}`;
  const deviceId = `migration-safety-device-${randomUUID()}`;
  const runId = `migration-safety-run-${randomUUID()}`;

  await client.query(
    `INSERT INTO users (id, email, password_hash, status, roles, created_at)
     VALUES ($1, $2, 'migration-safety-hash', 'active', '["user"]'::jsonb, NOW())`,
    [ownerId, `${ownerId}@example.com`],
  );
  await client.query(
    `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at)
     VALUES ($1, $2, 'Migration Safety Device', $3, 'active', '0.1.0', 'Windows 11', NOW())`,
    [deviceId, ownerId, `${deviceId}-fingerprint`],
  );
  await client.query(
    `INSERT INTO drawing_runs
      (run_id, owner_id, device_id, status, revision, intent, artifact_hashes, private_receipt_ids,
       start_idempotency_key, start_request_hash, formal_ugs_hash, error_category, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0,
       '{"action":"create_figure","requestedDetail":"overview","target":"browser_preview","sourceKinds":["typed_text"]}'::jsonb,
       '[]'::jsonb, '[]'::jsonb, $5, $6, $7, 'none', NOW(), NOW())`,
    [runId, ownerId, deviceId, status, `${runId}-start`, "a".repeat(64), formalUgsHash],
  );
  return { ownerId, runId };
}

async function expectMigrationFailure(client, expectedMessage, expectedHint) {
  let failure;
  try {
    await client.query(migrations.formalUgsState);
  } catch (error) {
    failure = error;
  } finally {
    await client.query("ROLLBACK");
  }
  assert(failure, `Migration 015 unexpectedly succeeded; expected ${expectedMessage}`);
  const message = failure instanceof Error ? failure.message : String(failure);
  assert(message.includes(expectedMessage), `Migration 015 failed with unexpected evidence: ${message}`);
  const hint = failure && typeof failure === "object" && "hint" in failure ? String(failure.hint ?? "") : "";
  assert(hint.includes(expectedHint), `Migration 015 failed with unexpected hint: ${hint}`);
}

async function assertLegacyAwaitStateRollback(client) {
  await resetPublicSchema(client);
  await installFreshDrawingRuns(client);
  await client.query(
    `ALTER TABLE drawing_runs
       DROP CONSTRAINT drawing_runs_status_check,
       ADD CONSTRAINT drawing_runs_status_check CHECK (status IN (
         'received', 'input_accepted', 'analyzing', 'awaiting_interpreter', 'candidate_structure',
         'awaiting_clarification', 'formal_ugs', 'composing_pvp', 'preview_ready', 'awaiting_page_binding',
         'awaiting_apply_confirmation', 'page_bound', 'applying', 'readback_verified', 'cancelled',
         'rejected', 'failed', 'conflicted'
       ))`,
  );
  const legacyRun = await insertPrincipalAndRun(client, { status: "awaiting_apply_confirmation" });

  await expectMigrationFailure(client, "legacy awaiting_apply_confirmation status", "deployed pre-015 workflow");
  const row = await client.query("SELECT status FROM drawing_runs WHERE owner_id = $1 AND run_id = $2", [legacyRun.ownerId, legacyRun.runId]);
  const constraint = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.drawing_runs'::regclass AND conname = 'drawing_runs_status_check'");
  assert(row.rows[0]?.status === "awaiting_apply_confirmation", "Legacy await row was changed despite migration rollback");
  assert(String(constraint.rows[0]?.definition).includes("awaiting_apply_confirmation"), "Legacy status constraint changed despite migration rollback");
  console.log("legacy await state aborts and rolls back");
}

async function assertInvalidHashRollback(client) {
  await resetPublicSchema(client);
  await installFreshDrawingRuns(client);
  await client.query("ALTER TABLE drawing_runs DROP CONSTRAINT drawing_runs_formal_ugs_hash_check");
  const invalidRun = await insertPrincipalAndRun(client, { formalUgsHash: "not-a-sha-256-hash" });

  await expectMigrationFailure(client, "non-SHA-256 formal_ugs_hash", "Correct or remove the invalid formal_ugs_hash values");
  const row = await client.query("SELECT formal_ugs_hash FROM drawing_runs WHERE owner_id = $1 AND run_id = $2", [invalidRun.ownerId, invalidRun.runId]);
  const constraint = await client.query("SELECT COUNT(*)::int AS count FROM pg_constraint WHERE conrelid = 'public.drawing_runs'::regclass AND conname = 'drawing_runs_formal_ugs_hash_check'");
  assert(row.rows[0]?.formal_ugs_hash === "not-a-sha-256-hash", "Invalid hash was changed despite migration rollback");
  assert(Number(constraint.rows[0]?.count) === 0, "Formal hash constraint was changed despite migration rollback");
  console.log("invalid existing hash aborts and rolls back");
}

async function assertNullableTextNormalization(client) {
  await resetPublicSchema(client);
  await installFreshDrawingRuns(client);
  await client.query("ALTER TABLE drawing_runs ALTER COLUMN formal_ugs_hash SET NOT NULL");
  const existingValidHash = "b".repeat(64);
  const existingRun = await insertPrincipalAndRun(client, { formalUgsHash: existingValidHash });
  await client.query(migrations.formalUgsState);

  const column = await client.query(
    "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'drawing_runs' AND column_name = 'formal_ugs_hash'",
  );
  assert(column.rows[0]?.data_type === "text" && column.rows[0]?.is_nullable === "YES", "Migration 015 did not normalize formal_ugs_hash to nullable TEXT");
  const preservedHash = await client.query("SELECT formal_ugs_hash FROM drawing_runs WHERE owner_id = $1 AND run_id = $2", [existingRun.ownerId, existingRun.runId]);
  assert(preservedHash.rows[0]?.formal_ugs_hash === existingValidHash, "Existing valid formal hash was not preserved during normalization");
  await insertPrincipalAndRun(client, { formalUgsHash: null });
  console.log("NOT NULL formal hash becomes nullable, preserves valid hash, and accepts null");
}

async function assertIncompatibleTypeRollback(client) {
  await resetPublicSchema(client);
  await installFreshDrawingRuns(client);
  await client.query("ALTER TABLE drawing_runs DROP CONSTRAINT drawing_runs_formal_ugs_hash_check");
  await client.query("ALTER TABLE drawing_runs ALTER COLUMN formal_ugs_hash TYPE BIGINT USING NULL::BIGINT");

  await expectMigrationFailure(client, "formal_ugs_hash has incompatible type bigint", "must use text, varchar, or char");
  const column = await client.query(
    "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'drawing_runs' AND column_name = 'formal_ugs_hash'",
  );
  assert(column.rows[0]?.data_type === "bigint", "Incompatible formal_ugs_hash type changed despite migration rollback");
  console.log("incompatible existing type aborts and rolls back with operator evidence");
}

async function assertFreshReruns(client) {
  await resetPublicSchema(client);
  await client.query(migrations.foundation);
  await client.query(migrations.drawingRuns);
  await client.query(migrations.formalUgsState);
  await client.query(migrations.drawingRuns);
  await client.query(migrations.formalUgsState);

  const column = await client.query(
    "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'drawing_runs' AND column_name = 'formal_ugs_hash'",
  );
  assert(column.rows[0]?.data_type === "text" && column.rows[0]?.is_nullable === "YES", "Fresh 010 plus 015 rerun did not preserve nullable TEXT formal_ugs_hash");
  console.log("fresh 010 plus 015 reruns safely");
}

const client = new Client({ connectionString: requiredDatabaseUrl() });
let dedicatedDatabaseVerified = false;
try {
  await client.connect();
  await assertDedicatedDatabase(client);
  dedicatedDatabaseVerified = true;
  await assertLegacyAwaitStateRollback(client);
  await assertInvalidHashRollback(client);
  await assertNullableTextNormalization(client);
  await assertIncompatibleTypeRollback(client);
  await assertFreshReruns(client);
  console.log("PostgreSQL Drawing Run migration safety smoke OK");
} finally {
  let cleanupFailure;
  if (dedicatedDatabaseVerified) {
    try {
      await resetPublicSchema(client);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    await client.end();
  } catch (error) {
    if (cleanupFailure) throw new AggregateError([cleanupFailure, error], "Migration safety smoke cleanup failed");
    throw error;
  }
  if (cleanupFailure) throw cleanupFailure;
}
