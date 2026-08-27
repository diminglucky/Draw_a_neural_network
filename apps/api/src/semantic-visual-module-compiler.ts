import { compareCodeUnits } from "./stable-string-order.js";
import type {
  SemanticArchitectureGraph,
  SemanticModule,
  SemanticRelation,
  SemanticRelationType,
} from "./semantic-visual-module.js";

export const SEMANTIC_VISUAL_COMPILER_VERSION = 1 as const;

export type VisualModulePartKind =
  | "tensor_face"
  | "operator_body"
  | "token_cell_strip"
  | "graph_inset"
  | "state_store"
  | "process_axis"
  | "repeat_marker"
  | "condition_marker"
  | "relation_marker"
  | "unknown_container"
  | "label";

export interface VisualModulePart {
  partId: string;
  kind: VisualModulePartKind;
  role: string;
  label: string;
  sourceModuleId: string;
  sourcePartIds: string[];
  evidenceIds: string[];
}

export interface VisualModulePlan {
  moduleId: string;
  visualGrammarId: string;
  parts: VisualModulePart[];
  inputPortIds: string[];
  outputPortIds: string[];
  sourceNodeIds: string[];
  evidenceIds: string[];
}

export type VisualRelationRole =
  | "data"
  | "condition"
  | "skip"
  | "merge_add"
  | "merge_concat"
  | "cross_attention"
  | "message_passing"
  | "state_read"
  | "state_write"
  | "feedback"
  | "time_step"
  | "diffusion_iteration";

export type VisualRelationMarker =
  | "arrow"
  | "skip_route"
  | "plus"
  | "concat"
  | "attention"
  | "message"
  | "read"
  | "write"
  | "feedback"
  | "time"
  | "diffusion";

export interface VisualRelationPlan {
  relationId: string;
  relationType: SemanticRelationType;
  visualRole: VisualRelationRole;
  marker: VisualRelationMarker;
  sourceModuleId: string;
  sourcePortId: string;
  targetModuleId: string;
  targetPortId: string;
  evidenceIds: string[];
}

export type SemanticVisualDiagnostic =
  | { code: "unknown-module"; moduleId: string }
  | { code: "candidate-structure"; moduleId?: string; relationId?: string };

export interface SemanticVisualCompilation {
  version: typeof SEMANTIC_VISUAL_COMPILER_VERSION;
  graphId: string;
  exportEligibility: SemanticArchitectureGraph["exportEligibility"];
  modules: VisualModulePlan[];
  relations: VisualRelationPlan[];
  diagnostics: SemanticVisualDiagnostic[];
}

export function compileSemanticVisualModules(graph: SemanticArchitectureGraph): SemanticVisualCompilation {
  const modules = graph.modules
    .slice()
    .sort((left, right) => compareCodeUnits(left.moduleId, right.moduleId))
    .map(compileModule);
  const relations = graph.relations
    .slice()
    .sort((left, right) => compareCodeUnits(left.relationId, right.relationId))
    .map(compileRelation);
  const diagnostics: SemanticVisualDiagnostic[] = [];
  for (const module of graph.modules) {
    if (module.semanticType === "unknown_module") diagnostics.push({ code: "unknown-module", moduleId: module.moduleId });
    if (module.knowledge === "candidate") diagnostics.push({ code: "candidate-structure", moduleId: module.moduleId });
  }
  for (const relation of graph.relations) {
    if (relation.knowledge === "candidate") diagnostics.push({ code: "candidate-structure", relationId: relation.relationId });
  }
  diagnostics.sort((left, right) => compareCodeUnits(diagnosticKey(left), diagnosticKey(right)));
  return deepFreeze({
    version: SEMANTIC_VISUAL_COMPILER_VERSION,
    graphId: graph.graphId,
    exportEligibility: graph.exportEligibility,
    modules,
    relations,
    diagnostics,
  });
}

function compileModule(module: SemanticModule): VisualModulePlan {
  const parts = partsFor(module);
  return {
    moduleId: module.moduleId,
    visualGrammarId: grammarId(module),
    parts,
    inputPortIds: module.inputs.map((port) => port.portId).sort(compareCodeUnits),
    outputPortIds: module.outputs.map((port) => port.portId).sort(compareCodeUnits),
    sourceNodeIds: module.sourceNodeIds.slice().sort(compareCodeUnits),
    evidenceIds: uniqueSorted(module.evidenceIds),
  };
}

function partsFor(module: SemanticModule): VisualModulePart[] {
  const internalPartIds = module.internalParts.map((part) => part.partId).sort(compareCodeUnits);
  const evidenceIds = uniqueSorted([
    ...module.evidenceIds,
    ...module.internalParts.flatMap((part) => part.evidenceIds),
  ]);
  const generated = (kind: VisualModulePartKind, role: string, label: string, sourcePartIds: string[] = internalPartIds, partEvidenceIds = evidenceIds): VisualModulePart => ({
    partId: module.moduleId + ":" + role,
    kind,
    role,
    label,
    sourceModuleId: module.moduleId,
    sourcePartIds: sourcePartIds.slice().sort(compareCodeUnits),
    evidenceIds: uniqueSorted(partEvidenceIds),
  });

  if (module.semanticType === "unknown_module") {
    return [
      generated("unknown_container", "unknown_module", "Unknown module", []),
      generated("label", "label", module.label, []),
    ];
  }
  if (module.semanticType === "attention_block") {
    return [
      generated("token_cell_strip", "query_tokens", "Query tokens"),
      generated("token_cell_strip", "key_tokens", "Key tokens"),
      generated("token_cell_strip", "value_tokens", "Value tokens"),
      generated("relation_marker", "attention_relation", "Attention relation"),
      generated("token_cell_strip", "output_tokens", "Output tokens"),
    ];
  }
  if (module.semanticType === "graph_message_passing" || module.semanticType === "mesh_graph") {
    return [
      generated("graph_inset", "node_group", "Graph nodes"),
      generated("graph_inset", "edge_group", "Graph edges"),
      generated("graph_inset", "message_aggregate", "Message aggregate"),
      generated("graph_inset", "graph_inset_label", module.label),
    ];
  }
  if (module.semanticType === "memory_state") {
    return [
      generated("state_store", "state_store", "Persistent state"),
      generated("state_store", "state_read_port", "State read"),
      generated("state_store", "state_write_port", "State write"),
    ];
  }
  if (module.semanticType === "diffusion_denoiser" || module.semanticType === "diffusion_ladder") {
    return [
      generated("operator_body", "operator_body", module.label),
      generated("repeat_marker", "repeat_marker", repeatLabel(module)),
      generated("process_axis", "process_axis", "Timestep"),
      generated("condition_marker", "condition_marker", conditionLabel(module)),
      generated("label", "label", module.label, []),
    ];
  }
  if (module.semanticType === "tensor_volume" || module.semanticType === "convolution_stage" || module.semanticType === "scale_transition" || module.semanticType === "grid") {
    return [
      generated("tensor_face", "front_face", "Tensor front face"),
      generated("tensor_face", "top_face", "Tensor top face"),
      generated("tensor_face", "side_face", "Tensor side face"),
      generated("operator_body", "operator_body", operatorLabel(module)),
      generated("label", "label", module.label, []),
    ];
  }
  if (module.semanticType === "token_sequence") {
    const parts = [generated("token_cell_strip", "tokens", "Token sequence")];
    if (module.internalParts.some((part) => part.role.toLowerCase().includes("special"))) parts.push(generated("relation_marker", "special_token_marker", "Special token"));
    parts.push(generated("label", "label", module.label, []));
    return parts;
  }
  if (module.semanticType === "ssm_block") {
    return [
      generated("operator_body", "operator_body", operatorLabel(module)),
      generated("state_store", "state_store", "State update"),
      generated("label", "label", module.label, []),
    ];
  }
  const operatorParts = module.internalParts.map((part) => generated("operator_body", "operator:" + part.role, part.label, [part.partId], part.evidenceIds));
  return [...operatorParts, generated(module.repeat ? "repeat_marker" : "label", module.repeat ? "repeat_marker" : "label", module.repeat ? repeatLabel(module) : module.label, [])];
}

function grammarId(module: SemanticModule): string {
  const ids: Record<string, string> = {
    tensor_volume: "tensor-artifact",
    convolution_stage: "tensor-operator-stage",
    scale_transition: "tensor-scale-transition",
    attention_block: "attention-block",
    token_sequence: "token-sequence",
    graph_message_passing: "graph-message-passing",
    mesh_graph: "graph-message-passing",
    memory_state: "memory-state",
    ssm_block: "state-space-block",
    diffusion_denoiser: "diffusion-denoiser",
    diffusion_ladder: "diffusion-ladder",
    unknown_module: "unknown-module",
  };
  return ids[module.semanticType] ?? module.semanticType.replace(/_/g, "-");
}

function compileRelation(relation: SemanticRelation): VisualRelationPlan {
  const mapping: Record<SemanticRelationType, { visualRole: VisualRelationRole; marker: VisualRelationMarker }> = {
    data_flow: { visualRole: "data", marker: "arrow" },
    condition_flow: { visualRole: "condition", marker: "arrow" },
    residual_skip: { visualRole: "skip", marker: "skip_route" },
    add_merge: { visualRole: "merge_add", marker: "plus" },
    concat_merge: { visualRole: "merge_concat", marker: "concat" },
    cross_attention: { visualRole: "cross_attention", marker: "attention" },
    message_passing: { visualRole: "message_passing", marker: "message" },
    state_read: { visualRole: "state_read", marker: "read" },
    state_write: { visualRole: "state_write", marker: "write" },
    feedback: { visualRole: "feedback", marker: "feedback" },
    time_step: { visualRole: "time_step", marker: "time" },
    diffusion_iteration: { visualRole: "diffusion_iteration", marker: "diffusion" },
  };
  return {
    relationId: relation.relationId,
    relationType: relation.type,
    visualRole: mapping[relation.type].visualRole,
    marker: mapping[relation.type].marker,
    sourceModuleId: relation.source.moduleId,
    sourcePortId: relation.source.portId,
    targetModuleId: relation.target.moduleId,
    targetPortId: relation.target.portId,
    evidenceIds: uniqueSorted(relation.evidenceIds),
  };
}

function operatorLabel(module: SemanticModule): string {
  return module.internalParts.map((part) => part.label).sort(compareCodeUnits).join(" → ") || module.label;
}

function repeatLabel(module: SemanticModule): string {
  if (!module.repeat) return "Repeated process";
  return module.repeat.count === "unknown" ? "Repeated process" : "×" + module.repeat.count;
}

function conditionLabel(module: SemanticModule): string {
  return module.condition ? module.condition.conditionType + " condition" : "Condition";
}

function diagnosticKey(value: { code: string; moduleId?: string; relationId?: string }): string {
  return value.code + ":" + (value.moduleId ?? value.relationId ?? "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
