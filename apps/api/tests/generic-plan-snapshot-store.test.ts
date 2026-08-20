import { describe, expect, it } from "vitest";
import { createGenericPlanSnapshot, type CreateGenericPlanSnapshotInput, type GenericPlanSnapshotOwner } from "../src/generic-plan-snapshot.js";
import { GenericPlanSnapshotStoreConflictError, InMemoryGenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";

const owner: GenericPlanSnapshotOwner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };

function input(overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  return {
    ...owner,
    graphId: "graph-1",
    ugsRevision: 1,
    ugsCanonicalHash: "a".repeat(64),
    generalPublicationGraphHash: "b".repeat(64),
    generalPublicationFigurePlanHash: "c".repeat(64),
    sourceHashes: ["d".repeat(64)],
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryGenericPlanSnapshotStore", () => {
  it("is insert-only for a deterministic owner/device/graph/revision identity", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.insert(owner, snapshot)).rejects.toBeInstanceOf(GenericPlanSnapshotStoreConflictError);
  });

  it("does not disclose snapshots across tenant, user, device, graph, or revision", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.get({ ...owner, tenantId: "tenant-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, userId: "user-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, deviceId: "device-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get(owner, "graph-2", snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get(owner, snapshot.graphId, 2, snapshot.snapshotId)).resolves.toBeNull();
  });

  it("returns clone-isolated deeply frozen snapshots", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const inserted = await store.insert(owner, createGenericPlanSnapshot(input()));
    const fetched = await store.get(owner, inserted.graphId, inserted.ugsRevision, inserted.snapshotId);
    expect(fetched).toEqual(inserted);
    expect(fetched).not.toBe(inserted);
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched!.sourceHashes)).toBe(true);
  });
});
