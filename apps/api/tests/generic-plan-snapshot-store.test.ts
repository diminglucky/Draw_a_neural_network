import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "../src/publication-visual-plan.js";
import { createGenericPlanSnapshot, type CreateGenericPlanSnapshotInput, type GenericPlanSnapshotOwner } from "../src/generic-plan-snapshot.js";
import { GenericPlanSnapshotStoreConflictError, InMemoryGenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";

const owner: GenericPlanSnapshotOwner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };

function pvp(): PublicationVisualPlan {
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: "pvp:store", canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" },
    lineage: { ugsHash: "a".repeat(64), gpgHash: "b".repeat(64), sourceHashes: ["d".repeat(64)], composerHash: "c".repeat(64), profileSetHash: "e".repeat(64) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: 1000, height: 600 }, safeMargins: { x: 10, y: 10, width: 980, height: 580 } },
    regions: [], primitiveGroups: [], primitives: [], ports: [], connectors: [], annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] }, profileApplications: [], sourceMappings: [],
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
    updateIdentity: { ownerId: "user-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  });
}

function input(overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  return { ...owner, graphId: "graph-1", ugsRevision: 1, ugsCanonicalHash: "a".repeat(64), generalPublicationGraphHash: "b".repeat(64), publicationVisualPlan: pvp(), createdAt: "2026-08-20T00:00:00.000Z", ...overrides };
}

describe("InMemoryGenericPlanSnapshotStore", () => {
  it("is insert-only for a deterministic owner/device/graph/revision/PVP identity", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.insert(owner, snapshot)).rejects.toBeInstanceOf(GenericPlanSnapshotStoreConflictError);
  });

  it("does not disclose PVP Snapshots across tenant, user, device, graph, or revision", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.get({ ...owner, tenantId: "tenant-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, userId: "user-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, deviceId: "device-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get(owner, "graph-2", snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
  });

  it("rejects forged PVP metadata and retains only the canonical reconstructed Snapshot", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const canonical = createGenericPlanSnapshot(input());
    const hostile = { ...canonical };
    Object.defineProperty(hostile, "publicationVisualPlanHash", { configurable: true, enumerable: true, get() { return "f".repeat(64); } });

    await expect(store.insert(owner, hostile as never)).rejects.toThrow(/canonical|Snapshot|PVP/i);
    await expect(store.get(owner, canonical.graphId, canonical.ugsRevision, canonical.snapshotId)).resolves.toBeNull();
  });

  it("returns clone-isolated deeply frozen PVP Snapshots", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const inserted = await store.insert(owner, createGenericPlanSnapshot(input()));
    const fetched = await store.get(owner, inserted.graphId, inserted.ugsRevision, inserted.snapshotId);
    expect(fetched).toEqual(inserted);
    expect(fetched).not.toBe(inserted);
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched!.publicationVisualPlan)).toBe(true);
    expect(fetched!.publicationVisualPlan).not.toBe(inserted.publicationVisualPlan);
  });
});
