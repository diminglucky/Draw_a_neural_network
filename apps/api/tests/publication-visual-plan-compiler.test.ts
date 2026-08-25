import { describe, expect, it } from "vitest";
import { assertPublicationVisualPlanRendererCapabilities, compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { evaluatePublicationVisualPlanQa } from "../src/publication-visual-plan-qa.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs, unknownHybridSemanticRegionsCandidateUgs, unknownHybridSemanticRegionsUgs, unknownResidualMultiBranchUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

describe("PublicationVisualPlan compiler", () => {
  it("compiles an unseen dual-stream custom network into a formal plan with native ports and orthogonal routes", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(plan.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
    expect((plan.primitives as any[]).some((item) => item.kind === "OperatorFrame")).toBe(true);
    expect(plan.ports).toHaveLength(graph.relations.length * 2);
    expect(plan.connectors).toHaveLength(graph.relations.length);
    expect(plan.sourceMappings).toHaveLength(graph.components.length);
    for (const connector of plan.connectors as any[]) {
      expect(connector.route).toHaveLength(4);
      expect(connector.route[0]).not.toEqual(connector.route.at(-1));
    }
  });

  it("uses compact semantic markers and routes skip relations outside the main node corridor", () => {
    const ugs = parseUniversalGraphSpec(unknownResidualMultiBranchUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const primitives = plan.primitives as any[];
    const split = primitives.find((primitive) => primitive.kind === "SplitMarker");
    const add = primitives.find((primitive) => primitive.kind === "AddMarker");
    const skip = (plan.connectors as any[]).find((connector) => connector.relation === "skip");
    const primaryTop = Math.min(...primitives.filter((primitive) => primitive.kind !== "RepeatBadge").map((primitive) => primitive.bounds.y));

    expect(split.bounds.width).toBe(split.bounds.height);
    expect(add.bounds.width).toBe(add.bounds.height);
    expect(split.bounds).toMatchObject({ width: 120, height: 120 });
    expect(add.bounds).toMatchObject({ width: 220, height: 220 });
    expect(split.bounds.width).toBeLessThan(add.bounds.width);
    const splitStyle = (plan.styleTokens as any).tokens.find((token: any) => token.tokenId === "style:split");
    expect(splitStyle.values).toMatchObject({ fill: "#334155", strokeWidth: "1.2" });
    expect(skip.styleTokenIds).toContain("style:skip");
    expect(skip.route.length).toBeGreaterThanOrEqual(6);
    expect(skip.route.slice(1, -1).some((point: any) => point.y < primaryTop)).toBe(true);
    for (let index = 1; index < skip.route.length; index += 1) {
      expect(skip.route[index].x === skip.route[index - 1].x || skip.route[index].y === skip.route[index - 1].y).toBe(true);
    }
  });

  it("uses restrained model-neutral stroke weights for publication primitives", () => {
    const ugs = parseUniversalGraphSpec(unknownResidualMultiBranchUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const tokens = new Map((plan.styleTokens as any).tokens.map((token: any) => [token.tokenId, token.values]));

    expect(tokens.get("style:terminal")).toMatchObject({ strokeWidth: "1.2" });
    expect(tokens.get("style:operator")).toMatchObject({ strokeWidth: "1.2" });
    expect(tokens.get("style:add")).toMatchObject({ strokeWidth: "1.2" });
    expect(tokens.get("style:relation")).toMatchObject({ strokeWidth: "1.2" });
    expect(tokens.get("style:skip")).toMatchObject({ strokeWidth: "1.2" });
  });

  it("keeps ambiguous topology as a non-exportable candidate plan", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(plan.eligibility).toMatchObject({ kind: "candidate", formalReasons: [], qaStatus: "pending" });
    expect(plan.eligibility.blockingReasons).toEqual(["topology-candidate"]);
  });

  it.each(["candidate-edge", "feedback-edge"])("never promotes %s to a formal PVP", (kind) => {
    const input = unknownDualStreamFusionUgs();
    if (kind === "candidate-edge") input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    if (kind === "feedback-edge") input.edges.push({ edgeId: "feedback", sourcePortId: "spectral_fusion:out", targetPortId: "texture_mixer:in", relation: "feedback", knowledge: "proven", evidenceIds: ["e-fusion"] });
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(compilePublicationVisualPlan({ ugs, graph, updateIdentity }).eligibility.kind).toBe("candidate");
  });

  it("fails closed when a renderer lacks a required PVP capability", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(() => assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route"])).toThrow(/shape-data|capability/i);
    expect(() => assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route", "shape-data"])).not.toThrow();
  });

  it("compiles an anonymous semantic hybrid into the full publication grammar with deterministic layout", () => {
    const ugs = parseUniversalGraphSpec(unknownHybridSemanticRegionsUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const first = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const second = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const kinds = (first.primitives as any[]).map((primitive) => primitive.kind);

    expect(kinds).toEqual(expect.arrayContaining([
      "InputTerminal", "OutputTerminal", "TensorStage", "TensorVolume",
      "OperatorFrame", "ModuleFrame", "RepeatBadge", "SplitMarker",
      "AddMarker", "ConcatMarker", "AttentionTokenStrip", "AttentionRelation",
    ]));
    expect((first.primitives as any[]).every((primitive) => primitive.visual)).toBe(true);
    expect((first.primitiveGroups as any[]).every((group) => group.semanticRegionId)).toBe(true);
    expect(first).toEqual(second);
    for (const connector of first.connectors as any[]) {
      for (let index = 1; index < connector.route.length; index += 1) {
        expect(connector.route[index].x === connector.route[index - 1].x || connector.route[index].y === connector.route[index - 1].y).toBe(true);
      }
    }
  });

  it("keeps anonymous composite meanings as separate visuals without duplicating data-topology connectors", () => {
    const input = unknownHybridSemanticRegionsUgs();
    input.nodes.find((node: any) => node.nodeId === "spatial_stage").kind = "custom_module";
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const first = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const second = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const spatialPrimitives = (first.primitives as any[]).filter((primitive) => (first.sourceMappings as any[])
      .find((mapping) => mapping.visualId === primitive.primitiveId)?.ugsIds.includes("spatial_stage"));

    expect(first).toEqual(second);
    expect(spatialPrimitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ primitiveId: "primitive:node:spatial_stage", kind: "ModuleFrame" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:scale_transition:source-to-spatial:stage", kind: "TensorStage" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:scale_transition:source-to-spatial:volume", kind: "TensorVolume" }),
      expect.objectContaining({ primitiveId: "primitive:repeat:spatial_stage", kind: "RepeatBadge" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:multi_branch:spatial_stage:split", kind: "SplitMarker" }),
    ]));
    expect(first.connectors).toHaveLength(graph.relations.length);
    expect(new Set((first.connectors as any[]).map((connector) => connector.connectorId)).size).toBe(graph.relations.length);
    expect(new Set((first.connectors as any[]).map((connector) => `${connector.sourcePortId}:${connector.targetPortId}`)).size).toBe(graph.relations.length);

    const byId = new Map((first.primitives as any[]).map((primitive) => [primitive.primitiveId, primitive]));
    const primary = byId.get("primitive:node:spatial_stage")!;
    const repeat = byId.get("primitive:repeat:spatial_stage")!;
    const split = byId.get("primitive:semantic:multi_branch:spatial_stage:split")!;
    const stage = byId.get("primitive:semantic:scale_transition:source-to-spatial:stage")!;
    const volume = byId.get("primitive:semantic:scale_transition:source-to-spatial:volume")!;

    expect(primary.bounds).toMatchObject({ width: 760, height: 320 });
    expect(repeat.bounds).toMatchObject({
      x: primary.bounds.x + primary.bounds.width + 16,
      y: primary.bounds.y + 16,
      width: 180,
      height: 48,
    });
    expect(split.bounds).toMatchObject({
      x: primary.bounds.x + primary.bounds.width + 16,
      y: primary.bounds.y + (primary.bounds.height - 120) / 2,
      width: 120,
      height: 120,
    });
    expect(split.bounds.y + split.bounds.height / 2).toBe(primary.bounds.y + primary.bounds.height / 2);
    expect(stage.bounds).toMatchObject({
      x: primary.bounds.x + primary.bounds.width + 16,
      y: primary.bounds.y + 236,
      width: 300,
      height: 88,
    });
    expect(volume.bounds).toMatchObject({
      x: primary.bounds.x + primary.bounds.width + 16,
      y: primary.bounds.y + 340,
      width: 300,
      height: 68,
    });
    expect([repeat, split, stage, volume].every((primitive) => primitive.bounds.width < primary.bounds.width && primitive.bounds.height < primary.bounds.height)).toBe(true);
    expect([repeat, split, stage, volume].every((primitive) => (first.sourceMappings as any[])
      .some((mapping) => mapping.visualId === primitive.primitiveId && mapping.ugsIds.includes("spatial_stage")))).toBe(true);
    expect(evaluatePublicationVisualPlanQa(first).status).toBe("passed");
  });

  it("packs every anonymous composite attachment beside one stable primary without visual collisions", () => {
    const input = unknownHybridSemanticRegionsUgs();
    const spatial = input.nodes.find((node: any) => node.nodeId === "spatial_stage");
    spatial.kind = "custom_module";
    spatial.semanticHints = ["attention", "self_attention", "self"];
    spatial.attributes = { ...spatial.attributes, attentionKind: "self" };
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const first = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const second = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const byId = new Map((first.primitives as any[]).map((primitive) => [primitive.primitiveId, primitive]));
    const expectedIds = [
      "primitive:node:spatial_stage",
      "primitive:repeat:spatial_stage",
      "primitive:semantic:scale_transition:source-to-spatial:stage",
      "primitive:semantic:scale_transition:source-to-spatial:volume",
      "primitive:semantic:multi_branch:spatial_stage:split",
      "primitive:semantic:token_attention:spatial_stage:tokens",
      "primitive:semantic:token_attention:spatial_stage:relation",
    ];
    const composite = expectedIds.map((primitiveId) => byId.get(primitiveId));
    const primary = composite[0]!;
    const attachments = composite.slice(1);

    expect(first).toEqual(second);
    expect(composite.every(Boolean)).toBe(true);
    expect(composite).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ModuleFrame" }),
      expect.objectContaining({ kind: "RepeatBadge" }),
      expect.objectContaining({ kind: "TensorStage" }),
      expect.objectContaining({ kind: "TensorVolume" }),
      expect.objectContaining({ kind: "SplitMarker" }),
      expect.objectContaining({ kind: "AttentionTokenStrip" }),
      expect.objectContaining({ kind: "AttentionRelation" }),
    ]));
    expect(primary.bounds).toMatchObject({ width: 760, height: 320 });
    expect(attachments.every((primitive) => primitive.bounds.x >= primary.bounds.x + primary.bounds.width)).toBe(true);
    expect(attachments.every((primitive, index) => attachments.slice(index + 1).every((other) => !boundsOverlap(primitive.bounds, other.bounds)))).toBe(true);
    expect(attachments.every((primitive) => (first.sourceMappings as any[]).some((mapping) => mapping.visualId === primitive.primitiveId
      && mapping.ugsIds.includes("spatial_stage") && mapping.evidenceIds.includes("e-topology")))).toBe(true);
    expect(evaluatePublicationVisualPlanQa(first).status).toBe("passed");
    expect(first.connectors).toHaveLength(graph.relations.length);
    expect((first.connectors as any[]).map((connector) => connector.connectorId).sort()).toEqual(graph.relations.map((relation) => `connector:${relation.relationId}`).sort());
    expect(new Set((first.connectors as any[]).map((connector) => `${connector.sourcePortId}:${connector.targetPortId}`)).size).toBe(graph.relations.length);
  });

  it("packs attachments from anonymous complex modules sharing one rank without cross-module collisions", () => {
    const input = unknownHybridSemanticRegionsUgs();
    for (const nodeId of ["left_path", "right_path"]) {
      const node = input.nodes.find((item: any) => item.nodeId === nodeId);
      node.kind = "custom_module";
      node.semanticHints = ["attention", "self_attention", "self"];
      node.attributes = { ...node.attributes, attentionKind: "self", repeatCount: 2, repeatGroupId: `repeat-${nodeId}` };
      input.groups.push({ groupId: `repeat-${nodeId}`, label: `Repeated ${nodeId}`, memberNodeIds: [nodeId], evidenceIds: ["e-topology"] });
    }
    input.nodes.find((item: any) => item.nodeId === "left_path").tensorFacts.dimensions = { channels: 32, height: 16, width: 16 };

    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const first = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const second = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const primitives = first.primitives as any[];
    const primaryByNodeId = new Map(["left_path", "right_path"].map((nodeId) => [nodeId, primitives.find((primitive) => primitive.primitiveId === `primitive:node:${nodeId}`)]));
    const attachmentsFor = (nodeId: string) => primitives.filter((primitive) => primitive.primitiveId === `primitive:repeat:${nodeId}`
      || primitive.primitiveId === `primitive:semantic:token_attention:${nodeId}:tokens`
      || primitive.primitiveId === `primitive:semantic:token_attention:${nodeId}:relation`);
    const attachments = ["left_path", "right_path"].flatMap(attachmentsFor);

    expect(first).toEqual(second);
    expect(primaryByNodeId.get("left_path")).toMatchObject({ kind: "ModuleFrame" });
    expect(primaryByNodeId.get("right_path")).toMatchObject({ kind: "ModuleFrame" });
    expect(attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ primitiveId: "primitive:repeat:left_path", kind: "RepeatBadge" }),
      expect.objectContaining({ primitiveId: "primitive:repeat:right_path", kind: "RepeatBadge" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:token_attention:left_path:tokens", kind: "AttentionTokenStrip" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:token_attention:left_path:relation", kind: "AttentionRelation" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:token_attention:right_path:tokens", kind: "AttentionTokenStrip" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:token_attention:right_path:relation", kind: "AttentionRelation" }),
    ]));
    expect(primitives.every((primitive, index) => primitives.slice(index + 1).every((other) => !boundsOverlap(primitive.bounds, other.bounds)))).toBe(true);
    for (const [nodeId, primary] of primaryByNodeId) {
      const nodeAttachments = attachmentsFor(nodeId);
      expect(nodeAttachments).toHaveLength(3);
      expect(nodeAttachments.every((primitive) => primitive.bounds.x >= primary.bounds.x + primary.bounds.width)).toBe(true);
    }
    expect(evaluatePublicationVisualPlanQa(first).status).toBe("passed");
    expect(first.connectors).toHaveLength(graph.relations.length);
    expect((first.connectors as any[]).map((connector) => connector.connectorId).sort()).toEqual(graph.relations.map((relation) => `connector:${relation.relationId}`).sort());
    expect(new Set((first.connectors as any[]).map((connector) => `${connector.sourcePortId}:${connector.targetPortId}`)).size).toBe(graph.relations.length);
  });

  it("adds a CandidateCallout and keeps a candidate semantic graph non-exportable", () => {
    const ugs = parseUniversalGraphSpec(unknownHybridSemanticRegionsCandidateUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(plan.eligibility).toMatchObject({ kind: "candidate", formalReasons: [] });
    expect((plan.primitives as any[]).some((primitive) => primitive.kind === "CandidateCallout")).toBe(true);
    expect((plan.primitives as any[]).some((primitive) => primitive.kind === "TensorVolume")).toBe(false);
  });
});

function boundsOverlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}
