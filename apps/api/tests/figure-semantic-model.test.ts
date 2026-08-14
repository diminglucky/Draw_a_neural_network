import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { parseFigureSemanticModel } from "../src/figure-semantic-model.js";
import { parseCanonicalNetworkIR } from "../src/network-ir-v2.js";

function ir() {
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "cnn", title: "Small CNN", description: null },
    tensors: [
      { id: "input-tensor", name: "input", shape: [32, 32, 3], axes: ["height", "width", "channel"], semanticRole: "input", dtype: null, producerNodeId: "input", consumerNodeIds: ["conv"] },
      { id: "feature-tensor", name: "features", shape: [16, 16, 16], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: null, producerNodeId: "conv", consumerNodeIds: ["output"] },
    ],
    nodes: [
      { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
      { id: "conv", op: "conv2d", inputTensorIds: ["input-tensor"], outputTensorIds: ["feature-tensor"], confidence: 0.9, sourceEvidenceIds: ["fact-conv"], repeats: null },
      { id: "output", op: "output", inputTensorIds: ["feature-tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
    ],
    edges: [
      { id: "input-flow", sourceNodeId: "input", targetNodeId: "conv", relation: "data", tensorIds: ["input-tensor"], confidence: 1, evidenceIds: ["fact-input"] },
      { id: "output-flow", sourceNodeId: "conv", targetNodeId: "output", relation: "data", tensorIds: ["feature-tensor"], confidence: 1, evidenceIds: ["fact-output"] },
    ],
    groups: [],
    unresolved: [],
  });
}

function model() {
  return {
    version: 1,
    grammar: { id: "cnn-classifier", version: 1 },
    regions: [{ id: "backbone", label: "Feature backbone", role: "backbone", displayIds: ["input-stage", "conv-stage", "output-head"] }],
    displayNodes: [
      { id: "input-stage", role: "input", label: "Input", summary: null, semantic: { stage: 0 } },
      { id: "conv-stage", role: "tensor_stage", label: "Conv stage", summary: "16 channels", semantic: { repeatCount: 1, channels: 16 } },
      { id: "output-head", role: "output", label: "Class scores", summary: null, semantic: { stage: 2 } },
    ],
    displayRelations: [
      { id: "flow-1", role: "flow", sourceDisplayId: "input-stage", targetDisplayId: "conv-stage", label: null, semantic: {} },
      { id: "flow-2", role: "flow", sourceDisplayId: "conv-stage", targetDisplayId: "output-head", label: null, semantic: {} },
    ],
    sourceMappings: [
      { displayId: "input-stage", networkNodeIds: ["input"], tensorIds: ["input-tensor"], edgeIds: ["input-flow"], evidenceIds: ["fact-input"] },
      { displayId: "conv-stage", networkNodeIds: ["conv"], tensorIds: ["feature-tensor"], edgeIds: ["input-flow", "output-flow"], evidenceIds: ["fact-conv"] },
      { displayId: "output-head", networkNodeIds: ["output"], tensorIds: ["feature-tensor"], edgeIds: ["output-flow"], evidenceIds: ["fact-output"] },
    ],
    narrative: { title: "Small CNN", summary: "A compact convolutional classifier.", stageSummaries: ["Input", "Feature extraction", "Output"] },
  };
}

describe("FigureSemanticModel", () => {
  it("accepts a bounded semantic narrative whose display objects map only to Canonical IR IDs", () => {
    const parsed = parseFigureSemanticModel(model(), ir(), defaultFigureIntent());

    expect(parsed.grammar).toEqual({ id: "cnn-classifier", version: 1 });
    expect(parsed.sourceMappings).toHaveLength(parsed.displayNodes.length);
    expect(JSON.stringify(parsed)).not.toMatch(/locator|excerpt|coordinates|primitive|outputPath/i);
  });

  it.each([
    ["an unknown IR node", (value: any) => { value.sourceMappings[1].networkNodeIds = ["unknown-node"]; }],
    ["an unknown public evidence ID", (value: any) => { value.sourceMappings[1].evidenceIds = ["private-evidence"]; }],
    ["a source-less display object", (value: any) => { value.sourceMappings = value.sourceMappings.slice(1); }],
    ["a disconnected relation endpoint", (value: any) => { value.displayRelations[1].targetDisplayId = "missing-display"; }],
    ["a forbidden coordinate field", (value: any) => { value.displayNodes[1].coordinates = { x: 10, y: 20 }; }],
    ["a forbidden source locator", (value: any) => { value.sourceMappings[1].locator = "line 12"; }],
  ])("rejects %s", (_label, mutate) => {
    const value = model();
    mutate(value);

    expect(() => parseFigureSemanticModel(value, ir(), defaultFigureIntent())).toThrow();
  });
});
