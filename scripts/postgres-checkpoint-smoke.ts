import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import {
  PostgresDrawingWorkflowCheckpointSaver,
  PostgresDrawingWorkflowCheckpointStore,
} from "../apps/api/src/drawing-run/postgres-checkpoint-saver.js";
import { deriveDrawingWorkflowThreadId } from "../apps/api/src/drawing-run/langgraph-workflow.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migrations = [
  "001_foundation.sql",
  "010_drawing_runs.sql",
  "011_drawing_workflow_checkpoints.sql",
].map((file) => readFileSync(resolve(process.cwd(), "apps/api/sql", file), "utf8"));

type Identity = { ownerId: string; deviceId: string; runId: string; revision: number };

function config(identity: Identity, checkpointId?: string) {
  return {
    configurable: {
      owner_id: identity.ownerId,
      device_id: identity.deviceId,
      run_id: identity.runId,
      revision: identity.revision,
      thread_id: deriveDrawingWorkflowThreadId(identity),
      checkpoint_ns: "",
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

function makeCheckpoint(identity: Identity, id: string, phase: string): Checkpoint {
  return {
    v: 4,
    id,
    ts: "2026-08-23T00:00:00.000Z",
    channel_values: {
      runId: identity.runId,
      ownerId: identity.ownerId,
      deviceId: identity.deviceId,
      revision: identity.revision,
      phase,
      artifactHashes: [],
    },
    channel_versions: {},
    versions_seen: {},
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ownerA = `checkpoint-smoke-owner-a-${randomUUID()}`;
const ownerB = `checkpoint-smoke-owner-b-${randomUUID()}`;
const deviceA = `checkpoint-smoke-device-a-${randomUUID()}`;
const deviceB = `checkpoint-smoke-device-b-${randomUUID()}`;
const runA = `checkpoint-smoke-run-a-${randomUUID()}`;
const runB = `checkpoint-smoke-run-b-${randomUUID()}`;
const checkpointId = `checkpoint-${randomUUID()}`;
const revisionCheckpointId = `checkpoint-revision-${randomUUID()}`;
const taskA = `task-a-${randomUUID()}`;
const taskB = `task-b-${randomUUID()}`;
const identityA: Identity = { ownerId: ownerA, deviceId: deviceA, runId: runA, revision: 3 };
const identityARevision4: Identity = { ...identityA, revision: 4 };
const identityB: Identity = { ownerId: ownerB, deviceId: deviceB, runId: runB, revision: 3 };
const metadata: CheckpointMetadata = { source: "postgres-smoke", step: 1, parents: {} };

const poolA = new Pool({ connectionString: databaseUrl });
const poolB = new Pool({ connectionString: databaseUrl });

try {
  const schema = await poolA.query("SELECT to_regclass('public.users') AS users_table");
  if (!schema.rows[0]?.users_table) await poolA.query(migrations[0]!);
  await poolA.query(migrations[1]!);
  await poolA.query(migrations[2]!);

  await poolA.query(
    `INSERT INTO users (id, email, password_hash, status, roles, created_at)
     VALUES ($1, $2, 'checkpoint-smoke', 'active', '[]'::jsonb, NOW()),
            ($3, $4, 'checkpoint-smoke', 'active', '[]'::jsonb, NOW())`,
    [ownerA, `${ownerA}@example.com`, ownerB, `${ownerB}@example.com`],
  );
  await poolA.query(
    `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at)
     VALUES ($1, $2, 'Checkpoint Smoke A', $3, 'active', '0.1.0', 'Windows 11', NOW()),
            ($4, $5, 'Checkpoint Smoke B', $6, 'active', '0.1.0', 'Windows 11', NOW())`,
    [deviceA, ownerA, `${deviceA}-fingerprint`, deviceB, ownerB, `${deviceB}-fingerprint`],
  );
  await poolA.query(
    `INSERT INTO drawing_runs
      (run_id, owner_id, device_id, status, revision, intent, artifact_hashes, private_receipt_ids,
       start_idempotency_key, start_request_hash, error_category, created_at, updated_at)
     VALUES ($1, $2, $3, 'received', 4, '{"action":"create_figure","requestedDetail":"overview","target":"browser_preview","sourceKinds":["typed_text"]}'::jsonb, '[]'::jsonb, '[]'::jsonb, $4, $5, 'none', NOW(), NOW()),
            ($6, $7, $8, 'received', 3, '{"action":"create_figure","requestedDetail":"overview","target":"browser_preview","sourceKinds":["typed_text"]}'::jsonb, '[]'::jsonb, '[]'::jsonb, $9, $10, 'none', NOW(), NOW())`,
    [runA, ownerA, deviceA, `${runA}-start`, "a".repeat(64), runB, ownerB, deviceB, `${runB}-start`, "b".repeat(64)],
  );

  const first = new PostgresDrawingWorkflowCheckpointSaver(new PostgresDrawingWorkflowCheckpointStore(poolA));
  await first.put(config(identityA), makeCheckpoint(identityA, checkpointId, "assessing"), metadata, {});
  await first.putWrites(
    config(identityA, checkpointId),
    [["safeChannel", { hash: "c".repeat(64) }]],
    taskA,
  );
  await first.put(config(identityARevision4), makeCheckpoint(identityARevision4, revisionCheckpointId, "awaiting_clarification"), metadata, {});
  await first.put(config(identityB), makeCheckpoint(identityB, checkpointId, "rejected"), metadata, {});
  await first.putWrites(
    config(identityB, checkpointId),
    [["safeChannel", { hash: "d".repeat(64) }]],
    taskB,
  );

  const second = new PostgresDrawingWorkflowCheckpointSaver(new PostgresDrawingWorkflowCheckpointStore(poolB));
  const restoredA = await second.getTuple(config(identityA, checkpointId));
  assert(restoredA?.checkpoint.channel_values.phase === "assessing", "PostgreSQL checkpoint phase readback failed");
  assert(restoredA?.pendingWrites?.[0]?.[0] === taskA, "PostgreSQL pending write task readback failed");
  assert((restoredA?.pendingWrites?.[0]?.[2] as { hash?: string })?.hash === "c".repeat(64), "PostgreSQL pending write value readback failed");

  const restoredB = await second.getTuple(config(identityB, checkpointId));
  assert(restoredB?.checkpoint.channel_values.phase === "rejected", "PostgreSQL owner/device/run isolation readback failed");
  assert((restoredB?.pendingWrites?.[0]?.[2] as { hash?: string })?.hash === "d".repeat(64), "PostgreSQL isolated pending write readback failed");

  const restoredRevision4 = await second.getTuple(config(identityARevision4, revisionCheckpointId));
  assert(restoredRevision4?.checkpoint.channel_values.phase === "awaiting_clarification", "PostgreSQL revision isolation readback failed");

  const latestA = await second.getTuple(config(identityA));
  assert(latestA?.checkpoint.id === checkpointId, "PostgreSQL latest checkpoint lookup failed");

  await new PostgresDrawingWorkflowCheckpointStore(poolB).deleteThread(identityA);
  assert(!await second.getTuple(config(identityA, checkpointId)), "Scoped checkpoint delete did not remove the requested revision");
  assert(await second.getTuple(config(identityARevision4, revisionCheckpointId)), "Scoped checkpoint delete crossed revision boundary");
  assert(await second.getTuple(config(identityB, checkpointId)), "Scoped checkpoint delete crossed owner/device/run boundary");

  console.log("PostgreSQL checkpoint smoke OK: cross-connection checkpoint, pending writes, identity isolation, and scoped deletion");
} finally {
  await poolA.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerA, ownerB]).catch(() => {});
  await poolA.end();
  await poolB.end();
}
