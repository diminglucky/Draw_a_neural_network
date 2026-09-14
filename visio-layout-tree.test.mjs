import assert from "node:assert/strict";
import test from "node:test";

import { compileVisioLayoutTree } from "./visio-layout-tree.mjs";

test("compiles legacy children into typed references and container paths", () => {
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "output"] },
      { id: "left", parentId: "root", direction: "vertical", children: ["a", "b"] },
    ],
    nodes: [
      { id: "a", containerId: "left", repeatCount: 4 },
      { id: "b", containerId: "left" },
      { id: "output", containerId: "root" },
    ],
    edges: [],
  });

  assert.deepEqual(tree.containerById.root.children, [
    { id: "left", kind: "container" },
    { id: "output", kind: "node" },
  ]);
  assert.deepEqual(tree.nodeById.a.containerPath, ["root", "left"]);
  assert.equal(tree.nodeById.a.repeatCount, 4);
  assert.equal(tree.valid, true);
});

test("scopes lanes to their owning container", () => {
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", children: ["left", "right"] },
      { id: "left", parentId: "root", children: ["a"] },
      { id: "right", parentId: "root", children: ["b"] },
    ],
    lanes: [{ id: "features", containerId: "left" }, { id: "features", containerId: "right" }],
    nodes: [{ id: "a", containerId: "left", laneId: "features" }, { id: "b", containerId: "right", laneId: "features" }],
  });

  assert.deepEqual(tree.nodes.map((node) => node.scopedLaneId), ["left::features", "right::features"]);
});

test("rejects cyclic container ownership deterministically", () => {
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "a", parentId: "b", children: ["b"] },
      { id: "b", parentId: "a", children: ["a"] },
    ],
    nodes: [],
  });

  assert.equal(tree.valid, false);
  assert.ok(tree.diagnostics.some((item) => item.code === "container-cycle"));
});

test("treats a legacy self-named container child as its node", () => {
  const tree = compileVisioLayoutTree({
    containers: [{ id: "prediction", children: ["prediction"] }],
    nodes: [{ id: "prediction", containerId: "prediction" }],
  });

  assert.deepEqual(tree.containerById.prediction.children, [{ id: "prediction", kind: "node" }]);
});
