import { describe, expect, it, vi } from "vitest";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../src/publication-visual-plan-qa-promotion.js";
import { GenericPlanSnapshotService } from "../src/generic-plan-snapshot-service.js";
import { InMemoryGenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

const owner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };

function fixture(overrides: { pvp?: unknown; ugs?: any; graph?: any } = {}) {
  const source = overrides.ugs || unknownDualStreamFusionUgs();
  const ugs = parseUniversalGraphSpec(source);
  const graph = overrides.graph || composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pending = compilePublicationVisualPlan({ ugs, graph, updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 } });
  const formalPassed = promotePublicationVisualPlanAfterTrustedReview({
    plan: pending,
    review: { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-20T08:00:00.000Z", approval: "approved", expectedPlanHash: pending.identity.canonicalHash },
  }).plan;
  return { ugs, graph, pvp: overrides.pvp || formalPassed };
}

function request(overrides: Record<string, unknown> = {}) {
  const value = fixture();
  return { owner, ugsRevision: 1, ugs: value.ugs, graph: value.graph, publicationVisualPlan: value.pvp, createdAt: "2026-08-20T00:00:00.000Z", ...overrides };
}

describe("GenericPlanSnapshotService", () => {
  it("persists one owner/device/revision-bound QA-passed canonical PVP", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const service = new GenericPlanSnapshotService({ store });
    const created = await service.create(request());

    expect(created.version).toBe(2);
    expect(created.publicationVisualPlanId).toMatch(/^pvp:/);
    expect(created.publicationVisualPlan.eligibility).toMatchObject({ kind: "formal", qaStatus: "passed" });
    await expect(store.get(owner, created.graphId, created.ugsRevision, created.snapshotId)).resolves.toEqual(created);
  });

  it.each([
    ["candidate", () => {
      const source = unknownDualStreamFusionUgs();
      source.edges[1] = { ...source.edges[1], relation: "candidate", knowledge: "candidate" };
      const ugs = parseUniversalGraphSpec(source);
      const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
      return request({ ugs, graph, publicationVisualPlan: compilePublicationVisualPlan({ ugs, graph, updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 } }) });
    }],
    ["formal pending", () => {
      const value = fixture();
      return request({ ugs: value.ugs, graph: value.graph, publicationVisualPlan: compilePublicationVisualPlan({ ugs: value.ugs, graph: value.graph, updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 } }) });
    }],
    ["feedback", () => {
      const source = unknownDualStreamFusionUgs();
      source.edges.push({ edgeId: "feedback", sourcePortId: "spectral_fusion:out", targetPortId: "texture_mixer:in", relation: "feedback", knowledge: "proven", evidenceIds: ["e-fusion"] });
      const ugs = parseUniversalGraphSpec(source);
      const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
      const pending = compilePublicationVisualPlan({ ugs, graph, updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 } });
      const forgedFormal = createPublicationVisualPlan({ ...structuredClone(pending), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" } });
      return request({ ugs, graph, publicationVisualPlan: forgedFormal });
    }],
    ["forged lineage", () => {
      const value = fixture();
      const plan = value.pvp as any;
      const forged = createPublicationVisualPlan({ ...structuredClone(plan), lineage: { ...(plan.lineage as object), gpgHash: "0".repeat(64) } });
      return request({ ugs: value.ugs, graph: value.graph, publicationVisualPlan: forged });
    }],
    ["foreign PVP identity", () => {
      const value = fixture();
      const plan = value.pvp as any;
      const foreign = createPublicationVisualPlan({ ...structuredClone(plan), updateIdentity: { ...(plan.updateIdentity as object), ownerId: "user-2" } });
      return request({ ugs: value.ugs, graph: value.graph, publicationVisualPlan: foreign });
    }],
    ["manually passed PVP without a trusted QA binding", () => {
      const value = fixture();
      const pending = compilePublicationVisualPlan({ ugs: value.ugs, graph: value.graph, updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 } });
      const manual = createPublicationVisualPlan({ ...structuredClone(pending), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" } });
      return request({ ugs: value.ugs, graph: value.graph, publicationVisualPlan: manual });
    }],
    ["structurally failed PVP QA", () => {
      const value = fixture();
      const plan = value.pvp as any;
      const invalidVisualPlan = createPublicationVisualPlan({
        ...structuredClone(plan),
        annotations: [
          { annotationId: "annotation:a", targetIds: [plan.primitives[0].primitiveId], bounds: { x: 20, y: 20, width: 100, height: 60 }, text: "A", role: "note", styleTokenIds: [] },
          { annotationId: "annotation:b", targetIds: [plan.primitives[1].primitiveId], bounds: { x: 60, y: 40, width: 100, height: 60 }, text: "B", role: "note", styleTokenIds: [] },
        ],
      });
      return request({ ugs: value.ugs, graph: value.graph, publicationVisualPlan: invalidVisualPlan });
    }],
  ])("does zero writes for %s", async (_name, build) => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const insert = vi.spyOn(store, "insert");
    const service = new GenericPlanSnapshotService({ store });
    await expect(service.create(build())).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});
