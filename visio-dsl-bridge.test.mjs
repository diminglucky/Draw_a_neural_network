import assert from "node:assert/strict";
import test from "node:test";
import { compileNeuralFigureDslToVisioLayout } from "./visio-dsl-bridge.mjs";

test("compiles a Neural Figure DSL program into a Visio-ready legacy layout", () => {
  const layout = compileNeuralFigureDslToVisioLayout({
    version: "neural-figure-dsl/v1",
    primitives: [
      { id: "stem", kind: "tensor_box", options: { x: 20, y: 40, w: 120, h: 80, depth: 36, caption: "Stem" } },
      { id: "block", kind: "right_banded_tensor", options: { x: 240, y: 40, w: 140, h: 80, depth: 36, caption: "Block" } },
      { id: "dense", kind: "dense_layer", options: { layers: [2, 3], x: 520, y: 90, nodeRadius: 10, nodeGap: 12, layerGap: 110 } },
    ],
    connectors: [
      { id: "flow", from: { primitiveId: "stem", anchor: "east" }, to: { primitiveId: "block", anchor: "west" } },
      { id: "dense-in", from: { primitiveId: "block", anchor: "east" }, to: { primitiveId: "dense", anchor: "west" } },
    ],
    groups: [
      { id: "stage", kind: "group_box", options: { label: "Stage", x: 0, y: 0, w: 700, h: 220, childIds: ["stem", "block"] } },
    ],
  });

  assert.equal(layout.version, "visio-diagram-plan/v1");
  assert.equal(layout.bridgeVersion, "visio-dsl-bridge/v1");
  assert.equal(layout.nodes.find((node) => node.id === "stem").shapeKind, "publication-tensor-box");
  assert.equal(layout.nodes.find((node) => node.id === "block").shapeKind, "publication-right-banded-tensor");
  assert.equal(layout.nodes.find((node) => node.id === "dense").shapeKind, "publication-dense-layer");
  assert.equal(layout.edges.length, 2);
  assert.equal(layout.artboard.width > 700, true);
});
