import assert from "node:assert/strict";
import test from "node:test";

import { neuralStructureFixtures } from "./fixtures/neural-structure-fixtures.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { createProjectionMap } from "./neural-projection-map.mjs";
import { compileSemanticScene } from "./semantic-neural-scene.mjs";
import { layoutNeuralScene, validateLaidOutScene } from "./neural-scene-layout.mjs";
import { createVisioDiagramPlan, validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { buildVisioRenderPlan } from "./visio-bridge.mjs";

test("generic structure fixtures compile without architecture-name dispatch", () => {
  assert.deepEqual(neuralStructureFixtures.map((fixture) => fixture.capability), [
    "sampling-repeat", "bypass-add", "encoder-decoder-symmetry", "three-scale-fusion", "attention",
    "state-feedback", "peer-streams", "conditional-routing", "irregular-graph", "unknown-operator",
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
