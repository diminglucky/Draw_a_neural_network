import { describe, expect, it } from "vitest";
import { createPlanSnapshot } from "../src/plan-snapshot.js";
import { InMemoryPlanSnapshotStore } from "../src/plan-snapshot-store.js";

function snapshot(revision = 1) {
  return createPlanSnapshot({
    draftId: "draft-1", revision,
    figureSet: { version: 1, figureSetId: `figure-set-${revision}`, draftId: "draft-1", revision, intentHash: "f".repeat(64), panels: [{ panelId: "overview", title: "Overview", primitives: [{ id: "node-1", kind: "shape", semanticIds: ["node-1"] }] }], crossPanelMappings: [] },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "a".repeat(64) }],
    compilerManifest: { canonicalization: "RFC-8785-JCS", architectureIrHash: "b".repeat(64), figureIntentHash: "f".repeat(64), componentCompilerVersion: "1", layoutCompilerVersion: "1", styleTokenVersion: "1", layoutSeed: "seed" },
    visualQa: { status: "pass", checks: [] }, createdAt: "2026-08-14T00:00:00.000Z",
  });
}

describe("InMemoryPlanSnapshotStore", () => {
  it("stores an immutable snapshot once and retrieves it only for the owning revision", async () => {
    const store = new InMemoryPlanSnapshotStore();
    const first = snapshot();
    await expect(store.insert({ tenantId: "tenant-1", userId: "user-1" }, first)).resolves.toEqual(first);
    await expect(store.insert({ tenantId: "tenant-1", userId: "user-1" }, first)).rejects.toThrow(/immutable|exists/i);
    await expect(store.getForRevision({ tenantId: "tenant-1", userId: "user-1" }, "draft-1", 1, first.planId)).resolves.toEqual(first);
    await expect(store.getForRevision({ tenantId: "tenant-1", userId: "user-1" }, "draft-1", 2, first.planId)).resolves.toBeNull();
    await expect(store.getForRevision({ tenantId: "tenant-2", userId: "user-1" }, "draft-1", 1, first.planId)).resolves.toBeNull();
  });

  it("records only the exact viewed preview artifact set for a stored snapshot", async () => {
    const store = new InMemoryPlanSnapshotStore();
    const first = snapshot();
    await store.insert({ tenantId: "tenant-1", userId: "user-1" }, first);
    await expect(store.recordViewedPreview({ tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", draftId: "draft-1", revision: 1, planId: first.planId, planHash: first.canonicalPlanBytesSha256, previewArtifactHashes: first.previewArtifactHashes, viewedAt: "2026-08-14T00:01:00.000Z" })).resolves.toBeUndefined();
    await expect(store.recordViewedPreview({ tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", draftId: "draft-1", revision: 1, planId: first.planId, planHash: first.canonicalPlanBytesSha256, previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "c".repeat(64) }], viewedAt: "2026-08-14T00:01:00.000Z" })).rejects.toThrow(/artifact|exact/i);
  });
});
