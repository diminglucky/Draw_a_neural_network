import assert from "node:assert/strict";
import test from "node:test";
import {
  layoutUniversalFigure,
  selectFigureGrammar,
} from "./universal-figure.mjs";

function residualIR() {
  return {
    figure: { title: "Residual fixture" },
    nodes: [
      { id: "input", op: "Input", family: "input", stage: 0, label: "x" },
      { id: "block", op: "Bottleneck", family: "custom", stage: 1, label: "Bottleneck", attributes: {
        internalGraph: {
          nodes: [
            { id: "norm", op: "LayerNorm", family: "norm", label: "Norm" },
            { id: "main", op: "Conv3x3", family: "conv", label: "3×3" },
            { id: "add", op: "Add", family: "merge", label: "+" },
          ],
          edges: [
            { id: "inner-main", source: "norm", target: "main", type: "signal" },
            { id: "inner-add", source: "main", target: "add", type: "residual" },
            { id: "inner-skip", source: "norm", target: "add", type: "residual" },
          ],
        },
      } },
      { id: "output", op: "Output", family: "output", stage: 2, label: "y" },
    ],
    edges: [
      { id: "forward", source: "input", target: "block", type: "signal" },
      { id: "skip", source: "input", target: "output", type: "skip" },
      { id: "tail", source: "block", target: "output", type: "signal" },
    ],
  };
}

test("selectFigureGrammar chooses a semantic grammar from topology, not a template name", () => {
  const grammar = selectFigureGrammar(residualIR());
  assert.equal(grammar.id, "residual-graph");
  assert.match(grammar.reason, /residual|skip/i);
});

test("layoutUniversalFigure preserves arbitrary internal topology inside a compound node", () => {
  const layout = layoutUniversalFigure(residualIR());
  const block = layout.nodes.find((node) => node.id === "block");
  assert.equal(block.representation, "compound");
  assert.deepEqual(block.inner.nodes.map((node) => node.id), ["norm", "main", "add"]);
  assert.equal(block.inner.edges.length, 3);
  assert.ok(block.inner.edges.some((edge) => edge.type === "residual"));
  assert.equal(layout.validation.ok, true);
});

test("layoutUniversalFigure packs a long single-lane graph with a readable width-aware gap", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, order: 0, label: "Input", w: 122, h: 188 },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `conv-${index + 1}`,
      family: "conv",
      stage: index + 1,
      order: index + 1,
      label: `Conv ${index + 1}`,
      w: 150,
      h: 220,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `pool-${index + 1}`,
      family: "pool",
      stage: index + 6,
      order: index + 6,
      label: "MaxPool",
      w: 92,
      h: 92,
    })),
    { id: "flatten", family: "flatten", stage: 11, order: 11, label: "Flatten", w: 150, h: 138 },
    { id: "fc1", family: "dense", stage: 12, order: 12, label: "Linear 4096", w: 132, h: 210 },
    { id: "fc2", family: "dense", stage: 13, order: 13, label: "Linear 4096", w: 132, h: 210 },
    { id: "output", family: "output", stage: 14, order: 14, label: "Linear 1000", w: 110, h: 148 },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: index === 10 ? "attention" : "signal",
  }));
  const layout = layoutUniversalFigure({ nodes, edges });
  const ordered = [...layout.nodes].sort((left, right) => left.order - right.order);
  const gaps = ordered.slice(1).map((node, index) => node.x - (ordered[index].x + ordered[index].w));

  assert.equal(layout.validation.ok, true);
  assert.ok(Math.min(...gaps) >= 30, `expected every stage gap to be >= 30, got ${gaps.join(", ")}`);
  assert.ok(layout.artboard.height <= 700, `expected a compact single-lane page, got height ${layout.artboard.height}`);
});

test("layoutUniversalFigure marks an opaque custom node unresolved instead of inventing children", () => {
  const ir = { nodes: [{ id: "custom", op: "OpaqueBlock", family: "custom", stage: 0, label: "OpaqueBlock" }], edges: [] };
  const layout = layoutUniversalFigure(ir);
  const custom = layout.nodes[0];
  assert.equal(custom.representation, "compound");
  assert.equal(custom.inner.kind, "unresolved");
  assert.equal(custom.inner.nodes.length, 0);
  assert.match(custom.note, /unresolved|review/i);
});

test("universal figure keeps pooling geometry distinct from merge symbols", () => {
  const layout = layoutUniversalFigure({
    nodes: [
      { id: "conv", family: "conv", stage: 0, label: "Conv" },
      { id: "pool", family: "pool", stage: 1, label: "MaxPool" },
      { id: "merge", family: "merge", stage: 2, label: "Add" },
    ],
    edges: [
      { id: "e1", source: "conv", target: "pool" },
      { id: "e2", source: "pool", target: "merge" },
    ],
  });

  assert.equal(layout.nodes.find((node) => node.id === "pool").representation, "pool-prism");
  assert.equal(layout.nodes.find((node) => node.id === "merge").representation, "operator-symbol");
});

test("universal figure groups linear convolution runs into evidence-backed stages", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, label: "Input" },
    { id: "conv1", family: "conv", stage: 1, order: 1, label: "Conv 64", shape: { output: [224, 224, 64] } },
    { id: "conv2", family: "conv", stage: 2, order: 2, label: "Conv 64", shape: { output: [224, 224, 64] } },
    { id: "pool1", family: "pool", stage: 3, order: 3, label: "MaxPool", shape: { output: [112, 112, 64] } },
    { id: "conv3", family: "conv", stage: 4, order: 4, label: "Conv 128", shape: { output: [112, 112, 128] } },
    { id: "conv4", family: "conv", stage: 5, order: 5, label: "Conv 128", shape: { output: [112, 112, 128] } },
    { id: "flatten", family: "flatten", stage: 6, order: 6, label: "Flatten" },
    { id: "fc", family: "dense", stage: 7, order: 7, label: "Linear 4096" },
    { id: "output", family: "output", stage: 8, order: 8, label: "Softmax" },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: "signal",
  }));
  const layout = layoutUniversalFigure({ nodes, edges });
  const blocks = layout.nodes.filter((node) => node.family === "conv");

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((node) => node.repeatCount), [2, 2]);
  assert.deepEqual(blocks.map((node) => node.inner.nodes.map((child) => child.id)), [
    ["conv1", "conv2"],
    ["conv3", "conv4"],
  ]);
  assert.equal(layout.nodes.find((node) => node.id === "fc").representation, "classifier-prism");
  assert.equal(layout.nodes.find((node) => node.id === "flatten").representation, "flatten-ribbon");
  assert.equal(layout.nodes.find((node) => node.id === "output").representation, "softmax-prism");
  assert.equal(layout.validation.ok, true);
});
