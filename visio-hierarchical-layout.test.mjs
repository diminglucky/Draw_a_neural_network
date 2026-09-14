import assert from "node:assert/strict";
import test from "node:test";

import { compileVisioLayoutTree } from "./visio-layout-tree.mjs";
import { layoutVisioHierarchy } from "./visio-hierarchical-layout.mjs";

const node = (id, containerId) => ({ id, containerId, w: 80, h: 60 });

function geometry(direction, count = 3, extra = {}) {
  const nodes = Array.from({ length: count }, (_, index) => node(`n${index + 1}`, "root"));
  const tree = compileVisioLayoutTree({
    containers: [{ id: "root", direction, children: nodes.map((item) => item.id), ...extra }],
    nodes,
  });
  return layoutVisioHierarchy(tree, { origin: { x: 100, y: 80 } });
}

test("horizontal and vertical containers advance on their declared axis", () => {
  const horizontal = geometry("horizontal");
  assert.ok(horizontal.nodeById.n1.x < horizontal.nodeById.n2.x);
  assert.equal(horizontal.nodeById.n1.y, horizontal.nodeById.n2.y);

  const vertical = geometry("vertical");
  assert.ok(vertical.nodeById.n1.y < vertical.nodeById.n2.y);
  assert.equal(vertical.nodeById.n1.x, vertical.nodeById.n2.x);
});

test("grid wraps items into bounded rows and stack overlays repeated items", () => {
  const grid = geometry("grid", 5, { columns: 2 });
  assert.equal(grid.nodeById.n1.y, grid.nodeById.n2.y);
  assert.ok(grid.nodeById.n3.y > grid.nodeById.n1.y);
  assert.equal(grid.nodeById.n1.x, grid.nodeById.n3.x);

  const stack = geometry("stack", 3);
  assert.ok(grid.containerById.root.w > 0);
  assert.ok(stack.nodeById.n2.x > stack.nodeById.n1.x);
  assert.ok(stack.nodeById.n2.x - stack.nodeById.n1.x < 30);
});

test("mixed nested containers are measured bottom-up and placed inside their parent", () => {
  const nodes = [node("a", "left"), node("b", "left"), node("c", "right"), node("d", "right")];
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "right"], padding: 30 },
      { id: "left", parentId: "root", direction: "vertical", children: ["a", "b"] },
      { id: "right", parentId: "root", direction: "vertical", children: ["c", "d"] },
    ],
    nodes,
  });
  const result = layoutVisioHierarchy(tree, { origin: { x: 40, y: 50 } });
  const root = result.containerById.root;
  const left = result.containerById.left;
  const right = result.containerById.right;

  assert.ok(result.nodeById.a.y < result.nodeById.b.y);
  assert.ok(left.x < right.x);
  for (const child of [left, right]) {
    assert.ok(child.x >= root.x && child.y >= root.y);
    assert.ok(child.x + child.w <= root.x + root.w);
    assert.ok(child.y + child.h <= root.y + root.h);
  }
  assert.ok(result.nodeById.a.y >= left.contentBounds.y, "node must stay below the container title band");
});

test("aligns the same scoped lane across sibling containers on a shared cross-axis", () => {
  const nodes = [
    { id: "left-a", containerId: "left", laneId: "features", laneContainerId: "root", w: 80, h: 40 },
    { id: "right-a", containerId: "right", laneId: "features", laneContainerId: "root", w: 80, h: 40 },
    { id: "right-b", containerId: "right", w: 80, h: 40 },
  ];
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "right"] },
      { id: "left", parentId: "root", direction: "vertical", children: ["left-a"] },
      { id: "right", parentId: "root", direction: "vertical", children: ["right-b", "right-a"] },
    ],
    nodes,
  });
  const result = layoutVisioHierarchy(tree);
  const left = result.nodeById["left-a"];
  const right = result.nodeById["right-a"];
  assert.equal(left.y + left.h / 2, right.y + right.h / 2);
  assert.ok(result.nodeById["right-b"].y + result.nodeById["right-b"].h <= right.y);
  assert.equal(
    result.nodeById["right-a"].y - result.nodeById["right-b"].y,
    40 + tree.containerById.right.gap,
    "lane alignment must preserve the declared vertical layout inside a sibling container",
  );
});

test("preserves declared vertical sibling flow while aligning lanes horizontally", () => {
  const nodes = [
    { id: "top-a", containerId: "top", laneId: "features", laneContainerId: "root", w: 80, h: 40 },
    { id: "bottom-a", containerId: "bottom", laneId: "features", laneContainerId: "root", w: 80, h: 40 },
  ];
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", direction: "vertical", children: ["top", "bottom"] },
      { id: "top", parentId: "root", direction: "horizontal", children: ["top-a"] },
      { id: "bottom", parentId: "root", direction: "horizontal", children: ["bottom-a"] },
    ],
    nodes,
  });
  const result = layoutVisioHierarchy(tree);
  assert.equal(result.nodeById["top-a"].x, result.nodeById["bottom-a"].x);
  assert.ok(result.containerById.bottom.y > result.containerById.top.y);
});

test("lane alignment translates same-branch members together without overlap", () => {
  const nodes = [
    { id: "left-a", containerId: "left", laneId: "p3", laneContainerId: "root", w: 80, h: 40 },
    { id: "left-b", containerId: "left", laneId: "p3", laneContainerId: "root", w: 80, h: 40 },
    { id: "right-a", containerId: "right", laneId: "p3", laneContainerId: "root", w: 80, h: 40 },
  ];
  const tree = compileVisioLayoutTree({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "right"] },
      { id: "left", parentId: "root", direction: "vertical", children: ["left-a", "left-b"], gap: 24 },
      { id: "right", parentId: "root", direction: "vertical", children: ["right-a"] },
    ],
    nodes,
    lanes: [{ id: "p3", key: "p3", axis: "horizontal", containerId: "root" }],
  });
  const beforeGap = 40 + tree.containerById.left.gap;
  const result = layoutVisioHierarchy(tree);
  assert.equal(result.nodeById["left-b"].y - result.nodeById["left-a"].y, beforeGap);
  assert.ok(result.nodeById["left-a"].y + result.nodeById["left-a"].h <= result.nodeById["left-b"].y);
});
