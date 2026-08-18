import {
  cloneAnalysisPlanSnapshot,
  type AnalysisPlanSnapshot,
  type AnalysisPlanSnapshotOwner,
} from "./analysis-plan-snapshot.js";

export interface AnalysisPlanSnapshotStore {
  insert(owner: AnalysisPlanSnapshotOwner, snapshot: AnalysisPlanSnapshot): Promise<AnalysisPlanSnapshot>;
  get(owner: AnalysisPlanSnapshotOwner, analysisId: string, snapshotId: string): Promise<AnalysisPlanSnapshot | null>;
}

export class AnalysisPlanSnapshotStoreConflictError extends Error {
  constructor() {
    super("immutable AnalysisPlanSnapshot already exists");
    this.name = "AnalysisPlanSnapshotStoreConflictError";
  }
}

export class InMemoryAnalysisPlanSnapshotStore implements AnalysisPlanSnapshotStore {
  private readonly snapshots = new Map<string, AnalysisPlanSnapshot>();

  async insert(owner: AnalysisPlanSnapshotOwner, snapshot: AnalysisPlanSnapshot): Promise<AnalysisPlanSnapshot> {
    assertOwner(owner);
    if (!snapshot.immutable) throw new Error("AnalysisPlanSnapshot must be immutable");
    if (snapshot.tenantId !== owner.tenantId || snapshot.userId !== owner.userId) throw new Error("AnalysisPlanSnapshot owner does not match the store owner");
    const key = snapshotKey(owner, snapshot.analysisId, snapshot.snapshotId);
    if (this.snapshots.has(key)) throw new AnalysisPlanSnapshotStoreConflictError();
    const stored = cloneAnalysisPlanSnapshot(snapshot);
    this.snapshots.set(key, stored);
    return cloneAnalysisPlanSnapshot(stored);
  }

  async get(owner: AnalysisPlanSnapshotOwner, analysisId: string, snapshotId: string): Promise<AnalysisPlanSnapshot | null> {
    assertOwner(owner);
    requireIdentifier(analysisId, "analysisId");
    requireIdentifier(snapshotId, "snapshotId");
    const snapshot = this.snapshots.get(snapshotKey(owner, analysisId, snapshotId));
    return snapshot ? cloneAnalysisPlanSnapshot(snapshot) : null;
  }
}

function snapshotKey(owner: AnalysisPlanSnapshotOwner, analysisId: string, snapshotId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, analysisId, snapshotId]);
}

function assertOwner(owner: AnalysisPlanSnapshotOwner): void {
  requireIdentifier(owner.tenantId, "tenantId");
  requireIdentifier(owner.userId, "userId");
}

function requireIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}
