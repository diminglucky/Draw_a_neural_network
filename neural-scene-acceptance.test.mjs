import assert from "node:assert/strict";
import test from "node:test";

import { neuralStructureFixtures } from "./fixtures/neural-structure-fixtures.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { createProjectionMap } from "./neural-projection-map.mjs";
import { compileSemanticScene } from "./semantic-neural-scene.mjs";
import { layoutNeuralScene, validateLaidOutScene } from "./neural-scene-layout.mjs";
import { createVisioDiagramPlan, validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { buildVisioRenderPlan } from "./visio-bridge.mjs";
import { normalizeUniversalIR } from "./universal-ir.mjs";

test("generic structure fixtures compile without architecture-name dispatch", () => {
  assert.deepEqual(neuralStructureFixtures.map((fixture) => fixture.capability), [
    "sampling-repeat", "bypass-add", "encoder-decoder-symmetry", "three-scale-fusion", "attention",
    "state-feedback", "peer-streams", "conditional-routing", "irregular-graph", "unknown-operator",
    "resnet-like", "unet-like", "transformer-like", "rnn-like", "gnn-like",
  ]);
  for (const fixture of neuralStructureFixtures) {
    const facts = deriveNeuralSemanticFacts(fixture.ir);
    const projection = createProjectionMap(fixture.ir, facts, { detail: "balanced" });
    const scene = compileSemanticScene(fixture.ir, facts, projection);
    const laidOut = layoutNeuralScene(scene);
    const plan = createVisioDiagramPlan({ ir: fixture.ir, scene: laidOut });
    const render = buildVisioRenderPlan(plan, { documentPath: `C:\\acceptance\\${fixture.capability}.vsdx` });

    assert.equal(validateLaidOutScene(laidOut).ok, true, fixture.capability);
    assert.equal(validateVisioDiagramPlan(plan).ok, true, fixture.capability);
    assert.ok(fixture.ir.nodes.every((node) => laidOut.primitives.some((primitive) => primitive.sourceNodeIds.includes(node.id))), fixture.capability);
    assert.ok(fixture.ir.edges.every((edge) => laidOut.connectors.some((connector) => connector.sourceEdgeIds.includes(edge.id))
      || laidOut.primitives.some((primitive) => primitive.sourceEdgeIds.includes(edge.id))), fixture.capability);
    assert.deepEqual(render.shapes.map((shape) => shape.id).sort(), laidOut.primitives.map((primitive) => primitive.id).sort(), fixture.capability);
    assert.ok(render.shapes.every((shape) => shape.sceneForm), fixture.capability);
  }
});

test("protected structural relations retain distinct native route classes", () => {
  const routeClasses = new Set();
  for (const fixture of neuralStructureFixtures) {
    const facts = deriveNeuralSemanticFacts(fixture.ir);
    const projection = createProjectionMap(fixture.ir, facts, { detail: "balanced" });
    const laidOut = layoutNeuralScene(compileSemanticScene(fixture.ir, facts, projection));
    laidOut.connectors.forEach((connector) => routeClasses.add(connector.routeClass));
  }
  assert.ok(routeClasses.has("main-flow"));
  assert.ok(routeClasses.has("bypass"));
  assert.ok(routeClasses.has("state"));
  assert.ok(routeClasses.has("cross-scale"));
});

test("renaming model and operator labels preserves the full operation topology", () => {
  const fixture = neuralStructureFixtures.find((item) => item.capability === "bypass-add");
  const original = normalizeUniversalIR({ version: "universal-neural-ir/v1", ...fixture.ir });
  const renamed = normalizeUniversalIR({
    ...original,
    source: { ...original.source, name: "Completely Renamed Model" },
    figure: { ...original.figure, title: "Renamed Figure" },
    nodes: original.nodes.map((node) => ({
      ...node,
      op: `Display${node.id}`,
      label: `Label ${node.id}`,
      subtitle: "decorative text",
    })),
    edges: original.edges.map((edge) => ({ ...edge, label: `Edge ${edge.id}` })),
  });

  assert.deepEqual(operationSignature(original), operationSignature(renamed));
});

function operationSignature(ir) {
  const facts = deriveNeuralSemanticFacts(ir);
  const projection = createProjectionMap(ir, facts, { detail: "balanced" });
  const scene = compileSemanticScene(ir, facts, projection);
  const laidOut = layoutNeuralScene(scene);
  const plan = createVisioDiagramPlan({ ir, scene: laidOut });
  const render = buildVisioRenderPlan(plan, { documentPath: "C:\\acceptance\\renamed.vsdx" });
  return {
    projections: projection.projections.map((item) => ({
      id: item.id,
      kind: item.kind,
      nodeIds: item.orderedNodeIds,
      internalEdgeIds: item.internalEdgeIds,
      visibleEdgeIds: item.visibleEdgeIds,
    })),
    primitives: laidOut.primitives.map((item) => ({
      id: item.id,
      role: item.role,
      form: item.form,
      category: item.category,
      projectionId: item.projectionId,
      sourceNodeIds: item.sourceNodeIds,
      sourceEdgeIds: item.sourceEdgeIds,
      bounds: item.bounds,
    })),
    connectors: laidOut.connectors.map((item) => ({
      id: item.id,
      sourcePrimitiveId: item.sourcePrimitiveId,
      targetPrimitiveId: item.targetPrimitiveId,
      relationTags: item.relationTags,
      routeClass: item.routeClass,
      points: item.points,
      sourceEdgeIds: item.sourceEdgeIds,
    })),
    render: render.shapes.map((shape) => ({
      id: shape.id,
      sceneForm: shape.sceneForm,
      sceneRole: shape.sceneRole,
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      sourceNodeIds: shape.shapeData.sourceNodeIds,
    })),
  };
}
