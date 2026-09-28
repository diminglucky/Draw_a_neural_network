import assert from "node:assert/strict";
import test from "node:test";
import { fuseGraphEvidence } from "./graph-evidence-fusion.mjs";

function graph(edges) {
  return {
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "input", op: "Input", family: "input" },
      { id: "conv", op: "Conv2d", family: "conv" },
      { id: "output", op: "Output", family: "output" },
    ],
    edges,
  };
}

test("higher-authority graph evidence wins while preserving provenance", () => {
  const result = fuseGraphEvidence([
    { id: "ast", authority: 2, analyzer: "python-ast", ir: graph([
      { id: "a", source: "input", target: "conv", type: "signal" },
      { id: "b", source: "conv", target: "output", type: "output" },
    ]) },
    { id: "export", authority: 5, analyzer: "torch-export", ir: graph([
      { id: "a", source: "input", target: "conv", type: "signal" },
      { id: "b", source: "conv", target: "output", type: "output" },
    ]) },
  ]);

  assert.equal(result.blocked, false);
  assert.equal(result.provenance.nodes.conv[0].id, "export");
  assert.deepEqual(result.conflicts, []);
});

test("topology conflicts block fusion instead of silently overriding", () => {
  const result = fuseGraphEvidence([
    { id: "ast", authority: 2, analyzer: "python-ast", ir: graph([
      { id: "a", source: "input", target: "output", type: "signal" },
    ]) },
    { id: "export", authority: 5, analyzer: "torch-export", ir: graph([
      { id: "a", source: "input", target: "conv", type: "signal" },
    ]) },
  ]);

  assert.equal(result.blocked, true);
  assert.equal(result.status, "contradicted");
  assert.ok(result.conflicts.some((conflict) => conflict.kind === "edge-conflict" && conflict.severity === "error"));
});

test("aligns equivalent grounded graphs that use different source identities", () => {
  const result = fuseGraphEvidence([
    {
      id: "explicit-ir",
      authority: 10,
      analyzer: "explicit-ir",
      ir: graph([
        { id: "flow-a", source: "input", target: "conv", type: "signal" },
        { id: "flow-b", source: "conv", target: "output", type: "output" },
      ]),
    },
    {
      id: "config-source",
      authority: 6,
      analyzer: "config",
      ir: {
        version: "universal-neural-ir/v1",
        nodes: [
          { id: "pipeline-0", op: "Input", family: "input" },
          { id: "pipeline-1", op: "Conv2d", family: "conv" },
          { id: "pipeline-2", op: "Output", family: "output" },
        ],
        edges: [
          { id: "config-edge-1", source: "pipeline-0", target: "pipeline-1", type: "signal" },
          { id: "config-edge-2", source: "pipeline-1", target: "pipeline-2", type: "output" },
        ],
      },
    },
  ]);

  assert.equal(result.blocked, false, JSON.stringify(result.conflicts));
  assert.deepEqual(result.ir.nodes.map((node) => node.id), ["input", "conv", "output"]);
  assert.deepEqual(result.ir.edges.map((edge) => edge.id), ["flow-a", "flow-b"]);
  assert.equal(result.provenance.nodes.conv.some((item) => item.id === "config-source"), true);
  assert.equal(result.provenance.alignments[1].mappedNodeCount, 3);
});

test("grounded graphs with disjoint identities block instead of silently merging", () => {
  const result = fuseGraphEvidence([
    {
      id: "explicit-ir",
      authority: 10,
      analyzer: "explicit-ir",
      ir: {
        version: "universal-neural-ir/v1",
        nodes: [
          { id: "input", op: "Input", family: "input" },
          { id: "output", op: "Output", family: "output" },
        ],
        edges: [{ id: "flow", source: "input", target: "output", type: "output" }],
      },
    },
    {
      id: "artifact-source",
      authority: 8,
      analyzer: "onnx",
      ir: {
        version: "universal-neural-ir/v1",
        nodes: [
          { id: "onnx-0", op: "Conv", family: "conv" },
          { id: "onnx-1", op: "Relu", family: "activation" },
          { id: "onnx-2", op: "Gemm", family: "dense" },
        ],
        edges: [
          { id: "onnx-edge-1", source: "onnx-0", target: "onnx-1", type: "signal" },
          { id: "onnx-edge-2", source: "onnx-1", target: "onnx-2", type: "signal" },
        ],
      },
    },
  ]);

  assert.equal(result.blocked, true);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === "alignment-conflict" && conflict.severity === "error"));
});
