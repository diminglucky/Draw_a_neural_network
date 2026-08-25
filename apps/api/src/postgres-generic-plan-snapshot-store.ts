import {
  cloneGenericPlanSnapshot,
  type GenericPlanSnapshot,
  type GenericPlanSnapshotOwner,
} from "./generic-plan-snapshot.js";
import {
  confirmedPreviewHashForSnapshot,
  GenericPlanSnapshotStoreConflictError,
  type GenericPlanSnapshotStore,
} from "./generic-plan-snapshot-store.js";
import type { PoolLike } from "./postgres-store.js";

const AUTHENTICATED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const STRUCTURAL_ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const MAX_SNAPSHOT_BYTES = 8 * 1_048_576;

export class PostgresGenericPlanSnapshotStore implements GenericPlanSnapshotStore {
  constructor(private readonly pool: PoolLike) {}

  async insert(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): Promise<GenericPlanSnapshot> {
    assertOwner(owner);
    const canonical = cloneGenericPlanSnapshot(snapshot);
    if (!sameOwner(owner, canonical)) throw new Error("GenericPlanSnapshot owner does not match the store owner");
    const confirmedPreviewHash = confirmedPreviewHashForSnapshot(canonical);
    if (!confirmedPreviewHash) throw new Error("GenericPlanSnapshot is missing a trusted confirmed-preview promotion reason");
    const encoded = JSON.stringify(canonical);
    if (Buffer.byteLength(encoded, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("GenericPlanSnapshot is too large");
    const result = await this.pool.query(
      `INSERT INTO generic_plan_snapshots
         (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id, publication_visual_plan_hash, confirmed_preview_hash, snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
       ON CONFLICT DO NOTHING
       RETURNING snapshot_id`,
      [owner.tenantId, owner.userId, owner.deviceId, canonical.graphId, canonical.ugsRevision, canonical.snapshotId, canonical.publicationVisualPlanHash, confirmedPreviewHash, encoded, canonical.createdAt],
    );
    if (!result.rowCount) throw new GenericPlanSnapshotStoreConflictError();
    return cloneGenericPlanSnapshot(canonical);
  }

  async get(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    assertStructuralIdentifier(graphId, "graphId");
    if (!Number.isSafeInteger(ugsRevision) || ugsRevision <= 0) throw new Error("ugsRevision must be a positive safe integer");
    assertStructuralIdentifier(snapshotId, "snapshotId");
    const result = await this.pool.query(
      `SELECT snapshot
       FROM generic_plan_snapshots
       WHERE tenant_id = $1 AND user_id = $2 AND device_id = $3
         AND graph_id = $4 AND ugs_revision = $5 AND snapshot_id = $6`,
      [owner.tenantId, owner.userId, owner.deviceId, graphId, ugsRevision, snapshotId],
    );
    if (!result.rows[0]) return null;
    const snapshot = cloneGenericPlanSnapshot(parseJson(result.rows[0].snapshot));
    if (!sameOwner(owner, snapshot)
      || snapshot.graphId !== graphId
      || snapshot.ugsRevision !== ugsRevision
      || snapshot.snapshotId !== snapshotId) {
      throw new Error("Stored GenericPlanSnapshot identity does not match its locator");
    }
    return snapshot;
  }

  async getByPublicationVisualPlanHash(owner: GenericPlanSnapshotOwner, hash: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    const canonicalHash = canonicalDigest(hash, "publicationVisualPlanHash");
    const result = await this.pool.query(
      `SELECT publication_visual_plan_hash, snapshot
       FROM generic_plan_snapshots
       WHERE tenant_id = $1 AND user_id = $2 AND device_id = $3
         AND publication_visual_plan_hash = $4
       LIMIT 2`,
      [owner.tenantId, owner.userId, owner.deviceId, canonicalHash],
    );
    if (result.rows.length > 1 || (result.rowCount ?? 0) > 1) {
      throw new Error("GenericPlanSnapshot resolution is ambiguous for this owner, device, and PVP hash");
    }
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = cloneGenericPlanSnapshot(parseJson(row.snapshot));
    if (row.publication_visual_plan_hash !== canonicalHash
      || !sameOwner(owner, snapshot)
      || snapshot.publicationVisualPlanHash !== canonicalHash) {
      throw new Error("Stored GenericPlanSnapshot identity does not match its PVP hash locator");
    }
    return snapshot;
  }

  async getByConfirmedPreviewHash(owner: GenericPlanSnapshotOwner, pendingPreviewHash: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    const canonicalHash = canonicalDigest(pendingPreviewHash, "pendingPreviewHash");
    const result = await this.pool.query(
      `SELECT confirmed_preview_hash, snapshot
       FROM generic_plan_snapshots
       WHERE tenant_id = $1 AND user_id = $2 AND device_id = $3
         AND confirmed_preview_hash = $4
       LIMIT 2`,
      [owner.tenantId, owner.userId, owner.deviceId, canonicalHash],
    );
    if (result.rows.length > 1 || (result.rowCount ?? 0) > 1) {
      throw new Error("GenericPlanSnapshot resolution is ambiguous for this owner, device, and confirmed preview hash");
    }
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = cloneGenericPlanSnapshot(parseJson(row.snapshot));
    if (row.confirmed_preview_hash !== canonicalHash
      || !sameOwner(owner, snapshot)
      || confirmedPreviewHashForSnapshot(snapshot) !== canonicalHash) {
      throw new Error("Stored GenericPlanSnapshot identity does not match its confirmed preview hash locator");
    }
    return snapshot;
  }
}

function parseJson(value: unknown): GenericPlanSnapshot {
  try {
    return (typeof value === "string" ? JSON.parse(value) : structuredClone(value)) as GenericPlanSnapshot;
  } catch {
    throw new Error("Stored GenericPlanSnapshot JSON is invalid");
  }
}

function sameOwner(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): boolean {
  return owner.tenantId === snapshot.tenantId && owner.userId === snapshot.userId && owner.deviceId === snapshot.deviceId;
}

function assertOwner(owner: GenericPlanSnapshotOwner): void {
  assertAuthenticatedIdentifier(owner.tenantId, "tenantId");
  assertAuthenticatedIdentifier(owner.userId, "userId");
  assertAuthenticatedIdentifier(owner.deviceId, "deviceId");
}

function assertAuthenticatedIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !AUTHENTICATED_ID.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function assertStructuralIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !STRUCTURAL_ID.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function canonicalDigest(value: string, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
  return value.toLowerCase();
}
