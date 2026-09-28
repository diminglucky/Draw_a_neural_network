import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalModelGraph } from "./canonical-model-graph.mjs";
import { planNeuralFigure, validateNeuralFigurePlan } from "./figure-planner.mjs";
import { validateNeuralFigureProgram } from "./neural-figure-dsl.mjs";
import { neuralStructureFixtures } from "./fixtures/neural-structure-fixtures.mjs";

test("plans generic neural figures from canonical topology without model-name dispatch", () => {
  const fixture = neuralStructureFixtures.find((item) => item.capability === "unet-like");
  const graph = buildCanonicalModelGraph(fixture.ir);
  const plan = planNeuralFigure(graph);

  assert.equal(plan.version, "neural-figure-dsl/v1");
  assert.equal(plan.plannerVersion, "neural-figure-planner/v1");
  assert.equal(validateNeuralFigureProgram(plan).ok, true);
  assert.equal(validateNeuralFigurePlan(plan, graph).ok, true);
  assert.equal(plan.primitives.length, graph.nodes.length);
  assert.equal(plan.connectors.length, graph.edges.length);
  assert.ok(Array.isArray(plan.groups));
  assert.ok(plan.connectors.some((connector) => connector.routeClass === "bypass"));
});

test("planner output remains structurally stable when labels are renamed", () => {
  const base = neuralStructureFixtures.find((item) => item.capability === "attention").ir;
  const renamed = {
    ...base,
    nodes: base.nodes.map((node, index) => ({
      ...node,
      id: `renamed-${index + 1}`,
      op: `Renamed${index + 1}`,
      label: `Display ${index + 1}`,
    })),
    edges: base.edges.map((edge, index) => ({
      ...edge,
      id: `renamed-edge-${index + 1}`,
      source: `renamed-${base.nodes.findIndex((node) => node.id === edge.source) + 1}`,
      target: `renamed-${base.nodes.findIndex((node) => node.id === edge.target) + 1}`,
    })),
  };
  const basePlan = planNeuralFigure(buildCanonicalModelGraph(base));
  const renamedPlan = planNeuralFigure(buildCanonicalModelGraph(renamed));
  const shape = (plan) => plan.primitives.map((primitive) => {
    const options = primitive.options || {};
    return [primitive.kind, Math.round(options.x), Math.round(options.y), Math.round(options.w), Math.round(options.h)];
  });
  assert.equal(validateNeuralFigurePlan(renamedPlan, buildCanonicalModelGraph(renamed)).ok, true);
  assert.deepEqual(shape(basePlan), shape(renamedPlan));
});
