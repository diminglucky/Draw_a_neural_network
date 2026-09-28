import assert from "node:assert/strict";
import test from "node:test";
import {
  VISIO_OPERATION_PLAN_VERSION,
  validateVisioOperationPlan,
} from "./visio-operation-plan.mjs";

function operationPlan() {
  return {
    version: VISIO_OPERATION_PLAN_VERSION,
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    createDocument: false,
    renderId: "render-1",
    unitScale: 0.0065,
    shapes: [{
      id: "shape-1",
      sourceNodeIds: ["input"],
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    }, {
      id: "shape-2",
      sourceNodeIds: ["output"],
      x: 200,
      y: 0,
      w: 100,
      h: 60,
    }],
    connectors: [{
      id: "connector-1",
      sourceShapeId: "shape-1",
      targetShapeId: "shape-2",
      points: [{ x: 100, y: 30 }, { x: 200, y: 30 }],
    }],
  };
}

test("validates a frozen Visio Operation Plan", () => {
  assert.equal(validateVisioOperationPlan(operationPlan()).ok, true);
});

test("rejects version drift and dangling operation identities", () => {
  const plan = operationPlan();
  plan.version = "visio-native-bridge/v2";
  plan.shapes.push({ ...plan.shapes[0] });
  plan.connectors[0].targetShapeId = "missing-shape";

  const validation = validateVisioOperationPlan(plan);
  assert.ok(validation.issues.some((issue) => issue.code === "invalid-visio-operation-plan-version"));
  assert.ok(validation.issues.some((issue) => issue.code === "duplicate-operation-shape-id"));
  assert.ok(validation.issues.some((issue) => issue.code === "missing-operation-target-shape"));
});
