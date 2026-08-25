import { describe, expect, it, vi } from "vitest";
import { InMemoryDrawingArtifactStore, digestDrawingArtifact, type DrawingArtifactStore } from "../src/drawing-input/drawing-artifacts.js";
import { createGenericPlanSnapshot, type GenericPlanSnapshotOwner } from "../src/generic-plan-snapshot.js";
import { InMemoryGenericPlanSnapshotStore, type GenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { SelectedPagePreviewReviewService } from "../src/selected-page-preview-review.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

const owner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };
const workflowId = "workflow-1";
const reviewedAt = "2026-08-25T08:00:00.000Z";
const expectedUgsHash = digestDrawingArtifact(parseUniversalGraphSpec(unknownDualStreamFusionUgs()));

async function pendingFixture(overrides: { ugs?: unknown; pvp?: unknown; workflowId?: string } = {}) {
  const ugs = parseUniversalGraphSpec(overrides.ugs ?? unknownDualStreamFusionUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pvp = overrides.pvp ?? compilePublicationVisualPlan({
    ugs,
    graph,
    updateIdentity: {
      ownerId: owner.userId,
      deviceId: owner.deviceId,
      workflowId: overrides.workflowId ?? workflowId,
      documentId: "browser-preview",
      pageId: "browser-preview",
      expectedRevision: ugs.revision,
    },
  });
  const artifacts = new InMemoryDrawingArtifactStore();
  const ugsHash = digestDrawingArtifact(ugs);
  await artifacts.putUgs(owner.userId, ugsHash, ugs);
  await artifacts.putPvp(owner.userId, (pvp as any).identity.canonicalHash, pvp as any);
  return { artifacts, ugs, graph, pvp: pvp as any, pendingPreviewHash: (pvp as any).identity.canonicalHash };
}

function service(artifacts: Pick<DrawingArtifactStore, "getPvp" | "getUgs">, snapshots: GenericPlanSnapshotStore) {
  return new SelectedPagePreviewReviewService({ artifacts, snapshots, now: () => new Date(reviewedAt) });
}

function request(overrides: { owner?: GenericPlanSnapshotOwner; workflowId?: string; expectedUgsHash?: string; pendingPreviewHash: string }) {
  return { owner, workflowId, expectedUgsHash, ...overrides };
}

describe("SelectedPagePreviewReviewService", () => {
  it("promotes a generic pending browser preview into one immutable snapshot", async () => {
    const fixture = await pendingFixture();
    const snapshots = new InMemoryGenericPlanSnapshotStore();

    const result = await service(fixture.artifacts, snapshots).confirm(request({ pendingPreviewHash: fixture.pendingPreviewHash }));

    expect(result.replayed).toBe(false);
    expect(result.snapshot.ugsRevision).toBe(fixture.ugs.revision);
    expect(result.snapshot.ugsCanonicalHash).toBe(digestDrawingArtifact(fixture.ugs));
    expect(result.snapshot.publicationVisualPlan.eligibility.formalReasons).toContain(`visual-qa:pvp-qa-1:${fixture.pendingPreviewHash}`);
    expect(result.decision).toMatchObject({
      reviewerId: owner.userId,
      reviewedAt,
      sourcePlanHash: fixture.pendingPreviewHash,
      approvedPlanHash: result.snapshot.publicationVisualPlanHash,
    });
  });

  it("accepts an authenticated drawing-run UUID that starts with a digit", async () => {
    const numericLeadingWorkflowId = "7f6d4b8a-8f0c-4ae3-9ca4-f539f670d703";
    const fixture = await pendingFixture({ workflowId: numericLeadingWorkflowId });

    const result = await service(fixture.artifacts, new InMemoryGenericPlanSnapshotStore()).confirm(request({
      workflowId: numericLeadingWorkflowId,
      pendingPreviewHash: fixture.pendingPreviewHash,
    }));

    expect(result.replayed).toBe(false);
    expect((result.snapshot.publicationVisualPlan.updateIdentity as { workflowId: string }).workflowId).toBe(numericLeadingWorkflowId);
  });

  it("rejects a pending preview whose UGS is not the Drawing Run formal UGS", async () => {
    const fixture = await pendingFixture();
    const snapshots = new InMemoryGenericPlanSnapshotStore();
    const insert = vi.spyOn(snapshots, "insert");

    await expect(service(fixture.artifacts, snapshots).confirm(request({
      expectedUgsHash: "f".repeat(64),
      pendingPreviewHash: fixture.pendingPreviewHash,
    }))).rejects.toThrow(/formal UGS/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("replays exactly one owner-device-workflow confirmation without another insert", async () => {
    const fixture = await pendingFixture();
    const snapshots = new InMemoryGenericPlanSnapshotStore();
    const insert = vi.spyOn(snapshots, "insert");
    const reviewer = service(fixture.artifacts, snapshots);
    const input = request({ pendingPreviewHash: fixture.pendingPreviewHash });

    const created = await reviewer.confirm(input);
    const replayed = await reviewer.confirm(input);

    expect(replayed).toMatchObject({ snapshot: created.snapshot, replayed: true });
    expect(replayed.decision).toMatchObject({ reviewerId: owner.userId, reviewedAt, sourcePlanHash: fixture.pendingPreviewHash });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["owner", request({ owner: { ...owner, userId: "user-2" }, pendingPreviewHash: "" })],
    ["device", request({ owner: { ...owner, deviceId: "device-2" }, pendingPreviewHash: "" })],
    ["workflow", request({ workflowId: "workflow-2", pendingPreviewHash: "" })],
  ])("does not let a foreign %s reuse a confirmed preview", async (_kind, foreign) => {
    const fixture = await pendingFixture();
    const snapshots = new InMemoryGenericPlanSnapshotStore();
    const insert = vi.spyOn(snapshots, "insert");
    const reviewer = service(fixture.artifacts, snapshots);
    await reviewer.confirm(request({ pendingPreviewHash: fixture.pendingPreviewHash }));
    insert.mockClear();

    await expect(reviewer.confirm({ ...foreign, pendingPreviewHash: fixture.pendingPreviewHash })).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing PVP", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({ getPvp: async () => null, getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts) })],
    ["tampered PVP", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({ getPvp: async () => ({ ...structuredClone(fixture.pvp), lineage: { ...fixture.pvp.lineage, gpgHash: "0".repeat(64) } }), getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts) })],
    ["missing UGS", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({ getPvp: fixture.artifacts.getPvp.bind(fixture.artifacts), getUgs: async () => null })],
    ["tampered UGS", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({ getPvp: fixture.artifacts.getPvp.bind(fixture.artifacts), getUgs: async () => ({ ...structuredClone(fixture.ugs), revision: 2 }) })],
    ["lineage mismatch", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({ ...structuredClone(fixture.pvp), lineage: { ...fixture.pvp.lineage, gpgHash: "0".repeat(64) } }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
    ["candidate", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({ ...structuredClone(fixture.pvp), eligibility: { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: "pending" } }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
    ["passed without trusted review", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({ ...structuredClone(fixture.pvp), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" } }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
    ["blocking reasons", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({ ...structuredClone(fixture.pvp), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: ["needs-review"], qaStatus: "pending" } }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
    ["failed structural QA", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({
        ...structuredClone(fixture.pvp),
        annotations: [
          { annotationId: "annotation:a", targetIds: [fixture.pvp.primitives[0].primitiveId], bounds: { x: 20, y: 20, width: 100, height: 60 }, text: "A", role: "note", styleTokenIds: [] },
          { annotationId: "annotation:b", targetIds: [fixture.pvp.primitives[1].primitiveId], bounds: { x: 60, y: 40, width: 100, height: 60 }, text: "B", role: "note", styleTokenIds: [] },
        ],
      }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
    ["non-browser target", async (fixture: Awaited<ReturnType<typeof pendingFixture>>) => ({
      getPvp: async () => createPublicationVisualPlan({ ...structuredClone(fixture.pvp), updateIdentity: { ...fixture.pvp.updateIdentity, documentId: "document-1", pageId: "page-1" } }),
      getUgs: fixture.artifacts.getUgs.bind(fixture.artifacts),
    })],
  ])("rejects %s before snapshot insertion", async (_name, buildArtifacts) => {
    const fixture = await pendingFixture();
    const snapshots = new InMemoryGenericPlanSnapshotStore();
    const insert = vi.spyOn(snapshots, "insert");

    await expect(service(await buildArtifacts(fixture), snapshots).confirm(request({ pendingPreviewHash: fixture.pendingPreviewHash }))).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns the verified existing snapshot after an immutable insert race", async () => {
    const fixture = await pendingFixture();
    const inner = new InMemoryGenericPlanSnapshotStore();
    const snapshots: GenericPlanSnapshotStore = {
      get: inner.get.bind(inner),
      getByPublicationVisualPlanHash: inner.getByPublicationVisualPlanHash.bind(inner),
      getByConfirmedPreviewHash: inner.getByConfirmedPreviewHash.bind(inner),
      async insert(snapshotOwner, snapshot) {
        await inner.insert(snapshotOwner, snapshot);
        throw new (await import("../src/generic-plan-snapshot-store.js")).GenericPlanSnapshotStoreConflictError();
      },
    };

    const result = await service(fixture.artifacts, snapshots).confirm(request({ pendingPreviewHash: fixture.pendingPreviewHash }));

    expect(result.replayed).toBe(true);
    expect(result.snapshot.publicationVisualPlan.eligibility.formalReasons).toContain(`visual-qa:pvp-qa-1:${fixture.pendingPreviewHash}`);
  });
});
