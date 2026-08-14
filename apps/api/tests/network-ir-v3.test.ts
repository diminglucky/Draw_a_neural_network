import { describe, expect, it } from "vitest";
import { parseEvidenceGraph } from "../src/evidence-graph.js";
import { validateArchitectureIRv3 } from "../src/network-ir-v3.js";

const shape = {
  axes: ["B", "C", "H", "W"],
  dimensions: [{ kind: "known", value: 1 }, { kind: "known", value: 64 }, { kind: "known", value: 32 }, { kind: "known", value: 32 }],
  batchSemantics: "independent",
};

function graph() {
  const fact = (id: string, nodeId: string) => ({
    id,
    kind: "node_exists",
    subject: { kind: "node", nodeId },
    payload: { kind: "node_exists", operatorKind: "operator" },
    evidenceRefs: [{
      sourceId: "source-code-1",
      sourceSha256: "a".repeat(64),
      locator: { kind: "code", startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
      excerptDigest: "b".repeat(64),
    }],
    extractionConfidence: 0.98,
    decisionConfidence: 0.98,
    sourceRole: "code",
    scope: "architecture",
    status: "accepted",
    analyzer: { id: "static", version: "1", policy: "static" },
    conflictGroupId: null,
    conflictKey: `node:${nodeId}:exists`,
  });
  return parseEvidenceGraph({
    version: 2,
    facts: ["input", "left", "right", "add", "output"].map((nodeId) => fact(`fact-${nodeId}`, nodeId)),
    relations: [],
  });
}

function port(id: string, semanticType = "data", portShape = shape) {
  return { id, representation: "spatial_feature_map", shape: portShape, semanticType };
}

function validAddIr(): any {
  return {
    version: 3,
    graphId: "residual-example",
    inputs: [{ nodeId: "input", portId: "out" }],
    outputs: [{ nodeId: "output", portId: "out" }],
    modules: [],
    nodes: [
      { id: "input", kind: "input", semanticRole: "image", inputPorts: [], outputPorts: [port("out")], evidenceIds: ["fact-input"] },
      { id: "left", kind: "operator", semanticRole: "conv", inputPorts: [port("in")], outputPorts: [port("out")], evidenceIds: ["fact-left"] },
      { id: "right", kind: "operator", semanticRole: "projection", inputPorts: [port("in")], outputPorts: [port("out")], evidenceIds: ["fact-right"] },
      {
        id: "add", kind: "merge", semanticRole: "residual_add", inputPorts: [port("left"), port("right")], outputPorts: [port("out")],
        mergeKind: "add", concatAxis: null,
        inputCompatibility: [{ status: "proven", comparedAxes: ["C", "H", "W"], reason: "same feature shape", evidenceFactIds: ["fact-add"] }],
        evidenceIds: ["fact-add"],
      },
      { id: "output", kind: "output", semanticRole: "prediction", inputPorts: [port("in")], outputPorts: [port("out", "prediction")], evidenceIds: ["fact-output"] },
    ],
    edges: [
      { id: "edge-input-left", source: { nodeId: "input", portId: "out" }, target: { nodeId: "left", portId: "in" }, transport: "data", evidenceIds: ["fact-left"] },
      { id: "edge-input-right", source: { nodeId: "input", portId: "out" }, target: { nodeId: "right", portId: "in" }, transport: "data", evidenceIds: ["fact-right"] },
      { id: "edge-left-add", source: { nodeId: "left", portId: "out" }, target: { nodeId: "add", portId: "left" }, transport: "data", evidenceIds: ["fact-add"] },
      { id: "edge-right-add", source: { nodeId: "right", portId: "out" }, target: { nodeId: "add", portId: "right" }, transport: "data", evidenceIds: ["fact-add"] },
      { id: "edge-add-output", source: { nodeId: "add", portId: "out" }, target: { nodeId: "output", portId: "in" }, transport: "data", evidenceIds: ["fact-output"] },
    ],
    processes: [],
    evidenceIndex: {},
    unresolved: [],
  };
}

describe("Architecture IR v3", () => {
  it("accepts an evidence-backed Add with typed data ports and proven shape compatibility", () => {
    const result = validateArchitectureIRv3(validAddIr(), graph(), { renderReady: true });
    expect(result.valid).toBe(true);
    expect(result.ir?.version).toBe(3);
  });

  it("rejects an Add whose typed input arity is below two", () => {
    const ir = validAddIr();
    ir.nodes[3].inputPorts = [ir.nodes[3].inputPorts[0]];
    ir.edges = ir.edges.filter((edge: any) => edge.target.portId !== "right");
    const result = validateArchitectureIRv3(ir, graph());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "merge-arity", path: "nodes[3].inputPorts" }));
  });

  it("requires concat axis and blocks an unknown critical concat shape during render-ready validation", () => {
    const ir = validAddIr();
    ir.nodes[3] = {
      ...ir.nodes[3],
      mergeKind: "concat",
      concatAxis: null,
      inputCompatibility: [{ status: "unknown", comparedAxes: ["H", "W"], reason: "channels unknown", evidenceFactIds: ["fact-add"] }],
    };
    const result = validateArchitectureIRv3(ir, graph(), { renderReady: true });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "concat-axis", path: "nodes[3].concatAxis" }),
      expect.objectContaining({ code: "shape-compatibility-unknown", path: "nodes[3].inputCompatibility[0]" }),
    ]));
  });

  it("requires typed query, key, and value inputs for an Attention node", () => {
    const ir = validAddIr();
    ir.nodes[3] = {
      id: "add", kind: "attention", semanticRole: "cross_attention",
      inputPorts: [port("query", "query"), port("key", "key")], outputPorts: [port("out")],
      attentionKind: "cross", evidenceIds: ["fact-add"],
    };
    const result = validateArchitectureIRv3(ir, graph());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "attention-qkv", path: "nodes[3].inputPorts" }));
  });

  it("rejects a data edge whose target port does not exist", () => {
    const ir = validAddIr();
    ir.edges[2].target.portId = "missing";
    const result = validateArchitectureIRv3(ir, graph());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing-target-port", path: "edges[2].target.portId" }));
  });

  it("requires feedback edges to belong to an explicit process", () => {
    const ir = validAddIr();
    ir.edges.push({ id: "edge-feedback", source: { nodeId: "add", portId: "out" }, target: { nodeId: "left", portId: "in" }, transport: "feedback", evidenceIds: ["fact-add"] });
    const result = validateArchitectureIRv3(ir, graph());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "unowned-feedback", path: "edges[5]" }));
  });
});
