import assert from "node:assert/strict";
import test from "node:test";

import { layoutUniversalFigure } from "./universal-figure.mjs";
import { buildVisioRenderPlan } from "./visio-bridge.mjs";

const render = (ir) => {
  const layout = layoutUniversalFigure(ir, { detail: "full" });
  return { layout, plan: buildVisioRenderPlan(layout, { documentPath: "C:\\test\\network.vsdx", allowLegacyProjection: true }) };
};

test("vertical repeated stack preserves residual topology into Visio", () => {
  const { layout, plan } = render({
    containers: [{ id: "stack", direction: "vertical", children: ["input", "unit-a", "unit-b", "sum", "output"] }],
    nodes: [
      { id: "input", family: "input", containerId: "stack" },
      { id: "unit-a", family: "conv", containerId: "stack", repeatCount: 2 },
      { id: "unit-b", family: "conv", containerId: "stack" },
      { id: "sum", family: "merge", op: "Add", semanticRole: "merge_add", containerId: "stack" },
      { id: "output", family: "output", containerId: "stack" },
    ],
    edges: [
      { id: "main-a", source: "input", target: "unit-a" },
      { id: "main-b", source: "unit-a", target: "unit-b" },
      { id: "main-sum", source: "unit-b", target: "sum" },
      { id: "skip", source: "input", target: "sum", type: "residual" },
      { id: "main-out", source: "sum", target: "output" },
    ],
  });

  assert.equal(layout.placementMode, "hierarchical");
  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.edges.find((edge) => edge.id === "skip").route.kind, "local");
  assert.ok(plan.shapes.some((shape) => shape.sourceNodeId === "sum"));
  assert.ok(plan.connectors.some((edge) => edge.sourceEdgeId === "skip"));
});

test("two modules retain decision and external feedback in the Visio plan", () => {
  const { layout, plan } = render({
    containers: [
      { id: "root", direction: "horizontal", children: ["producer", "evaluator"] },
      { id: "producer", parentId: "root", direction: "vertical", children: ["seed", "sample"] },
      { id: "evaluator", parentId: "root", direction: "vertical", children: ["real", "judge"] },
    ],
    nodes: [
      { id: "seed", family: "input", containerId: "producer" },
      { id: "sample", family: "custom", compoundKind: "module", containerId: "producer" },
      { id: "real", family: "input", containerId: "evaluator" },
      { id: "judge", family: "custom", compoundKind: "module", semanticRole: "decision", attributes: { controlKind: "binary" }, containerId: "evaluator" },
    ],
    edges: [
      { id: "generate", source: "seed", target: "sample" },
      { id: "fake", source: "sample", target: "judge", type: "branch" },
      { id: "truth", source: "real", target: "judge", type: "merge" },
      { id: "training", source: "judge", target: "sample", type: "feedback" },
    ],
  });

  assert.equal(layout.edges.find((edge) => edge.id === "training").route.kind, "external");
  assert.ok(plan.shapes.some((shape) => shape.sourceNodeId === "judge" && shape.visualRole === "decision"));
  assert.equal(plan.connectors.find((edge) => edge.sourceEdgeId === "training").routeClass, "feedback");
});

test("nested dual stacks preserve containment and cross-module interaction", () => {
  const { layout, plan } = render({
    containers: [
      { id: "root", direction: "horizontal", children: ["left", "right"] },
      { id: "left", parentId: "root", direction: "vertical", children: ["left-in", "left-block"] },
      { id: "right", parentId: "root", direction: "vertical", children: ["right-in", "cross", "right-out"] },
    ],
    nodes: [
      { id: "left-in", family: "input", containerId: "left" },
      { id: "left-block", family: "attention", containerId: "left", repeatCount: 6 },
      { id: "right-in", family: "input", containerId: "right" },
      { id: "cross", family: "attention", containerId: "right", ports: { inputs: ["query", "context"] } },
      { id: "right-out", family: "output", containerId: "right" },
    ],
    edges: [
      { id: "left-flow", source: "left-in", target: "left-block" },
      { id: "right-flow", source: "right-in", target: "cross", targetPort: "query" },
      { id: "context", source: "left-block", target: "cross", targetPort: "context", type: "merge" },
      { id: "right-out", source: "cross", target: "right-out" },
    ],
  });

  const children = ["left", "right"].map((id) => layout.groups.find((group) => group.id === id));
  assert.ok(children.every(Boolean), "nested containers must be represented as Visio groups");
  const root = {
    x: Math.min(...children.map((group) => group.bounds.x)) - 30,
    y: Math.min(...children.map((group) => group.bounds.y)) - 30,
    w: Math.max(...children.map((group) => group.bounds.x + group.bounds.w)) - Math.min(...children.map((group) => group.bounds.x)) + 60,
    h: Math.max(...children.map((group) => group.bounds.y + group.bounds.h)) - Math.min(...children.map((group) => group.bounds.y)) + 60,
  };
  for (const id of ["left", "right"]) {
    const child = layout.groups.find((group) => group.id === id).bounds;
    assert.ok(child.x >= root.x && child.y >= root.y);
    assert.ok(child.x + child.w <= root.x + root.w && child.y + child.h <= root.y + root.h);
  }
  assert.equal(plan.connectors.find((edge) => edge.sourceEdgeId === "context").routeClass, "merge");
  const leftBlock = plan.shapes.find((shape) => shape.sourceNodeId === "left-block");
  assert.equal(leftBlock.geometryData.repeatCount, 6);
  assert.deepEqual(leftBlock.containerPath, ["root", "left"]);
});
