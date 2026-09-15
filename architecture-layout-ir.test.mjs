import assert from "node:assert/strict";
import test from "node:test";
import { compileArchitectureLayout } from "./architecture-layout-ir.mjs";

test("compiles generic branching multi-scale topology into layout semantics", () => {
  const result = compileArchitectureLayout({
    nodes: [
      { id: "a", label: "A", containerId: "trunk", shape: { dimensions: [80, 80, 128] }, ports: { inputs: ["x"], outputs: ["y"] } },
      { id: "b", label: "B", containerId: "fusion", shape: { dimensions: [40, 40, 256] }, ports: { inputs: ["x", "skip"], outputs: ["y"] } },
      { id: "out", label: "Output", containerId: "head", shape: { dimensions: [40, 40, 64] }, ports: { inputs: ["x"], outputs: [] } },
    ],
    edges: [
      { id: "main", source: "a", target: "b", ports: { source: "y", target: "x" } },
      { id: "cross", source: "a", target: "b", type: "skip", ports: { source: "y", target: "skip" } },
      { id: "finish", source: "b", target: "out", ports: { source: "y", target: "x" } },
    ],
    containers: [
      { id: "trunk", label: "Trunk", direction: "vertical", children: ["a"] },
      { id: "fusion", label: "Fusion", direction: "vertical", children: ["b"] },
      { id: "head", label: "Head", direction: "vertical", children: ["out"] },
    ],
  });

  assert.deepEqual(result.containers.map((item) => item.id), ["trunk", "fusion", "head"]);
  assert.equal(result.containers[0].direction, "vertical");
  assert.deepEqual(result.lanes.map((lane) => lane.key), ["80x80", "40x40"]);
  assert.equal(result.nodeAssignments.find((item) => item.nodeId === "a").laneId, "lane-80x80");
  assert.equal(result.edges.find((item) => item.id === "cross").routeClass, "skip");
  assert.equal(result.edges.find((item) => item.id === "main").routeClass, "scale-transfer");
  assert.deepEqual(result.nodes.find((item) => item.id === "b").ports.inputs, ["x", "skip"]);
});

test("infers stage containers for complex container-free graphs", () => {
  const result = compileArchitectureLayout({
    nodes: [
      { id: "input", family: "input", stage: 0, shape: { output: [80, 80, 3] } },
      { id: "left", family: "conv", stage: 1, shape: { output: [80, 80, 32] } },
      { id: "right", family: "conv", stage: 1, shape: { output: [40, 40, 64] } },
      { id: "merge", family: "merge", stage: 2, shape: { output: [40, 40, 96] } },
      { id: "small", family: "output", stage: 3, shape: { output: [80, 80, 32] } },
      { id: "large", family: "output", stage: 3, shape: { output: [40, 40, 32] } },
    ],
    edges: [
      { source: "input", target: "left" }, { source: "input", target: "right" },
      { source: "left", target: "merge", type: "skip" }, { source: "right", target: "merge" },
      { source: "merge", target: "small" }, { source: "merge", target: "large" },
    ],
  });
  assert.equal(result.features.autoContainers, true);
  assert.ok(result.containers.some((container) => container.id === "auto-root"));
  assert.ok(result.containers.filter((container) => container.id.startsWith("auto-stage-")).length >= 2);
  assert.ok(result.nodeAssignments.every((assignment) => assignment.containerId));
});

test("preserves explicit lanes and nested container ownership", () => {
  const result = compileArchitectureLayout({
    nodes: [
      { id: "state", laneId: "hidden-state", containerId: "inner" },
    ],
    edges: [],
    containers: [
      { id: "outer", kind: "module", children: ["inner"], direction: "horizontal" },
      { id: "inner", kind: "stage", parentId: "outer", children: ["state"] },
    ],
    lanes: [{ id: "lane-hidden-state", kind: "state", key: "hidden-state", label: "Hidden state" }],
  });

  assert.deepEqual(result.lanes, [{ id: "lane-hidden-state", kind: "state", key: "hidden-state", order: 0, label: "Hidden state" }]);
  assert.deepEqual(result.nodeAssignments[0], { nodeId: "state", containerId: "inner", laneId: "lane-hidden-state" });
  assert.equal(result.features.nestedModules, true);
  assert.equal(result.containers.find((item) => item.id === "inner").parentId, "outer");
  assert.equal(result.containerTree.version, "visio-layout-tree/v1");
  assert.deepEqual(result.containerTree.nodeById.state.containerPath, ["outer", "inner"]);
});

test("preserves repetition as a first-class layout property", () => {
  const result = compileArchitectureLayout({
    containers: [{ id: "stack", children: ["unit"] }],
    nodes: [{ id: "unit", containerId: "stack", repeatCount: 6 }],
    edges: [],
  });

  assert.equal(result.nodes[0].repeatCount, 6);
  assert.equal(result.features.repeatedBlocks, true);
  assert.equal(result.containerTree.nodeById.unit.repeatCount, 6);
});

test("projects inferred spatial lanes into the typed container tree", () => {
  const result = compileArchitectureLayout({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "right"] },
      { id: "left", parentId: "root", direction: "vertical", children: ["a", "b"] },
      { id: "right", parentId: "root", direction: "vertical", children: ["c", "d"] },
    ],
    nodes: [
      { id: "a", containerId: "left", shape: { output: [80, 80, 64] } },
      { id: "b", containerId: "left", shape: { dimensions: [40, 40, 128] } },
      { id: "c", containerId: "right", shape: { dimensions: [80, 80, 64] } },
      { id: "d", containerId: "right", shape: { output: [40, 40, 128] } },
    ],
    edges: [],
  });

  assert.deepEqual(result.containerTree.lanes.map((lane) => lane.id), ["lane-80x80", "lane-40x40"]);
  assert.equal(result.containerTree.nodeById.a.scopedLaneId, result.containerTree.nodeById.c.scopedLaneId);
  assert.equal(result.containerTree.nodeById.b.scopedLaneId, result.containerTree.nodeById.d.scopedLaneId);
  assert.deepEqual(result.containerTree.nodeById.a.containerPath, ["root", "left"]);
  assert.deepEqual(result.containerTree.nodeById.d.containerPath, ["root", "right"]);
  assert.equal(result.features.hasSpatialScaleLanes, true);
});
