import { describe, expect, it } from "vitest";
import { compileGeneralPublicationFigurePlan, parseGeneralPublicationFigurePlan, verifyGeneralPublicationFigurePlan } from "../src/general-publication-figure-plan.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

describe("General Publication Figure Plan", () => {
  it("creates a deterministic renderer-neutral plan for a complete unknown-module graph", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    const first = compileGeneralPublicationFigurePlan({ ugs, graph });
    const second = compileGeneralPublicationFigurePlan({ ugs, graph });

    expect(first).toEqual(second);
    expect(first.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
      expect.objectContaining({ role: "custom_module", sourceNodeIds: ["spectral_fusion"] }),
    ]));
    expect(first.sourceGraphHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/\b(visio|svg|com|worker|command|path|sourceBytes)\b/i);
  });

  it("maps semantic rank and lane order to stable bounds and traceable formal connectors", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const input = plan.primitives.find((item) => item.sourceComponentIds.includes("node:input"));
    const texture = plan.primitives.find((item) => item.sourceComponentIds.includes("node:texture_mixer"));
    const context = plan.primitives.find((item) => item.sourceComponentIds.includes("node:context_router"));

    expect(input).toBeDefined();
    expect(texture).toBeDefined();
    expect(context).toBeDefined();
    expect(texture!.bounds.left).toBeGreaterThan(input!.bounds.left);
    expect(context!.bounds.top).not.toBe(texture!.bounds.top);
    expect(plan.connectors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "flow", sourceRelationIds: ["relation:input-to-texture"] }),
    ]));
  });

  it.each(["candidate-edge", "blocking-topology", "feedback"])("rejects %s before formal planning", (kind) => {
    const input = unknownDualStreamFusionUgs();
    if (kind === "candidate-edge") input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    if (kind === "blocking-topology") input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];
    if (kind === "feedback") input.edges.push({ edgeId: "feedback-edge", sourcePortId: "spectral_fusion:out", targetPortId: "texture_mixer:in", relation: "feedback", knowledge: "proven", evidenceIds: ["e-fusion"] });
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph })).toThrow(/eligible|candidate|feedback/i);
  });

  it("rejects duplicate evidence and source references before a plan can be frozen", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const duplicateEvidence = structuredClone(plan);
    duplicateEvidence.primitives[0]!.evidenceIds = ["e-input", "e-input"];
    const duplicateSource = structuredClone(plan);
    duplicateSource.sourceMappings[0]!.sourceComponentIds = ["node:input", "node:input"];

    expect(() => parseGeneralPublicationFigurePlan(duplicateEvidence)).toThrow(/duplicate|unique/i);
    expect(() => parseGeneralPublicationFigurePlan(duplicateSource)).toThrow(/duplicate|unique/i);
  });

  it("rejects an eligible graph that is not the complete canonical projection of its UGS", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const missingRelation = structuredClone(graph);
    missingRelation.relations = missingRelation.relations.slice(1);
    const forgedRelation = structuredClone(graph);
    forgedRelation.relations[0]!.role = "skip";
    const forgedComponent = structuredClone(graph);
    forgedComponent.components[0]!.role = "generic_module";
    const forgedSourceMapping = structuredClone(graph);
    forgedSourceMapping.sourceMappings[0]!.evidenceIds = ["e-output"];
    const missingLayoutEntry = structuredClone(graph);
    missingLayoutEntry.layoutOrder = missingLayoutEntry.layoutOrder.slice(1);
    const duplicateLayoutEntry = structuredClone(graph);
    duplicateLayoutEntry.layoutOrder.push(structuredClone(duplicateLayoutEntry.layoutOrder[0]!));
    const extraLayoutEntry = structuredClone(graph);
    extraLayoutEntry.layoutOrder.push({ componentId: "node:unexpected", rank: 99, order: 99 });

    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: missingRelation })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: forgedRelation })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: forgedComponent })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: forgedSourceMapping })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: missingLayoutEntry })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: duplicateLayoutEntry })).toThrow(/canonical|UGS|match/i);
    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph: extraLayoutEntry })).toThrow(/canonical|UGS|match/i);
  });

  it("requires exactly one provenance mapping per primitive and rejects mismatched or self-looping plan records", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const missingMapping = structuredClone(plan);
    missingMapping.sourceMappings = missingMapping.sourceMappings.slice(1);
    const mismatchedMapping = structuredClone(plan);
    mismatchedMapping.sourceMappings[0]!.evidenceIds = ["e-output"];
    const selfLoop = structuredClone(plan);
    selfLoop.connectors[0]!.toPrimitiveId = selfLoop.connectors[0]!.fromPrimitiveId;
    const unsortedProvenance = structuredClone(plan);
    unsortedProvenance.primitives[0]!.evidenceIds = ["z-evidence", "a-evidence"];
    unsortedProvenance.sourceMappings[0]!.evidenceIds = ["z-evidence", "a-evidence"];
    const unsortedConnector = structuredClone(plan);
    unsortedConnector.connectors[0]!.sourceRelationIds = ["z-relation", "a-relation"];
    const unknownEndpoint = structuredClone(plan);
    unknownEndpoint.connectors[0]!.toPrimitiveId = "primitive:missing";
    const nonCanonicalOrder = structuredClone(plan);
    nonCanonicalOrder.primitives.reverse();

    expect(() => parseGeneralPublicationFigurePlan(missingMapping)).toThrow(/mapping|provenance/i);
    expect(() => parseGeneralPublicationFigurePlan(mismatchedMapping)).toThrow(/mapping|provenance/i);
    expect(() => parseGeneralPublicationFigurePlan(selfLoop)).toThrow(/self|connector/i);
    expect(() => parseGeneralPublicationFigurePlan(unsortedProvenance)).toThrow(/sorted/i);
    expect(() => parseGeneralPublicationFigurePlan(unsortedConnector)).toThrow(/sorted/i);
    expect(() => parseGeneralPublicationFigurePlan(unknownEndpoint)).toThrow(/unknown|connector/i);
    expect(() => parseGeneralPublicationFigurePlan(nonCanonicalOrder)).toThrow(/order|sorted/i);
  });

  it("rejects an unvalidated UGS at the public compiler boundary", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const forgedUgs = structuredClone(ugs);
    forgedUgs.nodes[0]!.attributes = { geometryMode: "free" };

    expect(() => compileGeneralPublicationFigurePlan({ ugs: forgedUgs, graph })).toThrow(/attribute|permitted|validation/i);
  });

  it("verifies imported plans against the canonical UGS and General Publication Graph", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const forgedHash = structuredClone(plan);
    forgedHash.sourceGraphHash = "0".repeat(64);
    const forgedGeometry = structuredClone(plan);
    forgedGeometry.primitives[0]!.bounds.left += 1;

    expect(() => verifyGeneralPublicationFigurePlan({ ugs, graph, plan })).not.toThrow();
    expect(() => verifyGeneralPublicationFigurePlan({ ugs, graph, plan: forgedHash })).toThrow(/canonical|match/i);
    expect(() => verifyGeneralPublicationFigurePlan({ ugs, graph, plan: forgedGeometry })).toThrow(/canonical|match/i);
  });

  it("accepts canonical generated identifiers derived from legal maximum-length UGS identifiers", () => {
    const longNodeId = `n${"x".repeat(127)}`;
    const ugs = parseUniversalGraphSpec(linearUgs(1, longNodeId));
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph })).not.toThrow();
  });

  it("adapts canonical geometry so every supported UGS rank remains within bounded document units", () => {
    const ugs = parseUniversalGraphSpec(linearUgs(256));
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });

    expect(plan.page.width).toBeLessThanOrEqual(10_000);
    expect(plan.page.height).toBeLessThanOrEqual(10_000);
    expect(plan.primitives).toHaveLength(256);
    expect(plan.primitives.every((primitive) => primitive.bounds.left + primitive.bounds.width <= 10_000 && primitive.bounds.top + primitive.bounds.height <= 10_000)).toBe(true);
  });

  it("accepts every formal primitive and connector the bounded UGS contract can canonically produce", () => {
    const componentUgs = parseUniversalGraphSpec(maximumComponentUgs());
    const componentGraph = composeGeneralPublicationGraph(componentUgs, { detail: "architecture" });
    const relationUgs = parseUniversalGraphSpec(maximumRelationUgs());
    const relationGraph = composeGeneralPublicationGraph(relationUgs, { detail: "architecture" });

    expect(componentGraph.components).toHaveLength(768);
    expect(compileGeneralPublicationFigurePlan({ ugs: componentUgs, graph: componentGraph }).primitives).toHaveLength(768);
    expect(relationGraph.relations).toHaveLength(2_048);
    expect(compileGeneralPublicationFigurePlan({ ugs: relationUgs, graph: relationGraph }).connectors).toHaveLength(2_048);
  });

  it("uses code-unit ordering for same-rank identifiers and preserves hash identity when source arrays reorder", () => {
    const firstInput = sameRankCaseUgs();
    const reorderedInput = structuredClone(firstInput);
    reorderedInput.nodes.reverse();
    reorderedInput.ports.reverse();
    reorderedInput.edges.reverse();
    reorderedInput.evidence.reverse();
    const firstGraph = composeGeneralPublicationGraph(parseUniversalGraphSpec(firstInput), { detail: "architecture" });
    const reorderedGraph = composeGeneralPublicationGraph(parseUniversalGraphSpec(reorderedInput), { detail: "architecture" });
    const firstPlan = compileGeneralPublicationFigurePlan({ ugs: parseUniversalGraphSpec(firstInput), graph: firstGraph });
    const reorderedPlan = compileGeneralPublicationFigurePlan({ ugs: parseUniversalGraphSpec(reorderedInput), graph: reorderedGraph });

    expect(firstGraph).toEqual(reorderedGraph);
    expect(firstGraph.layoutOrder.filter((item) => item.rank === 1).map((item) => item.componentId)).toEqual(["node:I", "node:i"]);
    expect(firstPlan.sourceGraphHash).toBe(reorderedPlan.sourceGraphHash);
    expect(firstPlan).toEqual(reorderedPlan);
  });
});

function linearUgs(nodeCount: number, firstNodeId = "n0"): any {
  const sourceHash = "a".repeat(64);
  const nodeId = (index: number) => index === 0 ? firstNodeId : `n${index}`;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    nodeId: nodeId(index),
    kind: index === 0 ? "input" : index === nodeCount - 1 ? "output" : "operator",
    label: `Node ${index}`,
    semanticHints: [],
    inputPortIds: index === 0 ? [] : [`${nodeId(index)}:in`],
    outputPortIds: index === nodeCount - 1 ? [] : [`${nodeId(index)}:out`],
    attributes: {},
    shapeClaim: "unknown",
    operationKnowledge: "known",
    evidenceIds: [`e${index}`],
  }));
  const ports = nodes.flatMap((node: any, index: number) => [
    ...(index === 0 ? [] : [{ portId: `${node.nodeId}:in`, nodeId: node.nodeId, direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] }]),
    ...(index === nodeCount - 1 ? [] : [{ portId: `${node.nodeId}:out`, nodeId: node.nodeId, direction: "output", label: null, representation: null, semanticType: "data", evidenceIds: [] }]),
  ]);
  return {
    version: 1,
    graphId: "linear-network",
    revision: 1,
    sourceIds: ["prompt-1"],
    sourceHashes: [sourceHash],
    nodes,
    ports,
    edges: Array.from({ length: nodeCount - 1 }, (_, index) => ({ edgeId: `edge${index}`, sourcePortId: `${nodeId(index)}:out`, targetPortId: `${nodeId(index + 1)}:in`, relation: "data", knowledge: "declared", evidenceIds: [`e${index + 1}`] })),
    groups: [],
    evidence: nodes.map((_: unknown, index: number) => ({ evidenceId: `e${index}`, sourceId: "prompt-1", sourceHash, locator: `fragment-${index}`, excerptDigest: "b".repeat(64) })),
    topologyConfidence: 1,
    unresolved: [],
  };
}

function sameRankCaseUgs(): any {
  const input = linearUgs(4);
  input.nodes[0] = { ...input.nodes[0], nodeId: "input", outputPortIds: ["input:out"] };
  input.nodes[1] = { ...input.nodes[1], nodeId: "I", inputPortIds: ["I:in"], outputPortIds: ["I:out"] };
  input.nodes[2] = { ...input.nodes[2], nodeId: "i", inputPortIds: ["i:in"], outputPortIds: ["i:out"] };
  input.nodes[3] = { ...input.nodes[3], nodeId: "output", inputPortIds: ["output:in"] };
  input.ports = [
    { portId: "input:out", nodeId: "input", direction: "output", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: "I:in", nodeId: "I", direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: "I:out", nodeId: "I", direction: "output", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: "i:in", nodeId: "i", direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: "i:out", nodeId: "i", direction: "output", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: "output:in", nodeId: "output", direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] },
  ];
  input.edges = [
    { edgeId: "input-I", sourcePortId: "input:out", targetPortId: "I:in", relation: "data", knowledge: "declared", evidenceIds: ["e1"] },
    { edgeId: "input-i", sourcePortId: "input:out", targetPortId: "i:in", relation: "data", knowledge: "declared", evidenceIds: ["e2"] },
    { edgeId: "I-output", sourcePortId: "I:out", targetPortId: "output:in", relation: "data", knowledge: "declared", evidenceIds: ["e3"] },
    { edgeId: "i-output", sourcePortId: "i:out", targetPortId: "output:in", relation: "data", knowledge: "declared", evidenceIds: ["e3"] },
  ];
  return input;
}

function maximumComponentUgs(): any {
  const input = linearUgs(256);
  input.nodes = input.nodes.map((node: any) => ({
    ...node,
    kind: "custom_module",
    inputPortIds: [`${node.nodeId}:left`, `${node.nodeId}:right`],
    outputPortIds: [],
    attributes: { repeatCount: 2 },
  }));
  input.ports = input.nodes.flatMap((node: any) => [
    { portId: `${node.nodeId}:left`, nodeId: node.nodeId, direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] },
    { portId: `${node.nodeId}:right`, nodeId: node.nodeId, direction: "input", label: null, representation: null, semanticType: "data", evidenceIds: [] },
  ]);
  input.edges = [];
  return input;
}

function maximumRelationUgs(): any {
  const input = linearUgs(256);
  const candidates: Array<[number, number]> = [];
  for (let source = 0; source < 256 && candidates.length < 2_048; source += 1) {
    for (let target = source + 1; target < 256 && candidates.length < 2_048; target += 1) candidates.push([source, target]);
  }
  input.edges = candidates.map(([source, target], index) => ({
    edgeId: `edge${index}`,
    sourcePortId: `n${source}:out`,
    targetPortId: `n${target}:in`,
    relation: "data",
    knowledge: "declared",
    evidenceIds: ["e0"],
  }));
  return input;
}
