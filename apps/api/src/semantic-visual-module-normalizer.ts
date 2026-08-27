import { createHash } from "node:crypto";
import { compareCodeUnits } from "./stable-string-order.js";
import {
  SEMANTIC_VISUAL_CONTRACT_VERSION,
  type SemanticArchitectureGraph,
  type SemanticArchitectureGraphInput,
  type SemanticDataObject,
  type SemanticExportEligibility,
  type SemanticModule,
  type SemanticPanelIntent,
  type SemanticPort,
  type SemanticRelation,
  type SymbolicShape,
} from "./semantic-visual-module.js";

type AnyRecord = Record<string, any>;

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_KEY = /coordinate|bounds|geometry|renderer|command|path|script|sourcebytes|sourcecode|rawsource|outputpath/i;
const GRAPH_KEYS = ["graphId", "revision", "modules", "dataObjects", "relations", "panels", "evidenceIds", "confidence", "unresolved"];
const MODULE_KEYS = ["moduleId", "semanticType", "label", "sourceNodeIds", "evidenceIds", "inputs", "outputs", "internalParts", "repeat", "state", "condition", "layoutIntent", "confidence", "knowledge"];
const DATA_KEYS = ["dataId", "dataType", "shape", "sourceNodeIds", "evidenceIds", "visualRole", "confidence", "knowledge"];
const PORT_KEYS = ["portId", "direction", "dataId", "role"];
const PART_KEYS = ["partId", "kind", "role", "label", "evidenceIds"];
const RELATION_KEYS = ["relationId", "type", "source", "target", "dataId", "knowledge", "evidenceIds"];

export function normalizeSemanticArchitectureGraph(input: SemanticArchitectureGraphInput): SemanticArchitectureGraph {
  const graph = cloneRecord(input, "Semantic architecture graph must be a plain object");
  exactKeys(graph, GRAPH_KEYS, "semantic graph");
  const evidenceIds = evidenceList(graph.evidenceIds, new Set<string>(), "graph evidence", 2048, false);
  const evidenceSet = new Set(evidenceIds);
  const modules = array(graph.modules, 512, "modules").map((value, index) => normalizeModule(value, index, evidenceSet));
  const dataObjects = array(graph.dataObjects, 1024, "dataObjects").map((value, index) => normalizeData(value, index, evidenceSet));
  const moduleById = uniqueById(modules, "moduleId", "module");
  const dataById = uniqueById(dataObjects, "dataId", "data object");
  for (const module of modules) validateModule(module, moduleById, dataById);
  const relations = array(graph.relations, 2048, "relations").map((value, index) => normalizeRelation(value, index, moduleById, dataById, evidenceSet));
  uniqueById(relations, "relationId", "relation");
  const panels = array(graph.panels, 64, "panels").map((value, index) => normalizePanel(value, index, moduleById));
  uniqueById(panels, "panelId", "panel");
  const unresolved = array(graph.unresolved, 128, "unresolved").map((value, index) => normalizeUnresolved(value, index, evidenceSet));
  uniqueById(unresolved, "unresolvedId", "unresolved");

  const normalized: SemanticArchitectureGraphInput = {
    graphId: stringValue(graph.graphId, "graphId"),
    revision: stringValue(graph.revision, "revision"),
    modules: sortById(modules, "moduleId"),
    dataObjects: sortById(dataObjects, "dataId"),
    relations: sortById(relations, "relationId"),
    panels: sortById(panels, "panelId"),
    evidenceIds,
    confidence: confidenceValue(graph.confidence, "graph confidence"),
    unresolved: sortById(unresolved, "unresolvedId"),
  };
  const withoutHash: SemanticArchitectureGraph = {
    version: SEMANTIC_VISUAL_CONTRACT_VERSION,
    ...normalized,
    exportEligibility: eligibility(normalized),
    canonicalHash: "",
  };
  const canonicalHash = sha256(canonicalSemanticArchitectureGraphJson(withoutHash));
  return deepFreeze({ ...withoutHash, canonicalHash }) as SemanticArchitectureGraph;
}

export function canonicalSemanticArchitectureGraphJson(graph: SemanticArchitectureGraph): string {
  return JSON.stringify(canonicalValue(graph));
}

export function getSemanticExportEligibility(input: SemanticArchitectureGraphInput): SemanticExportEligibility {
  return normalizeSemanticArchitectureGraph(input).exportEligibility;
}

function normalizeModule(value: unknown, index: number, evidenceSet: Set<string>): SemanticModule {
  const item = record(value, "modules[" + index + "]");
  exactKeys(item, MODULE_KEYS, "modules[" + index + "]");
  const path = "modules[" + index + "]";
  const inputs = ports(item.inputs, "input", path + ".inputs");
  const outputs = ports(item.outputs, "output", path + ".outputs");
  const parts = array(item.internalParts, 128, path + ".internalParts").map((part, partIndex) => normalizePart(part, path + ".internalParts[" + partIndex + "]", evidenceSet));
  if (parts.length === 0) throw new Error("Module " + item.moduleId + " requires internalParts");
  const semanticType = oneOf(item.semanticType, [
    "image_frame", "tensor_volume", "token_sequence", "grid", "mesh_graph", "latent", "mask", "prediction", "memory_state",
    "convolution_stage", "scale_transition", "attention_block", "ffn_block", "ssm_block", "graph_message_passing", "diffusion_denoiser",
    "stage_region", "repeat_group", "multi_tower", "fusion_block", "time_axis", "feedback_loop", "diffusion_ladder", "ensemble_branch", "unknown_module",
  ], path + ".semanticType") as SemanticModule["semanticType"];
  const knowledge = oneOf(item.knowledge, ["proven", "declared", "candidate"], path + ".knowledge") as SemanticModule["knowledge"];
  return {
    moduleId: idValue(item.moduleId, path + ".moduleId"),
    semanticType,
    label: stringValue(item.label, path + ".label"),
    sourceNodeIds: idList(item.sourceNodeIds, path + ".sourceNodeIds", 256),
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
    inputs,
    outputs,
    internalParts: sortById(parts, "partId"),
    repeat: item.repeat === null ? null : repeatValue(item.repeat, path + ".repeat"),
    state: item.state === null ? null : stateValue(item.state, path + ".state", evidenceSet),
    condition: item.condition === null ? null : conditionValue(item.condition, path + ".condition", evidenceSet),
    layoutIntent: layoutValue(item.layoutIntent, path + ".layoutIntent"),
    confidence: confidenceValue(item.confidence, path + ".confidence"),
    knowledge,
  };
}

function normalizeData(value: unknown, index: number, evidenceSet: Set<string>): SemanticDataObject {
  const item = record(value, "dataObjects[" + index + "]");
  const path = "dataObjects[" + index + "]";
  exactKeys(item, DATA_KEYS, path);
  return {
    dataId: idValue(item.dataId, path + ".dataId"),
    dataType: oneOf(item.dataType, ["image", "video_frame", "tensor", "feature_map", "token_sequence", "grid", "mesh", "graph", "latent", "mask", "prediction", "memory", "state", "unknown"], path + ".dataType") as SemanticDataObject["dataType"],
    shape: item.shape === null ? null : shapeValue(item.shape, path + ".shape"),
    sourceNodeIds: idList(item.sourceNodeIds, path + ".sourceNodeIds", 256),
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
    visualRole: oneOf(item.visualRole, ["primary", "condition", "state", "output", "auxiliary"], path + ".visualRole") as SemanticDataObject["visualRole"],
    confidence: confidenceValue(item.confidence, path + ".confidence"),
    knowledge: oneOf(item.knowledge, ["proven", "declared", "candidate"], path + ".knowledge") as SemanticDataObject["knowledge"],
  };
}

function normalizeRelation(value: unknown, index: number, modules: Map<string, SemanticModule>, data: Map<string, SemanticDataObject>, evidenceSet: Set<string>): SemanticRelation {
  const path = "relations[" + index + "]";
  const item = record(value, path);
  exactKeys(item, RELATION_KEYS, path);
  const relation: SemanticRelation = {
    relationId: idValue(item.relationId, path + ".relationId"),
    type: oneOf(item.type, ["data_flow", "condition_flow", "residual_skip", "add_merge", "concat_merge", "cross_attention", "message_passing", "state_read", "state_write", "feedback", "time_step", "diffusion_iteration"], path + ".type") as SemanticRelation["type"],
    source: endpoint(item.source, modules, "output", path + ".source"),
    target: endpoint(item.target, modules, "input", path + ".target"),
    dataId: item.dataId === null ? null : idValue(item.dataId, path + ".dataId"),
    knowledge: oneOf(item.knowledge, ["proven", "declared", "candidate"], path + ".knowledge") as SemanticRelation["knowledge"],
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
  };
  if (relation.dataId !== null && !data.has(relation.dataId)) throw new Error("Relation references unknown data object " + relation.dataId);
  return relation;
}

function normalizePanel(value: unknown, index: number, modules: Map<string, SemanticModule>): SemanticPanelIntent {
  const path = "panels[" + index + "]";
  const item = record(value, path);
  exactKeys(item, ["panelId", "kind", "memberModuleIds"], path);
  const memberModuleIds = idList(item.memberModuleIds, path + ".memberModuleIds", 512);
  for (const moduleId of memberModuleIds) if (!modules.has(moduleId)) throw new Error("Panel references unknown module " + moduleId);
  return {
    panelId: idValue(item.panelId, path + ".panelId"),
    kind: oneOf(item.kind, ["overview", "detail", "process", "legend"], path + ".kind") as SemanticPanelIntent["kind"],
    memberModuleIds,
  };
}

function normalizeUnresolved(value: unknown, index: number, evidenceSet: Set<string>) {
  const path = "unresolved[" + index + "]";
  const item = record(value, path);
  exactKeys(item, ["unresolvedId", "scope", "severity", "evidenceIds"], path);
  return {
    unresolvedId: idValue(item.unresolvedId, path + ".unresolvedId"),
    scope: oneOf(item.scope, ["module", "relation", "shape", "topology"], path + ".scope") as "module" | "relation" | "shape" | "topology",
    severity: oneOf(item.severity, ["blocking", "warning"], path + ".severity") as "blocking" | "warning",
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
  };
}

function normalizePart(value: unknown, path: string, evidenceSet: Set<string>) {
  const item = record(value, path);
  exactKeys(item, ["partId", "kind", "role", "label", "evidenceIds"], path);
  return {
    partId: idValue(item.partId, path + ".partId"),
    kind: oneOf(item.kind, ["operator", "data", "relation", "annotation"], path + ".kind") as "operator" | "data" | "relation" | "annotation",
    role: stringValue(item.role, path + ".role"),
    label: stringValue(item.label, path + ".label"),
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
  };
}

function ports(value: unknown, direction: "input" | "output", path: string): SemanticPort[] {
  const result = array(value, 64, path).map((port, index) => {
    const item = record(port, path + "[" + index + "]");
    const childPath = path + "[" + index + "]";
    exactKeys(item, ["portId", "direction", "dataId", "role"], childPath);
    if (item.direction !== direction) throw new Error(childPath + ".direction must be " + direction);
    return {
      portId: idValue(item.portId, childPath + ".portId"),
      direction,
      dataId: item.dataId === null ? null : idValue(item.dataId, childPath + ".dataId"),
      role: oneOf(item.role, ["data", "condition", "state", "query", "key", "value", "mask"], childPath + ".role") as SemanticPort["role"],
    };
  });
  uniqueById(result, "portId", "port");
  return sortById(result, "portId");
}

function endpoint(value: unknown, modules: Map<string, SemanticModule>, direction: "input" | "output", path: string) {
  const item = record(value, path);
  exactKeys(item, ["moduleId", "portId"], path);
  const moduleId = idValue(item.moduleId, path + ".moduleId");
  const portId = idValue(item.portId, path + ".portId");
  const module = modules.get(moduleId);
  if (!module) throw new Error(path + " references unknown module " + moduleId);
  const ports = direction === "input" ? module.inputs : module.outputs;
  if (!ports.some((port) => port.portId === portId)) throw new Error(path + " references unknown " + direction + " port " + portId);
  return { moduleId, portId };
}

function validateModule(module: SemanticModule, modules: Map<string, SemanticModule>, data: Map<string, SemanticDataObject>): void {
  const allPorts = [...module.inputs, ...module.outputs];
  const portIds = new Set(allPorts.map((port) => port.portId));
  if (portIds.size !== allPorts.length) throw new Error("Duplicate port ID in module " + module.moduleId);
  for (const port of allPorts) if (port.dataId !== null && !data.has(port.dataId)) throw new Error("Module references unknown data object " + port.dataId);
  if (module.repeat) for (const unitId of module.repeat.unitModuleIds) if (!modules.has(unitId)) throw new Error("Repeat references unknown module " + unitId);
  if (module.state) {
    for (const portId of module.state.readPortIds) {
      const port = allPorts.find((candidate) => candidate.portId === portId);
      if (!port || port.direction !== "input") throw new Error("State read port " + portId + " must be an input port");
    }
    for (const portId of module.state.writePortIds) {
      const port = allPorts.find((candidate) => candidate.portId === portId);
      if (!port || port.direction !== "output") throw new Error("State write port " + portId + " must be an output port");
    }
  }
  if (module.condition) for (const portId of module.condition.portIds) if (!portIds.has(portId)) throw new Error("Condition references unknown port " + portId);
}

function repeatValue(value: unknown, path: string) {
  const item = record(value, path);
  exactKeys(item, ["kind", "count", "unitModuleIds", "display"], path);
  if (item.count !== "unknown" && (!Number.isInteger(item.count) || item.count <= 0)) throw new Error(path + ".count must be positive");
  return {
    kind: oneOf(item.kind, ["block", "time", "diffusion", "recurrent", "ensemble"], path + ".kind") as "block" | "time" | "diffusion" | "recurrent" | "ensemble",
    count: item.count as number | "unknown",
    unitModuleIds: idList(item.unitModuleIds, path + ".unitModuleIds", 512),
    display: oneOf(item.display, ["collapsed", "first_last", "expanded"], path + ".display") as "collapsed" | "first_last" | "expanded",
  };
}

function stateValue(value: unknown, path: string, evidenceSet: Set<string>) {
  const item = record(value, path);
  exactKeys(item, ["stateId", "stateType", "readPortIds", "writePortIds", "persistent", "evidenceIds"], path);
  return {
    stateId: idValue(item.stateId, path + ".stateId"),
    stateType: oneOf(item.stateType, ["memory", "recurrent", "latent", "unknown"], path + ".stateType") as "memory" | "recurrent" | "latent" | "unknown",
    readPortIds: idList(item.readPortIds, path + ".readPortIds", 64),
    writePortIds: idList(item.writePortIds, path + ".writePortIds", 64),
    persistent: booleanValue(item.persistent, path + ".persistent"),
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
  };
}

function conditionValue(value: unknown, path: string, evidenceSet: Set<string>) {
  const item = record(value, path);
  exactKeys(item, ["conditionId", "conditionType", "portIds", "evidenceIds"], path);
  return {
    conditionId: idValue(item.conditionId, path + ".conditionId"),
    conditionType: oneOf(item.conditionType, ["text", "time", "noise", "mask", "external", "unknown"], path + ".conditionType") as "text" | "time" | "noise" | "mask" | "external" | "unknown",
    portIds: idList(item.portIds, path + ".portIds", 64),
    evidenceIds: evidenceList(item.evidenceIds, evidenceSet, path + ".evidenceIds", 64, true),
  };
}

function layoutValue(value: unknown, path: string) {
  const item = record(value, path);
  exactKeys(item, ["emphasis", "preferredPanel", "detailPolicy"], path);
  return {
    emphasis: oneOf(item.emphasis, ["primary", "secondary", "auxiliary"], path + ".emphasis") as "primary" | "secondary" | "auxiliary",
    preferredPanel: oneOf(item.preferredPanel, ["overview", "detail", "process", "legend"], path + ".preferredPanel") as "overview" | "detail" | "process" | "legend",
    detailPolicy: oneOf(item.detailPolicy, ["summary", "expand", "inset"], path + ".detailPolicy") as "summary" | "expand" | "inset",
  };
}

function shapeValue(value: unknown, path: string): SymbolicShape {
  const item = record(value, path);
  exactKeys(item, ["axes", "dimensions"], path);
  const axes = idList(item.axes, path + ".axes", 16);
  const dimensions = array(item.dimensions, 16, path + ".dimensions").map((dimension, index) => {
    if (typeof dimension === "number" && Number.isFinite(dimension) && dimension > 0) return dimension;
    if (typeof dimension === "string" && dimension.trim().length > 0 && dimension.length <= 128) return dimension.trim();
    throw new Error(path + ".dimensions[" + index + "] is invalid");
  });
  if (axes.length !== dimensions.length) throw new Error(path + " axes and dimensions must have equal lengths");
  return { axes, dimensions };
}

function evidenceList(value: unknown, known: Set<string>, path: string, max: number, requireEvidence: boolean): string[] {
  const ids = idList(value, path, max);
  if (requireEvidence && ids.length === 0) throw new Error(path + " requires evidence");
  for (const id of ids) if (known.size > 0 && !known.has(id)) throw new Error(path + " references unknown evidence " + id);
  return ids;
}

function idList(value: unknown, path: string, max: number): string[] {
  const ids = array(value, max, path).map((item, index) => idValue(item, path + "[" + index + "]"));
  if (new Set(ids).size !== ids.length) throw new Error(path + " contains duplicate IDs");
  return [...ids].sort(compareCodeUnits);
}

function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(path + " must be an array with at most " + max + " items");
  return value;
}

function record(value: unknown, path: string): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(path + " must be a plain object");
  return value as AnyRecord;
}

function cloneRecord(value: unknown, message: string): AnyRecord {
  const item = record(value, message);
  try { return structuredClone(item); } catch { throw new Error(message); }
}

function exactKeys(value: AnyRecord, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY.test(key) || key.toLowerCase() === "visio" || key.toLowerCase().includes("visio_")) throw new Error("Forbidden renderer/geometry field " + path + "." + key);
    if (!allowed.includes(key)) throw new Error("Unknown field " + path + "." + key);
  }
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error("Missing field " + path + "." + key);
}

function idValue(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(path + " must be a stable identifier");
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) throw new Error(path + " must be a non-empty string");
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(path + " must be boolean");
  return value;
}

function confidenceValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(path + " must be a confidence in [0, 1]");
  return value;
}

function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(path + " has unsupported value");
  return value;
}

function uniqueById<T>(values: T[], key: keyof T, kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = String(value[key]);
    if (result.has(id)) throw new Error("Duplicate " + kind + " ID " + id);
    result.set(id, value);
  }
  return result;
}

function sortById<T>(values: T[], key: keyof T): T[] {
  return [...values].sort((left, right) => compareCodeUnits(String(left[key]), String(right[key])));
}

function eligibility(graph: SemanticArchitectureGraphInput): SemanticExportEligibility {
  if (graph.modules.some((module) => module.semanticType === "unknown_module")) return "blocked";
  if (graph.unresolved.some((item) => item.severity === "blocking")) return "blocked";
  if (graph.modules.some((module) => module.knowledge === "candidate") || graph.dataObjects.some((data) => data.knowledge === "candidate") || graph.relations.some((relation) => relation.knowledge === "candidate")) return "candidate";
  return "formal";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Semantic canonical JSON does not permit non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  const item = record(value, "Semantic canonical JSON");
  return Object.fromEntries(Object.keys(item).sort(compareCodeUnits).map((key) => [key, canonicalValue(item[key])]));
}

function canonicalSemanticArchitectureGraphJsonInternal(graph: SemanticArchitectureGraph): string {
  return JSON.stringify(canonicalValue(graph));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as AnyRecord)) deepFreeze(child);
  }
  return value;
}
