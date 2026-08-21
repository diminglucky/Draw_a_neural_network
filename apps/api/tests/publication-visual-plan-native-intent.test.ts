import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlanToNativeIntent } from "../src/publication-visual-plan-native-intent.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownCustomSpatialBackboneUgs,
  unknownDualTowerCrossModalFusionUgs,
  unknownMultiScaleEncoderDecoderUgs,
  unknownRepeatedFusionStackUgs,
  unknownResidualMultiBranchUgs,
} from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };
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
  return compilePublicationVisualPlan({ ugs, graph, updateIdentity });
}

function recordsById(values: readonly unknown[], id: string): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a PVP record");
    const record = value as Record<string, unknown>;
    return [String(record[id]), record] as const;
  }));
}

describe("PublicationVisualPlan native intent", () => {
  it.each(fixtureFamilies)("maps formal zero-template %s PVP deterministically through the allowlist", (_name, creator) => {
    const plan = compile(creator);

    const first = compilePublicationVisualPlanToNativeIntent(plan);
    const second = compilePublicationVisualPlanToNativeIntent(plan);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      protocolVersion: "pvp-native-intent-1",
      planId: plan.identity.planId,
      planHash: plan.identity.canonicalHash,
      updateIdentity,
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
      expect(primitive.shapeData).toEqual({
        "pvp.componentId": primitive.componentId,
        "pvp.ownership": "agent",
        "pvp.planHash": plan.identity.canonicalHash,
        "pvp.planId": plan.identity.planId,
        "pvp.primitiveId": primitive.primitiveId,
      });
    }
    for (const connector of first.connectors) {
      const source = sourceConnectors.get(connector.connectorId);
      expect(source).toBeDefined();
      expect(connector.route).toEqual(source!.route);
      expect(connector.styleTokenIds).toEqual(source!.styleTokenIds);
      expect(first.primitives.some((primitive) => primitive.primitiveId === connector.sourcePrimitiveId)).toBe(true);
      expect(first.primitives.some((primitive) => primitive.primitiveId === connector.targetPrimitiveId)).toBe(true);
      expect(connector.shapeData).toEqual({
        "pvp.connectorId": connector.connectorId,
        "pvp.ownership": "agent",
        "pvp.planHash": plan.identity.canonicalHash,
        "pvp.planId": plan.identity.planId,
      });
    }
    expect(Object.isFrozen(first.primitives)).toBe(true);
    expect(Object.isFrozen(first.primitives[0])).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.bounds)).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.styleTokenIds)).toBe(true);
    expect(Object.isFrozen(first.primitives[0]!.shapeData)).toBe(true);
    expect(() => (first.primitives as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(() => (first.primitives[0]!.styleTokenIds as unknown as string[]).push("style:mutated")).toThrow(TypeError);
    if (first.connectors.length > 0) {
      expect(Object.isFrozen(first.connectors[0])).toBe(true);
      expect(Object.isFrozen(first.connectors[0]!.route)).toBe(true);
      expect(Object.isFrozen(first.connectors[0]!.route[0])).toBe(true);
      expect(Object.isFrozen(first.connectors[0]!.shapeData)).toBe(true);
    }
  });

  it("rejects a candidate PVP before it can become native intent", () => {
    const source = unknownResidualMultiBranchUgs();
    source.edges[0] = { ...source.edges[0], relation: "candidate", knowledge: "candidate" };

    expect(() => compilePublicationVisualPlanToNativeIntent(compile(() => source))).toThrow(/formal/i);
  });

  it("rejects a canonical PVP with an unsupported visual primitive instead of inventing a Visio action", () => {
    const plan = compile(unknownCustomSpatialBackboneUgs);
    const unsafe = structuredClone(plan) as any;
    unsafe.primitives[0].kind = "ArbitraryVisioCom";

    expect(() => compilePublicationVisualPlanToNativeIntent(createPublicationVisualPlan(unsafe))).toThrow(/unsupported.*primitive/i);
  });

  it("rejects an unsupported canonical connector relation instead of widening the native allowlist", () => {
    const unsafe = structuredClone(compile(unknownCustomSpatialBackboneUgs)) as any;
    unsafe.connectors[0].relation = "ArbitraryVisioConnector";

    expect(() => compilePublicationVisualPlanToNativeIntent(createPublicationVisualPlan(unsafe))).toThrow(/unsupported.*connector/i);
  });

  it("rejects a canonical PVP whose structural QA fails before mapping a feedback connector", () => {
    const unsafe = structuredClone(compile(unknownCustomSpatialBackboneUgs)) as any;
    unsafe.connectors[0].relation = "feedback";

    expect(() => compilePublicationVisualPlanToNativeIntent(createPublicationVisualPlan(unsafe))).toThrow(/structural QA/i);
  });
});
