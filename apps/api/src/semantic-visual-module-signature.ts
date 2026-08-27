import { createHash } from "node:crypto";
import { compareCodeUnits } from "./stable-string-order.js";
import type {
  SemanticArchitectureGraph,
  SemanticDataType,
} from "./semantic-visual-module.js";

export interface ArchitectureSignature {
  dataTypes: SemanticDataType[];
  hasSpatialScaleChange: boolean;
  hasGraphStructure: boolean;
  hasPersistentState: boolean;
  hasConditionPath: boolean;
  hasCrossAttention: boolean;
  hasRepeat: boolean;
  hasFeedback: boolean;
  hasDiffusionIteration: boolean;
  hasMultiTower: boolean;
  complexity: "compact" | "composite" | "high";
}

export function deriveArchitectureSignature(graph: SemanticArchitectureGraph): ArchitectureSignature {
  const dataTypes = [...new Set(graph.dataObjects.map((data) => data.dataType))].sort(compareCodeUnits) as SemanticDataType[];
  const moduleTypes = new Set(graph.modules.map((module) => module.semanticType));
  const relationTypes = new Set(graph.relations.map((relation) => relation.type));
  const spatialObjects = graph.dataObjects.filter((data) => data.dataType === "tensor" || data.dataType === "feature_map");
  const hasSpatialScaleChange = moduleTypes.has("scale_transition") || hasDifferentSpatialShapes(spatialObjects);
  const hasGraphStructure = ["grid", "mesh", "graph"].some((type) => dataTypes.includes(type as SemanticDataType)) || moduleTypes.has("graph_message_passing") || relationTypes.has("message_passing");
  const hasPersistentState = moduleTypes.has("memory_state") || moduleTypes.has("ssm_block") || graph.modules.some((module) => module.state !== null) || graph.dataObjects.some((data) => data.dataType === "memory" || data.dataType === "state") || relationTypes.has("state_read") || relationTypes.has("state_write");
  const hasConditionPath = graph.modules.some((module) => module.condition !== null) || relationTypes.has("condition_flow");
  const hasCrossAttention = relationTypes.has("cross_attention") || graph.modules.some((module) => module.semanticType === "attention_block" && module.condition !== null);
  const hasRepeat = graph.modules.some((module) => module.repeat !== null || module.semanticType === "repeat_group" || module.semanticType === "ensemble_branch");
  const hasFeedback = relationTypes.has("feedback") || moduleTypes.has("feedback_loop");
  const hasDiffusionIteration = relationTypes.has("diffusion_iteration") || moduleTypes.has("diffusion_denoiser") || moduleTypes.has("diffusion_ladder");
  const hasMultiTower = moduleTypes.has("multi_tower") || hasFusionWithMultipleTowers(graph);
  const advancedTraits = [hasSpatialScaleChange, hasGraphStructure, hasPersistentState, hasConditionPath, hasCrossAttention, hasRepeat, hasFeedback, hasDiffusionIteration, hasMultiTower].filter(Boolean).length;
  const complexity = graph.modules.length <= 4 && advancedTraits === 0
    ? "compact"
    : graph.modules.length > 16 || advancedTraits >= 5
      ? "high"
      : "composite";
  return {
    dataTypes,
    hasSpatialScaleChange,
    hasGraphStructure,
    hasPersistentState,
    hasConditionPath,
    hasCrossAttention,
    hasRepeat,
    hasFeedback,
    hasDiffusionIteration,
    hasMultiTower,
    complexity,
  };
}

export function architectureSignatureId(signature: ArchitectureSignature): string {
  return createHash("sha256").update(canonicalSignatureJson(signature), "utf8").digest("hex");
}

function hasDifferentSpatialShapes(objects: SemanticArchitectureGraph["dataObjects"]): boolean {
  const shapes = objects
    .filter((data) => data.shape !== null)
    .map((data) => JSON.stringify(data.shape));
  return new Set(shapes).size > 1;
}

function hasFusionWithMultipleTowers(graph: SemanticArchitectureGraph): boolean {
  const towerIds = new Set(graph.modules.filter((module) => module.semanticType === "multi_tower").map((module) => module.moduleId));
  if (towerIds.size < 2) return false;
  return graph.modules.some((module) => module.semanticType === "fusion_block" && graph.relations.filter((relation) => relation.target.moduleId === module.moduleId && towerIds.has(relation.source.moduleId)).length >= 2);
}

function canonicalSignatureJson(signature: ArchitectureSignature): string {
  return JSON.stringify({
    dataTypes: [...signature.dataTypes].sort(compareCodeUnits),
    hasSpatialScaleChange: signature.hasSpatialScaleChange,
    hasGraphStructure: signature.hasGraphStructure,
    hasPersistentState: signature.hasPersistentState,
    hasConditionPath: signature.hasConditionPath,
    hasCrossAttention: signature.hasCrossAttention,
    hasRepeat: signature.hasRepeat,
    hasFeedback: signature.hasFeedback,
    hasDiffusionIteration: signature.hasDiffusionIteration,
    hasMultiTower: signature.hasMultiTower,
    complexity: signature.complexity,
  });
}
