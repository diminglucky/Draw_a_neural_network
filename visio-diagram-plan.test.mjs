import assert from "node:assert/strict";
import test from "node:test";

import { assertVisioDiagramPlan, createVisioDiagramPlan, validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { analyzeArchitectureInput } from "./agent-pipeline.mjs";
import { layoutUniversalFigure } from "./universal-figure.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { createProjectionMap } from "./neural-projection-map.mjs";
import { compileSemanticScene } from "./semantic-neural-scene.mjs";
import { layoutNeuralScene } from "./neural-scene-layout.mjs";

function laidOutSceneFor(ir) {
  const facts = deriveNeuralSemanticFacts(ir);
  const projectionMap = createProjectionMap(ir, facts, { detail: "balanced" });
  return layoutNeuralScene(compileSemanticScene(ir, facts, projectionMap));
}

function recurrentLoopIR() {
  return {
    figure: { title: "Recurrent state fixture", subtitle: "stateful loop" },
    nodes: [
      { id: "input", family: "input", op: "Input", label: "x", stage: 0, ports: { inputs: [], outputs: ["x"] } },
      {
        id: "cell", family: "recurrent", op: "GRUCell", label: "Recurrent Cell", stage: 1,
        ports: { inputs: ["x", "state"], outputs: ["state", "y"] },
        attributes: { internalGraph: {
          nodes: [{ id: "update", family: "operator", label: "Update gate" }, { id: "state", family: "state", label: "Hidden state" }],
          edges: [{ id: "cell-state", source: "update", target: "state", type: "state" }],
        } },
      },
      { id: "opaque", family: "custom", op: "OpaqueController", label: "Opaque controller", stage: 2 },
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

test("creates the sole Visio-native diagram contract without a renderer projection", () => {
  const plan = createVisioDiagramPlan({
    ir: { nodes: [{ id: "input", family: "input" }], edges: [] },
    geometry: {
      figure: { title: "Network" },
      artboard: { x: 0, y: 0, width: 800, height: 500 },
      nodes: [{ id: "input", sourceNodeId: "input", family: "input", x: 20, y: 20, w: 100, h: 80 }],
      edges: [],
      groups: [],
    },
  });

  assert.equal(plan.version, "visio-diagram-plan/v1");
  assert.equal("projection" in plan, false);
  assert.equal(validateVisioDiagramPlan(plan).ok, true);
  assert.equal(assertVisioDiagramPlan(plan), plan);
});

test("embeds a laid-out neural scene as the Visio visual source of truth", () => {
  const ir = {
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "head", family: "output", op: "Detect", ports: { inputs: ["features"], outputs: ["detections"] } },
    ],
    edges: [{ id: "features", source: "input", target: "head", ports: { source: "out", target: "features" } }],
  };
  const scene = laidOutSceneFor(ir);
  const plan = createVisioDiagramPlan({ ir, scene, geometry: layoutUniversalFigure(ir) });

  assert.deepEqual(plan.scene, scene);
  assert.notEqual(plan.scene, scene);
  assert.equal(plan.scene.units, "layout-unit");
  assert.ok(plan.nodes.length > 0, "compatibility node index remains available");
  assert.ok(plan.edges.length > 0, "compatibility edge index remains available");
  assert.equal(validateVisioDiagramPlan(plan).ok, true);
});

test("rejects malformed laid-out scenes at the Visio Diagram Plan boundary", () => {
  const ir = {
    nodes: [{ id: "input", family: "input", op: "Input" }, { id: "output", family: "output", op: "Output" }],
    edges: [{ id: "flow", source: "input", target: "output" }],
  };
  const validPlan = createVisioDiagramPlan({ ir, scene: laidOutSceneFor(ir), geometry: layoutUniversalFigure(ir) });
  const invalidUnits = structuredClone(validPlan);
  invalidUnits.scene.units = "pixels";
  assert.ok(validateVisioDiagramPlan(invalidUnits).issues.some((issue) => issue.code === "invalid-scene-units"));

  const missingAnchors = structuredClone(validPlan);
  delete missingAnchors.scene.primitives.find((primitive) => primitive.role === "body").anchors;
  assert.ok(validateVisioDiagramPlan(missingAnchors).issues.some((issue) => issue.code === "missing-scene-body-anchors"));

  const danglingConnector = structuredClone(validPlan);
  danglingConnector.scene.connectors[0].targetPrimitiveId = "missing-body";
  assert.ok(validateVisioDiagramPlan(danglingConnector).issues.some((issue) => issue.code === "unresolved-scene-topology"));
});

test("Visio Diagram Plan rejects the retired figure-plan version", () => {
  assert.throws(
    () => assertVisioDiagramPlan({ version: "figure-plan/v1", nodes: [], edges: [] }),
    /invalid-visio-diagram-plan-version/,
  );
});

test("analysis reports a Visio-ready state and Visio diagram plan", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input" },
        { id: "output", family: "output", op: "Output" },
      ],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
  });

  assert.equal(result.status, "ready_for_visio");
  assert.equal(result.readyForVisio, true);
  assert.equal(result.visioDiagramPlan.version, "visio-diagram-plan/v1");
  assert.equal("readyForPreview" in result, false);
  assert.equal("figurePlan" in result, false);
});

test("Visio Diagram Plan preserves recurrent state loops and unresolved semantics", () => {
  const ir = recurrentLoopIR();
  const plan = createVisioDiagramPlan({ ir, geometry: (awaitableLayout(ir)), diagnostics: { warnings: ["fixture"] } });

  assert.equal(plan.version, "visio-diagram-plan/v1");
  assert.deepEqual(plan.nodes.map((node) => node.sourceNodeId), ["input", "cell", "opaque", "output"]);
  const cell = plan.nodes.find((node) => node.sourceNodeId === "cell");
  assert.deepEqual(cell.ports, { inputs: ["x", "state"], outputs: ["state", "y"] });
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
  assert.equal(validateVisioDiagramPlan(plan).ok, true);
});

test("Visio Diagram Plan preserves recurrent layout identities and rails", () => {
  const ir = {
    nodes: [{
      id: "cell", family: "recurrent", op: "LSTMCell",
      attributes: {
        repetition: { axis: "iteration", instances: ["old", "now", "future"] },
        stateTransitions: [{ sourceEdgeId: "state-edge", kind: "feedback", sourcePort: "h", targetPort: "h" }],
        internalGraph: { nodes: [{ id: "observed", op: "Add" }], edges: [], ports: { states: ["h"] } },
      },
    }],
    edges: [{ id: "state-edge", source: "cell", target: "cell", type: "loop", ports: { source: "h", target: "h" } }],
  };
  const plan = createVisioDiagramPlan({ ir, geometry: (awaitableLayout(ir)) });

  assert.deepEqual(plan.recurrentLayout.instances.map((instance) => instance.role), ["previous", "expanded", "next"]);
  assert.equal(plan.recurrentLayout.expandedInstanceId, "cell:expanded");
  assert.equal(plan.recurrentLayout.stateRails[0].sourceEdgeId, "state-edge");
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.nodes.map((node) => node.id), ["observed"]);
  assert.deepEqual(plan.recurrentLayout.expandedInternalGraph.ports, { states: ["h"] });
  assert.equal(plan.recurrentLayout.uncertainty.unresolved, false);
});

test("Visio Diagram Plan marks recurrent expansion unresolved without internal evidence", () => {
  const ir = { nodes: [{ id: "opaque-cell", family: "recurrent", op: "LSTMCell", stage: 0 }], edges: [] };
  const plan = createVisioDiagramPlan({ ir, geometry: (awaitableLayout(ir)) });
  const node = plan.nodes.find((item) => item.sourceNodeId === "opaque-cell");

  assert.equal(plan.recurrentLayout.uncertainty.unresolved, true);
  assert.equal(node.unresolved, true);
  assert.equal(node.visualRole, "recurrent-state");
  assert.equal(node.unresolvedMarker.kind, "unresolved-module");
  assert.match(node.unresolvedMarker.reason, /internal topology/i);
});

test("Visio Diagram Plan carries input grammar and geometry evidence", () => {
  const ir = {
    nodes: [
      { id: "image-input", family: "input", op: "Input", label: "Image", shape: { output: [1, 3, 224, 224] }, stage: 0, ports: { inputs: [], outputs: ["image"] }, evidence: [{ kind: "shape", source: "fixture" }] },
      { id: "conv1", family: "conv", op: "Conv2d", label: "Conv 64", shape: { output: [1, 224, 224, 64] }, stage: 1, ports: { inputs: ["image"], outputs: ["features"] } },
    ],
    edges: [{ id: "image-conv", source: "image-input", target: "conv1", type: "signal" }],
  };
  const plan = createVisioDiagramPlan({ ir, geometry: (awaitableLayout(ir)) });
  const input = plan.nodes.find((node) => node.sourceNodeId === "image-input");

  assert.equal(input.inputGrammar.kind, "image-input");
  assert.equal(input.shapeKind, "image-plane");
  assert.deepEqual(input.geometryData, input.geometry.data);
  assert.deepEqual(plan.nodes.map((node) => node.sourceNodeId), ["image-input", "conv1"]);
  assert.deepEqual(plan.edges.map((edge) => edge.sourceEdgeId), ["image-conv"]);
  assert.equal(validateVisioDiagramPlan(plan).ok, true);
});

test("Visio Diagram Plan preserves container, lane, port, and route semantics", () => {
  const ir = {
    nodes: [
      { id: "source", family: "custom", compoundKind: "module", label: "Source", stage: 0, containerId: "trunk", laneId: "wide", ports: { outputs: ["features"] }, shape: { output: [128, 128, 64] } },
      { id: "merge", family: "merge", label: "Merge", stage: 1, containerId: "fusion", laneId: "narrow", ports: { inputs: ["main", "skip"] }, shape: { output: [64, 64, 128] } },
    ],
    containers: [{ id: "trunk", label: "Trunk", children: ["source"] }, { id: "fusion", label: "Fusion", children: ["merge"] }],
    lanes: [{ id: "wide", key: "wide", label: "Wide scale", order: 0 }, { id: "narrow", key: "narrow", label: "Narrow scale", order: 1 }],
    edges: [{ id: "transfer", source: "source", target: "merge", type: "signal", ports: { source: "features", target: "skip" } }],
  };
  const plan = createVisioDiagramPlan({ ir, geometry: (awaitableLayout(ir)) });
  const source = plan.nodes.find((node) => node.sourceNodeId === "source");
  const edge = plan.edges.find((item) => item.sourceEdgeId === "transfer");

  assert.equal(source.containerId, "trunk");
  assert.equal(source.laneId, "wide");
  assert.equal(edge.routeClass, "scale-transfer");
  assert.equal(edge.sourceContainerId, "trunk");
  assert.equal(edge.targetContainerId, "fusion");
  assert.equal(edge.sourceLaneId, "wide");
  assert.equal(edge.targetLaneId, "narrow");
  assert.deepEqual(edge.sourceEndpointIds, { source: "features", target: "skip" });
});

test("Visio Diagram Plan rejects empty and duplicate identities", () => {
  const empty = validateVisioDiagramPlan({ version: "visio-diagram-plan/v1", nodes: [], edges: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((issue) => issue.code === "empty-visio-diagram-plan"));

  const report = validateVisioDiagramPlan({
    version: "visio-diagram-plan/v1",
    nodes: [{ id: "n1", sourceNodeId: "same" }, { id: "n2", sourceNodeId: "same" }],
    edges: [{ id: "e1", sourceEdgeId: "e1", source: "n1", target: "missing" }],
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "duplicate-source-node-id"));
  assert.ok(report.issues.some((issue) => issue.code === "missing-edge-target"));
});

test("Visio Diagram Plan carries group containment bounds and named modules", () => {
  const ir = {
    figure: { title: "Detector" },
    nodes: [
      { id: "in", family: "input", op: "Input", stage: 0, order: 0 },
      { id: "c2f", family: "custom", compoundKind: "module", op: "C2f", label: "C2f", stage: 1 },
      { id: "out", family: "output", op: "Output", stage: 2 },
    ],
    edges: [{ source: "in", target: "c2f" }, { source: "c2f", target: "out" }],
    groups: [{ id: "backbone", label: "Backbone", kind: "backbone", nodeIds: ["in", "c2f"] }],
  };
  const layout = awaitableLayout(ir);
  const plan = createVisioDiagramPlan({ ir, geometry: layout });
  const module = plan.nodes.find((node) => node.sourceNodeId === "c2f");

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].label, "Backbone");
  assert.equal(module.unresolved, false);
  assert.equal(module.visualRole, "named-module");
});

function awaitableLayout(ir) {
  return layoutUniversalFigure(ir);
}
