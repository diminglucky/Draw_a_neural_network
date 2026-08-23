import { randomUUID } from "node:crypto";
import type {
  AgentUsageDuplicate,
  AgentUsageFinalizationInput,
  AgentUsageReservation,
  AgentUsageReservationInput,
  AuditRecord,
  Device,
  DeviceChallenge,
  FigureAnalysisCreationResult,
  FigureAnalysisRecord,
  FigureDraft,
  FigureDraftRevision,
  FigureDraftStatus,
  Job,
  Session,
  Subscription,
  User,
  VisioJobCreationResult,
} from "./domain.js";
import {
  assertFigureDraftPayloadStatus,
  parseFigureDraftRevisionPayload,
  type FigureDraftRevisionPayload,
} from "./figure-draft-payload.js";
import type { FoundationStore } from "./store.js";
import type { DrawingRun, DrawingRunEvent, DrawingRunStatus } from "./drawing-run/contracts.js";

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface PoolClientLike {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(error?: Error): void;
}

export interface PoolLike {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClientLike>;
  end?(): Promise<void>;
}

type Row = Record<string, any>;

function timestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string | number | Date).toISOString();
}

function requiredTimestamp(value: unknown): string {
  const result = timestamp(value);
  if (!result) throw new Error("Database row is missing a required timestamp");
  return result;
}

function figureDraftStatus(value: unknown): FigureDraftStatus {
  if (value === "needs_confirmation" || value === "ready_for_preview" || value === "failed") return value;
  throw new Error("Database row contains an invalid figure draft status");
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? JSON.parse(value) as T : value as T;
}

function mapUser(row: Row): User {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    status: row.status,
    roles: json(row.roles, []),
    createdAt: requiredTimestamp(row.created_at),
    lastLoginAt: timestamp(row.last_login_at),
  };
}

function mapDevice(row: Row): Device {
  return {
    id: String(row.id),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    name: String(row.name),
    publicKey: String(row.public_key ?? ""),
    fingerprintHash: String(row.fingerprint_hash),
    status: row.status,
    clientVersion: String(row.client_version),
    osVersion: String(row.os_version),
    createdAt: requiredTimestamp(row.created_at),
    lastSeenAt: timestamp(row.last_seen_at),
  };
}

function mapDeviceChallenge(row: Row): DeviceChallenge {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    value: String(row.challenge),
    expiresAt: requiredTimestamp(row.expires_at),
    consumedAt: timestamp(row.consumed_at),
    createdAt: requiredTimestamp(row.created_at),
  };
}

function mapFigureDraft(row: Row): FigureDraft {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: String(row.conversation_id),
    status: figureDraftStatus(row.status),
    currentRevision: Number(row.current_revision),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapFigureDraftRevision(row: Row): FigureDraftRevision {
  const status = figureDraftStatus(row.status);
  const payload = parseFigureDraftRevisionPayload(json(row.payload, {}), { statusCode: 500 });
  assertFigureDraftPayloadStatus(payload, status, 500);
  return {
    draftId: String(row.draft_id),
    revision: Number(row.revision),
    status,
    payload,
    createdAt: requiredTimestamp(row.created_at),
  };
}

function mapSession(row: Row): Session {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    status: row.status,
    accessTokenId: String(row.access_token_id),
    startedAt: requiredTimestamp(row.started_at),
    lastHeartbeatAt: requiredTimestamp(row.last_heartbeat_at),
    leaseExpiresAt: requiredTimestamp(row.lease_expires_at),
    leaseFencingToken: Number(row.lease_fencing_token ?? 1),
    revokedAt: timestamp(row.revoked_at),
  };
}

function mapSubscription(row: Row): Subscription {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    plan: String(row.plan_name ?? row.plan_id),
    status: row.status,
    startsAt: requiredTimestamp(row.starts_at),
    endsAt: timestamp(row.ends_at),
    features: json(row.features, []),
    limits: json(row.limits, {}),
  };
}

function mapJob(row: Row): Job {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    type: row.type,
    status: row.status,
    input: json(row.input, {}),
    output: row.output === null || row.output === undefined ? null : json(row.output, null),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: requiredTimestamp(row.created_at),
    startedAt: timestamp(row.started_at),
    completedAt: timestamp(row.completed_at),
  };
}

function mapAudit(row: Row): AuditRecord {
  return {
    id: String(row.id),
    actorType: row.actor_type,
    actorId: row.actor_id ?? null,
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: row.target_id ?? null,
    reason: row.reason ?? null,
    metadata: json(row.metadata, {}),
    createdAt: requiredTimestamp(row.created_at),
  };
}

function mapAgentUsage(row: Row): AgentUsageReservation {
  const limit = Number(row.limit_snapshot);
  const consumed = Number(row.consumed);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    metric: row.metric,
    periodStart: requiredTimestamp(row.period_start),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    amount: Number(row.amount),
    limit,
    consumed,
    remaining: Math.max(0, limit - consumed),
    state: row.state,
    outcome: row.outcome ?? null,
    provider: row.provider ?? null,
    errorCode: row.error_code ?? null,
    createdAt: requiredTimestamp(row.created_at),
    finalizedAt: timestamp(row.finalized_at),
  };
}

function drawingRunStatus(value: unknown): DrawingRunStatus {
  const statuses: DrawingRunStatus[] = [
    "received", "input_accepted", "analyzing", "awaiting_interpreter", "candidate_structure",
    "awaiting_clarification", "formal_ugs", "composing_pvp", "preview_ready", "awaiting_page_binding",
    "page_bound", "awaiting_apply_confirmation", "applying", "readback_verified", "cancelled", "rejected",
    "failed", "conflicted",
  ];
  if (typeof value === "string" && statuses.includes(value as DrawingRunStatus)) return value as DrawingRunStatus;
  throw new Error("Database row contains an invalid Drawing Run status");
}

function mapDrawingRun(row: Row): DrawingRun {
  return {
    runId: String(row.run_id),
    ownerId: String(row.owner_id),
    deviceId: String(row.device_id),
    status: drawingRunStatus(row.status),
    revision: Number(row.revision),
    intent: json(row.intent, {} as DrawingRun["intent"]),
    artifactHashes: json(row.artifact_hashes, []),
    privateReceiptIds: json(row.private_receipt_ids, []),
    startIdempotencyKey: String(row.start_idempotency_key),
    startRequestHash: String(row.start_request_hash),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
    clarification: row.clarification === null || row.clarification === undefined ? null : json(row.clarification, null),
    preview: row.preview === null || row.preview === undefined ? null : json(row.preview, null),
    errorCategory: String(row.error_category) as DrawingRun["errorCategory"],
  };
}

function mapDrawingRunEvent(row: Row): DrawingRunEvent {
  return {
    eventId: String(row.event_id),
    runId: String(row.run_id),
    revision: Number(row.revision),
    status: drawingRunStatus(row.status),
    action: row.action,
    artifactHashes: json(row.artifact_hashes, []),
    errorCategory: row.error_category,
    occurredAt: requiredTimestamp(row.occurred_at),
    ...(row.request_hash ? { requestHash: String(row.request_hash) } : {}),
  };
}

function figureAnalysisStatus(value: unknown): FigureAnalysisRecord["status"] {
  if (value === "needs_confirmation" || value === "candidate_structure" || value === "ready_for_preview" || value === "failed") return value;
  throw new Error("Database row contains an invalid figure analysis status");
}

function mapFigureAnalysis(row: Row): FigureAnalysisRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name),
    sourceMimeType: row.source_mime_type,
    sourceBytes: Number(row.source_bytes),
    sourceSha256: String(row.source_sha256),
    kind: "pytorch-source",
    status: figureAnalysisStatus(row.status),
    architectureIR: json(row.architecture_ir, null),
    unresolved: json(row.unresolved, []),
    blockingQuestion: json(row.blocking_question, null),
    evidenceGraph: json(row.evidence_graph, { version: 2, facts: [], relations: [] }),
    evidenceSummary: json(row.evidence_summary, { version: 2, facts: [], relations: [] }),
    sourceRef: {
      sourceRecordId: String(row.source_record_id),
      retentionClass: "analysis_source",
      sourceSha256: String(row.source_ref_sha256 ?? row.source_sha256),
      bytes: Number(row.source_ref_bytes ?? row.source_bytes),
    },
    warnings: json(row.warnings, []),
    capabilityVersion: "pytorch-static-linear-v0",
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

async function failFigureDraftTransaction(client: PoolClientLike, error: unknown): Promise<never> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original SQL/mapping error. The client is destroyed below.
  }
  const releaseError = error instanceof Error ? error : new Error("Figure draft transaction failed");
  try {
    client.release(releaseError);
  } catch {
    // pg release is synchronous; a release failure must not mask the original error.
  }
  throw error;
}

export class PostgresFoundationStore implements FoundationStore {
  constructor(private readonly pool: PoolLike) {}

  async close(): Promise<void> {
    await this.pool.end?.();
  }

  async createFigureDraft(
    draft: Omit<FigureDraft, "currentRevision">,
    payload: FigureDraftRevisionPayload,
  ): Promise<{ draft: FigureDraft; revision: FigureDraftRevision }> {
    const validatedPayload = parseFigureDraftRevisionPayload(payload);
    assertFigureDraftPayloadStatus(validatedPayload, draft.status);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO figure_drafts (id,user_id,conversation_id,status,current_revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING *`,
        [draft.id, draft.userId, draft.conversationId, draft.status, draft.createdAt, draft.updatedAt],
      );
      const revision = await client.query(
        `INSERT INTO figure_draft_revisions (draft_id,revision,status,payload,created_at)
         VALUES ($1,1,$2,$3,$4) RETURNING *`,
        [draft.id, draft.status, JSON.stringify(validatedPayload), draft.createdAt],
      );
      const mapped = {
        draft: mapFigureDraft(created.rows[0]),
        revision: mapFigureDraftRevision(revision.rows[0]),
      };
      await client.query("COMMIT");
      client.release();
      return mapped;
    } catch (error) {
      return failFigureDraftTransaction(client, error);
    }
  }

  async getFigureDraft(userId: string, draftId: string): Promise<FigureDraft | null> {
    const result = await this.pool.query(
      "SELECT * FROM figure_drafts WHERE id = $1 AND user_id = $2",
      [draftId, userId],
    );
    return result.rows[0] ? mapFigureDraft(result.rows[0]) : null;
  }

  async getFigureDraftRevision(
    userId: string,
    draftId: string,
    revision: number,
  ): Promise<FigureDraftRevision | null> {
    const result = await this.pool.query(
      `SELECT r.* FROM figure_draft_revisions r
       JOIN figure_drafts d ON d.id = r.draft_id
       WHERE d.user_id = $1 AND r.draft_id = $2 AND r.revision = $3`,
      [userId, draftId, revision],
    );
    return result.rows[0] ? mapFigureDraftRevision(result.rows[0]) : null;
  }

  async appendFigureDraftRevision(input: {
    userId: string;
    draftId: string;
    expectedRevision: number;
    status: FigureDraftStatus;
    payload: FigureDraftRevisionPayload;
    createdAt: string;
  }): Promise<{ conflict: boolean; draft: FigureDraft | null; revision: FigureDraftRevision | null }> {
    const payload = parseFigureDraftRevisionPayload(input.payload);
    assertFigureDraftPayloadStatus(payload, input.status);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE figure_drafts
         SET status = $4, current_revision = current_revision + 1, updated_at = $5
         WHERE id = $1 AND user_id = $2 AND current_revision = $3
         RETURNING *`,
        [input.draftId, input.userId, input.expectedRevision, input.status, input.createdAt],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        client.release();
        return { conflict: true, draft: null, revision: null };
      }
      const revision = await client.query(
        `INSERT INTO figure_draft_revisions (draft_id,revision,status,payload,created_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.draftId, input.expectedRevision + 1, input.status, JSON.stringify(payload), input.createdAt],
      );
      const mapped = {
        conflict: false,
        draft: mapFigureDraft(updated.rows[0]),
        revision: mapFigureDraftRevision(revision.rows[0]),
      };
      await client.query("COMMIT");
      client.release();
      return mapped;
    } catch (error) {
      return failFigureDraftTransaction(client, error);
    }
  }

  async createUser(user: User): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO users (id, email, password_hash, status, roles, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, email, password_hash, status, roles, created_at, last_login_at`,
      [user.id, user.email, user.passwordHash, user.status, JSON.stringify(user.roles), user.createdAt, user.lastLoginAt],
    );
    return mapUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, status, roles, created_at, last_login_at
       FROM users WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async getUser(id: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, status, roles, created_at, last_login_at
       FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, status, roles, created_at, last_login_at
       FROM users ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUser);
  }

  async updateUser(user: User): Promise<User> {
    const result = await this.pool.query(
      `UPDATE users SET email = $2, password_hash = $3, status = $4, roles = $5::jsonb, last_login_at = $6
       WHERE id = $1
       RETURNING id, email, password_hash, status, roles, created_at, last_login_at`,
      [user.id, user.email, user.passwordHash, user.status, JSON.stringify(user.roles), user.lastLoginAt],
    );
    return mapUser(result.rows[0]);
  }

  async createDevice(device: Device): Promise<Device> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [device.id, device.userId, device.name, device.fingerprintHash, device.status, device.clientVersion, device.osVersion, device.createdAt, device.lastSeenAt],
      );
      await client.query(
        `INSERT INTO device_keys (device_id, public_key, algorithm, created_at)
         VALUES ($1, $2, 'Ed25519', $3)`,
        [device.id, device.publicKey, device.createdAt],
      );
      await client.query("COMMIT");
      return device;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getDevice(id: string): Promise<Device | null> {
    const result = await this.pool.query(
      `SELECT d.id, d.user_id, d.name, dk.public_key, d.fingerprint_hash, d.status,
              d.client_version, d.os_version, d.created_at, d.last_seen_at
       FROM devices d LEFT JOIN device_keys dk ON dk.device_id = d.id
       WHERE d.id = $1`,
      [id],
    );
    return result.rows[0] ? mapDevice(result.rows[0]) : null;
  }

  async listDevicesByUser(userId: string): Promise<Device[]> {
    const result = await this.pool.query(
      `SELECT d.id, d.user_id, d.name, dk.public_key, d.fingerprint_hash, d.status,
              d.client_version, d.os_version, d.created_at, d.last_seen_at
       FROM devices d LEFT JOIN device_keys dk ON dk.device_id = d.id
       WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
      [userId],
    );
    return result.rows.map(mapDevice);
  }

  async updateDevice(device: Device): Promise<Device> {
    const result = await this.pool.query(
      `UPDATE devices SET user_id = $2, name = $3, fingerprint_hash = $4, status = $5,
          client_version = $6, os_version = $7, last_seen_at = $8 WHERE id = $1
       RETURNING id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at, last_seen_at`,
      [device.id, device.userId, device.name, device.fingerprintHash, device.status, device.clientVersion, device.osVersion, device.lastSeenAt],
    );
    await this.pool.query(
      `INSERT INTO device_keys (device_id, public_key, algorithm, created_at)
       VALUES ($1, $2, 'Ed25519', $3)
       ON CONFLICT (device_id) DO UPDATE SET public_key = EXCLUDED.public_key`,
      [device.id, device.publicKey, device.createdAt],
    );
    return mapDevice({ ...result.rows[0], public_key: device.publicKey });
  }

  async createDeviceChallenge(challenge: DeviceChallenge): Promise<DeviceChallenge> {
    const result = await this.pool.query(
      `INSERT INTO device_challenges (id, user_id, device_id, challenge, expires_at, consumed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, device_id, challenge, expires_at, consumed_at, created_at`,
      [challenge.id, challenge.userId, challenge.deviceId, challenge.value, challenge.expiresAt, challenge.consumedAt, challenge.createdAt],
    );
    return mapDeviceChallenge(result.rows[0]);
  }

  async getDeviceChallenge(id: string): Promise<DeviceChallenge | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, challenge, expires_at, consumed_at, created_at
       FROM device_challenges WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapDeviceChallenge(result.rows[0]) : null;
  }

  async consumeDeviceChallenge(id: string, now: Date): Promise<DeviceChallenge | null> {
    const result = await this.pool.query(
      `UPDATE device_challenges SET consumed_at = $2
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2
       RETURNING id, user_id, device_id, challenge, expires_at, consumed_at, created_at`,
      [id, now.toISOString()],
    );
    return result.rows[0] ? mapDeviceChallenge(result.rows[0]) : null;
  }

  async getSession(id: string): Promise<Session | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at
       FROM sessions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listSessions(): Promise<Session[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at
       FROM sessions ORDER BY started_at DESC`,
    );
    return result.rows.map(mapSession);
  }

  async getActiveSessionByUser(userId: string): Promise<Session | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at
       FROM sessions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async createSession(session: Session): Promise<Session> {
    const result = await this.pool.query(
      `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at`,
      [session.id, session.userId, session.deviceId, session.status, session.accessTokenId, session.startedAt, session.lastHeartbeatAt, session.leaseExpiresAt, session.leaseFencingToken, session.revokedAt],
    );
    return mapSession(result.rows[0]);
  }

  async updateSession(session: Session, expectedFencingToken?: number): Promise<Session | null> {
    const where = expectedFencingToken === undefined ? "WHERE id = $1" : "WHERE id = $1 AND status = 'active' AND lease_fencing_token = $6";
    const result = await this.pool.query(
      `UPDATE sessions SET status = $2, last_heartbeat_at = $3, lease_expires_at = $4, revoked_at = $5
       ${where}
       RETURNING id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at`,
      expectedFencingToken === undefined
        ? [session.id, session.status, session.lastHeartbeatAt, session.leaseExpiresAt, session.revokedAt]
        : [session.id, session.status, session.lastHeartbeatAt, session.leaseExpiresAt, session.revokedAt, expectedFencingToken],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async claimActiveSession(userId: string, session: Session, now: Date): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const current = await client.query(
        `SELECT id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at
         FROM sessions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId],
      );
      const active = current.rows[0] ? mapSession(current.rows[0]) : null;
      if (active && new Date(active.leaseExpiresAt).getTime() > now.getTime()) {
        await client.query("ROLLBACK");
        return false;
      }
      if (active) {
        await client.query("UPDATE sessions SET status = 'expired' WHERE id = $1", [active.id]);
      }
      await client.query(
        `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [session.id, session.userId, session.deviceId, session.status, session.accessTokenId, session.startedAt, session.lastHeartbeatAt, session.leaseExpiresAt, session.leaseFencingToken, session.revokedAt],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      if (uniqueViolation(error)) return false;
      throw error;
    } finally {
      client.release();
    }
  }

  async createSubscription(subscription: Subscription): Promise<Subscription> {
    const result = await this.pool.query(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, ends_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, user_id, plan_id, status, starts_at, ends_at`,
      [subscription.id, subscription.userId, subscription.plan, subscription.status, subscription.startsAt, subscription.endsAt],
    );
    return mapSubscription({ ...result.rows[0], plan_name: subscription.plan, features: subscription.features, limits: subscription.limits });
  }

  async getCurrentSubscription(userId: string): Promise<Subscription | null> {
    const result = await this.pool.query(
      `SELECT s.id, s.user_id, s.plan_id, p.name AS plan_name, s.status, s.starts_at, s.ends_at,
              COALESCE(p.features, '[]'::jsonb) AS features, COALESCE(p.limits, '{}'::jsonb) AS limits
       FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status IN ('trialing', 'active')
         AND (s.ends_at IS NULL OR s.ends_at > NOW())
       ORDER BY s.starts_at DESC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async createJob(job: Job): Promise<Job> {
    const result = await this.pool.query(
      `INSERT INTO jobs (id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
       RETURNING id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at`,
      [job.id, job.userId, job.deviceId, job.type, job.status, JSON.stringify(job.input), job.output === null ? null : JSON.stringify(job.output), job.errorCode, job.errorMessage, job.createdAt, job.startedAt, job.completedAt],
    );
    return mapJob(result.rows[0]);
  }

  async createVisioJobIdempotent(input: { job: Job; idempotencyKey: string; requestHash: string }): Promise<VisioJobCreationResult> {
    const client = await this.pool.connect();
    const columns = "id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at";
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO jobs (id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, type, ((input->>'idempotencyKey')))
           WHERE type = 'visio-export' AND input ? 'idempotencyKey'
         DO NOTHING
         RETURNING ${columns}`,
        [input.job.id, input.job.userId, input.job.deviceId, input.job.type, input.job.status, JSON.stringify(input.job.input), input.job.output === null ? null : JSON.stringify(input.job.output), input.job.errorCode, input.job.errorMessage, input.job.createdAt, input.job.startedAt, input.job.completedAt],
      );
      if (inserted.rows[0]) {
        await client.query("COMMIT");
        return { job: mapJob(inserted.rows[0]), duplicate: false, requestHashMatches: true };
      }
      const existing = await client.query(
        `SELECT ${columns}
         FROM jobs
         WHERE user_id = $1 AND type = 'visio-export' AND input->>'idempotencyKey' = $2
         FOR UPDATE`,
        [input.job.userId, input.idempotencyKey],
      );
      if (!existing.rows[0]) throw new Error("Visio idempotency conflict did not return the existing Job");
      const existingJob = mapJob(existing.rows[0]);
      const existingInput = existingJob.input && typeof existingJob.input === "object" ? existingJob.input as Record<string, unknown> : {};
      await client.query("COMMIT");
      return { job: existingJob, duplicate: true, requestHashMatches: existingInput.requestHash === input.requestHash };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getJob(id: string): Promise<Job | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at
       FROM jobs WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async listJobs(): Promise<Job[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at
       FROM jobs ORDER BY created_at DESC`,
    );
    return result.rows.map(mapJob);
  }

  async updateJob(job: Job): Promise<Job> {
    const result = await this.pool.query(
      `UPDATE jobs SET status = $2, output = $3::jsonb, error_code = $4, error_message = $5, started_at = $6, completed_at = $7
       WHERE id = $1
       RETURNING id, user_id, device_id, type, status, input, output, error_code, error_message, created_at, started_at, completed_at`,
      [job.id, job.status, job.output === null ? null : JSON.stringify(job.output), job.errorCode, job.errorMessage, job.startedAt, job.completedAt],
    );
    return mapJob(result.rows[0]);
  }

  async createFigureAnalysisIdempotent(input: { record: FigureAnalysisRecord; sourceCode: string; idempotencyKey: string; requestHash: string }): Promise<FigureAnalysisCreationResult> {
    const columns = `id, user_id, source_id, source_name, source_mime_type, source_bytes, source_sha256,
      kind, status, architecture_ir, unresolved, blocking_question, evidence_graph, evidence_summary,
      source_record_id, source_ref_sha256, source_ref_bytes, warnings, capability_version,
      idempotency_key, request_hash, created_at, updated_at`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT ${columns} FROM figure_analyses WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.record.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const record = mapFigureAnalysis(existing.rows[0]);
        await client.query("COMMIT");
        client.release();
        return { record, duplicate: true, requestHashMatches: String(existing.rows[0].request_hash) === input.requestHash };
      }

      await client.query(
        `INSERT INTO figure_analysis_sources
          (id, user_id, source_id, source_sha256, source_bytes, source_code, retention_class, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [input.record.sourceRef.sourceRecordId, input.record.userId, input.record.sourceId, input.record.sourceSha256, input.record.sourceBytes, input.sourceCode, input.record.sourceRef.retentionClass, input.record.createdAt],
      );
      const inserted = await client.query(
        `INSERT INTO figure_analyses
          (id, user_id, source_id, source_name, source_mime_type, source_bytes, source_sha256,
           kind, status, architecture_ir, unresolved, blocking_question, evidence_graph, evidence_summary,
           source_record_id, source_ref_sha256, source_ref_bytes, warnings, capability_version,
           idempotency_key, request_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
                 $14::jsonb, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING ${columns}`,
        [
          input.record.id,
          input.record.userId,
          input.record.sourceId,
          input.record.sourceName,
          input.record.sourceMimeType,
          input.record.sourceBytes,
          input.record.sourceSha256,
          input.record.kind,
          input.record.status,
          JSON.stringify(input.record.architectureIR),
          JSON.stringify(input.record.unresolved),
          JSON.stringify(input.record.blockingQuestion),
          JSON.stringify(input.record.evidenceGraph),
          JSON.stringify(input.record.evidenceSummary),
          input.record.sourceRef.sourceRecordId,
          input.record.sourceRef.sourceSha256,
          input.record.sourceRef.bytes,
          JSON.stringify(input.record.warnings),
          input.record.capabilityVersion,
          input.idempotencyKey,
          input.requestHash,
          input.record.createdAt,
          input.record.updatedAt,
        ],
      );
      if (inserted.rows[0]) {
        const record = mapFigureAnalysis(inserted.rows[0]);
        await client.query("COMMIT");
        client.release();
        return { record, duplicate: false, requestHashMatches: true };
      }

      const duplicate = await client.query(
        `SELECT ${columns} FROM figure_analyses WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.record.userId, input.idempotencyKey],
      );
      if (!duplicate.rows[0]) throw new Error("Figure analysis idempotency conflict did not return the existing record");
      const record = mapFigureAnalysis(duplicate.rows[0]);
      await client.query("COMMIT");
      client.release();
      return { record, duplicate: true, requestHashMatches: String(duplicate.rows[0].request_hash) === input.requestHash };
    } catch (error) {
      return failFigureDraftTransaction(client, error);
    }
  }

  async getFigureAnalysis(userId: string, id: string): Promise<FigureAnalysisRecord | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, source_id, source_name, source_mime_type, source_bytes, source_sha256,
              kind, status, architecture_ir, unresolved, blocking_question, evidence_graph, evidence_summary,
              source_record_id, source_ref_sha256, source_ref_bytes, warnings, capability_version,
              idempotency_key, request_hash, created_at, updated_at
       FROM figure_analyses WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return result.rows[0] ? mapFigureAnalysis(result.rows[0]) : null;
  }

  async createAuditRecord(record: AuditRecord): Promise<AuditRecord> {
    const result = await this.pool.query(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING id, actor_type, actor_id, action, target_type, target_id, reason, metadata, created_at`,
      [record.id, record.actorType, record.actorId, record.action, record.targetType, record.targetId, record.reason, JSON.stringify(record.metadata), record.createdAt],
    );
    return mapAudit(result.rows[0]);
  }

  async listAuditRecords(): Promise<AuditRecord[]> {
    const result = await this.pool.query(
      `SELECT id, actor_type, actor_id, action, target_type, target_id, reason, metadata, created_at
       FROM audit_logs ORDER BY created_at DESC`,
    );
    return result.rows.map(mapAudit);
  }

  async reserveAgentUsage(input: AgentUsageReservationInput): Promise<AgentUsageReservation | AgentUsageDuplicate | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO agent_usage_periods (user_id, metric, period_start, limit_snapshot, consumed, updated_at)
         VALUES ($1, $2, $3, $4, 0, NOW())
         ON CONFLICT (user_id, metric, period_start) DO NOTHING`,
        [input.userId, input.metric, input.periodStart, input.limit],
      );

      const periodResult = await client.query(
        `SELECT user_id, metric, period_start, limit_snapshot, consumed, updated_at
         FROM agent_usage_periods
         WHERE user_id = $1 AND metric = $2 AND period_start = $3
         FOR UPDATE`,
        [input.userId, input.metric, input.periodStart],
      );
      const period = periodResult.rows[0];
      if (!period) throw new Error("Agent usage period could not be created");

      const existingResult = await client.query(
        `SELECT id, user_id, metric, period_start, idempotency_key, request_hash, amount,
                limit_snapshot, consumed, state, outcome, provider, error_code, created_at, finalized_at
         FROM agent_usage_ledger
         WHERE user_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.userId, input.idempotencyKey],
      );
      if (existingResult.rows[0]) {
        await client.query("COMMIT");
        const reservation = mapAgentUsage(existingResult.rows[0]);
        return {
          duplicate: true,
          requestHashMatches: reservation.requestHash === input.requestHash,
          reservation,
        };
      }

      const updatedPeriodResult = await client.query(
        `UPDATE agent_usage_periods
         SET consumed = consumed + $4, updated_at = NOW()
         WHERE user_id = $1 AND metric = $2 AND period_start = $3
           AND consumed + $4 <= limit_snapshot
         RETURNING user_id, metric, period_start, limit_snapshot, consumed, updated_at`,
        [input.userId, input.metric, input.periodStart, input.amount],
      );
      const updatedPeriod = updatedPeriodResult.rows[0];
      if (!updatedPeriod) {
        await client.query("ROLLBACK");
        return null;
      }

      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const ledgerResult = await client.query(
        `INSERT INTO agent_usage_ledger
          (id, user_id, metric, period_start, idempotency_key, request_hash, amount,
           limit_snapshot, consumed, state, outcome, provider, error_code, created_at, finalized_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'accepted', NULL, NULL, NULL, $10, NULL)
         RETURNING id, user_id, metric, period_start, idempotency_key, request_hash, amount,
                   limit_snapshot, consumed, state, outcome, provider, error_code, created_at, finalized_at`,
        [
          id,
          input.userId,
          input.metric,
          input.periodStart,
          input.idempotencyKey,
          input.requestHash,
          input.amount,
          updatedPeriod.limit_snapshot,
          updatedPeriod.consumed,
          createdAt,
        ],
      );
      await client.query("COMMIT");
      return mapAgentUsage(ledgerResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeAgentUsage(input: AgentUsageFinalizationInput): Promise<AgentUsageReservation | null> {
    const finalizedAt = input.finalizedAt ?? new Date().toISOString();
    const result = await this.pool.query(
      `UPDATE agent_usage_ledger
       SET state = $2, outcome = $3, provider = $4, error_code = $5, finalized_at = $6
       WHERE id = $1 AND state = 'accepted'
       RETURNING id, user_id, metric, period_start, idempotency_key, request_hash, amount,
                 limit_snapshot, consumed, state, outcome, provider, error_code, created_at, finalized_at`,
      [input.id, input.state, input.outcome, input.provider ?? null, input.errorCode ?? null, finalizedAt],
    );
    if (result.rows[0]) return mapAgentUsage(result.rows[0]);

    const existing = await this.pool.query(
      `SELECT id, user_id, metric, period_start, idempotency_key, request_hash, amount,
              limit_snapshot, consumed, state, outcome, provider, error_code, created_at, finalized_at
       FROM agent_usage_ledger WHERE id = $1`,
      [input.id],
    );
    return existing.rows[0] ? mapAgentUsage(existing.rows[0]) : null;
  }

  async createDrawingRun(run: DrawingRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO drawing_runs
       (run_id, owner_id, device_id, status, revision, intent, artifact_hashes, private_receipt_ids, start_idempotency_key, start_request_hash, clarification, preview, error_category, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        run.runId, run.ownerId, run.deviceId, run.status, run.revision, JSON.stringify(run.intent),
        JSON.stringify(run.artifactHashes), JSON.stringify(run.privateReceiptIds),
        run.startIdempotencyKey, run.startRequestHash,
        run.clarification ? JSON.stringify(run.clarification) : null,
        run.preview ? JSON.stringify(run.preview) : null,
        run.errorCategory, run.createdAt, run.updatedAt,
      ],
    );
  }

  async getDrawingRunByStartIdempotency(ownerId: string, deviceId: string, idempotencyKey: string): Promise<DrawingRun | null> {
    const result = await this.pool.query(
      "SELECT * FROM drawing_runs WHERE owner_id = $1 AND device_id = $2 AND start_idempotency_key = $3",
      [ownerId, deviceId, idempotencyKey],
    );
    return result.rows[0] ? mapDrawingRun(result.rows[0]) : null;
  }

  async getDrawingRun(ownerId: string, runId: string): Promise<DrawingRun | null> {
    const result = await this.pool.query(
      "SELECT * FROM drawing_runs WHERE owner_id = $1 AND run_id = $2",
      [ownerId, runId],
    );
    return result.rows[0] ? mapDrawingRun(result.rows[0]) : null;
  }

  async listDrawingRunsForRecovery(): Promise<DrawingRun[]> {
    const result = await this.pool.query(
      `SELECT * FROM drawing_runs
       WHERE status NOT IN ('readback_verified', 'cancelled', 'rejected', 'failed', 'conflicted')
       ORDER BY updated_at ASC, run_id ASC`,
    );
    return result.rows.map(mapDrawingRun);
  }

  async compareAndSetDrawingRun(input: { ownerId: string; runId: string; expectedRevision: number; next: DrawingRun }): Promise<"updated" | "conflict"> {
    const run = input.next;
    const result = await this.pool.query(
      `UPDATE drawing_runs
       SET status = $4, revision = $5, intent = $6, artifact_hashes = $7, private_receipt_ids = $8,
           clarification = $9, preview = $10, error_category = $11, updated_at = $12
       WHERE owner_id = $1 AND run_id = $2 AND revision = $3
       RETURNING *`,
      [
        input.ownerId, input.runId, input.expectedRevision, run.status, run.revision, JSON.stringify(run.intent),
        JSON.stringify(run.artifactHashes), JSON.stringify(run.privateReceiptIds),
        run.clarification ? JSON.stringify(run.clarification) : null,
        run.preview ? JSON.stringify(run.preview) : null,
        run.errorCategory, run.updatedAt,
      ],
    );
    return result.rowCount === 1 ? "updated" : "conflict";
  }

  async appendDrawingRunEvent(event: DrawingRunEvent, idempotencyKey: string): Promise<DrawingRunEvent> {
    const inserted = await this.pool.query(
      `INSERT INTO drawing_run_events
       (owner_id, run_id, event_id, revision, status, action, artifact_hashes, error_category, idempotency_key, request_hash, occurred_at)
       SELECT owner_id, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       FROM drawing_runs WHERE run_id = $1
       ON CONFLICT (owner_id, run_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [event.runId, event.eventId, event.revision, event.status, event.action, JSON.stringify(event.artifactHashes), event.errorCategory, idempotencyKey, event.requestHash ?? null, event.occurredAt],
    );
    if (inserted.rows[0]) return mapDrawingRunEvent(inserted.rows[0]);
    const existing = await this.pool.query(
      "SELECT * FROM drawing_run_events WHERE run_id = $1 AND idempotency_key = $2",
      [event.runId, idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error("Drawing Run event could not be persisted");
    return mapDrawingRunEvent(existing.rows[0]);
  }

  async getDrawingRunEvent(ownerId: string, runId: string, idempotencyKey: string): Promise<DrawingRunEvent | null> {
    const result = await this.pool.query(
      "SELECT e.* FROM drawing_run_events e WHERE e.owner_id = $1 AND e.run_id = $2 AND e.idempotency_key = $3",
      [ownerId, runId, idempotencyKey],
    );
    return result.rows[0] ? mapDrawingRunEvent(result.rows[0]) : null;
  }

  async listDrawingRunEvents(ownerId: string, runId: string): Promise<DrawingRunEvent[]> {
    const result = await this.pool.query(
      "SELECT e.* FROM drawing_run_events e WHERE e.owner_id = $1 AND e.run_id = $2 ORDER BY e.revision ASC, e.occurred_at ASC, e.event_id ASC",
      [ownerId, runId],
    );
    return result.rows.map(mapDrawingRunEvent);
  }
}
