import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnchorConnectorPrimitive,
  createDenseLayerPrimitive,
  createGroupBoxPrimitive,
  createLayerStackPrimitive,
  createRightBandedTensorPrimitive,
  createTensorBoxPrimitive,
  validatePublicationPrimitive,
} from "./publication-primitives.mjs";

test("creates a 3D tensor box with PlotNeuralNet-style faces and anchors", () => {
  const primitive = createTensorBoxPrimitive({
    id: "conv",
    x: 100,
    y: 120,
    w: 120,
    h: 80,
    depth: 40,
    xLabel: "64",
    yLabel: "80",
    zLabel: "120",
    caption: "CONV 3x3",
  });
  assert.equal(primitive.kind, "tensor-box");
  assert.equal(primitive.faces.front.length, 4);
  assert.equal(primitive.faces.top.length, 4);
  assert.equal(primitive.faces.side.length, 4);
  assert.deepEqual(primitive.anchors.west, { x: 100, y: 160 });
  assert.deepEqual(primitive.anchors.east, { x: 220, y: 160 });
  assert.equal(validatePublicationPrimitive(primitive).ok, true);
});

test("creates right-banded Conv+ReLU tensor primitive", () => {
  const primitive = createRightBandedTensorPrimitive({
    id: "conv-relu",
    x: 40,
    y: 80,
    w: 150,
    h: 90,
    depth: 30,
    bandRatio: 1 / 3,
  });
  assert.equal(primitive.kind, "right-banded-tensor");
  assert.equal(primitive.band.front.length, 4);
  assert.equal(primitive.band.front[0][0] > primitive.geometry.x, true);
  assert.equal(validatePublicationPrimitive(primitive).ok, true);
});

test("creates a dense layer primitive with every adjacent-node connection", () => {
  const primitive = createDenseLayerPrimitive({ layers: [2, 3, 3], nodeRadius: 12, nodeGap: 20, layerGap: 160 });
  assert.equal(primitive.nodes.length, 8);
  assert.equal(primitive.links.length, 2 * 3 + 3 * 3);
  assert.deepEqual(primitive.anchors.west, { x: -12, y: 0 });
  assert.deepEqual(primitive.anchors.east, { x: 332, y: 0 });
  assert.deepEqual(primitive.layerLabels.map((label) => label.text), ["2", "3", "3"]);
  assert.equal(validatePublicationPrimitive(primitive).ok, true);
});

test("creates layer stack, group box, and anchor connector primitives", () => {
  const stack = createLayerStackPrimitive({ id: "stack", count: 3, x: 10, y: 20, cellWidth: 30, h: 50, depth: 12 });
  const bandedStack = createLayerStackPrimitive({ id: "banded", count: 2, cellKind: "right_banded_tensor", cellWidth: 30, h: 50, depth: 12 });
  const group = createGroupBoxPrimitive({ id: "encoder", label: "Encoder", x: 0, y: 0, w: 300, h: 200, childIds: [stack.id] });
  const connector = createAnchorConnectorPrimitive({
    id: "skip",
    sourcePrimitiveId: "a",
    targetPrimitiveId: "b",
    sourceAnchorId: "east",
    targetAnchorId: "west",
    sourceAnchor: { x: 100, y: 50 },
    targetAnchor: { x: 300, y: 50 },
    routeClass: "bypass",
  });
  assert.equal(stack.cells.length, 3);
  assert.equal(bandedStack.cells.every((cell) => cell.kind === "right-banded-tensor"), true);
  assert.equal(stack.sourceNodeIds[0], "stack");
  assert.equal(stack.anchors.west.x < stack.anchors.east.x, true);
  assert.equal(group.label, "Encoder");
  assert.deepEqual(connector.points, [[100, 50], [300, 50]]);
});
