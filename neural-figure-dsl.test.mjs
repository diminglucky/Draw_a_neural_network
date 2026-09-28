import assert from "node:assert/strict";
import test from "node:test";
import {
  compileNeuralFigureProgram,
  createNeuralFigureProgram,
  validateNeuralFigureProgram,
} from "./neural-figure-dsl.mjs";

test("validates and compiles a Neural Figure DSL program into publication primitives", () => {
  const program = createNeuralFigureProgram({
    primitives: [
      { id: "stem", kind: "tensor_box", options: { x: 20, y: 40, w: 120, h: 80, depth: 36, caption: "Stem" } },
      { id: "block", kind: "right_banded_tensor", options: { x: 240, y: 40, w: 140, h: 80, depth: 36, caption: "Block" } },
    ],
    connectors: [
      { id: "flow", from: { primitiveId: "stem", anchor: "east" }, to: { primitiveId: "block", anchor: "west" }, routeClass: "main-flow" },
    ],
    groups: [
      { id: "stage", kind: "group_box", options: { label: "Stage", x: 0, y: 0, w: 420, h: 180, childIds: ["stem", "block"] } },
    ],
  });
  assert.equal(validateNeuralFigureProgram(program).ok, true);
  const compiled = compileNeuralFigureProgram(program);
  assert.equal(compiled.primitives.length, 2);
  assert.equal(compiled.connectors.length, 1);
  assert.deepEqual(compiled.connectors[0].points, [[140, 80], [240, 80]]);
  assert.equal(compiled.groups[0].label, "Stage");
});

test("rejects DSL connector references to missing primitives", () => {
  const program = createNeuralFigureProgram({
    primitives: [{ id: "a", kind: "tensor_box", options: { x: 0, y: 0, w: 100, h: 50 } }],
    connectors: [{ id: "bad", from: { primitiveId: "a", anchor: "east" }, to: { primitiveId: "missing", anchor: "west" } }],
  });
  const validation = validateNeuralFigureProgram(program);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "dsl-connector-missing-primitive"));
});

test("compiles dense layer and layer stack primitives for extensible diagrams", () => {
  const program = createNeuralFigureProgram({
    primitives: [
      { id: "dense", kind: "dense_layer", options: { layers: [2, 3], x: 100, y: 100 } },
      { id: "stack", kind: "layer_stack", options: { count: 4, x: 300, y: 80, cellWidth: 28, h: 70, depth: 20 } },
    ],
  });
  const compiled = compileNeuralFigureProgram(program);
  assert.equal(compiled.primitives.find((item) => item.id === "dense").links.length, 6);
  assert.equal(compiled.primitives.find((item) => item.id === "stack").cells.length, 4);
});
