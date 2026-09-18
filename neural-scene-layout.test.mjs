import assert from "node:assert/strict";
import test from "node:test";
import { layoutNeuralScene, scoreLayout, validateLaidOutScene } from "./neural-scene-layout.mjs";

function scene() {
  return {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceNodeIds: ["input"], projectionId: "p-input", semanticTags: ["input"], data: { scale: "s1" } },
      { id: "branch", role: "body", category: "operator", form: "band", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["branch"], data: { scale: "s1" } },
      { id: "left", role: "body", category: "operator", form: "volume", sourceNodeIds: ["left"], projectionId: "p-left", semanticTags: ["spatial"], data: { scale: "s1" } },
      { id: "right", role: "body", category: "operator", form: "volume", sourceNodeIds: ["right"], projectionId: "p-right", semanticTags: ["spatial"], data: { scale: "s2" } },
      { id: "merge", role: "body", category: "structure", form: "glyph", sourceNodeIds: ["merge"], projectionId: "p-merge", semanticTags: ["merge"], data: { scale: "s1" } },
      { id: "label", role: "decoration", category: "annotation", form: "text", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["label"], labels: ["branch"] },
    ],
    relations: [
      { id: "e0", sourcePrimitiveId: "input", targetPrimitiveId: "branch", relationTags: ["data"], sourceEdgeIds: ["e0"] },
      { id: "e1", sourcePrimitiveId: "branch", targetPrimitiveId: "left", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "branch", targetPrimitiveId: "right", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "left", targetPrimitiveId: "merge", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "right", targetPrimitiveId: "merge", relationTags: ["crossScale"], sourceEdgeIds: ["e4"] },
      { id: "skip", sourcePrimitiveId: "branch", targetPrimitiveId: "merge", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    constraints: [],
  };
}

test("lays out primitives in abstract units with stable bounds, anchors, and page", () => {
  const result = layoutNeuralScene(scene());
  assert.equal(result.version, "laid-out-neural-scene/v1");
  assert.equal(result.units, "layout-unit");
  assert.ok(result.page.width > 0 && result.page.height > 0);
  assert.ok(result.primitives.every((primitive) => primitive.bounds.w > 0 && primitive.bounds.h > 0 && Number.isInteger(primitive.zIndex)));
  assert.ok(result.primitives.find((primitive) => primitive.id === "input").anchors.outputs.length > 0);
  assert.ok(result.connectors.find((connector) => connector.id === "skip").routeClass === "bypass");
});

test("enforces non-overlap, left-to-right DAG direction, and bypass obstacle avoidance", () => {
  const result = layoutNeuralScene(scene());
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) assert.equal(overlaps(bodies[i].bounds, bodies[j].bounds), false);
  const branch = result.primitives.find((primitive) => primitive.id === "branch");
  const merge = result.primitives.find((primitive) => primitive.id === "merge");
  assert.ok(merge.bounds.x > branch.bounds.x);
  assert.ok(result.connectors.every((connector) => connector.points.length >= 2));
  for (const connector of result.connectors) {
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      assert.equal(pathIntersects(connector.points, body.bounds), false, `${connector.id} crosses ${body.id}`);
    }
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("lays out declared scene groups as containing bounds", () => {
  const grouped = { ...scene(), groups: [{ id: "branch-group", role: "module", primitiveIds: ["branch", "left", "right"] }] };
  const result = layoutNeuralScene(grouped);
  const group = result.groups.find((item) => item.id === "branch-group");
  assert.ok(group);
  for (const id of group.primitiveIds) {
    const primitive = result.primitives.find((item) => item.id === id);
    assert.ok(contains(group.bounds, primitive.bounds));
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("aligns equal scales and reports cross-scale transfers as soft diagnostics", () => {
  const result = layoutNeuralScene(scene());
  const left = result.primitives.find((primitive) => primitive.id === "left");
  const input = result.primitives.find((primitive) => primitive.id === "input");
  assert.equal(left.bounds.y, input.bounds.y);
  assert.ok(result.diagnostics.some((item) => item.code === "cross-scale-transfer"));
  assert.equal(result.softScore.crossScaleAlignment >= 0, true);
});

test("layout is deterministic and budget overflow is explicit", () => {
  const first = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  const second = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.some((item) => item.code === "layout-budget-exceeded"));
});

test("validation reports containment, anchor, page, and route hard violations", () => {
  const result = layoutNeuralScene(scene());
  result.primitives.find((primitive) => primitive.id === "branch").bounds.x = -1;
  result.connectors[0].points = [];
  const validation = validateLaidOutScene(result);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "primitive-out-of-page"));
  assert.ok(validation.issues.some((issue) => issue.code === "invalid-connector-route"));
});

test("scores segment crossings between connectors without shared endpoints", () => {
  const connectors = [
    { id: "down", sourcePrimitiveId: "a", targetPrimitiveId: "d", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { id: "up", sourcePrimitiveId: "b", targetPrimitiveId: "c", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
    { id: "shared", sourcePrimitiveId: "a", targetPrimitiveId: "e", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
  ];

  assert.equal(scoreLayout([], connectors).crossings, 1);
});

test("validation rejects a connector that passes through an unrelated body", () => {
  const layout = {
    version: "laid-out-neural-scene/v1",
    units: "layout-unit",
    page: { x: 0, y: 0, width: 300, height: 120 },
    primitives: [
      body("source", 10, 40, 40, 40),
      body("obstacle", 120, 30, 60, 60),
      body("target", 240, 40, 40, 40),
    ],
    connectors: [
      { id: "through", sourcePrimitiveId: "source", targetPrimitiveId: "target", relationTags: ["data"], points: [{ x: 50, y: 60 }, { x: 240, y: 60 }] },
    ],
    groups: [],
  };

  const validation = validateLaidOutScene(layout);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.find((issue) => issue.code === "connector-body-intersection"), {
    code: "connector-body-intersection",
    relationId: "through",
    primitiveId: "obstacle",
  });
});

test("routes through one corridor around consecutive obstacles", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: false }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(connector.points.length >= 4);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
});

test("uses the bottom corridor when the top corridor is blocked", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: true }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const source = result.primitives.find((item) => item.id === "z-source");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(Math.max(...connector.points.map((point) => point.y)) > source.bounds.y + source.bounds.h);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
  assert.equal(validateLaidOutScene(result).issues.some((issue) => issue.relationId === "long-route"), false);
});

test("multi-corridor obstacle routing is deterministic", () => {
  const input = corridorScene({ blockTop: true });
  const routes = Array.from({ length: 5 }, () => layoutNeuralScene(input).connectors.find((item) => item.id === "long-route").points);

  for (const route of routes.slice(1)) assert.deepEqual(route, routes[0]);
});

test("nested groups participate in placement without sibling overlap or non-finite bounds", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("left-a", "band", "flow"),
      sceneBody("left-b", "band", "flow"),
      sceneBody("right-a", "band", "flow"),
    ],
    relations: [
      relation("left-flow", "left-a", "left-b"),
      relation("cross", "left-b", "right-a"),
    ],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["left-a", "left-b", "right-a"] },
      { id: "left", parentId: "root", primitiveIds: ["left-a", "left-b"] },
      { id: "right", parentId: "root", primitiveIds: ["right-a"] },
      { id: "empty", parentId: "root", primitiveIds: [] },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const byGroup = new Map(result.groups.map((group) => [group.id, group]));
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("left").bounds), true);
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("right").bounds), true);
  assert.equal(overlaps(byGroup.get("left").bounds, byGroup.get("right").bounds), false);
  assert.ok(Object.values(byGroup.get("empty").bounds).every(Number.isFinite));
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places nested container children according to declared direction, padding, and gap", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("a", "band", "flow"),
      sceneBody("b", "band", "flow"),
      sceneBody("c", "band", "flow"),
      sceneBody("d", "band", "flow"),
    ],
    relations: [],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["a", "b", "c", "d"], direction: "horizontal", padding: 30, gap: 70 },
      { id: "left", parentId: "root", primitiveIds: ["a", "b"], direction: "vertical", padding: 20, gap: 35 },
      { id: "right", parentId: "root", primitiveIds: ["c", "d"], direction: "vertical", padding: 20, gap: 35 },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const bodyById = new Map(result.primitives.filter((item) => item.role === "body").map((item) => [item.id, item]));
  const groupById = new Map(result.groups.map((item) => [item.id, item]));
  assert.equal(bodyById.get("a").bounds.x, bodyById.get("b").bounds.x);
  assert.ok(bodyById.get("b").bounds.y >= bodyById.get("a").bounds.y + bodyById.get("a").bounds.h + 35);
  assert.ok(groupById.get("right").bounds.x >= groupById.get("left").bounds.x + groupById.get("left").bounds.w + 70);
  assert.equal(groupById.get("left").bounds.x - groupById.get("root").bounds.x, 30);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("sizes the page to include container padding and bounds", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [sceneBody("only", "band", "flow")],
    relations: [],
    groups: [{ id: "frame", primitiveIds: ["only"], direction: "horizontal", padding: 120, gap: 32 }],
  });
  const frame = result.groups[0].bounds;

  assert.ok(frame.x + frame.w <= result.page.width);
  assert.ok(frame.y + frame.h <= result.page.height);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places grouped and ungrouped top-level bodies without overlap in data-flow order", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("input", "band", "flow"),
      sceneBody("inside-a", "band", "flow"),
      sceneBody("inside-b", "band", "flow"),
      sceneBody("output", "band", "flow"),
    ],
    relations: [
      relation("enter", "input", "inside-a"),
      relation("internal", "inside-a", "inside-b"),
      relation("leave", "inside-b", "output"),
    ],
    groups: [{ id: "module", primitiveIds: ["inside-a", "inside-b"], direction: "vertical", padding: 24, gap: 30 }],
  });
  const bodies = result.primitives.filter((item) => item.role === "body");
  const byId = new Map(bodies.map((item) => [item.id, item.bounds]));

  assert.ok(byId.get("input").x + byId.get("input").w <= result.groups[0].bounds.x);
  assert.ok(result.groups[0].bounds.x + result.groups[0].bounds.w <= byId.get("output").x);
  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) assert.equal(overlaps(bodies[left].bounds, bodies[right].bounds), false);
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

function corridorScene({ blockTop }) {
  const primitives = [
    sceneBody("a-top-seed", "plane", "top"),
    sceneBody("z-source", "band", "flow"),
    sceneBody("mid-1", "band", "flow"),
    sceneBody("mid-2", "band", "flow"),
    sceneBody("target", "band", "flow"),
  ];
  const relations = [
    relation("flow-1", "z-source", "mid-1"),
    relation("flow-2", "mid-1", "mid-2"),
    relation("flow-3", "mid-2", "target"),
    relation("long-route", "z-source", "target"),
  ];
  if (blockTop) {
    primitives.push(sceneBody("top-1", "plane", "top"), sceneBody("top-2", "plane", "top"));
    relations.push(relation("top-link-1", "a-top-seed", "top-1"), relation("top-link-2", "top-1", "top-2"));
  }
  return { version: "semantic-neural-scene/v1", primitives, relations, constraints: [] };
}

function sceneBody(id, form, scale) {
  return { id, role: "body", category: "operator", form, sourceNodeIds: [id], projectionId: `p-${id}`, semanticTags: [], data: { scale } };
}

function relation(id, sourcePrimitiveId, targetPrimitiveId) {
  return { id, sourcePrimitiveId, targetPrimitiveId, relationTags: ["data"], sourceEdgeIds: [id] };
}

function body(id, x, y, w, h) {
  return { id, role: "body", bounds: { x, y, w, h }, anchors: { inputs: [], outputs: [] } };
}

function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function contains(outer, inner) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h; }
function pathIntersects(points, rect) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a.x === b.x && a.x > rect.x && a.x < rect.x + rect.w && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.h) return true;
    if (a.y === b.y && a.y > rect.y && a.y < rect.y + rect.h && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.w) return true;
  }
  return false;
}
