import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalModelGraph, validateCanonicalModelGraph } from "./canonical-model-graph.mjs";

function ir() {
  return {
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "input", op: "Input", family: "input", shape: { output: [224, 224, 3], ordering: "HWC", source: "declared", confidence: 1 } },
      { id: "conv", op: "Conv2d", family: "conv", shape: { output: [112, 112, 64], ordering: "HWC", source: "inferred", confidence: 0.9 }, containerId: "encoder" },
      { id: "output", op: "Output", family: "output", shape: { output: [10], ordering: "vector", source: "declared", confidence: 1 } },
    ],
    edges: [
      { id: "input-conv", source: "input", target: "conv", type: "signal" },
      { id: "conv-output", source: "conv", target: "output", type: "output" },
    ],
    containers: [{ id: "encoder", children: ["conv"], kind: "stage" }],
  };
}

test("builds a canonical model graph with tensor contracts and module tree", () => {
  const graph = buildCanonicalModelGraph(ir());
  assert.equal(graph.version, "canonical-model-graph/v1");
  assert.deepEqual(graph.nodes.map((node) => node.canonicalId), ["input", "conv", "output"]);
  assert.equal(graph.tensorContracts.conv.output.shape[0], "112");
  assert.equal(graph.tensorContracts.conv.output.status, "inferred");
  assert.deepEqual(graph.moduleTree.find((group) => group.id === "encoder").nodeIds, ["conv"]);
  assert.equal(validateCanonicalModelGraph(graph).ok, true);
});

test("canonical model graph reports missing tensor contracts", () => {
  const graph = buildCanonicalModelGraph(ir());
  delete graph.tensorContracts.output;
  const validation = validateCanonicalModelGraph(graph);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-tensor-contract" && issue.nodeId === "output"));
});
