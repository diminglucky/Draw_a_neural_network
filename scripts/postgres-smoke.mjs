import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");
const fencingMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/002_session_fencing.sql"), "utf8");
const challengeMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/003_device_challenges.sql"), "utf8");
const usageMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/004_agent_usage_ledger.sql"), "utf8");
const visioJobIdempotencyMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/005_visio_job_idempotency.sql"), "utf8");
const figureDraftMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/006_figure_drafts.sql"), "utf8");
const universalFigureExportJobsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/007_universal_figure_export_jobs.sql"), "utf8");
const universalFigureStateMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/008_universal_figure_state.sql"), "utf8");
const drawingRunsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/010_drawing_runs.sql"), "utf8");
const drawingWorkflowCheckpointsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/011_drawing_workflow_checkpoints.sql"), "utf8");
const privateInputReceiptsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/012_private_input_receipts.sql"), "utf8");
const drawingInputArtifactsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/013_drawing_input_artifacts.sql"), "utf8");
const drawingArtifactsMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/014_drawing_artifacts.sql"), "utf8");
const drawingRunFormalUgsStateMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/015_drawing_run_formal_ugs_state.sql"), "utf8");
const userId = `smoke-${randomUUID()}`;
const email = `${userId}@example.com`;
const deviceOneId = `device-${randomUUID()}`;
const deviceTwoId = `device-${randomUUID()}`;
const sessionOneId = `session-${randomUUID()}`;
const sessionTwoId = `session-${randomUUID()}`;
const challengeId = `challenge-${randomUUID()}`;
const expiredChallengeId = `challenge-${randomUUID()}`;
const drawingRunId = `run-${randomUUID()}`;
const drawingRunEventId = `${drawingRunId}:1:received`;
const receiptId = `receipt:${randomUUID()}`;
const ownerRevisionReceiptId = `receipt:${randomUUID()}`;
const receiptContent = Buffer.from("postgres-receipt-smoke", "utf8");
const receiptHash = createHash("sha256").update(receiptContent).digest("hex");
const ownerRevisionContent = Buffer.from("owner-revision-smoke", "utf8");
const ownerRevisionHash = createHash("sha256").update(ownerRevisionContent).digest("hex");
const receiptBatchHash = createHash("sha256").update(JSON.stringify([
  {
    receiptId,
    ownerId: userId,
    contentHandle: `content:${receiptId}`,
    kind: "typed_text",
    mimeType: "text/plain",
    sha256: receiptHash,
    byteLength: receiptContent.byteLength,
    retention: "ephemeral",
  },
]), "utf8").digest("hex");
const evidencePackBody = {
  version: 1,
  facts: [{
    localFactRef: "fact:f:1",
    sourceKind: "architecture_fact",
    summary: "input declaration",
    confidence: 1,
    semanticKey: "node:input",
    evidence: {
      evidenceId: "evidence:e:1",
      sourceKind: "architecture_fact",
      sourceHash: receiptHash,
      locatorKind: "section",
      locatorOrdinal: 1,
      excerptDigest: receiptHash,
    },
  }],
  unresolved: [],
};
const evidencePackHash = createHash("sha256").update(JSON.stringify(evidencePackBody), "utf8").digest("hex");
const localProposal = { version: 2, nodes: [], ports: [], edges: [], unresolved: [] };
const localProposalHash = createHash("sha256").update(JSON.stringify(localProposal), "utf8").digest("hex");
const qaArtifact = { planHash: "0".repeat(64), status: "passed" };
const qaArtifactHash = createHash("sha256").update(JSON.stringify(qaArtifact), "utf8").digest("hex");

async function connect() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

let first;
let second;
try {
  first = await connect();
  const schema = await first.query("SELECT to_regclass('public.users') AS users_table");
  if (!schema.rows[0]?.users_table) await first.query(migration);
  await first.query(fencingMigration);
  await first.query(challengeMigration);
  const usageSchema = await first.query("SELECT to_regclass('public.agent_usage_ledger') AS usage_table");
  if (!usageSchema.rows[0]?.usage_table) await first.query(usageMigration);
  await first.query(visioJobIdempotencyMigration);
  await first.query(figureDraftMigration);
  await first.query(universalFigureExportJobsMigration);
  await first.query(universalFigureStateMigration);
  await first.query(drawingRunsMigration);
  await first.query(drawingWorkflowCheckpointsMigration);
  await first.query(privateInputReceiptsMigration);
  await first.query(drawingInputArtifactsMigration);
  await first.query(drawingArtifactsMigration);
  await first.query(drawingRunFormalUgsStateMigration);
  await first.query(
    `INSERT INTO users (id, email, password_hash, status, roles, created_at)
     VALUES ($1, $2, 'smoke-hash', 'active', '["user"]'::jsonb, NOW())`,
    [userId, email],
  );
  await first.query(
    `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at)
     VALUES ($1, $2, 'Smoke Device A', 'smoke-fingerprint-a', 'active', '0.1.0', 'Windows 11', NOW()),
            ($3, $2, 'Smoke Device B', 'smoke-fingerprint-b', 'active', '0.1.0', 'Windows 11', NOW())`,
    [deviceOneId, userId, deviceTwoId],
  );
  await first.query(
    `INSERT INTO device_keys (device_id, public_key, algorithm, created_at)
     VALUES ($1, 'smoke-public-key-a', 'Ed25519', NOW()), ($2, 'smoke-public-key-b', 'Ed25519', NOW())`,
    [deviceOneId, deviceTwoId],
  );
  await first.query(
    `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
     VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 1)`,
    [sessionOneId, userId, deviceOneId, `access-${randomUUID()}`],
  );

  let uniqueViolation = false;
  try {
    await first.query(
      `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
       VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 2)`,
      [sessionTwoId, userId, deviceTwoId, `access-${randomUUID()}`],
    );
  } catch (error) {
    uniqueViolation = error?.code === "23505";
  }
  if (!uniqueViolation) throw new Error("PostgreSQL one-active-session invariant did not reject the competing session");

  await first.query("UPDATE sessions SET status = 'expired' WHERE id = $1", [sessionOneId]);
  await first.query(
    `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
     VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 2)`,
    [sessionTwoId, userId, deviceTwoId, `access-${randomUUID()}`],
  );

  const staleUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW(), lease_expires_at = NOW() + INTERVAL '90 seconds'
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionOneId, 1],
  );
  if (staleUpdate.rowCount !== 0) throw new Error("Stale session fencing token updated an expired session");

  const staleTokenUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW()
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionTwoId, 1],
  );
  if (staleTokenUpdate.rowCount !== 0) throw new Error("A stale fencing token updated the current session");

  const currentUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW()
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionTwoId, 2],
  );
  if (currentUpdate.rowCount !== 1) throw new Error("The current fencing token could not update the active session");

  await first.query(
    `INSERT INTO device_challenges (id, user_id, device_id, challenge, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '120 seconds', NOW())`,
    [challengeId, userId, deviceTwoId, `challenge-value-${randomUUID()}`],
  );
  const consumedChallenge = await first.query(
    `UPDATE device_challenges SET consumed_at = NOW()
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING id`,
    [challengeId],
  );
  if (consumedChallenge.rowCount !== 1) throw new Error("A valid device challenge could not be consumed");
  const replayedChallenge = await first.query(
    `UPDATE device_challenges SET consumed_at = NOW()
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING id`,
    [challengeId],
  );
  if (replayedChallenge.rowCount !== 0) throw new Error("A consumed device challenge was replayable");
  await first.query(
    `INSERT INTO device_challenges (id, user_id, device_id, challenge, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW() - INTERVAL '1 second', NOW())`,
    [expiredChallengeId, userId, deviceTwoId, `expired-value-${randomUUID()}`],
  );
  const expiredChallenge = await first.query(
    `UPDATE device_challenges SET consumed_at = NOW()
     WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING id`,
    [expiredChallengeId],
  );
  if (expiredChallenge.rowCount !== 0) throw new Error("An expired device challenge was consumed");

  const usagePeriod = "2026-08-01T00:00:00.000Z";
  const usageKey = `usage-${randomUUID()}`;
  const usageHash = `hash-${randomUUID()}`;
  await first.query("BEGIN");
  await first.query(
    `INSERT INTO agent_usage_periods (user_id, metric, period_start, limit_snapshot, consumed)
     VALUES ($1, 'agentChatRequests', $2, 1, 0)
     ON CONFLICT (user_id, metric, period_start) DO NOTHING`,
    [userId, usagePeriod],
  );
  const usageFirstPeriod = await first.query(
    `UPDATE agent_usage_periods SET consumed = consumed + 1, updated_at = NOW()
     WHERE user_id = $1 AND metric = 'agentChatRequests' AND period_start = $2
       AND consumed + 1 <= limit_snapshot
     RETURNING consumed, limit_snapshot`,
    [userId, usagePeriod],
  );
  if (usageFirstPeriod.rowCount !== 1) throw new Error("The first Agent usage reservation was rejected");
  await first.query(
    `INSERT INTO agent_usage_ledger
      (id, user_id, metric, period_start, idempotency_key, request_hash, amount, limit_snapshot, consumed, state, created_at)
     VALUES ($1, $2, 'agentChatRequests', $3, $4, $5, 1, $6, $7, 'accepted', NOW())`,
    [randomUUID(), userId, usagePeriod, usageKey, usageHash, usageFirstPeriod.rows[0].limit_snapshot, usageFirstPeriod.rows[0].consumed],
  );
  await first.query("COMMIT");

  const duplicateUsage = await first.query(
    `SELECT id, request_hash, state FROM agent_usage_ledger
     WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, usageKey],
  );
  if (duplicateUsage.rowCount !== 1 || duplicateUsage.rows[0].request_hash !== usageHash) throw new Error("Agent usage idempotency readback failed");
  const exhaustedUsage = await first.query(
    `UPDATE agent_usage_periods SET consumed = consumed + 1, updated_at = NOW()
     WHERE user_id = $1 AND metric = 'agentChatRequests' AND period_start = $2
       AND consumed + 1 <= limit_snapshot
     RETURNING consumed`,
    [userId, usagePeriod],
  );
  if (exhaustedUsage.rowCount !== 0) throw new Error("Agent usage quota did not enforce the monthly limit");
  const finalizedUsage = await first.query(
    `UPDATE agent_usage_ledger SET state = 'failed', outcome = 'provider_error', error_code = 'AGENT_PROVIDER_FAILED', finalized_at = NOW()
     WHERE user_id = $1 AND idempotency_key = $2 AND state = 'accepted'
     RETURNING state, outcome, error_code`,
    [userId, usageKey],
  );
  if (finalizedUsage.rowCount !== 1 || finalizedUsage.rows[0].state !== "failed") throw new Error("Agent usage finalization failed");

  second = await connect();
  const result = await second.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (result.rows.length !== 1 || result.rows[0].email !== email) {
    throw new Error("PostgreSQL persistence readback did not return the inserted user");
  }
  const usageReadback = await second.query(
    `SELECT p.consumed, l.state
     FROM agent_usage_periods p JOIN agent_usage_ledger l
       ON l.user_id = p.user_id AND l.metric = p.metric AND l.period_start = p.period_start
     WHERE p.user_id = $1 AND p.metric = 'agentChatRequests' AND p.period_start = $2`,
    [userId, usagePeriod],
  );
  if (usageReadback.rowCount !== 1 || Number(usageReadback.rows[0].consumed) !== 1 || usageReadback.rows[0].state !== "failed") {
    throw new Error("PostgreSQL Agent usage persistence readback failed");
  }
  await first.query(
    `INSERT INTO drawing_runs
      (run_id, owner_id, device_id, status, revision, intent, artifact_hashes, private_receipt_ids, start_idempotency_key, start_request_hash, error_category, created_at, updated_at)
     VALUES ($1, $2, $3, 'received', 0, '{"action":"create_figure","requestedDetail":"overview","target":"browser_preview","sourceKinds":["typed_text"]}'::jsonb, '[]'::jsonb, '[]'::jsonb, $4, $5, 'none', NOW(), NOW())`,
    [drawingRunId, userId, deviceOneId, `start-${drawingRunId}`, "0".repeat(64)],
  );
  await first.query(
    `INSERT INTO drawing_run_events
      (owner_id, run_id, event_id, revision, status, action, artifact_hashes, error_category, idempotency_key, occurred_at)
     VALUES ($1, $2, $3, 1, 'cancelled', 'failed', '[]'::jsonb, 'cancelled', $4, NOW())`,
    [userId, drawingRunId, drawingRunEventId, `smoke-${drawingRunId}`],
  );
  await first.query(
    `INSERT INTO private_input_receipts
      (owner_id, receipt_id, kind, mime_type, sha256, byte_length, retention, content_handle, content, created_at)
     VALUES ($1, $2, 'typed_text', 'text/plain', $3, $4, 'ephemeral', $5, $6, NOW()),
            ($1, $7, 'typed_text', 'text/plain', $8, $9, 'owner_revision', $10, $11, NOW())`,
    [userId, receiptId, receiptHash, receiptContent.byteLength, `content:${receiptId}`, receiptContent, ownerRevisionReceiptId, ownerRevisionHash, ownerRevisionContent.byteLength, `content:${ownerRevisionReceiptId}`, ownerRevisionContent],
  );
  await first.query(
    `INSERT INTO private_input_receipt_batches (owner_id, batch_hash, created_at)
     VALUES ($1, $2, NOW())`,
    [userId, receiptBatchHash],
  );
  await first.query(
    `INSERT INTO private_input_receipt_batch_items (owner_id, batch_hash, ordinal, receipt_id)
     VALUES ($1, $2, 0, $3)`,
    [userId, receiptBatchHash, receiptId],
  );
  await first.query(
    `INSERT INTO drawing_evidence_packs (owner_id, evidence_pack_hash, pack, created_at)
     VALUES ($1, $2, $3::jsonb, NOW())`,
    [userId, evidencePackHash, JSON.stringify({ ...evidencePackBody, hash: evidencePackHash })],
  );
  await first.query(
    `INSERT INTO drawing_local_proposals (owner_id, proposal_hash, proposal, created_at)
     VALUES ($1, $2, $3::jsonb, NOW())`,
    [userId, localProposalHash, JSON.stringify(localProposal)],
  );
  await first.query(
    `INSERT INTO drawing_artifacts (owner_id, artifact_kind, artifact_hash, artifact, created_at)
     VALUES ($1, 'qa', $2, $3::jsonb, NOW())`,
    [userId, qaArtifactHash, JSON.stringify(qaArtifact)],
  );
  const receiptReadback = await second.query(
    `SELECT r.receipt_id, r.sha256, r.retention, r.content
     FROM private_input_receipts r WHERE r.owner_id = $1 ORDER BY r.receipt_id`,
    [userId],
  );
  if (receiptReadback.rowCount !== 2 || receiptReadback.rows.some((row) => !Buffer.isBuffer(row.content))) throw new Error("PostgreSQL private receipt persistence readback failed");
  const ephemeralReadback = await first.query(
    `DELETE FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2 AND retention = 'ephemeral' RETURNING content`,
    [userId, receiptId],
  );
  if (ephemeralReadback.rowCount !== 1 || !ephemeralReadback.rows[0].content.equals(receiptContent)) throw new Error("PostgreSQL ephemeral receipt deletion failed");
  const ownerRevisionReadback = await second.query(
    `SELECT content FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2 AND retention = 'owner_revision'`,
    [userId, ownerRevisionReceiptId],
  );
  if (ownerRevisionReadback.rowCount !== 1 || !ownerRevisionReadback.rows[0].content.equals(ownerRevisionContent)) throw new Error("PostgreSQL owner_revision receipt retention failed");
  await first.query("DELETE FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2 AND retention = 'owner_revision'", [userId, ownerRevisionReceiptId]);
  const artifactReadback = await second.query(
    `SELECT (SELECT evidence_pack_hash FROM drawing_evidence_packs WHERE owner_id = $1 AND evidence_pack_hash = $2) AS evidence_hash,
            (SELECT proposal_hash FROM drawing_local_proposals WHERE owner_id = $1 AND proposal_hash = $3) AS proposal_hash,
            (SELECT artifact_hash FROM drawing_artifacts WHERE owner_id = $1 AND artifact_kind = 'qa' AND artifact_hash = $4) AS drawing_artifact_hash`,
    [userId, evidencePackHash, localProposalHash, qaArtifactHash],
  );
  if (artifactReadback.rowCount !== 1 || artifactReadback.rows[0].evidence_hash !== evidencePackHash || artifactReadback.rows[0].proposal_hash !== localProposalHash || artifactReadback.rows[0].drawing_artifact_hash !== qaArtifactHash) throw new Error("PostgreSQL drawing input artifact readback failed");
  const drawingRunReadback = await second.query(
    `SELECT r.status, r.revision, COUNT(e.event_id)::int AS event_count
     FROM drawing_runs r LEFT JOIN drawing_run_events e ON e.owner_id = r.owner_id AND e.run_id = r.run_id
     WHERE r.owner_id = $1 AND r.run_id = $2 GROUP BY r.status, r.revision`,
    [userId, drawingRunId],
  );
  if (drawingRunReadback.rowCount !== 1 || drawingRunReadback.rows[0].status !== "received" || Number(drawingRunReadback.rows[0].event_count) !== 1) {
    throw new Error("PostgreSQL Drawing Run persistence readback failed");
  }
  await second.end();
  second = null;
  await first.query("DELETE FROM users WHERE id = $1", [userId]);
  await first.end();
  first = null;
  console.log(`PostgreSQL smoke OK: persistence, session fencing, device challenges, and Agent usage ledger accepted for ${email}`);
} catch (error) {
  console.error(`PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await first?.end().catch(() => {});
  await second?.end().catch(() => {});
}
