import assert from "node:assert/strict";
import test from "node:test";
import { ARCHITECTURE_IR_CONTRACTS } from "./architecture-contracts.mjs";

test("freezes the graph, semantic, visual-plan, and Visio-operation versions", () => {
  assert.deepEqual(ARCHITECTURE_IR_CONTRACTS, {
    graph: "universal-neural-ir/v1",
    canonicalModel: "canonical-model-graph/v1",
    semantic: {
      facts: "neural-semantic-facts/v1",
      motifs: "neural-motifs/v1",
    },
    visualPlan: {
      semanticScene: "semantic-neural-scene/v1",
      laidOutScene: "laid-out-neural-scene/v1",
      visioDiagramPlan: "visio-diagram-plan/v1",
    },
    visioOperation: "visio-native-bridge/v1",
    publicationLayout: "publication-layout-plan/v1",
    referenceStyle: {
      spec: "reference-figure-spec/v1",
      compilation: "reference-style-compilation/v1",
      comparison: "figure-comparison/v1",
    },
    publicationPrimitive: "publication-primitive/v1",
    neuralFigureDsl: "neural-figure-dsl/v1",
    neuralFigurePlanner: "neural-figure-planner/v1",
    figureQa: "figure-qa/v1",
    modelWorkspace: "model-workspace/v1",
    evidenceFusion: "graph-evidence-fusion/v1",
    evidenceMetadata: "evidence-metadata/v1",
    shapeInference: "shape-inference/v1",
  });
  assert.equal(Object.isFrozen(ARCHITECTURE_IR_CONTRACTS), true);
  assert.equal(Object.isFrozen(ARCHITECTURE_IR_CONTRACTS.semantic), true);
  assert.equal(Object.isFrozen(ARCHITECTURE_IR_CONTRACTS.visualPlan), true);
});
