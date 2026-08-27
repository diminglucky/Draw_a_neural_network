import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniversalIR,
  normalizeUniversalIR,
  projectUniversalIRToCanvas,
  validateUniversalIR,
} from "./universal-ir.mjs";

const customGraph = {
  figure: {
    title: "Custom multimodal graph",
    subtitle: "branch, custom operator, and merge",
    stages: ["Input", "Branches", "Merge", "Output"],
  },
  nodes: [
    { id: "input", op: "Input", family: "input", stage: 0, label: "Image + Text", shape: ["B", "N", 768] },
    {
      id: "custom",
      op: "CustomCrossModalBlock",
      family: "custom",
      stage: 1,
      label: "CustomCrossModalBlock",
      inputs: ["input"],
      outputs: ["custom-out"],
      ports: { inputs: ["image", "text"], outputs: ["fused"] },
      source: { file: "model.py", line: 42, symbol: "CustomCrossModalBlock.forward" },
      confidence: 0.73,
    },
    { id: "conv", op: "Conv2d", family: "conv", stage: 1, label: "Conv2d", inputs: ["input"], outputs: ["conv-out"] },
    { id: "merge", op: "Add", family: "merge", stage: 2, label: "Add", inputs: ["custom", "conv"], outputs: ["merged"] },
    { id: "output", op: "Output", family: "output", stage: 3, label: "Prediction", inputs: ["merge"] },
  ],
  edges: [
    { id: "input-custom", source: "input", target: "custom", type: "signal" },
    { id: "input-conv", source: "input", target: "conv", type: "signal" },
    { id: "custom-merge", source: "custom", target: "merge", type: "skip" },
    { id: "conv-merge", source: "conv", target: "merge", type: "signal" },
    { id: "merge-output", source: "merge", target: "output", type: "signal" },
  ],
};

test("Universal IR preserves arbitrary operators, ports, shapes, evidence, and confidence", () => {
  const ir = createUniversalIR(customGraph, { sourceKind: "pytorch" });
  const custom = ir.nodes.find((node) => node.id === "custom");

  assert.equal(ir.version, "universal-neural-ir/v1");
  assert.equal(ir.source.kind, "pytorch");
  assert.equal(custom.op, "CustomCrossModalBlock");
  assert.equal(custom.family, "custom");
  assert.deepEqual(custom.ports.inputs, ["image", "text"]);
  assert.equal(custom.shape, undefined);
  assert.equal(custom.source.line, 42);
  assert.equal(custom.confidence, 0.73);
  assert.equal(validateUniversalIR(ir).ok, true);
});

test("Universal IR projects custom and merge semantics without collapsing custom nodes to blocks", () => {
  const ir = normalizeUniversalIR(createUniversalIR(customGraph));
  const document = projectUniversalIRToCanvas(ir);
  const custom = document.nodes.find((node) => node.id === "custom");
  const merge = document.nodes.find((node) => node.id === "merge");

  assert.equal(custom.type, "compound");
  assert.equal(custom.compoundKind, "unresolved");
  assert.equal(custom.op, "CustomCrossModalBlock");
  assert.deepEqual(custom.ports.inputs, ["image", "text"]);
  assert.equal(merge.type, "concat");
  assert.equal(document.edges.length, 5);
  assert.deepEqual(document.figure.stages, customGraph.figure.stages);
});

test("Universal IR validation fails closed for missing endpoints and invalid confidence", () => {
  const ir = createUniversalIR({
    nodes: [{ id: "only", op: "Unknown", family: "custom", confidence: 1.2 }],
    edges: [{ id: "broken", source: "only", target: "missing" }],
  });
  const report = validateUniversalIR(ir);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.kind === "missing-edge-endpoint"));
  assert.ok(report.issues.some((issue) => issue.kind === "invalid-confidence"));
});
