import assert from "node:assert/strict";
import test from "node:test";
import { layoutNeuralScene, validateLaidOutScene } from "./neural-scene-layout.mjs";

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
