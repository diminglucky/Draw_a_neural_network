import {
  cloneGenericPlanSnapshot,
  type GenericPlanSnapshot,
  type GenericPlanSnapshotOwner,
} from "./generic-plan-snapshot.js";
import { isPublicationVisualPlanQaPromotionReason } from "./publication-visual-plan-qa-promotion.js";

const QA_PROMOTION_PREFIX = "visual-qa:pvp-qa-1:";

export interface GenericPlanSnapshotStore {
  insert(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): Promise<GenericPlanSnapshot>;
  get(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): Promise<GenericPlanSnapshot | null>;
  getByPublicationVisualPlanHash(owner: GenericPlanSnapshotOwner, hash: string): Promise<GenericPlanSnapshot | null>;
  getByConfirmedPreviewHash(owner: GenericPlanSnapshotOwner, pendingPreviewHash: string): Promise<GenericPlanSnapshot | null>;
}

export class GenericPlanSnapshotStoreConflictError extends Error {
  constructor() {
    super("immutable GenericPlanSnapshot already exists");
    this.name = "GenericPlanSnapshotStoreConflictError";
  }
}

export class InMemoryGenericPlanSnapshotStore implements GenericPlanSnapshotStore {
  private readonly snapshots = new Map<string, GenericPlanSnapshot>();

  async insert(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): Promise<GenericPlanSnapshot> {
    assertOwner(owner);
    const canonical = cloneGenericPlanSnapshot(snapshot);
    if (!sameOwner(owner, canonical)) throw new Error("GenericPlanSnapshot owner does not match the store owner");
    const key = snapshotKey(owner, canonical.graphId, canonical.ugsRevision, canonical.snapshotId);
    if (this.snapshots.has(key)) throw new GenericPlanSnapshotStoreConflictError();
    const stored = cloneGenericPlanSnapshot(canonical);
    this.snapshots.set(key, stored);
    return cloneGenericPlanSnapshot(stored);
  }

  async get(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    assertStructuralIdentifier(graphId, "graphId");
    if (!Number.isSafeInteger(ugsRevision) || ugsRevision <= 0) throw new Error("ugsRevision must be a positive safe integer");
    assertStructuralIdentifier(snapshotId, "snapshotId");
    const snapshot = this.snapshots.get(snapshotKey(owner, graphId, ugsRevision, snapshotId));
    return snapshot ? cloneGenericPlanSnapshot(snapshot) : null;
  }

  async getByPublicationVisualPlanHash(owner: GenericPlanSnapshotOwner, hash: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    const canonicalHash = canonicalDigest(hash, "publicationVisualPlanHash");
    let match: GenericPlanSnapshot | null = null;
    for (const snapshot of this.snapshots.values()) {
      if (!sameOwner(owner, snapshot) || snapshot.publicationVisualPlanHash !== canonicalHash) continue;
      if (match) throw new Error("GenericPlanSnapshot resolution is ambiguous for this owner, device, and PVP hash");
      match = snapshot;
    }
    return match ? cloneGenericPlanSnapshot(match) : null;
  }

  async getByConfirmedPreviewHash(owner: GenericPlanSnapshotOwner, pendingPreviewHash: string): Promise<GenericPlanSnapshot | null> {
    assertOwner(owner);
    const canonicalHash = canonicalDigest(pendingPreviewHash, "pendingPreviewHash");
    let match: GenericPlanSnapshot | null = null;
    for (const snapshot of this.snapshots.values()) {
      if (!sameOwner(owner, snapshot)) continue;
      const confirmedPreviewHashes = confirmedPreviewHashesForSnapshot(snapshot);
      if (!confirmedPreviewHashes.includes(canonicalHash)) continue;
      if (confirmedPreviewHashes.length !== 1) throw new Error("GenericPlanSnapshot has ambiguous trusted QA promotion reasons");
      if (match) throw new Error("GenericPlanSnapshot resolution is ambiguous for this owner, device, and confirmed preview hash");
      match = snapshot;
    }
    return match ? cloneGenericPlanSnapshot(match) : null;
  }
}

export function confirmedPreviewHashForSnapshot(snapshot: GenericPlanSnapshot): string | null {
  const confirmedPreviewHashes = confirmedPreviewHashesForSnapshot(snapshot);
  if (confirmedPreviewHashes.length === 0) return null;
  if (confirmedPreviewHashes.length !== 1) throw new Error("GenericPlanSnapshot has ambiguous trusted QA promotion reasons");
  return confirmedPreviewHashes[0]!;
}

function confirmedPreviewHashesForSnapshot(snapshot: GenericPlanSnapshot): string[] {
  return snapshot.publicationVisualPlan.eligibility.formalReasons
    .filter(isPublicationVisualPlanQaPromotionReason)
    .map((reason) => reason.slice(QA_PROMOTION_PREFIX.length));
}

function snapshotKey(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, owner.deviceId, graphId, ugsRevision, snapshotId]);
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
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function assertStructuralIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function canonicalDigest(value: string, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
  return value.toLowerCase();
}
