import assert from "node:assert/strict";
import test from "node:test";

import { resolveVisioPorts, routeVisioConnectors } from "./visio-port-routing.mjs";

function graph({ nodes, edges, containers = [] }) {
  return {
    version: "visio-hierarchical-geometry/v1",
    nodes,
    nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    containers,
    containerById: Object.fromEntries(containers.map((container) => [container.id, container])),
    edges,
  };
}

const node = (id, x, y, containerId = "root", extra = {}) => ({ id, x, y, w: 80, h: 50, containerId, ...extra });
const container = (id, x, y, w, h, direction = "horizontal", parentId = "") => ({
  id, x, y, w, h, direction, parentId, titleBand: 24,
  contentBounds: { x: x + 12, y: y + 36, w: w - 24, h: h - 48 },
});

test("main-flow ports follow horizontal and vertical container directions", () => {
  const horizontal = graph({
    containers: [container("root", 0, 0, 320, 140, "horizontal")],
    nodes: [node("a", 30, 55), node("b", 200, 55)],
    edges: [{ id: "ab", source: "a", target: "b", routeClass: "main-flow" }],
  });
  const hp = resolveVisioPorts(horizontal);
  assert.equal(hp.portByKey["a::out"].side, "right");
  assert.equal(hp.portByKey["b::in"].side, "left");

  const vertical = graph({
    containers: [container("root", 0, 0, 180, 260, "vertical")],
    nodes: [node("a", 50, 45), node("b", 50, 160)],
    edges: [{ id: "ab", source: "a", target: "b", routeClass: "main-flow" }],
  });
  const vp = resolveVisioPorts(vertical);
  assert.equal(vp.portByKey["a::out"].side, "bottom");
  assert.equal(vp.portByKey["b::in"].side, "top");
});

test("merge inputs have stable spatial ordering and distinct anchors", () => {
  const geometry = graph({
    containers: [container("root", 0, 0, 430, 250)],
    nodes: [node("upper", 30, 55), node("lower", 30, 145), node("join", 280, 100, "root", { ports: { inputs: ["left-a", "left-b"] } })],
    edges: [
      { id: "z-lower", source: "lower", target: "join", targetPort: "left-b", routeClass: "merge" },
      { id: "a-upper", source: "upper", target: "join", targetPort: "left-a", routeClass: "merge" },
    ],
  });
  const first = resolveVisioPorts(geometry);
  const second = resolveVisioPorts({ ...geometry, edges: [...geometry.edges].reverse() });
  assert.ok(first.portByKey["join::left-a"].y < first.portByKey["join::left-b"].y);
  assert.notEqual(first.portByKey["join::left-a"].y, first.portByKey["join::left-b"].y);
  assert.deepEqual(first.ports.map(({ key, x, y }) => [key, x, y]), second.ports.map(({ key, x, y }) => [key, x, y]));
});

test("local residual uses a compact corridor outside the participating nodes", () => {
  const geometry = graph({
    containers: [container("root", 0, 0, 420, 180)],
    nodes: [node("start", 30, 75), node("middle", 155, 75), node("end", 280, 75)],
    edges: [{ id: "res", source: "start", target: "end", routeClass: "residual" }],
  });
  const ports = resolveVisioPorts(geometry);
  const routed = routeVisioConnectors(geometry, ports);
  const route = routed.connectors[0].points;
  assert.ok(route.length >= 4);
  assert.ok(Math.min(...route.map((point) => point.y)) < 75);
  assert.equal(routed.diagnostics.length, 0);
});

test("cross-container connector avoids container title bands", () => {
  const left = container("left", 0, 0, 180, 170);
  const right = container("right", 250, 0, 180, 170);
  const geometry = graph({
    containers: [left, right],
    nodes: [node("a", 55, 75, "left"), node("b", 305, 75, "right")],
    edges: [{ id: "cross", source: "a", target: "b", routeClass: "cross-container" }],
  });
  const routed = routeVisioConnectors(geometry, resolveVisioPorts(geometry));
  assert.equal(routed.connectors[0].status, "routed");
  assert.equal(routed.diagnostics.length, 0);
  assert.ok(routed.connectors[0].points.every((point) => point.y > 24));
});

test("feedback uses an external corridor beyond all involved containers", () => {
  const root = container("root", 20, 20, 400, 200);
  const geometry = graph({
    containers: [root],
    nodes: [node("first", 65, 100), node("last", 310, 100)],
    edges: [{ id: "feedback", source: "last", target: "first", routeClass: "feedback" }],
  });
  const routed = routeVisioConnectors(geometry, resolveVisioPorts(geometry));
  const ys = routed.connectors[0].points.map((point) => point.y);
  assert.ok(Math.min(...ys) < root.y, "feedback corridor should leave the container");
  assert.equal(routed.connectors[0].corridor, "external");
});

test("unavoidable hard-obstacle intersections are rejected with diagnostics", () => {
  const geometry = graph({
    nodes: [node("a", 0, 50, ""), node("blocker", 110, 0, "", { w: 100, h: 160 }), node("b", 300, 50, "")],
    edges: [{ id: "ab", source: "a", target: "b", routeClass: "main-flow" }],
  });
  const routed = routeVisioConnectors(geometry, resolveVisioPorts(geometry), { maxDetour: 20 });
  assert.equal(routed.connectors[0].status, "rejected");
  assert.ok(routed.diagnostics.some((item) => item.code === "route-hard-obstacle" && item.edgeId === "ab"));
});
