import assert from "node:assert/strict";
import test from "node:test";

import { projectVisioDetail } from "./visio-detail-projection.mjs";

function graph() {
  return {
    version: "visio-hierarchical-geometry/v1",
    nodes: [
      { id: "a", family: "conv", x: 10, y: 20, w: 80, h: 50, containerId: "stage", containerPath: ["root", "stage"], repeatCount: 1, ports: { inputs: ["x"], outputs: ["a-out"] } },
      { id: "b", family: "conv", x: 110, y: 20, w: 80, h: 50, containerId: "stage", containerPath: ["root", "stage"], repeatCount: 3, ports: { inputs: ["b-in"], outputs: ["b-out"] } },
      { id: "c", family: "conv", x: 210, y: 20, w: 80, h: 50, containerId: "stage", containerPath: ["root", "stage"], repeatCount: 1, ports: { inputs: ["c-in"], outputs: ["c-out"] } },
      { id: "d", family: "merge", x: 330, y: 20, w: 70, h: 50, containerId: "head", containerPath: ["root", "head"], repeatCount: 1, ports: { inputs: ["main", "skip"], outputs: ["y"] } },
    ],
    edges: [
      { id: "ab", source: "a", target: "b", routeClass: "main-flow", ports: { source: "a-out", target: "b-in" } },
      { id: "bc", source: "b", target: "c", routeClass: "main-flow", ports: { source: "b-out", target: "c-in" } },
      { id: "cd", source: "c", target: "d", routeClass: "cross-container", ports: { source: "c-out", target: "main" } },
      { id: "skip", source: "a", target: "d", routeClass: "residual", ports: { source: "a-out", target: "skip" } },
    ],
    containers: [{ id: "root" }, { id: "stage" }, { id: "head" }],
    bounds: { x: 0, y: 0, w: 420, h: 100 },
  };
}

test("full projection preserves every node, edge, and input object", () => {
  const input = graph();
  const before = structuredClone(input);
  const result = projectVisioDetail(input, { detail: "full" });

  assert.equal(result.detail, "full");
  assert.deepEqual(result.nodes.map((node) => node.id), ["a", "b", "c", "d"]);
  assert.deepEqual(result.edges.map((edge) => edge.id), ["ab", "bc", "cd", "skip"]);
  assert.deepEqual(result.nodeById.b.sourceNodeIds, ["b"]);
  assert.equal(result.nodeById.b.repeatCount, 3);
  assert.deepEqual(input, before, "projection must not mutate layout geometry");
});

test("compact projection collapses homogeneous linear runs without losing detail", () => {
  const result = projectVisioDetail(graph(), { detail: "compact" });
  const projected = result.nodes.find((node) => node.sourceNodeIds.length === 3);

  assert.ok(projected);
  assert.deepEqual(projected.sourceNodeIds, ["a", "b", "c"]);
  assert.deepEqual(projected.containerPath, ["root", "stage"]);
  assert.equal(projected.repeatCount, 5);
  assert.deepEqual(projected.ports, { inputs: ["x"], outputs: ["c-out"] });
  assert.deepEqual(projected.internalGraph.nodes.map((node) => node.id), ["a", "b", "c"]);
  assert.deepEqual(projected.internalGraph.edges.map((edge) => edge.id), ["ab", "bc"]);
});

test("semantic external edges remain traceable after endpoint projection", () => {
  const result = projectVisioDetail(graph(), { detail: "compact" });
  const projected = result.nodes.find((node) => node.sourceNodeIds.includes("a"));
  const cross = result.edgeById.cd;
  const residual = result.edgeById.skip;

  assert.equal(cross.source, projected.id);
  assert.equal(cross.target, "d");
  assert.equal(cross.sourceNodeId, "c");
  assert.equal(cross.targetNodeId, "d");
  assert.equal(cross.sourcePort, "c-out");
  assert.equal(cross.targetPort, "main");
  assert.equal(residual.source, projected.id);
  assert.equal(residual.target, "d");
  assert.equal(residual.sourceNodeId, "a");
  assert.equal(residual.routeClass, "residual");
});

test("overview collapses mixed-family main-flow chains only within one container", () => {
  const input = graph();
  input.nodes[1].family = "normalization";
  input.nodes[2].family = "activation";
  const compact = projectVisioDetail(input, { detail: "compact" });
  const overview = projectVisioDetail(input, { detail: "overview" });

  assert.equal(compact.nodes.length, 4);
  assert.equal(overview.nodes.length, 2);
  assert.deepEqual(overview.nodes.find((node) => node.sourceNodeIds.length === 3).sourceNodeIds, ["a", "b", "c"]);
});

test("invalid detail levels are rejected", () => {
  assert.throws(() => projectVisioDetail(graph(), { detail: "poster" }), /detail/i);
});
