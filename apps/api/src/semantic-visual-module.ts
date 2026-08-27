export const SEMANTIC_VISUAL_CONTRACT_VERSION = 1 as const;

export type SemanticModuleType =
  | "image_frame" | "tensor_volume" | "token_sequence" | "grid" | "mesh_graph"
  | "latent" | "mask" | "prediction" | "memory_state"
  | "convolution_stage" | "scale_transition" | "attention_block" | "ffn_block"
  | "ssm_block" | "graph_message_passing" | "diffusion_denoiser"
  | "stage_region" | "repeat_group" | "multi_tower" | "fusion_block"
  | "time_axis" | "feedback_loop" | "diffusion_ladder" | "ensemble_branch"
  | "unknown_module";

export type SemanticDataType =
  | "image" | "video_frame" | "tensor" | "feature_map" | "token_sequence"
  | "grid" | "mesh" | "graph" | "latent" | "mask" | "prediction"
  | "memory" | "state" | "unknown";

export type SemanticRelationType =
  | "data_flow" | "condition_flow" | "residual_skip" | "add_merge" | "concat_merge"
  | "cross_attention" | "message_passing" | "state_read" | "state_write"
  | "feedback" | "time_step" | "diffusion_iteration";

export type SemanticKnowledge = "proven" | "declared" | "candidate";
export type SemanticExportEligibility = "formal" | "candidate" | "blocked";

export interface SymbolicShape {
  axes: string[];
  dimensions: Array<number | string>;
}

export interface SemanticPort {
  portId: string;
  direction: "input" | "output";
  dataId: string | null;
  role: "data" | "condition" | "state" | "query" | "key" | "value" | "mask";
}

export interface ModulePart {
  partId: string;
  kind: "operator" | "data" | "relation" | "annotation";
  role: string;
  label: string;
  evidenceIds: string[];
}

export interface RepeatSpec {
  kind: "block" | "time" | "diffusion" | "recurrent" | "ensemble";
  count: number | "unknown";
  unitModuleIds: string[];
  display: "collapsed" | "first_last" | "expanded";
}

export interface StateSpec {
  stateId: string;
  stateType: "memory" | "recurrent" | "latent" | "unknown";
  readPortIds: string[];
  writePortIds: string[];
  persistent: boolean;
  evidenceIds: string[];
}

export interface ConditionSpec {
  conditionId: string;
  conditionType: "text" | "time" | "noise" | "mask" | "external" | "unknown";
  portIds: string[];
  evidenceIds: string[];
}

export interface ModuleLayoutIntent {
  emphasis: "primary" | "secondary" | "auxiliary";
  preferredPanel: "overview" | "detail" | "process" | "legend";
  detailPolicy: "summary" | "expand" | "inset";
}

export interface SemanticModule {
  moduleId: string;
  semanticType: SemanticModuleType;
  label: string;
  sourceNodeIds: string[];
  evidenceIds: string[];
  inputs: SemanticPort[];
  outputs: SemanticPort[];
  internalParts: ModulePart[];
  repeat: RepeatSpec | null;
  state: StateSpec | null;
  condition: ConditionSpec | null;
  layoutIntent: ModuleLayoutIntent;
  confidence: number;
  knowledge: SemanticKnowledge;
}

export interface SemanticDataObject {
  dataId: string;
  dataType: SemanticDataType;
  shape: SymbolicShape | null;
  sourceNodeIds: string[];
  evidenceIds: string[];
  visualRole: "primary" | "condition" | "state" | "output" | "auxiliary";
  confidence: number;
  knowledge: SemanticKnowledge;
}

export interface SemanticRelation {
  relationId: string;
  type: SemanticRelationType;
  source: { moduleId: string; portId: string };
  target: { moduleId: string; portId: string };
  dataId: string | null;
  knowledge: SemanticKnowledge;
  evidenceIds: string[];
}

export interface SemanticPanelIntent {
  panelId: string;
  kind: "overview" | "detail" | "process" | "legend";
  memberModuleIds: string[];
}

export interface UnresolvedSemantic {
  unresolvedId: string;
  scope: "module" | "relation" | "shape" | "topology";
  severity: "blocking" | "warning";
  evidenceIds: string[];
}

export interface SemanticArchitectureGraphInput {
  graphId: string;
  revision: string;
  modules: SemanticModule[];
  dataObjects: SemanticDataObject[];
  relations: SemanticRelation[];
  panels: SemanticPanelIntent[];
  evidenceIds: string[];
  confidence: number;
  unresolved: UnresolvedSemantic[];
}

export interface SemanticArchitectureGraph extends SemanticArchitectureGraphInput {
  version: typeof SEMANTIC_VISUAL_CONTRACT_VERSION;
  exportEligibility: SemanticExportEligibility;
  canonicalHash: string;
}
