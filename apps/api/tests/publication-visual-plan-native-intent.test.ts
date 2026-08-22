import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { createGenericPlanSnapshot, type GenericPlanSnapshot } from "../src/generic-plan-snapshot.js";
import { GenericPlanSnapshotService } from "../src/generic-plan-snapshot-service.js";
import { InMemoryGenericPlanSnapshotStore, type GenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import * as nativeIntentModule from "../src/publication-visual-plan-native-intent.js";
import { PublicationVisualNativeIntentService } from "../src/publication-visual-plan-native-intent.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../src/publication-visual-plan-qa-promotion.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownCustomSpatialBackboneUgs,
  unknownDualTowerCrossModalFusionUgs,
  unknownMultiScaleEncoderDecoderUgs,
  unknownRepeatedFusionStackUgs,
  unknownResidualMultiBranchUgs,
} from "./fixtures/universal-graph-spec.js";

const owner = { tenantId: "tenant-1", userId: "owner-1", deviceId: "device-1" };
const updateIdentity = { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };
const fixtureFamilies = [
  ["custom spatial backbone", unknownCustomSpatialBackboneUgs],
  ["residual multi-branch network", unknownResidualMultiBranchUgs],
  ["multi-scale encoder-decoder", unknownMultiScaleEncoderDecoderUgs],
  ["dual-tower cross-modal fusion", unknownDualTowerCrossModalFusionUgs],
  ["repeated fusion stack", unknownRepeatedFusionStackUgs],
] as const;

function compile(creator: () => any) {
  const ugs = parseUniversalGraphSpec(creator());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  return { ugs, graph, plan: compilePublicationVisualPlan({ ugs, graph, updateIdentity }) };
}

function approvedPlan(creator: () => any) {
  const value = compile(creator);
  return {
    ...value,
    plan: promotePublicationVisualPlanAfterTrustedReview({
      plan: value.plan,
      review: { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-21T12:00:00.000Z", approval: "approved", expectedPlanHash: value.plan.identity.canonicalHash },
    }).plan,
  };
}

async function trusted(creator: () => any) {
  const value = approvedPlan(creator);
  const snapshots = new InMemoryGenericPlanSnapshotStore();
  const snapshot = await new GenericPlanSnapshotService({ store: snapshots }).create({
    owner,
    ugsRevision: 1,
    ugs: value.ugs,
    graph: value.graph,
    publicationVisualPlan: value.plan,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  const service = new PublicationVisualNativeIntentService({ snapshotStore: snapshots });
  const input = { owner, graphId: snapshot.graphId, ugsRevision: snapshot.ugsRevision, snapshotId: snapshot.snapshotId };
  return { ...value, snapshot, service, input };
}

function recordsById(values: readonly unknown[], id: string): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a PVP record");
    const record = value as Record<string, unknown>;
    return [String(record[id]), record] as const;
  }));
}

function storeReturning(snapshot: unknown): GenericPlanSnapshotStore {
  return {
    insert: async () => { throw new Error("insert is not expected"); },
    get: async () => snapshot as GenericPlanSnapshot,
  };
}

describe("PublicationVisualPlan native intent", () => {
  it("exports no raw PublicationVisualPlan-to-native-intent entry point", () => {
    expect(nativeIntentModule).not.toHaveProperty("compilePublicationVisualPlanToNativeIntent");
  });

  it.each(fixtureFamilies)("maps trusted zero-template %s Snapshots deterministically through the allowlist", async (_name, creator) => {
    const { plan, snapshot, service, input } = await trusted(creator);
    const first = await service.compile(input);
    const second = await service.compile(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      protocolVersion: "pvp-native-intent-1",
      planId: snapshot.publicationVisualPlanId,
      planHash: snapshot.publicationVisualPlanHash,
      updateIdentity,
      coordinateSpace: { id: "pvp-du-1", unit: "du", duPerInch: 1000, page: (plan.coordinateSpace as any).page },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.primitives).toHaveLength(plan.primitives.length);
    expect(first.connectors).toHaveLength(plan.connectors.length);
    expect(first.primitives.every((item) => ["terminal", "module", "split", "merge-add", "merge-concat", "repeat-badge"].includes(item.nativeKind))).toBe(true);
    expect(first.connectors.every((item) => ["flow", "skip", "merge", "condition"].includes(item.nativeKind))).toBe(true);
    const sourcePrimitives = recordsById(plan.primitives, "primitiveId");
    const sourceConnectors = recordsById(plan.connectors, "connectorId");
    for (const primitive of first.primitives) {
      const source = sourcePrimitives.get(primitive.primitiveId);
      expect(source).toBeDefined();
      expect(primitive.componentId).toBe(source!.componentId);
      expect(primitive.bounds).toEqual(source!.bounds);
      expect(primitive.styleTokenIds).toEqual(source!.styleTokenIds);
    }
    for (const connector of first.connectors) {
      const source = sourceConnectors.get(connector.connectorId);
      expect(source).toBeDefined();
      expect(connector.route).toEqual(source!.route);
      expect(connector.styleTokenIds).toEqual(source!.styleTokenIds);
    }
    expect(Object.isFrozen(first.primitives)).toBe(true);
    expect(Object.isFrozen(first.primitives[0])).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.bounds)).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.styleTokenIds)).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.shapeData)).toBe(true);
  });

  it("rejects a foreign device, wrong graph/revision, or unknown Snapshot before native mapping", async () => {
    const { service, input } = await trusted(unknownCustomSpatialBackboneUgs);
    await expect(service.compile({ ...input, owner: { ...owner, deviceId: "device-2" } })).rejects.toThrow(/snapshot/i);
    await expect(service.compile({ ...input, graphId: "other-graph" })).rejects.toThrow(/snapshot/i);
    await expect(service.compile({ ...input, ugsRevision: 2 })).rejects.toThrow(/snapshot/i);
    await expect(service.compile({ ...input, snapshotId: "generic-plan-missing" })).rejects.toThrow(/snapshot/i);
  });

  it.each([
    ["tenant", { tenantId: "tenant-2" }],
    ["user", { userId: "owner-2" }],
    ["device", { deviceId: "device-2" }],
    ["graph", { graphId: "other-graph" }],
    ["revision", { ugsRevision: 2 }],
    ["snapshot ID", { snapshotId: "generic-plan-other" }],
  ])("rejects a returned Snapshot whose %s does not match its locator", async (_field, patch) => {
    const { snapshot, input } = await trusted(unknownCustomSpatialBackboneUgs);
    const mismatched = structuredClone(snapshot) as GenericPlanSnapshot;
    Object.assign(mismatched as object, patch);
    const service = new PublicationVisualNativeIntentService({ snapshotStore: storeReturning(mismatched) });
    await expect(service.compile(input)).rejects.toThrow(/identity|snapshot/i);
  });

  it("rejects a canonical stored Snapshot whose PVP update identity or UGS/GPG lineage is not bound to it", async () => {
    const { snapshot, input } = await trusted(unknownCustomSpatialBackboneUgs);
    const foreignUpdateIdentity = { ...updateIdentity, ownerId: "owner-2", deviceId: "device-2", expectedRevision: 2 };
    const foreignIdentitySource = compile(unknownCustomSpatialBackboneUgs);
    const foreignIdentityPending = compilePublicationVisualPlan({
      ugs: foreignIdentitySource.ugs,
      graph: foreignIdentitySource.graph,
      updateIdentity: foreignUpdateIdentity,
    });
    const foreignIdentityPlan = promotePublicationVisualPlanAfterTrustedReview({
      plan: foreignIdentityPending,
      review: { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-21T12:00:00.000Z", approval: "approved", expectedPlanHash: foreignIdentityPending.identity.canonicalHash },
    }).plan;
    const foreignLineagePlan = approvedPlan(unknownDualTowerCrossModalFusionUgs).plan;
    const forgedSnapshots = [foreignIdentityPlan, foreignLineagePlan].map((plan) => createGenericPlanSnapshot({
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      deviceId: snapshot.deviceId,
      graphId: snapshot.graphId,
      ugsRevision: snapshot.ugsRevision,
      ugsCanonicalHash: snapshot.ugsCanonicalHash,
      generalPublicationGraphHash: snapshot.generalPublicationGraphHash,
      publicationVisualPlan: plan,
      createdAt: snapshot.createdAt,
    }));

    for (const forged of forgedSnapshots) {
      const service = new PublicationVisualNativeIntentService({ snapshotStore: storeReturning(forged) });
      await expect(service.compile({ ...input, snapshotId: forged.snapshotId })).rejects.toThrow(/update identity|lineage/i);
    }
  });

  it("rejects candidate, pending, manually-passed, capability-incomplete, and non-DU stored data", async () => {
    const { snapshot, input } = await trusted(unknownCustomSpatialBackboneUgs);
    const pending = compile(unknownCustomSpatialBackboneUgs).plan;
    const candidateSource = unknownResidualMultiBranchUgs();
    candidateSource.edges[0] = { ...candidateSource.edges[0], relation: "candidate", knowledge: "candidate" };
    const candidate = compile(() => candidateSource).plan;
    const manual = createPublicationVisualPlan({ ...structuredClone(pending), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" } });
    const capabilityPending = compile(unknownCustomSpatialBackboneUgs).plan as any;
    const capabilityPlan = createPublicationVisualPlan({
      ...structuredClone(capabilityPending),
      rendererRequirements: {
        ...capabilityPending.rendererRequirements,
        requiredCapabilities: capabilityPending.rendererRequirements.requiredCapabilities.filter((value: string) => value !== "shape-data"),
      },
    });
    const capabilityPvp = promotePublicationVisualPlanAfterTrustedReview({
      plan: capabilityPlan,
      review: { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-21T12:00:00.000Z", approval: "approved", expectedPlanHash: capabilityPlan.identity.canonicalHash },
    }).plan;
    const capabilityMissing = createGenericPlanSnapshot({
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      deviceId: snapshot.deviceId,
      graphId: snapshot.graphId,
      ugsRevision: snapshot.ugsRevision,
      ugsCanonicalHash: snapshot.ugsCanonicalHash,
      generalPublicationGraphHash: snapshot.generalPublicationGraphHash,
      publicationVisualPlan: capabilityPvp,
      createdAt: snapshot.createdAt,
    });
    const nonDu = structuredClone(snapshot) as any;
    nonDu.publicationVisualPlan.coordinateSpace.unit = "in";

    for (const unsafe of [pending, candidate, manual]) {
      const forged = structuredClone(snapshot) as any;
      forged.publicationVisualPlan = unsafe;
      const service = new PublicationVisualNativeIntentService({ snapshotStore: storeReturning(forged) });
      await expect(service.compile(input)).rejects.toThrow();
    }
    const capabilityInput = { ...input, snapshotId: capabilityMissing.snapshotId };
    await expect(new PublicationVisualNativeIntentService({ snapshotStore: storeReturning(capabilityMissing) }).compile(capabilityInput)).rejects.toThrow(/capabilit/i);
    await expect(new PublicationVisualNativeIntentService({ snapshotStore: storeReturning(nonDu) }).compile(input)).rejects.toThrow(/coordinate|PVP/i);
  });
});
