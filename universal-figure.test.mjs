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

test("layoutUniversalFigure marks an opaque custom node unresolved instead of inventing children", () => {
  const ir = { nodes: [{ id: "custom", op: "OpaqueBlock", family: "custom", stage: 0, label: "OpaqueBlock" }], edges: [] };
  const layout = layoutUniversalFigure(ir);
  const custom = layout.nodes[0];
  assert.equal(custom.representation, "compound");
  assert.equal(custom.inner.kind, "unresolved");
  assert.equal(custom.inner.nodes.length, 0);
  assert.match(custom.note, /unresolved|review/i);
});
