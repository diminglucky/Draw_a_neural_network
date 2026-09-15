import test from "node:test";
import assert from "node:assert/strict";
import { compileModuleComposition, layoutModuleComposition } from "./module-composition-ir.mjs";

test("module composition derives residual structure without model-name rules", () => {
  const composition = compileModuleComposition({ id: "block", attributes: { internalGraph: {
    nodes: [{ id: "norm", family: "norm" }, { id: "conv", family: "conv" }, { id: "add", family: "merge" }],
    edges: [{ source: "norm", target: "conv" }, { source: "conv", target: "add", type: "residual" }, { source: "norm", target: "add", type: "skip" }],
  } } });
  assert.equal(composition.pattern, "residual");
  assert.deepEqual(composition.ports.inputs, ["norm"]);
  assert.deepEqual(composition.ports.outputs, ["add"]);
});

test("module composition lays internal operators in a local topology grid", () => {
  const composition = compileModuleComposition({ attributes: { internalGraph: {
    nodes: [{ id: "a", w: 80, h: 40 }, { id: "b", w: 90, h: 40 }, { id: "c", w: 70, h: 40 }],
    edges: [{ source: "a", target: "b" }, { source: "a", target: "c" }],
  } } });
  const layout = layoutModuleComposition(composition);
  assert.equal(layout.pattern, "parallel");
  assert.ok(layout.bounds.w > 0 && layout.bounds.h > 0);
  assert.equal(new Set(layout.nodes.map((node) => `${node.x}:${node.y}`)).size, layout.nodes.length);
  assert.ok(layout.edges.every((edge) => edge.route?.points?.length === 2));
});

test("residual composition uses a dedicated bypass corridor and contains every child", () => {
  const layout = layoutModuleComposition(compileModuleComposition({ attributes: { internalGraph: {
    nodes: [{ id: "input", family: "norm" }, { id: "main", family: "conv" }, { id: "add", family: "merge" }],
    edges: [
      { id: "main-1", source: "input", target: "main" },
      { id: "main-2", source: "main", target: "add" },
      { id: "skip", source: "input", target: "add", type: "residual" },
    ],
  } } }));
  const skip = layout.edges.find((edge) => edge.id === "skip");
  assert.equal(skip.route.kind, "bypass");
  assert.ok(skip.route.points.length >= 4);
  assert.ok(layout.nodes.every((node) => node.x >= 0 && node.y >= 0
    && node.x + node.w <= layout.bounds.w && node.y + node.h <= layout.bounds.h));
});

test("operator families receive distinct publication dimensions", () => {
  const composition = compileModuleComposition({ attributes: { internalGraph: {
    nodes: [{ id: "conv", family: "conv" }, { id: "merge", family: "merge" }],
    edges: [{ source: "conv", target: "merge" }],
  } } });
  assert.notDeepEqual(
    composition.nodes.map(({ w, h }) => [w, h])[0],
    composition.nodes.map(({ w, h }) => [w, h])[1],
  );
});
