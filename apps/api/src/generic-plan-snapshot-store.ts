import {
  cloneGenericPlanSnapshot,
  type GenericPlanSnapshot,
  type GenericPlanSnapshotOwner,
} from "./generic-plan-snapshot.js";

export interface GenericPlanSnapshotStore {
  insert(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): Promise<GenericPlanSnapshot>;
  get(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): Promise<GenericPlanSnapshot | null>;
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
    assertIdentifier(graphId, "graphId");
    if (!Number.isSafeInteger(ugsRevision) || ugsRevision <= 0) throw new Error("ugsRevision must be a positive safe integer");
    assertIdentifier(snapshotId, "snapshotId");
    const snapshot = this.snapshots.get(snapshotKey(owner, graphId, ugsRevision, snapshotId));
    return snapshot ? cloneGenericPlanSnapshot(snapshot) : null;
  }
}

function snapshotKey(owner: GenericPlanSnapshotOwner, graphId: string, ugsRevision: number, snapshotId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, owner.deviceId, graphId, ugsRevision, snapshotId]);
}

function sameOwner(owner: GenericPlanSnapshotOwner, snapshot: GenericPlanSnapshot): boolean {
  return owner.tenantId === snapshot.tenantId && owner.userId === snapshot.userId && owner.deviceId === snapshot.deviceId;
}

function assertOwner(owner: GenericPlanSnapshotOwner): void {
  assertIdentifier(owner.tenantId, "tenantId");
  assertIdentifier(owner.userId, "userId");
  assertIdentifier(owner.deviceId, "deviceId");
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}
