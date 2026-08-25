import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migration016 = readFileSync(resolve(process.cwd(), "apps/api/sql/016_generic_plan_snapshots.sql"), "utf8");
const migration017 = readFileSync(resolve(process.cwd(), "apps/api/sql/017_generic_plan_snapshot_confirmed_previews.sql"), "utf8");
const schemaName = `generic_plan_snapshot_smoke_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = quoteIdentifier(schemaName);
const pendingPreviewHash = "a".repeat(64);
const promotedPlanHash = "b".repeat(64);
const owner = { tenantId: "tenant-smoke", userId: "user-smoke", deviceId: "device-smoke" };
const canonicalSnapshot = {
  version: 2,
  snapshotId: "snapshot-smoke-1",
  ...owner,
  graphId: "graph-smoke-1",
  ugsRevision: 1,
  ugsCanonicalHash: "c".repeat(64),
  generalPublicationGraphHash: "d".repeat(64),
  publicationVisualPlanId: "pvp:smoke",
  publicationVisualPlanHash: promotedPlanHash,
  sourceHashes: ["e".repeat(64)],
  publicationVisualPlan: {
    identity: { schemaVersion: 1, planId: "pvp:smoke", canonicalHash: promotedPlanHash },
    eligibility: {
      kind: "formal",
      formalReasons: ["topology-complete", `visual-qa:pvp-qa-1:${pendingPreviewHash}`],
      blockingReasons: [],
      qaStatus: "passed",
    },
  },
  createdAt: "2026-08-25T00:00:00.000Z",
  immutable: true,
};

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Disposable schema name is invalid");
  return `"${value}"`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function expectSqlState(expectedCode: string, label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (errorCode(error) === expectedCode) return;
    throw new Error(`${label} failed with SQLSTATE ${errorCode(error) ?? "unknown"}`, { cause: error });
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const client = new Client({ connectionString: databaseUrl });
let connected = false;
let schemaCreated = false;

async function applyMigration(sql: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

try {
  await client.connect();
  connected = true;
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  schemaCreated = true;
  await client.query(`SET search_path TO ${quotedSchema}, public`);

  await applyMigration(migration016);
  await client.query(
    `INSERT INTO generic_plan_snapshots
       (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id,
        publication_visual_plan_hash, snapshot, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
    [owner.tenantId, owner.userId, owner.deviceId, canonicalSnapshot.graphId, canonicalSnapshot.ugsRevision,
      canonicalSnapshot.snapshotId, promotedPlanHash, JSON.stringify(canonicalSnapshot), canonicalSnapshot.createdAt],
  );

  await applyMigration(migration017);
  const firstReadback = await client.query(
    "SELECT confirmed_preview_hash FROM generic_plan_snapshots WHERE snapshot_id = $1",
    [canonicalSnapshot.snapshotId],
  );
  assert(firstReadback.rows[0]?.confirmed_preview_hash === pendingPreviewHash, "Migration 017 did not backfill the trusted pending-preview hash");

  await applyMigration(migration017);
  const rerunReadback = await client.query(
    "SELECT confirmed_preview_hash FROM generic_plan_snapshots WHERE snapshot_id = $1",
    [canonicalSnapshot.snapshotId],
  );
  assert(rerunReadback.rows[0]?.confirmed_preview_hash === pendingPreviewHash, "Migration 017 rerun changed the confirmed-preview hash");

  await expectSqlState("23502", "confirmed-preview NOT NULL enforcement", () => client.query(
    `INSERT INTO generic_plan_snapshots
       (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id,
        publication_visual_plan_hash, snapshot, created_at)
     VALUES ($1, $2, $3, 'graph-null', 2, 'snapshot-null', $4, $5::jsonb, NOW())`,
    [owner.tenantId, owner.userId, owner.deviceId, "1".repeat(64), JSON.stringify(canonicalSnapshot)],
  ));

  await expectSqlState("23514", "confirmed-preview lowercase enforcement", () => client.query(
    `INSERT INTO generic_plan_snapshots
       (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id,
        publication_visual_plan_hash, confirmed_preview_hash, snapshot, created_at)
     VALUES ($1, $2, $3, 'graph-uppercase', 3, 'snapshot-uppercase', $4, $5, $6::jsonb, NOW())`,
    [owner.tenantId, owner.userId, owner.deviceId, "2".repeat(64), pendingPreviewHash.toUpperCase(), JSON.stringify(canonicalSnapshot)],
  ));

  await expectSqlState("23505", "owner/device/confirmed-preview uniqueness", () => client.query(
    `INSERT INTO generic_plan_snapshots
       (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id,
        publication_visual_plan_hash, confirmed_preview_hash, snapshot, created_at)
     VALUES ($1, $2, $3, 'graph-duplicate', 4, 'snapshot-duplicate', $4, $5, $6::jsonb, NOW())`,
    [owner.tenantId, owner.userId, owner.deviceId, "3".repeat(64), pendingPreviewHash, JSON.stringify(canonicalSnapshot)],
  ));

  await expectSqlState("P0001", "immutable UPDATE rejection", () => client.query(
    "UPDATE generic_plan_snapshots SET created_at = NOW() WHERE snapshot_id = $1",
    [canonicalSnapshot.snapshotId],
  ));
  await expectSqlState("P0001", "immutable DELETE rejection", () => client.query(
    "DELETE FROM generic_plan_snapshots WHERE snapshot_id = $1",
    [canonicalSnapshot.snapshotId],
  ));

  await client.query("ALTER TABLE generic_plan_snapshots DISABLE TRIGGER generic_plan_snapshots_immutable");
  await client.query(
    "UPDATE generic_plan_snapshots SET confirmed_preview_hash = $1 WHERE snapshot_id = $2",
    ["f".repeat(64), canonicalSnapshot.snapshotId],
  );
  await client.query("ALTER TABLE generic_plan_snapshots ENABLE TRIGGER generic_plan_snapshots_immutable");
  await expectSqlState("P0001", "migration 017 rerun consistency validation", () => applyMigration(migration017));
  await expectSqlState("P0001", "immutable trigger after rejected rerun", () => client.query(
    "UPDATE generic_plan_snapshots SET created_at = NOW() WHERE snapshot_id = $1",
    [canonicalSnapshot.snapshotId],
  ));

  await client.query("ALTER TABLE generic_plan_snapshots DISABLE TRIGGER generic_plan_snapshots_immutable");
  await client.query(
    "UPDATE generic_plan_snapshots SET confirmed_preview_hash = $1 WHERE snapshot_id = $2",
    [pendingPreviewHash, canonicalSnapshot.snapshotId],
  );
  await client.query("ALTER TABLE generic_plan_snapshots ENABLE TRIGGER generic_plan_snapshots_immutable");
  await applyMigration(migration017);

  console.log(`GenericPlanSnapshot migration smoke OK in disposable schema ${schemaName}`);
} catch (error) {
  console.error(`GenericPlanSnapshot migration smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (connected) {
    await client.query("SET search_path TO public").catch(() => {});
    if (schemaCreated) await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  }
}
