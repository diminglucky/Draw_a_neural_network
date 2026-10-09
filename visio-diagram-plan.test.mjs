import assert from "node:assert/strict";
import test from "node:test";

import { assertVisioDiagramPlan, createVisioDiagramPlan, validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { analyzeArchitectureInput } from "./agent-pipeline.mjs";
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
  const plan = createVisioDiagramPlan({ ir, scene });

  assert.deepEqual(plan.scene, scene);
  assert.notEqual(plan.scene, scene);
  assert.equal(plan.scene.units, "layout-unit");
  assert.ok(plan.nodes.length > 0, "compatibility node index remains available");
  assert.ok(plan.edges.length > 0, "compatibility edge index remains available");
  assert.deepEqual(plan.nodes.map((node) => node.sourceNodeId), ["input", "head"]);
  assert.deepEqual(plan.edges.map((edge) => edge.sourceEdgeId), ["features"]);
  assert.deepEqual(
    plan.nodes.map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h })),
    scene.primitives
      .filter((primitive) => primitive.role === "body")
      .map((primitive) => ({
        x: primitive.bounds.x,
        y: primitive.bounds.y,
        w: primitive.bounds.w,
        h: primitive.bounds.h,
      })),
  );
  assert.equal(validateVisioDiagramPlan(plan).ok, true);
});

test("laid-out scene visual geometry takes precedence over migration geometry", () => {
  const ir = {
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [{ id: "flow", source: "input", target: "output" }],
  };
  const scene = laidOutSceneFor(ir);
  scene.groups = [{ id: "scene-group", bounds: { x: 10, y: 20, w: 300, h: 180 } }];
  const geometry = {
    artboard: { x: 900, y: 900, width: 1, height: 1 },
    nodes: [{ id: "geometry-only", sourceNodeId: "geometry-only", x: 900, y: 900, w: 1, h: 1 }],
    edges: [{ id: "geometry-edge", sourceEdgeId: "geometry-edge", source: "geometry-only", target: "geometry-only" }],
    groups: [{ id: "geometry-group", bounds: { x: 900, y: 900, w: 1, h: 1 } }],
  };

  const plan = createVisioDiagramPlan({ ir, scene, geometry });
  const sceneBodies = scene.primitives.filter((primitive) => primitive.role === "body");

  assert.deepEqual(plan.artboard, scene.page);
  assert.deepEqual(plan.groups, scene.groups);
  assert.deepEqual(
    plan.nodes.map((node) => ({ sourceNodeId: node.sourceNodeId, x: node.x, y: node.y, w: node.w, h: node.h })),
    sceneBodies.map((body) => ({
      sourceNodeId: body.sourceNodeIds[0],
      x: body.bounds.x,
      y: body.bounds.y,
      w: body.bounds.w,
      h: body.bounds.h,
    })),
  );
  assert.deepEqual(
    plan.edges.map((edge) => ({ sourceEdgeId: edge.sourceEdgeId, route: edge.route })),
    scene.connectors.map((connector) => ({
      sourceEdgeId: connector.sourceEdgeIds[0],
      route: { kind: "polyline", points: connector.points },
    })),
  );
});

test("rejects malformed laid-out scenes at the Visio Diagram Plan boundary", () => {
  const ir = {
    nodes: [{ id: "input", family: "input", op: "Input" }, { id: "output", family: "output", op: "Output" }],
    edges: [{ id: "flow", source: "input", target: "output" }],
  };
  const validPlan = createVisioDiagramPlan({ ir, scene: laidOutSceneFor(ir) });
  const invalidUnits = structuredClone(validPlan);
  invalidUnits.scene.units = "pixels";
  assert.ok(validateVisioDiagramPlan(invalidUnits).issues.some((issue) => issue.code === "invalid-scene-units"));

  const missingAnchors = structuredClone(validPlan);
  delete missingAnchors.scene.primitives.find((primitive) => primitive.role === "body").anchors;
  assert.ok(validateVisioDiagramPlan(missingAnchors).issues.some((issue) => issue.code === "missing-scene-body-anchors"));

  const danglingConnector = structuredClone(validPlan);
  danglingConnector.scene.connectors[0].targetPrimitiveId = "missing-body";
  assert.ok(validateVisioDiagramPlan(danglingConnector).issues.some((issue) => issue.code === "unresolved-scene-topology"));

  const duplicatePrimitive = structuredClone(validPlan);
  duplicatePrimitive.scene.primitives.push(structuredClone(duplicatePrimitive.scene.primitives[0]));
  assert.ok(validateVisioDiagramPlan(duplicatePrimitive).issues.some((issue) => issue.code === "duplicate-scene-primitive"));
});

test("scene compatibility indexes string labels without dropping their text", () => {
  const ir = {
    nodes: [{ id: "input", family: "input", op: "Input" }, { id: "output", family: "output", op: "Output" }],
    edges: [{ id: "flow", source: "input", target: "output" }],
  };
  const scene = laidOutSceneFor(ir);
  scene.primitives.find((primitive) => primitive.sourceNodeIds.includes("input")).labels = ["Input image"];

  const plan = createVisioDiagramPlan({ ir, scene });
  assert.equal(plan.nodes.find((node) => node.sourceNodeId === "input").label, "Input image");
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
      { id: "c2f", family: "custom", compoundKind: "module", op: "C2f", label: "C2f", stage: 1, containerId: "backbone" },
      { id: "out", family: "output", op: "Output", stage: 2 },
    ],
    edges: [{ source: "in", target: "c2f" }, { source: "c2f", target: "out" }],
    groups: [{ id: "backbone", label: "Backbone", kind: "backbone", nodeIds: ["in", "c2f"] }],
  };
  const plan = createVisioDiagramPlan({ ir, scene: laidOutSceneFor(ir) });
  const module = plan.nodes.find((node) => node.sourceNodeId === "c2f");

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].label, "Backbone");
  assert.equal(module.unresolved, false);
  assert.equal(module.containerId, "backbone");
});
