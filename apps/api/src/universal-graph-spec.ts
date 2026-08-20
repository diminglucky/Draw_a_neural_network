import { z } from "zod";
import { compareCodeUnits } from "./stable-string-order.js";

const MAX_NODES = 256;
const MAX_PORTS = 1_024;
const MAX_EDGES = 2_048;
const MAX_GROUPS = 128;
const MAX_EVIDENCE = 512;
const MAX_UNRESOLVED = 64;

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const labelSchema = z.string().trim().min(1).max(240);
const nullableLabelSchema = z.string().trim().min(1).max(240).nullable();
const evidenceIdListSchema = z.array(idSchema).max(64);
const structuralEvidenceIdListSchema = evidenceIdListSchema.min(1);
const attributeValueSchema = z.union([z.string().trim().max(240), z.number().finite(), z.boolean(), z.null()]);
const forbiddenAttributeTokens = new Set(["x", "y", "width", "height", "bounds", "coordinate", "coordinates", "geometry", "path", "command", "script", "execution", "visio", "svg", "xml", "renderer", "rendering", "worker", "browser", "com"]);
const forbiddenAttributeCompounds = new Set(["sourcebytes", "rawsource", "sourcecode"]);

export type UniversalNodeKind = "input" | "output" | "operator" | "custom_operator" | "custom_module" | "container" | "state";
export type UniversalPortDirection = "input" | "output";
export type UniversalEdgeRelation = "data" | "skip" | "merge" | "condition" | "feedback" | "candidate";
export type GraphKnowledge = "proven" | "declared" | "candidate";
export type UniversalPreviewEligibility = "renderable" | "candidate";
export type UniversalExportEligibility = "eligible" | "ineligible";

export interface UniversalNode {
  nodeId: string;
  kind: UniversalNodeKind;
  label: string;
  semanticHints: string[];
  inputPortIds: string[];
  outputPortIds: string[];
  attributes: Record<string, string | number | boolean | null>;
  shapeClaim: "proven" | "symbolic" | "unknown";
  operationKnowledge: "known" | "inferred" | "custom";
  evidenceIds: string[];
}

export interface UniversalPort {
  portId: string;
  nodeId: string;
  direction: UniversalPortDirection;
  label: string | null;
  representation: string | null;
  semanticType: string | null;
  evidenceIds: string[];
}

export interface UniversalEdge {
  edgeId: string;
  sourcePortId: string;
  targetPortId: string;
  relation: UniversalEdgeRelation;
  knowledge: GraphKnowledge;
  evidenceIds: string[];
}

export interface UniversalGroup {
  groupId: string;
  label: string;
  memberNodeIds: string[];
  evidenceIds: string[];
}

export interface UniversalEvidence {
  evidenceId: string;
  sourceId: string;
  sourceHash: string;
  locator: string;
  excerptDigest: string;
}

export interface UniversalUnresolved {
  id: string;
  scope: "operation" | "shape" | "topology";
  severity: "blocking" | "warning";
  evidenceIds: string[];
}

export interface UniversalGraphSpec {
  version: 1;
  graphId: string;
  revision: number;
  sourceIds: string[];
  sourceHashes: string[];
  nodes: UniversalNode[];
  ports: UniversalPort[];
  edges: UniversalEdge[];
  groups: UniversalGroup[];
  evidence: UniversalEvidence[];
  topologyConfidence: number;
  unresolved: UniversalUnresolved[];
}

export interface UniversalGraphSpecValidationIssue {
  code: string;
  message: string;
  path: string;
}

export interface UniversalGraphSpecValidationResult {
  valid: boolean;
  ugs: UniversalGraphSpec | null;
  issues: UniversalGraphSpecValidationIssue[];
}

const attributesSchema = z.record(attributeValueSchema).superRefine((value, context) => {
  const keys = Object.keys(value);
  if (keys.length > 32) context.addIssue({ code: z.ZodIssueCode.custom, message: "attributes may contain at most 32 values" });
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || isForbiddenAttributeKey(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `attribute "${key}" is not permitted` });
    }
  }
});

function isForbiddenAttributeKey(key: string): boolean {
  const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split("_").filter(Boolean).map((token) => token.toLowerCase());
  return tokens.some((token) => forbiddenAttributeTokens.has(token)) || forbiddenAttributeCompounds.has(tokens.join(""));
}

const nodeSchema = z.object({
  nodeId: idSchema,
  kind: z.enum(["input", "output", "operator", "custom_operator", "custom_module", "container", "state"]),
  label: labelSchema,
  semanticHints: z.array(labelSchema).max(32),
  inputPortIds: z.array(idSchema).max(32),
  outputPortIds: z.array(idSchema).max(32),
  attributes: attributesSchema.default({}),
  shapeClaim: z.enum(["proven", "symbolic", "unknown"]),
  operationKnowledge: z.enum(["known", "inferred", "custom"]),
  evidenceIds: structuralEvidenceIdListSchema,
}).strict();

const portSchema = z.object({
  portId: idSchema,
  nodeId: idSchema,
  direction: z.enum(["input", "output"]),
  label: nullableLabelSchema,
  representation: nullableLabelSchema,
  semanticType: nullableLabelSchema,
  evidenceIds: evidenceIdListSchema,
}).strict();

const edgeSchema = z.object({
  edgeId: idSchema,
  sourcePortId: idSchema,
  targetPortId: idSchema,
  relation: z.enum(["data", "skip", "merge", "condition", "feedback", "candidate"]),
  knowledge: z.enum(["proven", "declared", "candidate"]),
  evidenceIds: structuralEvidenceIdListSchema,
}).strict();

const groupSchema = z.object({
  groupId: idSchema,
  label: labelSchema,
  memberNodeIds: z.array(idSchema).min(1).max(MAX_NODES),
  evidenceIds: structuralEvidenceIdListSchema,
}).strict();

const evidenceSchema = z.object({
  evidenceId: idSchema,
  sourceId: idSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  locator: z.string().trim().min(1).max(240),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const unresolvedSchema = z.object({
  id: idSchema,
  scope: z.enum(["operation", "shape", "topology"]),
  severity: z.enum(["blocking", "warning"]),
  evidenceIds: structuralEvidenceIdListSchema,
}).strict();

const universalGraphSpecSchema = z.object({
  version: z.literal(1),
  graphId: idSchema,
  revision: z.number().int().positive(),
  sourceIds: z.array(idSchema).min(1).max(64),
  sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).min(1).max(64),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
  ports: z.array(portSchema).max(MAX_PORTS),
  edges: z.array(edgeSchema).max(MAX_EDGES),
  groups: z.array(groupSchema).max(MAX_GROUPS),
  evidence: z.array(evidenceSchema).max(MAX_EVIDENCE),
  topologyConfidence: z.number().finite().min(0).max(1),
  unresolved: z.array(unresolvedSchema).max(MAX_UNRESOLVED),
}).strict();

export function validateUniversalGraphSpec(input: unknown): UniversalGraphSpecValidationResult {
  const parsed = universalGraphSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      ugs: null,
      issues: parsed.error.issues.map((issue) => ({ code: `schema:${issue.code}`, message: issue.message, path: formatPath(issue.path) })),
    };
  }

  const ugs = parsed.data as UniversalGraphSpec;
  const issues: UniversalGraphSpecValidationIssue[] = [];
  unique(ugs.sourceIds, "source-id", "sourceIds", issues);
  unique(ugs.sourceHashes, "source-hash", "sourceHashes", issues);
  unique(ugs.nodes.map((node) => node.nodeId), "node", "nodes", issues);
  unique(ugs.ports.map((port) => port.portId), "port", "ports", issues);
  unique(ugs.edges.map((edge) => edge.edgeId), "edge", "edges", issues);
  unique(ugs.groups.map((group) => group.groupId), "group", "groups", issues);
  unique(ugs.evidence.map((item) => item.evidenceId), "evidence", "evidence", issues);
  unique(ugs.unresolved.map((item) => item.id), "unresolved", "unresolved", issues);

  const nodeById = new Map(ugs.nodes.map((node) => [node.nodeId, node]));
  const portById = new Map(ugs.ports.map((port) => [port.portId, port]));
  const evidenceIds = new Set(ugs.evidence.map((item) => item.evidenceId));
  const sourceIds = new Set(ugs.sourceIds);
  const sourceHashes = new Set(ugs.sourceHashes);

  for (const [index, evidence] of ugs.evidence.entries()) {
    if (!sourceIds.has(evidence.sourceId)) issue(issues, "unknown-evidence-source", `Evidence ${evidence.evidenceId} references an unknown source`, `evidence[${index}].sourceId`);
    if (!sourceHashes.has(evidence.sourceHash)) issue(issues, "unknown-evidence-hash", `Evidence ${evidence.evidenceId} references an unknown source hash`, `evidence[${index}].sourceHash`);
  }
  for (const [index, node] of ugs.nodes.entries()) {
    unique(node.inputPortIds, "node-input-port", `nodes[${index}].inputPortIds`, issues);
    unique(node.outputPortIds, "node-output-port", `nodes[${index}].outputPortIds`, issues);
    for (const portId of node.inputPortIds) assertPortOwnership(portById.get(portId), node.nodeId, "input", `nodes[${index}].inputPortIds`, issues);
    for (const portId of node.outputPortIds) assertPortOwnership(portById.get(portId), node.nodeId, "output", `nodes[${index}].outputPortIds`, issues);
    assertEvidence(node.evidenceIds, evidenceIds, `nodes[${index}].evidenceIds`, issues);
  }
  for (const [index, port] of ugs.ports.entries()) {
    const owner = nodeById.get(port.nodeId);
    if (!owner) issue(issues, "unknown-port-node", `Port ${port.portId} has an unknown owner`, `ports[${index}].nodeId`);
    else if (port.direction === "input" && !owner.inputPortIds.includes(port.portId)) issue(issues, "unowned-port", `Input port ${port.portId} is not declared by ${owner.nodeId}`, `ports[${index}].portId`);
    else if (port.direction === "output" && !owner.outputPortIds.includes(port.portId)) issue(issues, "unowned-port", `Output port ${port.portId} is not declared by ${owner.nodeId}`, `ports[${index}].portId`);
    assertEvidence(port.evidenceIds, evidenceIds, `ports[${index}].evidenceIds`, issues);
  }
  for (const [index, edge] of ugs.edges.entries()) {
    const source = portById.get(edge.sourcePortId);
    const target = portById.get(edge.targetPortId);
    if (!source || source.direction !== "output") issue(issues, "invalid-edge-source", `Edge ${edge.edgeId} must reference an output port`, `edges[${index}].sourcePortId`);
    if (!target || target.direction !== "input") issue(issues, "invalid-edge-target", `Edge ${edge.edgeId} must reference an input port`, `edges[${index}].targetPortId`);
    if (edge.relation === "candidate" && edge.knowledge !== "candidate") issue(issues, "candidate-knowledge", `Candidate edge ${edge.edgeId} must use candidate knowledge`, `edges[${index}].knowledge`);
    if (edge.relation !== "candidate" && edge.knowledge === "candidate") issue(issues, "candidate-relation", `Candidate knowledge edge ${edge.edgeId} must use candidate relation`, `edges[${index}].relation`);
    assertEvidence(edge.evidenceIds, evidenceIds, `edges[${index}].evidenceIds`, issues);
  }
  const cyclicEdgeIds = findNonFeedbackCycle(ugs, portById);
  for (const edgeId of cyclicEdgeIds) {
    const index = ugs.edges.findIndex((edge) => edge.edgeId === edgeId);
    issue(
      issues,
      "non-feedback-cycle",
      `Non-feedback topology cycle includes edge ${edgeId}; recurrence must use feedback edges or candidate topology`,
      `edges[${index}]`,
    );
  }
  for (const [index, group] of ugs.groups.entries()) {
    unique(group.memberNodeIds, "group-member", `groups[${index}].memberNodeIds`, issues);
    for (const nodeId of group.memberNodeIds) if (!nodeById.has(nodeId)) issue(issues, "unknown-group-node", `Group ${group.groupId} references an unknown node`, `groups[${index}].memberNodeIds`);
    assertEvidence(group.evidenceIds, evidenceIds, `groups[${index}].evidenceIds`, issues);
  }
  for (const [index, unresolved] of ugs.unresolved.entries()) assertEvidence(unresolved.evidenceIds, evidenceIds, `unresolved[${index}].evidenceIds`, issues);

  return { valid: issues.length === 0, ugs: issues.length === 0 ? ugs : null, issues };
}

export function parseUniversalGraphSpec(input: unknown): UniversalGraphSpec {
  const result = validateUniversalGraphSpec(input);
  if (result.valid && result.ugs) return result.ugs;
  throw new Error(`UniversalGraphSpec validation failed: ${result.issues.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
}

export function getUniversalGraphEligibility(ugs: UniversalGraphSpec): { preview: UniversalPreviewEligibility; export: UniversalExportEligibility } {
  const topologyCandidate = ugs.edges.some((edge) => edge.relation === "candidate" || edge.knowledge === "candidate")
    || ugs.unresolved.some((item) => item.scope === "topology" && item.severity === "blocking");
  return topologyCandidate ? { preview: "candidate", export: "ineligible" } : { preview: "renderable", export: "eligible" };
}

function unique(values: string[], kind: string, path: string, issues: UniversalGraphSpecValidationIssue[]): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) issue(issues, `duplicate-${kind}`, `Duplicate ${kind} ${value}`, `${path}[${index}]`);
    seen.add(value);
  }
}

function assertPortOwnership(port: UniversalPort | undefined, nodeId: string, direction: UniversalPortDirection, path: string, issues: UniversalGraphSpecValidationIssue[]): void {
  if (!port || port.nodeId !== nodeId || port.direction !== direction) {
    issue(issues, "invalid-port-ownership", `Node ${nodeId} does not own a ${direction} port declared at ${path}`, path);
  }
}

function assertEvidence(ids: string[], known: Set<string>, path: string, issues: UniversalGraphSpecValidationIssue[]): void {
  unique(ids, "evidence-reference", path, issues);
  for (const [index, id] of ids.entries()) if (!known.has(id)) issue(issues, "unknown-evidence", `Unknown evidence ${id}`, `${path}[${index}]`);
}

function findNonFeedbackCycle(ugs: UniversalGraphSpec, portById: Map<string, UniversalPort>): string[] {
  const adjacency = new Map<string, Array<{ edgeId: string; targetNodeId: string }>>();
  for (const edge of ugs.edges) {
    if (edge.relation === "candidate" || edge.knowledge === "candidate" || edge.relation === "feedback") continue;
    const sourceNodeId = portById.get(edge.sourcePortId)?.nodeId;
    const targetNodeId = portById.get(edge.targetPortId)?.nodeId;
    if (!sourceNodeId || !targetNodeId) continue;
    const outgoing = adjacency.get(sourceNodeId) ?? [];
    outgoing.push({ edgeId: edge.edgeId, targetNodeId });
    adjacency.set(sourceNodeId, outgoing);
  }
  for (const outgoing of adjacency.values()) outgoing.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId));

  const state = new Map<string, "visiting" | "visited">();
  const nodeStack: string[] = [];
  const edgeStack: string[] = [];
  const visit = (nodeId: string): string[] => {
    state.set(nodeId, "visiting");
    nodeStack.push(nodeId);
    for (const edge of adjacency.get(nodeId) ?? []) {
      if (state.get(edge.targetNodeId) === "visiting") {
        const cycleStart = nodeStack.indexOf(edge.targetNodeId);
        return [...edgeStack.slice(cycleStart), edge.edgeId];
      }
      if (!state.has(edge.targetNodeId)) {
        edgeStack.push(edge.edgeId);
        const cycle = visit(edge.targetNodeId);
        if (cycle.length > 0) return cycle;
        edgeStack.pop();
      }
    }
    nodeStack.pop();
    state.set(nodeId, "visited");
    return [];
  };

  for (const nodeId of [...ugs.nodes.map((node) => node.nodeId)].sort(compareCodeUnits)) {
    if (!state.has(nodeId)) {
      const cycle = visit(nodeId);
      if (cycle.length > 0) return cycle;
    }
  }
  return [];
}

function issue(issues: UniversalGraphSpecValidationIssue[], code: string, message: string, path: string): void {
  issues.push({ code, message, path });
}

function formatPath(path: PropertyKey[]): string {
  return path.length === 0 ? "$" : path.reduce<string>((value, part) => typeof part === "number" ? `${value}[${part}]` : value ? `${value}.${String(part)}` : String(part), "");
}
