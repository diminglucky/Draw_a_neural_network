import { compareCodeUnits } from "./stable-string-order.js";
import type {
  SemanticArchitectureGraph,
  SemanticModule,
  SemanticRelationType,
} from "./semantic-visual-module.js";
import type {
  SemanticVisualCompilation,
  VisualModulePlan,
} from "./semantic-visual-module-compiler.js";

export const FIGURE_STORY_PLAN_VERSION = 1 as const;

export type StoryPanelKind = "overview" | "detail" | "process" | "legend";
export type StoryLaneKind = "main" | "condition" | "state" | "feedback" | "graph" | "process";

export interface StoryPanel {
  panelId: string;
  kind: StoryPanelKind;
  purpose: string;
  moduleIds: string[];
  relationIds: string[];
}

export interface StoryLane {
  laneId: string;
  kind: StoryLaneKind;
  moduleIds: string[];
  relationIds: string[];
}

export interface StoryInset {
  insetId: string;
  sourceModuleId: string;
  panelId: string;
  referenceLabel: string;
  partIds: string[];
}

export interface StoryLegendEntry {
  legendId: string;
  semanticType: string;
  visualRole: string;
  explanation: string;
}

export interface FigureStoryDiagnostic {
  code: "unknown-module" | "candidate-structure" | "empty-main-path";
  moduleId?: string;
  relationId?: string;
}

export interface FigureStoryPlan {
  version: typeof FIGURE_STORY_PLAN_VERSION;
  graphId: string;
  exportEligibility: SemanticArchitectureGraph["exportEligibility"];
  mainPathModuleIds: string[];
  panels: StoryPanel[];
  lanes: StoryLane[];
  insets: StoryInset[];
  legend: StoryLegendEntry[];
  diagnostics: FigureStoryDiagnostic[];
}

const MAIN_RELATIONS = new Set<SemanticRelationType>(["data_flow", "residual_skip", "add_merge", "concat_merge"]);
const LANE_BY_RELATION: Record<SemanticRelationType, StoryLaneKind> = {
  data_flow: "main",
  condition_flow: "condition",
  residual_skip: "main",
  add_merge: "main",
  concat_merge: "main",
  cross_attention: "condition",
  message_passing: "graph",
  state_read: "state",
  state_write: "state",
  feedback: "feedback",
  time_step: "process",
  diffusion_iteration: "process",
};
const COMPLEX_MODULE_TYPES = new Set([
  "attention_block",
  "graph_message_passing",
  "mesh_graph",
  "memory_state",
  "ssm_block",
  "diffusion_denoiser",
  "diffusion_ladder",
]);
const LEGEND_TEXT: Record<string, { visualRole: string; explanation: string }> = {
  data: { visualRole: "data", explanation: "primary data flow" },
  condition: { visualRole: "condition", explanation: "conditioning input" },
  skip: { visualRole: "skip", explanation: "residual or skip connection" },
  merge_add: { visualRole: "merge_add", explanation: "additive merge" },
  merge_concat: { visualRole: "merge_concat", explanation: "concatenation merge" },
  cross_attention: { visualRole: "cross_attention", explanation: "cross-attention relation" },
  message_passing: { visualRole: "message_passing", explanation: "graph message passing" },
  state_read: { visualRole: "state_read", explanation: "persistent state read" },
  state_write: { visualRole: "state_write", explanation: "persistent state write" },
  feedback: { visualRole: "feedback", explanation: "feedback or recycling relation" },
  process: { visualRole: "process", explanation: "time or diffusion process" },
};

export function composeFigureStory(
  graph: SemanticArchitectureGraph,
  compilation: SemanticVisualCompilation,
): FigureStoryPlan {
  if (graph.graphId !== compilation.graphId) throw new Error("Story graph and visual compilation graph IDs must match");
  const mainPathModuleIds = extractMainPath(graph);
  const lanes = createLanes(graph, mainPathModuleIds);
  const complexModuleIds = graph.modules
    .filter((module) => COMPLEX_MODULE_TYPES.has(module.semanticType))
    .map((module) => module.moduleId)
    .sort(compareCodeUnits);
  const overviewRelationIds = graph.relations
    .filter((relation) => LANE_BY_RELATION[relation.type] === "main" && mainPathModuleIds.includes(relation.source.moduleId) && mainPathModuleIds.includes(relation.target.moduleId))
    .map((relation) => relation.relationId)
    .sort(compareCodeUnits);
  const detailRelationIds = graph.relations
    .filter((relation) => complexModuleIds.includes(relation.source.moduleId) || complexModuleIds.includes(relation.target.moduleId))
    .map((relation) => relation.relationId)
    .sort(compareCodeUnits);
  const processRelationIds = laneRelations(lanes, "process");
  const panelModules = new Set(mainPathModuleIds);
  const panels: StoryPanel[] = [
    panel("panel:overview", "overview", "Primary architecture narrative", mainPathModuleIds, overviewRelationIds),
  ];
  if (complexModuleIds.length > 0) {
    panels.push(panel("panel:detail", "detail", "Selected complex module internals", complexModuleIds, detailRelationIds));
    for (const moduleId of complexModuleIds) panelModules.add(moduleId);
  }
  if (processRelationIds.length > 0) {
    panels.push(panel("panel:process", "process", "Time and diffusion process", laneModules(lanes, "process"), processRelationIds));
  }
  panels.push(panel("panel:legend", "legend", "Semantic relation legend", [...panelModules].sort(compareCodeUnits), []));

  const modulePlanById = new Map(compilation.modules.map((module) => [module.moduleId, module]));
  const insets = complexModuleIds.map((moduleId) => {
    const module = modulePlanById.get(moduleId);
    return {
      insetId: "inset:" + moduleId,
      sourceModuleId: moduleId,
      panelId: "panel:overview",
      referenceLabel: "detail:" + moduleId,
      partIds: module ? module.parts.map((part) => part.partId) : [],
    };
  });
  const legend = createLegend(graph);
  const diagnostics = createDiagnostics(graph, compilation, mainPathModuleIds);
  return deepFreeze({
    version: FIGURE_STORY_PLAN_VERSION,
    graphId: graph.graphId,
    exportEligibility: graph.exportEligibility,
    mainPathModuleIds,
    panels,
    lanes,
    insets,
    legend,
    diagnostics,
  });
}

function extractMainPath(graph: SemanticArchitectureGraph): string[] {
  const moduleIds = graph.modules.map((module) => module.moduleId).sort(compareCodeUnits);
  const relations = graph.relations
    .filter((relation) => MAIN_RELATIONS.has(relation.type))
    .sort((left, right) => compareCodeUnits(left.relationId, right.relationId));
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const relation of relations) {
    const targets = outgoing.get(relation.source.moduleId) ?? [];
    targets.push(relation.target.moduleId);
    outgoing.set(relation.source.moduleId, targets);
    incoming.add(relation.target.moduleId);
  }
  for (const targets of outgoing.values()) targets.sort(compareCodeUnits);
  const starts = moduleIds.filter((moduleId) => !incoming.has(moduleId));
  const candidates = starts.length > 0 ? starts : moduleIds;
  let best: string[] = [];
  for (const start of candidates) {
    const path = longestPath(start, outgoing, new Set<string>());
    if (path.length > best.length || (path.length === best.length && sequenceKey(path) < sequenceKey(best))) best = path;
  }
  return best;
}

function longestPath(nodeId: string, outgoing: Map<string, string[]>, visiting: Set<string>): string[] {
  if (visiting.has(nodeId)) return [];
  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const children = outgoing.get(nodeId) ?? [];
  let best: string[] = [];
  for (const child of children) {
    const suffix = longestPath(child, outgoing, nextVisiting);
    if (suffix.length > best.length || (suffix.length === best.length && sequenceKey(suffix) < sequenceKey(best))) best = suffix;
  }
  return [nodeId, ...best];
}

function createLanes(graph: SemanticArchitectureGraph, mainPath: string[]): StoryLane[] {
  const byKind = new Map<StoryLaneKind, { modules: Set<string>; relations: string[] }>();
  for (const relation of graph.relations.slice().sort((left, right) => compareCodeUnits(left.relationId, right.relationId))) {
    const kind = LANE_BY_RELATION[relation.type];
    const lane = byKind.get(kind) ?? { modules: new Set<string>(), relations: [] };
    lane.relations.push(relation.relationId);
    lane.modules.add(relation.source.moduleId);
    lane.modules.add(relation.target.moduleId);
    byKind.set(kind, lane);
  }
  if (mainPath.length > 0) {
    const lane = byKind.get("main") ?? { modules: new Set<string>(), relations: [] };
    for (const moduleId of mainPath) lane.modules.add(moduleId);
    byKind.set("main", lane);
  }
  const order: StoryLaneKind[] = ["main", "condition", "state", "feedback", "graph", "process"];
  return order
    .filter((kind) => byKind.has(kind))
    .map((kind) => ({
      laneId: "lane:" + kind,
      kind,
      moduleIds: [...byKind.get(kind)!.modules].sort(compareCodeUnits),
      relationIds: [...byKind.get(kind)!.relations].sort(compareCodeUnits),
    }));
}

function createLegend(graph: SemanticArchitectureGraph): StoryLegendEntry[] {
  const roles = new Set<string>();
  for (const relation of graph.relations) {
    const lane = LANE_BY_RELATION[relation.type];
    if (relation.type === "data_flow") roles.add("data");
    else if (relation.type === "condition_flow") roles.add("condition");
    else if (relation.type === "residual_skip") roles.add("skip");
    else if (relation.type === "add_merge") roles.add("merge_add");
    else if (relation.type === "concat_merge") roles.add("merge_concat");
    else if (relation.type === "cross_attention") roles.add("cross_attention");
    else if (relation.type === "message_passing") roles.add("message_passing");
    else if (relation.type === "state_read") roles.add("state_read");
    else if (relation.type === "state_write") roles.add("state_write");
    else if (relation.type === "feedback") roles.add("feedback");
    else if (lane === "process") roles.add("process");
  }
  return [...roles].sort(compareCodeUnits).map((semanticType) => ({
    legendId: "legend:" + semanticType,
    semanticType,
    visualRole: LEGEND_TEXT[semanticType].visualRole,
    explanation: LEGEND_TEXT[semanticType].explanation,
  }));
}

function createDiagnostics(graph: SemanticArchitectureGraph, compilation: SemanticVisualCompilation, mainPath: string[]): FigureStoryDiagnostic[] {
  const diagnostics: FigureStoryDiagnostic[] = compilation.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  if (mainPath.length === 0 && graph.modules.length > 0) diagnostics.push({ code: "empty-main-path" });
  diagnostics.sort((left, right) => compareCodeUnits(diagnosticKey(left), diagnosticKey(right)));
  return diagnostics;
}

function panel(panelId: string, kind: StoryPanelKind, purpose: string, moduleIds: string[], relationIds: string[]): StoryPanel {
  return {
    panelId,
    kind,
    purpose,
    // Panel order is part of the figure narrative. The overview must retain
    // the extracted main-path order; callers already provide sorted IDs for
    // non-narrative panels where lexical order is the desired tie-breaker.
    moduleIds: [...new Set(moduleIds)],
    relationIds: [...new Set(relationIds)].sort(compareCodeUnits),
  };
}

function laneRelations(lanes: StoryLane[], kind: StoryLaneKind): string[] {
  return lanes.find((lane) => lane.kind === kind)?.relationIds ?? [];
}

function laneModules(lanes: StoryLane[], kind: StoryLaneKind): string[] {
  return lanes.find((lane) => lane.kind === kind)?.moduleIds ?? [];
}

function sequenceKey(values: string[]): string {
  return values.join("\u0000");
}

function diagnosticKey(value: FigureStoryDiagnostic): string {
  return value.code + ":" + (value.moduleId ?? value.relationId ?? "");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
