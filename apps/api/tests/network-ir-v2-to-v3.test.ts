import { describe, expect, it } from "vitest";
import { parseCanonicalNetworkIR } from "../src/network-ir-v2.js";
import { adaptCanonicalNetworkIRv2 } from "../src/network-ir-v2-to-v3.js";
import { validateArchitectureIRv3 } from "../src/network-ir-v3.js";

function residualV2(): any {
  return {
    version: 2,
    figure: { id: "legacy-residual", title: "Legacy residual", description: null },
    tensors: [
      { id: "input-tensor", name: "input", shape: [1, 64, 32, 32], axes: ["batch", "channel", "height", "width"], semanticRole: "input", dtype: "float32", producerNodeId: "input", consumerNodeIds: ["left", "right"] },
      { id: "left-tensor", name: "left", shape: [1, 64, 32, 32], axes: ["batch", "channel", "height", "width"], semanticRole: "activation", dtype: "float32", producerNodeId: "left", consumerNodeIds: ["add-1"] },
      { id: "right-tensor", name: "right", shape: [1, 64, 32, 32], axes: ["batch", "channel", "height", "width"], semanticRole: "activation", dtype: "float32", producerNodeId: "right", consumerNodeIds: ["add-1"] },
      { id: "merged-tensor", name: "merged", shape: [1, 64, 32, 32], axes: ["batch", "channel", "height", "width"], semanticRole: "activation", dtype: "float32", producerNodeId: "add-1", consumerNodeIds: ["output"] },
    ],
    nodes: [
      { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"] },
      { id: "left", op: "conv2d", inputTensorIds: ["input-tensor"], outputTensorIds: ["left-tensor"], confidence: 0.9, sourceEvidenceIds: ["fact-left"] },
      { id: "right", op: "conv2d", inputTensorIds: ["input-tensor"], outputTensorIds: ["right-tensor"], confidence: 0.9, sourceEvidenceIds: ["fact-right"] },
      { id: "add-1", op: "add", inputTensorIds: ["left-tensor", "right-tensor"], outputTensorIds: ["merged-tensor"], confidence: 0.9, sourceEvidenceIds: ["fact-add"] },
      { id: "output", op: "output", inputTensorIds: ["merged-tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"] },
    ],
    edges: [
      { id: "edge-input-left", sourceNodeId: "input", targetNodeId: "left", relation: "data", tensorIds: ["input-tensor"], confidence: 1, evidenceIds: ["fact-left"] },
      { id: "edge-input-right", sourceNodeId: "input", targetNodeId: "right", relation: "data", tensorIds: ["input-tensor"], confidence: 1, evidenceIds: ["fact-right"] },
      { id: "edge-left-add", sourceNodeId: "left", targetNodeId: "add-1", relation: "data", tensorIds: ["left-tensor"], confidence: 0.9, evidenceIds: ["fact-add"] },
      { id: "edge-right-add", sourceNodeId: "right", targetNodeId: "add-1", relation: "data", tensorIds: ["right-tensor"], confidence: 0.9, evidenceIds: ["fact-add"] },
      { id: "edge-add-output", sourceNodeId: "add-1", targetNodeId: "output", relation: "data", tensorIds: ["merged-tensor"], confidence: 0.9, evidenceIds: ["fact-output"] },
    ],
    groups: [],
    unresolved: [],
  };
}

describe("Canonical NetworkIR v2 to Architecture IR v3 adapter", () => {
  it("preserves v2 identifiers and evidence while recording loss of typed merge semantics", () => {
    const legacy = parseCanonicalNetworkIR(residualV2());
    const adapted = adaptCanonicalNetworkIRv2(legacy);

    expect(adapted).toMatchObject({ version: 3, graphId: "legacy-residual" });
    expect(adapted.nodes.map((node) => node.id)).toEqual(legacy.nodes.map((node) => node.id));
    expect(adapted.edges.map((edge) => edge.id)).toEqual(legacy.edges.map((edge) => edge.id));
    expect(adapted.nodes.find((node) => node.id === "add-1")).toMatchObject({ kind: "merge", evidenceIds: ["fact-add"] });
    expect(adapted.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking",
      conflictKey: "v2:merge:add-1",
      evidenceFactIds: ["fact-add"],
    }));
    expect(validateArchitectureIRv3(adapted).valid).toBe(true);
  });
});
