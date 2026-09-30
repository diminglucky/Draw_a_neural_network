import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePublicationFigure, validateFigureQa } from "./figure-qa.mjs";

function tensorNode(id, x, y, depth = 24) {
  return {
    id,
    sourceNodeId: id,
    shapeKind: "publication-tensor-box",
    x,
    y,
    w: 60,
    h: 80,
    depth,
    geometryData: { geometry: { depth } },
  };
}

test("figure QA accepts a connected publication figure with depth and external labels", () => {
  const result = evaluatePublicationFigure({
    version: "visio-diagram-plan/v1",
    nodes: [
      tensorNode("a", 0, 0),
      tensorNode("b", 200, 0),
      { id: "label:a", sourceNodeId: "label:a", shapeKind: "publication-label", x: 0, y: -30, w: 60, h: 20 },
    ],
    edges: [{ id: "e", source: "a", target: "b", points: [{ x: 60, y: 40 }, { x: 200, y: 40 }] }],
  });

  assert.equal(validateFigureQa(result).ok, true);
  assert.equal(result.ok, true);
  assert.equal(result.metrics.minDepth, 24);
});

test("figure QA reports flat nodes, label overlap, and connector obstacles", () => {
  const result = evaluatePublicationFigure({
    version: "visio-diagram-plan/v1",
    nodes: [
      tensorNode("a", 0, 0, 0),
      tensorNode("b", 160, 0),
      tensorNode("blocker", 80, 0),
      { id: "label:a", sourceNodeId: "label:a", shapeKind: "publication-label", x: 10, y: 10, w: 30, h: 20 },
    ],
    edges: [{ id: "e", source: "a", target: "b", points: [{ x: 60, y: 40 }, { x: 160, y: 40 }] }],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "publication-node-without-depth"));
  assert.ok(result.issues.some((issue) => issue.code === "label-overlaps-node"));
  assert.ok(result.issues.some((issue) => issue.code === "connector-passes-through-node"));
});

test("figure QA reports encoder-decoder layouts that are not U shaped", () => {
  const result = evaluatePublicationFigure({
    version: "visio-diagram-plan/v1",
    nodes: [
      { id: "pool", sourceNodeId: "pool", label: "MaxPool", x: 0, y: 200, w: 50, h: 50 },
      { id: "up", sourceNodeId: "up", label: "Up-conv", x: 120, y: 200, w: 50, h: 50 },
    ],
    edges: [],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "encoder-decoder-not-u-shaped"));
});
