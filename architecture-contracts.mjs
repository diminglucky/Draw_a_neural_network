import { UNIVERSAL_IR_VERSION } from "./universal-ir.mjs";
import { NEURAL_SEMANTIC_FACTS_VERSION } from "./neural-semantic-facts.mjs";
import { NEURAL_MOTIFS_VERSION } from "./neural-motifs.mjs";
import { SEMANTIC_NEURAL_SCENE_VERSION } from "./semantic-neural-scene.mjs";
import { LAID_OUT_NEURAL_SCENE_VERSION } from "./neural-scene-layout.mjs";
import { VISIO_DIAGRAM_PLAN_VERSION } from "./visio-diagram-plan.mjs";
import { VISIO_OPERATION_PLAN_VERSION } from "./visio-operation-plan.mjs";
import { GRAPH_EVIDENCE_FUSION_VERSION } from "./graph-evidence-fusion.mjs";
import { EVIDENCE_METADATA_VERSION } from "./evidence-metadata.mjs";
import { SHAPE_INFERENCE_VERSION } from "./shape-inference.mjs";
import { CANONICAL_MODEL_GRAPH_VERSION } from "./canonical-model-graph.mjs";
import { RENDERING_PROFILE_VERSION } from "./rendering-profile.mjs";
import { NEURAL_BLOCK_IR_VERSION } from "./neural-block-ir.mjs";
import { MODEL_WORKSPACE_VERSION } from "./model-workspace.mjs";

export const ARCHITECTURE_IR_CONTRACTS = Object.freeze({
  graph: UNIVERSAL_IR_VERSION,
  canonicalModel: CANONICAL_MODEL_GRAPH_VERSION,
  semantic: Object.freeze({
    facts: NEURAL_SEMANTIC_FACTS_VERSION,
    motifs: NEURAL_MOTIFS_VERSION,
    blocks: NEURAL_BLOCK_IR_VERSION,
  }),
  visualPlan: Object.freeze({
    semanticScene: SEMANTIC_NEURAL_SCENE_VERSION,
    laidOutScene: LAID_OUT_NEURAL_SCENE_VERSION,
    visioDiagramPlan: VISIO_DIAGRAM_PLAN_VERSION,
  }),
  visioOperation: VISIO_OPERATION_PLAN_VERSION,
  renderingProfile: RENDERING_PROFILE_VERSION,
  modelWorkspace: MODEL_WORKSPACE_VERSION,
  evidenceFusion: GRAPH_EVIDENCE_FUSION_VERSION,
  evidenceMetadata: EVIDENCE_METADATA_VERSION,
  shapeInference: SHAPE_INFERENCE_VERSION,
});
