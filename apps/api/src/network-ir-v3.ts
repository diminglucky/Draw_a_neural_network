import { z } from "zod";
import type {
  AxisRole,
  EvidenceGraph,
  EvidenceRef,
  OperatorKind,
  PortSemanticType,
  ProcessSemantic,
  TensorRepresentation,
  TensorShape,
} from "./evidence-graph.js";

export interface PortRef { nodeId: string; portId: string; }
export interface RepeatSemantic { count: number | "unknown"; unitNodeIds: string[]; expansionPolicy: "collapsed" | "first_and_last" | "fully_expanded"; }
export interface UnresolvedQuestion { id: string; severity: "blocking" | "warning"; conflictKey: string; candidateValues: string[]; evidenceFactIds: string[]; dependencyQuestionIds: string[]; }
export interface ShapeCompatibility { status: "proven" | "incompatible" | "unknown"; comparedAxes: AxisRole[]; reason: string; evidenceFactIds: string[]; }
export interface ArchitectureModule { id: string; label: string; parentModuleId: string | null; memberNodeIds: string[]; interfacePortIds: string[]; collapsedByDefault: boolean; evidenceIds: string[]; }
export interface TypedPort { id: string; representation: TensorRepresentation; shape?: TensorShape; semanticType: PortSemanticType; }
export interface ArchitectureNode { id: string; kind: Exclude<OperatorKind, "merge" | "attention">; semanticRole: string; inputPorts: TypedPort[]; outputPorts: TypedPort[]; repeat?: RepeatSemantic; evidenceIds: string[]; }
export interface MergeNode extends Omit<ArchitectureNode, "kind"> { kind: "merge"; mergeKind: "add" | "concat" | "gated_sum"; concatAxis: AxisRole | null; inputCompatibility: ShapeCompatibility[]; }
export interface AttentionNode extends Omit<ArchitectureNode, "kind"> { kind: "attention"; attentionKind: "self" | "cross"; }
export type ArchitectureIRNode = ArchitectureNode | MergeNode | AttentionNode;
export interface ArchitectureEdge { id: string; source: PortRef; target: PortRef; transport: "data" | "condition" | "feedback"; evidenceIds: string[]; }
export interface ArchitectureIRv3 { version: 3; graphId: string; inputs: PortRef[]; outputs: PortRef[]; modules: ArchitectureModule[]; nodes: ArchitectureIRNode[]; edges: ArchitectureEdge[]; processes: ProcessSemantic[]; evidenceIndex: Record<string, EvidenceRef[]>; unresolved: UnresolvedQuestion[]; }
export interface ArchitectureIRv3ValidationIssue { code: string; message: string; path: string; }
export interface ArchitectureIRv3ValidationResult { valid: boolean; ir?: ArchitectureIRv3; issues: ArchitectureIRv3ValidationIssue[]; }
export interface ArchitectureIRv3ValidationOptions { renderReady?: boolean; }

const id = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const semanticLabel = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:/ -]*$/);
const axisRole = z.enum(["B", "C", "H", "W", "D", "T", "N", "F", "unknown"]);
const tensorRepresentation = z.enum(["spatial_feature_map", "vector", "token_sequence", "query_sequence", "node_feature", "coordinate", "state", "scalar_distribution"]);
const portSemanticType = z.enum(["data", "query", "key", "value", "mask", "skip", "condition", "prediction", "state"]);
const operatorKind = z.enum(["input", "output", "module", "operator", "merge", "split", "attention", "repeat", "process", "adapter"]);
const shapeExpressionSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.object({ kind: z.literal("known"), value: z.number().finite().positive() }).strict(),
  z.object({ kind: z.literal("symbol"), name: id }).strict(),
  z.object({ kind: z.literal("derived"), operator: z.enum(["add", "subtract", "multiply", "divide", "ceil_div"]), operands: z.array(shapeExpressionSchema).min(1).max(8) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]));
const tensorShapeSchema = z.object({ axes: z.array(axisRole).min(1).max(8), dimensions: z.array(shapeExpressionSchema).min(1).max(8), batchSemantics: z.enum(["independent", "broadcastable", "unknown"]) }).strict().superRefine((shape, context) => {
  if (shape.axes.length !== shape.dimensions.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "shape axes and dimensions must have the same length", path: ["dimensions"] });
  if (new Set(shape.axes).size !== shape.axes.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "shape axes must be unique", path: ["axes"] });
});
const typedPortSchema = z.object({ id, representation: tensorRepresentation, shape: tensorShapeSchema.optional(), semanticType: portSemanticType }).strict();
const portRefSchema = z.object({ nodeId: id, portId: id }).strict();
const repeatSchema = z.object({ count: z.union([z.number().int().positive().max(1_000_000), z.literal("unknown")]), unitNodeIds: z.array(id).min(1).max(128), expansionPolicy: z.enum(["collapsed", "first_and_last", "fully_expanded"]) }).strict();
const shapeCompatibilitySchema = z.object({ status: z.enum(["proven", "incompatible", "unknown"]), comparedAxes: z.array(axisRole).min(1).max(8), reason: semanticLabel, evidenceFactIds: z.array(id).max(32) }).strict();
const nodeSchema = z.object({
  id,
  kind: operatorKind,
  semanticRole: semanticLabel,
  inputPorts: z.array(typedPortSchema).max(32),
  outputPorts: z.array(typedPortSchema).max(32),
  repeat: repeatSchema.optional(),
  evidenceIds: z.array(id).max(64),
  mergeKind: z.enum(["add", "concat", "gated_sum"]).optional(),
  concatAxis: axisRole.nullable().optional(),
  inputCompatibility: z.array(shapeCompatibilitySchema).max(32).optional(),
  attentionKind: z.enum(["self", "cross"]).optional(),
}).strict();
const moduleSchema = z.object({ id, label: semanticLabel, parentModuleId: id.nullable(), memberNodeIds: z.array(id).max(256), interfacePortIds: z.array(id).max(128), collapsedByDefault: z.boolean(), evidenceIds: z.array(id).max(64) }).strict();
const edgeSchema = z.object({ id, source: portRefSchema, target: portRefSchema, transport: z.enum(["data", "condition", "feedback"]), evidenceIds: z.array(id).max(64) }).strict();
const processSchema = z.object({
  id,
  kind: z.enum(["iterative", "recurrent", "refinement", "sampling"]),
  bodyNodeIds: z.array(id).min(1).max(128),
  stateInputPortIds: z.array(id).max(32),
  stateOutputPortIds: z.array(id).max(32),
  iterationCount: z.union([z.number().int().positive().max(1_000_000), z.literal("unknown")]),
  termination: z.enum(["fixed_count", "convergence", "external_schedule", "unknown"]),
}).strict();
const unresolvedSchema = z.object({ id, severity: z.enum(["blocking", "warning"]), conflictKey: semanticLabel, candidateValues: z.array(semanticLabel).max(8), evidenceFactIds: z.array(id).max(64), dependencyQuestionIds: z.array(id).max(16) }).strict();
const evidenceRefSchema = z.object({
  sourceId: id,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  locator: z.unknown(),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const irSchema = z.object({
  version: z.literal(3), graphId: id, inputs: z.array(portRefSchema).min(1).max(64), outputs: z.array(portRefSchema).min(1).max(64),
  modules: z.array(moduleSchema).max(128), nodes: z.array(nodeSchema).min(1).max(512), edges: z.array(edgeSchema).max(2048), processes: z.array(processSchema).max(64),
  evidenceIndex: z.record(z.array(evidenceRefSchema).max(32)), unresolved: z.array(unresolvedSchema).max(64),
}).strict();

export function validateArchitectureIRv3(value: unknown, evidence?: EvidenceGraph, options: ArchitectureIRv3ValidationOptions = {}): ArchitectureIRv3ValidationResult {
  const parsed = irSchema.safeParse(value);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => ({ code: `schema:${issue.code}`, message: issue.message, path: formatPath(issue.path) })) };
  const ir = parsed.data as ArchitectureIRv3;
  const issues: ArchitectureIRv3ValidationIssue[] = [];
  const add = (code: string, message: string, path: string) => issues.push({ code, message, path });
  const nodeById = uniqueIndex(ir.nodes, (node) => node.id, "nodes", add);
  const moduleById = uniqueIndex(ir.modules, (module) => module.id, "modules", add);
  const edgeIds = new Set<string>();
  const evidenceIds = evidence ? new Set(evidence.facts.map((fact) => fact.id)) : null;

  const inputPortByNode = new Map<string, Set<string>>();
  const outputPortByNode = new Map<string, Set<string>>();
  for (const [index, node] of ir.nodes.entries()) {
    inputPortByNode.set(node.id, collectUniquePortIds(node.inputPorts, `nodes[${index}].inputPorts`, add));
    outputPortByNode.set(node.id, collectUniquePortIds(node.outputPorts, `nodes[${index}].outputPorts`, add));
    checkNodeSemantics(node, index, options, add);
    checkEvidenceIds(node.evidenceIds, evidenceIds, `nodes[${index}].evidenceIds`, add);
  }

  const membership = new Map<string, string>();
  for (const [index, module] of ir.modules.entries()) {
    if (module.parentModuleId && !moduleById.has(module.parentModuleId)) add("missing-parent-module", `Module ${module.id} has an unknown parent`, `modules[${index}].parentModuleId`);
    if (module.parentModuleId === module.id) add("module-self-parent", `Module ${module.id} cannot parent itself`, `modules[${index}].parentModuleId`);
    for (const nodeId of module.memberNodeIds) {
      if (!nodeById.has(nodeId)) add("unknown-module-member", `Module ${module.id} references unknown node ${nodeId}`, `modules[${index}].memberNodeIds`);
      const prior = membership.get(nodeId);
      if (prior && prior !== module.id) add("multiple-module-membership", `Node ${nodeId} belongs to both ${prior} and ${module.id}`, `modules[${index}].memberNodeIds`);
      membership.set(nodeId, module.id);
    }
    checkEvidenceIds(module.evidenceIds, evidenceIds, `modules[${index}].evidenceIds`, add);
  }

  const adjacency = new Map<string, Set<string>>();
  const feedbackEndpoints = new Set<string>();
  for (const [index, edge] of ir.edges.entries()) {
    if (edgeIds.has(edge.id)) add("duplicate-edge-id", `Edge ID ${edge.id} must be unique`, `edges[${index}].id`);
    edgeIds.add(edge.id);
    const source = nodeById.get(edge.source.nodeId);
    const target = nodeById.get(edge.target.nodeId);
    if (!source) add("missing-source-node", `Unknown source node ${edge.source.nodeId}`, `edges[${index}].source.nodeId`);
    if (!target) add("missing-target-node", `Unknown target node ${edge.target.nodeId}`, `edges[${index}].target.nodeId`);
    if (source && !outputPortByNode.get(source.id)?.has(edge.source.portId)) add("missing-source-port", `Unknown source port ${edge.source.portId}`, `edges[${index}].source.portId`);
    if (target && !inputPortByNode.get(target.id)?.has(edge.target.portId)) add("missing-target-port", `Unknown target port ${edge.target.portId}`, `edges[${index}].target.portId`);
    checkEvidenceIds(edge.evidenceIds, evidenceIds, `edges[${index}].evidenceIds`, add);
    if (edge.transport === "feedback") {
      feedbackEndpoints.add(`${edge.source.nodeId}:${edge.source.portId}>${edge.target.nodeId}:${edge.target.portId}`);
    } else if (source && target) {
      const outgoing = adjacency.get(source.id) ?? new Set<string>();
      outgoing.add(target.id);
      adjacency.set(source.id, outgoing);
    }
  }

  for (const [index, ref] of ir.inputs.entries()) checkPortRef(ref, nodeById, outputPortByNode, "input", `inputs[${index}]`, add);
  for (const [index, ref] of ir.outputs.entries()) checkPortRef(ref, nodeById, outputPortByNode, "output", `outputs[${index}]`, add);
  checkReachability(ir, adjacency, add);

  const processedFeedback = new Set<string>();
  for (const [index, process] of ir.processes.entries()) {
    const body = new Set(process.bodyNodeIds);
    for (const nodeId of body) if (!nodeById.has(nodeId)) add("unknown-process-node", `Process ${process.id} references unknown node ${nodeId}`, `processes[${index}].bodyNodeIds`);
    for (const edge of ir.edges) {
      const key = `${edge.source.nodeId}:${edge.source.portId}>${edge.target.nodeId}:${edge.target.portId}`;
      if (edge.transport === "feedback" && body.has(edge.source.nodeId) && body.has(edge.target.nodeId)) processedFeedback.add(key);
    }
  }
  for (const [index, edge] of ir.edges.entries()) {
    const key = `${edge.source.nodeId}:${edge.source.portId}>${edge.target.nodeId}:${edge.target.portId}`;
    if (edge.transport === "feedback" && !processedFeedback.has(key)) add("unowned-feedback", "Feedback edge must belong to an explicit process", `edges[${index}]`);
  }

  for (const [index, unresolved] of ir.unresolved.entries()) {
    if (unresolved.severity === "blocking" && options.renderReady) add("blocking-unresolved", "Render-ready IR cannot contain a blocking unresolved question", `unresolved[${index}]`);
    checkEvidenceIds(unresolved.evidenceFactIds, evidenceIds, `unresolved[${index}].evidenceFactIds`, add);
  }
  return issues.length ? { valid: false, issues } : { valid: true, ir, issues };
}

export function parseArchitectureIRv3(value: unknown, evidence?: EvidenceGraph, options?: ArchitectureIRv3ValidationOptions): ArchitectureIRv3 {
  const result = validateArchitectureIRv3(value, evidence, options);
  if (result.valid && result.ir) return result.ir;
  throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
}

function checkNodeSemantics(node: ArchitectureIRNode, index: number, options: ArchitectureIRv3ValidationOptions, add: (code: string, message: string, path: string) => void): void {
  const path = `nodes[${index}]`;
  if (node.kind === "merge") {
    if (!node.mergeKind || !node.inputCompatibility) {
      add("merge-semantics", "Merge node requires merge kind and input compatibility", path);
      return;
    }
    const dataInputs = node.inputPorts.filter((port) => port.semanticType === "data");
    if (dataInputs.length < 2) add("merge-arity", "Merge node requires at least two typed data inputs", `${path}.inputPorts`);
    if (node.outputPorts.length < 1) add("merge-output", "Merge node requires an output port", `${path}.outputPorts`);
    if (node.mergeKind === "concat" && node.concatAxis == null) add("concat-axis", "Concat merge requires concatAxis", `${path}.concatAxis`);
    if (node.mergeKind !== "concat" && node.concatAxis != null) add("unexpected-concat-axis", "Only concat merge may set concatAxis", `${path}.concatAxis`);
    if (node.inputCompatibility.length !== Math.max(0, dataInputs.length - 1)) add("merge-shape-constraints", "Merge must declare compatibility for each additional data input", `${path}.inputCompatibility`);
    for (const [compatibilityIndex, compatibility] of (node.inputCompatibility ?? []).entries()) {
      if (compatibility.status === "incompatible") add("shape-incompatible", "Merge input shapes are incompatible", `${path}.inputCompatibility[${compatibilityIndex}]`);
      if (compatibility.status === "unknown" && options.renderReady) add("shape-compatibility-unknown", "Critical merge shape compatibility is unknown", `${path}.inputCompatibility[${compatibilityIndex}]`);
    }
  } else if ((node as { mergeKind?: unknown; concatAxis?: unknown; inputCompatibility?: unknown }).mergeKind || (node as { concatAxis?: unknown }).concatAxis !== undefined || (node as { inputCompatibility?: unknown }).inputCompatibility) {
    add("unexpected-merge-semantics", "Only merge nodes may define merge fields", path);
  }
  if (node.kind === "attention") {
    if (!node.attentionKind) add("attention-semantics", "Attention node requires attentionKind", path);
    const roles = new Set(node.inputPorts.map((port) => port.semanticType));
    if (!roles.has("query") || !roles.has("key") || !roles.has("value")) add("attention-qkv", "Attention node requires typed query, key, and value input ports", `${path}.inputPorts`);
  } else if ((node as { attentionKind?: unknown }).attentionKind) {
    add("unexpected-attention-semantics", "Only attention nodes may define attentionKind", path);
  }
}

function checkPortRef(ref: PortRef, nodes: Map<string, ArchitectureIRNode>, outputPorts: Map<string, Set<string>>, role: string, path: string, add: (code: string, message: string, path: string) => void): void {
  if (!nodes.has(ref.nodeId)) add(`missing-${role}-node`, `Unknown ${role} node ${ref.nodeId}`, `${path}.nodeId`);
  else if (!outputPorts.get(ref.nodeId)?.has(ref.portId)) add(`missing-${role}-port`, `Unknown ${role} port ${ref.portId}`, `${path}.portId`);
}

function checkReachability(ir: ArchitectureIRv3, adjacency: Map<string, Set<string>>, add: (code: string, message: string, path: string) => void): void {
  const roots = ir.inputs.map((input) => input.nodeId);
  const visited = new Set(roots);
  const pending = [...roots];
  while (pending.length) {
    const nodeId = pending.shift();
    if (!nodeId) continue;
    for (const target of adjacency.get(nodeId) ?? []) if (!visited.has(target)) { visited.add(target); pending.push(target); }
  }
  const hasBlockingCandidate = ir.unresolved.some((unresolved) => unresolved.severity === "blocking");
  if (hasBlockingCandidate) return;
  for (const [index, output] of ir.outputs.entries()) if (!visited.has(output.nodeId)) add("unreachable-output", `Output node ${output.nodeId} is not reachable from an input`, `outputs[${index}]`);
}

function checkEvidenceIds(ids: string[], known: Set<string> | null, path: string, add: (code: string, message: string, path: string) => void): void {
  if (new Set(ids).size !== ids.length) add("duplicate-evidence-id", "Evidence IDs must be unique", path);
  if (known) for (const [index, evidenceId] of ids.entries()) if (!known.has(evidenceId)) add("unknown-evidence-id", `Unknown evidence fact ${evidenceId}`, `${path}[${index}]`);
}

function collectUniquePortIds(ports: TypedPort[], path: string, add: (code: string, message: string, path: string) => void): Set<string> {
  const ids = new Set<string>();
  for (const [index, port] of ports.entries()) {
    if (ids.has(port.id)) add("duplicate-port-id", `Port ID ${port.id} must be unique on its node`, `${path}[${index}].id`);
    ids.add(port.id);
  }
  return ids;
}

function uniqueIndex<T extends { id: string }>(values: T[], key: (value: T) => string, path: string, add: (code: string, message: string, path: string) => void): Map<string, T> {
  const result = new Map<string, T>();
  for (const [index, value] of values.entries()) {
    const valueKey = key(value);
    if (result.has(valueKey)) add(`duplicate-${path.slice(0, -1)}-id`, `${path} ID ${valueKey} must be unique`, `${path}[${index}].id`);
    result.set(valueKey, value);
  }
  return result;
}

function formatPath(path: PropertyKey[]): string {
  return path.map((segment) => typeof segment === "number" ? `[${segment}]` : segment).join(".").replace(/^\./, "");
}
