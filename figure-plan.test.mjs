import assert from "node:assert/strict";
import test from "node:test";
import {
  createFigurePlan,
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
  assert.equal(plan.recurrentLayout.expandedInternalGraph.status, "resolved");

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

test("Figure Plan Visio projection preserves source identities and routes", () => {
  const ir = recurrentLoopIR();
  const plan = createFigurePlan({ ir, layout: layoutUniversalFigure(ir) });
  const visio = figurePlanForVisio(plan, {
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    renderId: "render-1",
  });

  assert.equal(visio.projection.renderer, "visio");
  assert.equal(visio.projection.documentPath, "C:\\project\\existing.vsdx");
  assert.equal(visio.projection.pageName, "Page-1");
  assert.deepEqual(visio.nodes.map((node) => node.sourceNodeId), ["input", "cell", "opaque", "output"]);
  assert.deepEqual(visio.edges.map((edge) => edge.sourceEdgeId), ["input-cell", "state-loop", "cell-opaque", "opaque-output"]);
});

test("createFigurePlan propagates recurrent layout identities, rails, internal graph, and uncertainty", () => {
  const ir = {
    nodes: [{
      id: "cell",
      family: "recurrent",
      op: "LSTMCell",
      attributes: {
        repetition: { axis: "iteration", instances: ["old", "now", "future"] },
        stateTransitions: [{ sourceEdgeId: "state-edge", kind: "feedback", sourcePort: "h", targetPort: "h" }],
        internalGraph: { nodes: [{ id: "observed", op: "Add" }], edges: [], ports: { states: ["h"] } },
      },
    }],
    edges: [{ id: "state-edge", source: "cell", target: "cell", type: "loop", ports: { source: "h", target: "h" } }],
  };
  const plan = createFigurePlan({ ir, layout: layoutUniversalFigure(ir) });
  const visio = figurePlanForVisio(plan);

  assert.deepEqual(plan.recurrentLayout.instances.map((instance) => instance.role), ["previous", "expanded", "next"]);
  assert.equal(plan.recurrentLayout.expandedInstanceId, "cell:expanded");
  assert.equal(plan.recurrentLayout.stateRails[0].sourceEdgeId, "state-edge");
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.nodes.map((node) => node.id), ["observed"]);
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.ports, { states: ["h"] });
  assert.equal(plan.recurrentLayout.uncertainty.unresolved, false);
  assert.deepEqual(visio.recurrentLayout, plan.recurrentLayout);
});

test("createFigurePlan marks the recurrent node unresolved when expansion has no internal graph", () => {
  const ir = {
    nodes: [{ id: "opaque-cell", family: "recurrent", op: "LSTMCell", stage: 0 }],
    edges: [],
  };
  const plan = createFigurePlan({ ir, layout: layoutUniversalFigure(ir) });
  const node = plan.nodes.find((item) => item.sourceNodeId === "opaque-cell");

  assert.equal(plan.recurrentLayout.uncertainty.unresolved, true);
  assert.equal(node.unresolved, true);
  assert.equal(node.visualRole, "recurrent-state");
  assert.equal(node.unresolvedMarker.kind, "unresolved-module");
  assert.match(node.unresolvedMarker.reason, /internal topology/i);
});

test("Figure Plan carries input grammar geometry into Visio projection", () => {
  const ir = {
    nodes: [
      {
        id: "image-input",
        family: "input",
        op: "Input",
        label: "Image",
        shape: { output: [1, 3, 224, 224] },
        stage: 0,
        ports: { inputs: [], outputs: ["image"] },
        evidence: [{ kind: "shape", source: "fixture" }],
      },
      {
        id: "conv1",
        family: "conv",
        op: "Conv2d",
        label: "Conv 64",
        shape: { output: [1, 224, 224, 64] },
        stage: 1,
        ports: { inputs: ["image"], outputs: ["features"] },
      },
    ],
    edges: [{ id: "image-conv", source: "image-input", target: "conv1", type: "signal" }],
  };
  const layout = layoutUniversalFigure(ir);
  const plan = createFigurePlan({ ir, layout });
  const visio = figurePlanForVisio(plan);
  const visioInput = visio.nodes.find((node) => node.sourceNodeId === "image-input");

  assert.equal(visioInput.inputGrammar.kind, "image-input");
  assert.equal(visioInput.shapeKind, "image-plane");
  assert.deepEqual(visioInput.geometryData, visioInput.geometry.data);
  assert.deepEqual(visio.nodes.map((node) => node.sourceNodeId), ["image-input", "conv1"]);
  assert.deepEqual(visio.edges.map((edge) => edge.sourceEdgeId), ["image-conv"]);
  assert.equal(validateFigurePlan(visio).ok, true);
});

test("Figure Plan Visio projection exposes recurrent instances to the native bridge", () => {
  const plan = createFigurePlan({
    ir: recurrentLoopIR(),
    layout: layoutUniversalFigure(recurrentLoopIR()),
  });
  const visio = figurePlanForVisio(plan, { documentPath: "C:/model.vsdx" });
  const projectedCell = visio.nodes.find((node) => node.sourceNodeId === "cell");

  assert.equal(projectedCell.recurrentLayout.instances.length, 3);
  assert.equal(projectedCell.recurrentLayout.stateRails.length, 1);
});

test("Figure Plan validation rejects an empty figure", () => {
  const validation = validateFigurePlan({ version: "figure-plan/v1", nodes: [], edges: [] });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "empty-figure-plan"));
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
