import assert from "node:assert/strict";
import test from "node:test";
import {
  createFigurePlan,
  figurePlanForCanvas,
  figurePlanForBrowser,
  figurePlanForVisio,
  mergeCanvasStateIntoFigurePlan,
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
  const browser = figurePlanForBrowser(plan);
  const visio = figurePlanForVisio(plan);

  assert.deepEqual(plan.recurrentLayout.instances.map((instance) => instance.role), ["previous", "expanded", "next"]);
  assert.equal(plan.recurrentLayout.expandedInstanceId, "cell:expanded");
  assert.equal(plan.recurrentLayout.stateRails[0].sourceEdgeId, "state-edge");
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.nodes.map((node) => node.id), ["observed"]);
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.ports, { states: ["h"] });
  assert.equal(plan.recurrentLayout.uncertainty.unresolved, false);
  assert.deepEqual(browser.recurrentLayout, visio.recurrentLayout);
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
  assert.equal(figurePlanForCanvas(plan).nodes.find((item) => item.sourceNodeId === "opaque-cell").compoundKind, "operator");
  assert.equal(node.unresolvedMarker.kind, "unresolved-module");
  assert.match(node.unresolvedMarker.reason, /internal topology/i);
});

test("Figure Plan carries input grammar geometry identically to browser and Visio projections", () => {
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
  const browser = figurePlanForBrowser(plan);
  const visio = figurePlanForVisio(plan);
  const browserInput = browser.nodes.find((node) => node.sourceNodeId === "image-input");
  const visioInput = visio.nodes.find((node) => node.sourceNodeId === "image-input");

  assert.equal(browserInput.inputGrammar.kind, "image-input");
  assert.equal(browserInput.shapeKind, "image-plane");
  assert.deepEqual(browserInput.geometryData, browserInput.geometry.data);
  assert.deepEqual(browserInput, visioInput);
  assert.deepEqual(browser.edges, visio.edges);
  assert.deepEqual(browser.nodes.map((node) => node.sourceNodeId), ["image-input", "conv1"]);
  assert.deepEqual(browser.edges.map((edge) => edge.sourceEdgeId), ["image-conv"]);
  assert.equal(validateFigurePlan(browser).ok, true);
  assert.equal(validateFigurePlan(visio).ok, true);
});

test("Figure Plan canvas projection is the editable browser source of truth", () => {
  const plan = createFigurePlan({
    ir: recurrentLoopIR(),
    layout: layoutUniversalFigure(recurrentLoopIR()),
  });
  const canvas = figurePlanForCanvas(plan);

  assert.equal(canvas.projection.renderer, "canvas");
  assert.deepEqual(canvas.nodes.map((node) => node.id), plan.nodes.map((node) => node.id));
  assert.deepEqual(canvas.nodes.map((node) => node.sourceNodeId), plan.nodes.map((node) => node.sourceNodeId));
  assert.deepEqual(canvas.edges.map((edge) => edge.id), plan.edges.map((edge) => edge.id));
  assert.deepEqual(canvas.edges.map((edge) => edge.sourceEdgeId), plan.edges.map((edge) => edge.sourceEdgeId));
  assert.equal(canvas.nodes.find((node) => node.sourceNodeId === "cell").type, "compound");
  assert.equal(canvas.nodes.find((node) => node.sourceNodeId === "cell").visualRole, "recurrent-state");
  assert.equal(canvas.nodes.find((node) => node.sourceNodeId === "cell").compoundKind, "operator");
  assert.equal(canvas.nodes.find((node) => node.sourceNodeId === "cell").w, plan.nodes.find((node) => node.sourceNodeId === "cell").w);
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

test("merging canvas edits makes additions and deletions canonical in Figure Plan", () => {
  const plan = {
    version: "figure-plan/v1",
    nodes: [
      { id: "n1", sourceNodeId: "source-1", sourceNodeIds: ["source-1"], family: "input", visualRole: "vector-input", x: 10, y: 20, w: 80, h: 60 },
      { id: "n2", sourceNodeId: "source-2", sourceNodeIds: ["source-2"], family: "dense", visualRole: "neuron-layer", x: 160, y: 20, w: 100, h: 80 },
    ],
    edges: [{ id: "e1", sourceEdgeId: "source-e1", source: "n1", target: "n2", sourceNodeId: "source-1", targetNodeId: "source-2", type: "signal", route: { kind: "straight", points: [] } }],
  };
  const merged = mergeCanvasStateIntoFigurePlan(plan, {
    nodes: [
      { id: "n2", label: "Edited dense", family: "dense", visualRole: "neuron-layer", x: 220, y: 30, w: 120, h: 90 },
      { id: "n3", label: "Added operator", type: "compound", family: "custom", x: 420, y: 30, w: 140, h: 100 },
    ],
    edges: [{ id: "e2", source: "n2", target: "n3", type: "control", label: "new" }],
  });

  assert.deepEqual(merged.nodes.map((node) => node.id), ["n2", "n3"]);
  assert.equal(merged.nodes.find((node) => node.id === "n2").sourceNodeId, "source-2");
  assert.equal(merged.nodes.find((node) => node.id === "n3").sourceNodeId, "n3");
  assert.deepEqual(merged.edges.map((edge) => edge.id), ["e2"]);
  assert.equal(merged.edges[0].sourceNodeId, "source-2");
  assert.equal(merged.edges[0].targetNodeId, "n3");
  assert.equal(merged.edges[0].route.kind, "skip-lane");
});
