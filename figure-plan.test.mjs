import assert from "node:assert/strict";
import test from "node:test";
import {
  createFigurePlan,
  figurePlanForBrowser,
  figurePlanForVisio,
  validateFigurePlan,
} from "./figure-plan.mjs";
import { layoutUniversalFigure } from "./universal-figure.mjs";

function recurrentLoopIR() {
  return {
    figure: { title: "Recurrent state fixture", subtitle: "stateful loop" },
    nodes: [
      {
        id: "input",
        family: "input",
        op: "Input",
        label: "x",
        stage: 0,
        ports: { inputs: [], outputs: ["x"] },
      },
      {
        id: "cell",
        family: "recurrent",
        op: "GRUCell",
        label: "Recurrent Cell",
        stage: 1,
        ports: { inputs: ["x", "state"], outputs: ["state", "y"] },
        attributes: {
          internalGraph: {
            nodes: [
              { id: "update", family: "operator", label: "Update gate" },
              { id: "state", family: "state", label: "Hidden state" },
            ],
            edges: [{ id: "cell-state", source: "update", target: "state", type: "state" }],
          },
        },
      },
      {
        id: "opaque",
        family: "custom",
        op: "OpaqueController",
        label: "Opaque controller",
        stage: 2,
      },
      { id: "output", family: "output", op: "Output", label: "y", stage: 3 },
    ],
    edges: [
      { id: "input-cell", source: "input", target: "cell", type: "signal", ports: { source: "x", target: "x" } },
      { id: "state-loop", source: "cell", target: "cell", type: "loop", ports: { source: "state", target: "state" } },
      { id: "cell-opaque", source: "cell", target: "opaque", type: "state" },
      { id: "opaque-output", source: "opaque", target: "output", type: "signal" },
    ],
  };
}

test("createFigurePlan preserves recurrent state loops and unresolved semantics", () => {
  const ir = recurrentLoopIR();
  const layout = layoutUniversalFigure(ir);
  const plan = createFigurePlan({ ir, layout, diagnostics: { warnings: ["fixture"] } });

  assert.equal(plan.version, "figure-plan/v1");
  assert.deepEqual(plan.nodes.map((node) => node.sourceNodeId), ["input", "cell", "opaque", "output"]);
  const cell = plan.nodes.find((node) => node.sourceNodeId === "cell");
  assert.deepEqual(cell.ports, { inputs: ["x", "state"], outputs: ["state", "y"] });
  assert.equal(cell.semanticRole, "feature_transform");
  assert.equal(cell.visualRole, "recurrent-state");
  assert.equal(cell.styleProfile, "recurrent");
  assert.equal(cell.shapeKind, "compound");
  assert.ok(cell.geometry.width > 0 && cell.geometry.height > 0);
  assert.equal(cell.unresolved, false);

  const unresolved = plan.nodes.find((node) => node.sourceNodeId === "opaque");
  assert.equal(unresolved.unresolved, true);
  assert.equal(unresolved.unresolvedMarker.kind, "unresolved-module");
  const loop = plan.edges.find((edge) => edge.sourceEdgeId === "state-loop");
  assert.equal(loop.sourceNodeId, "cell");
  assert.equal(loop.targetNodeId, "cell");
  assert.deepEqual(loop.ports, { source: "state", target: "state" });
  assert.equal(loop.route.kind, "loop");
  assert.ok(loop.route.points.length >= 4);
  assert.deepEqual(plan.diagnostics, { warnings: ["fixture"] });
  assert.equal(validateFigurePlan(plan).ok, true);
});

test("Figure Plan projections preserve source identities and routes across browser and Visio", () => {
  const ir = recurrentLoopIR();
  const plan = createFigurePlan({ ir, layout: layoutUniversalFigure(ir) });
  const browser = figurePlanForBrowser(plan);
  const visio = figurePlanForVisio(plan, {
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    renderId: "render-1",
  });

  assert.equal(browser.projection.renderer, "browser");
  assert.equal(visio.projection.renderer, "visio");
  assert.equal(visio.projection.documentPath, "C:\\project\\existing.vsdx");
  assert.equal(visio.projection.pageName, "Page-1");
  assert.deepEqual(browser.nodes.map((node) => node.sourceNodeId), visio.nodes.map((node) => node.sourceNodeId));
  assert.deepEqual(browser.edges.map((edge) => edge.sourceEdgeId), visio.edges.map((edge) => edge.sourceEdgeId));
  assert.deepEqual(browser.edges.map((edge) => edge.route), visio.edges.map((edge) => edge.route));
});

test("validateFigurePlan reports duplicate identities and dangling endpoints", () => {
  const report = validateFigurePlan({
    nodes: [
      { id: "n1", sourceNodeId: "same" },
      { id: "n2", sourceNodeId: "same" },
    ],
    edges: [{ id: "e1", sourceEdgeId: "e1", source: "n1", target: "missing" }],
  });

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "duplicate-source-node-id"));
  assert.ok(report.issues.some((issue) => issue.code === "missing-edge-target"));
  assert.equal(report.summary.nodeCount, 2);
  assert.equal(report.summary.edgeCount, 1);
});
