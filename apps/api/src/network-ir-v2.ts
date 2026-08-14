import { z } from "zod";
import { ApiErrorCode, FoundationError } from "./domain.js";
import { parseEvidenceBundle, type EvidenceBundle, type ProposedUnresolved } from "./evidence-bundle.js";

type NodeOp = "input" | "output" | "conv2d" | "depthwise_conv2d" | "pool" | "upsample" | "add" | "concat" | "flatten" | "dense" | "embedding" | "classifier" | "attention" | "transformer_block";
type EdgeRelation = "data" | "residual" | "cross_attention" | "iteration";
type TensorRole = "input" | "activation" | "output" | "logits" | "state" | "unknown";

interface CanonicalFigure {
  id: string;
  title: string;
  description: string | null;
}

interface CanonicalTensor {
  id: string;
  name: string;
  shape: Array<number | string>;
  axes: string[];
  semanticRole: TensorRole;
  dtype: string | null;
  producerNodeId: string | null;
  consumerNodeIds: string[];
}

interface CanonicalNode {
  id: string;
  op: NodeOp;
  inputTensorIds: string[];
  outputTensorIds: string[];
  confidence: number | null;
  sourceEvidenceIds: string[];
  repeats: { count: number; unitNodeIds: string[] } | null;
}

interface CanonicalEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: EdgeRelation;
  tensorIds: string[];
  confidence: number | null;
  evidenceIds: string[];
}

interface CanonicalGroup {
  id: string;
  label: string;
  nodeIds: string[];
  confidence: number | null;
  sourceEvidenceIds: string[];
}

export interface CanonicalNetworkIR {
  version: 2;
  figure: CanonicalFigure;
  tensors: CanonicalTensor[];
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  groups: CanonicalGroup[];
  unresolved: ProposedUnresolved[];
}

export interface CanonicalNetworkIRValidationIssue {
  code: string;
  message: string;
  path: string;
}

export interface CanonicalNetworkIRValidationResult {
  valid: boolean;
  issues: CanonicalNetworkIRValidationIssue[];
  ir: CanonicalNetworkIR | null;
}

export interface CanonicalNetworkIRValidationOptions {
  renderReady?: boolean;
}

const idSchema = z.string().trim().min(1);
const nullableTextSchema = z.string().trim().min(1).nullable().optional().default(null);
const confidenceSchema = z.number().finite().min(0).max(1).nullable().optional().default(null);
const evidenceIdsSchema = z.array(idSchema).default([]);

const canonicalNetworkIRSchema = z.object({
  version: z.literal(2),
  figure: z.object({
    id: idSchema,
    title: z.string().trim().min(1),
    description: nullableTextSchema,
  }).strict(),
  tensors: z.array(z.object({
    id: idSchema,
    name: z.string().trim().min(1),
    shape: z.array(z.union([z.number().int(), z.string().trim().min(1)])).default([]),
    axes: z.array(idSchema).default([]),
    semanticRole: z.enum(["input", "activation", "output", "logits", "state", "unknown"]),
    dtype: nullableTextSchema,
    producerNodeId: nullableTextSchema,
    consumerNodeIds: z.array(idSchema).default([]),
  }).strict()).default([]),
  nodes: z.array(z.object({
    id: idSchema,
    op: z.enum(["input", "output", "conv2d", "depthwise_conv2d", "pool", "upsample", "add", "concat", "flatten", "dense", "embedding", "classifier", "attention", "transformer_block"]),
    inputTensorIds: z.array(idSchema).default([]),
    outputTensorIds: z.array(idSchema).default([]),
    confidence: confidenceSchema,
    sourceEvidenceIds: evidenceIdsSchema,
    repeats: z.object({ count: z.number().int().positive(), unitNodeIds: z.array(idSchema).min(1) }).strict().nullable().optional().default(null),
  }).strict()).min(1),
  edges: z.array(z.object({
    id: idSchema,
    sourceNodeId: idSchema,
    targetNodeId: idSchema,
    relation: z.enum(["data", "residual", "cross_attention", "iteration"]),
    tensorIds: z.array(idSchema).min(1),
    confidence: confidenceSchema,
    evidenceIds: evidenceIdsSchema,
  }).strict()).default([]),
  groups: z.array(z.object({
    id: idSchema,
    label: z.string().trim().min(1),
    nodeIds: z.array(idSchema).default([]),
    confidence: confidenceSchema,
    sourceEvidenceIds: evidenceIdsSchema,
  }).strict()).default([]),
  unresolved: z.array(z.object({
    id: idSchema,
    question: z.string().max(512),
    severity: z.enum(["blocking", "warning"]),
    candidateValues: z.array(z.string().max(256)).max(8),
    evidenceIds: evidenceIdsSchema,
  }).strict()).default([]),
}).strict();

export function validateCanonicalNetworkIR(input: unknown, evidence?: EvidenceBundle, options?: CanonicalNetworkIRValidationOptions): CanonicalNetworkIRValidationResult {
  const parsed = canonicalNetworkIRSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: `schema:${issue.code}`,
        message: issue.message,
        path: formatPath(issue.path),
      })),
      ir: null,
    };
  }

  const issues = validateSemantics(parsed.data as CanonicalNetworkIR, evidence);
  if (options?.renderReady) {
    for (const [index, unresolved] of parsed.data.unresolved.entries()) {
      if (unresolved.severity === "blocking") {
        issues.push(issue("blocking-unresolved", `Blocking unresolved entry "${unresolved.id}" must be resolved before rendering`, `unresolved[${index}]`));
      }
    }
  }
  return { valid: issues.length === 0, issues, ir: parsed.data as CanonicalNetworkIR };
}

export function parseCanonicalNetworkIR(input: unknown, evidence?: EvidenceBundle, options?: CanonicalNetworkIRValidationOptions): CanonicalNetworkIR {
  const result = validateCanonicalNetworkIR(input, evidence, options);
  if (!result.valid || !result.ir) {
    throw new FoundationError(
      ApiErrorCode.VALIDATION_FAILED,
      buildValidationMessage(result.issues),
      400,
      { issues: result.issues },
    );
  }

  return result.ir;
}

function validateSemantics(ir: CanonicalNetworkIR, evidence?: EvidenceBundle): CanonicalNetworkIRValidationIssue[] {
  const issues: CanonicalNetworkIRValidationIssue[] = [];
  uniqueIdIndices(ir.nodes, "nodes", issues);
  const tensorIndices = uniqueIdIndices(ir.tensors, "tensors", issues);
  uniqueIdIndices(ir.edges, "edges", issues);
  uniqueIdIndices(ir.groups, "groups", issues);
  uniqueIdIndices(ir.unresolved, "unresolved", issues);

  const tensorById = new Map(ir.tensors.map((tensor) => [tensor.id, tensor]));
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const groupMembership = new Set(ir.groups.flatMap((group) => group.nodeIds));

  // 1. Tensor references in every node and edge.
  for (const [index, node] of ir.nodes.entries()) {
    validateTensorReferences(node.inputTensorIds, tensorById, `nodes[${index}].inputTensorIds`, issues);
    validateTensorReferences(node.outputTensorIds, tensorById, `nodes[${index}].outputTensorIds`, issues);
  }
  for (const [index, edge] of ir.edges.entries()) {
    validateTensorReferences(edge.tensorIds, tensorById, `edges[${index}].tensorIds`, issues);
  }

  // 2. Node input/output tensor producer and consumer consistency.
  for (const [index, tensor] of ir.tensors.entries()) {
    if (tensor.axes.length !== tensor.shape.length) {
      issues.push(issue("invalid-tensor-axes", "Tensor axes must align with its shape rank", `tensors[${index}].axes`));
    }
    if (tensor.producerNodeId && !nodeById.has(tensor.producerNodeId)) {
      issues.push(issue("missing-node-reference", `Tensor producer "${tensor.producerNodeId}" does not reference a known node`, `tensors[${index}].producerNodeId`));
    }
    for (const [consumerIndex, consumerId] of tensor.consumerNodeIds.entries()) {
      if (!nodeById.has(consumerId)) {
        issues.push(issue("missing-node-reference", `Tensor consumer "${consumerId}" does not reference a known node`, `tensors[${index}].consumerNodeIds[${consumerIndex}]`));
      }
    }
  }

  for (const [index, node] of ir.nodes.entries()) {
    for (const tensorId of node.inputTensorIds) {
      const tensor = tensorById.get(tensorId);
      if (tensor && !tensor.consumerNodeIds.includes(node.id)) {
        issues.push(issue("tensor-consumer-mismatch", `Tensor "${tensorId}" must list node "${node.id}" as a consumer`, `tensors[${tensorIndices.get(tensorId)}].consumerNodeIds`));
      }
    }
    for (const tensorId of node.outputTensorIds) {
      const tensor = tensorById.get(tensorId);
      if (tensor && tensor.producerNodeId !== node.id) {
        issues.push(issue("tensor-producer-mismatch", `Tensor "${tensorId}" must name node "${node.id}" as its producer`, `tensors[${tensorIndices.get(tensorId)}].producerNodeId`));
      }
    }

  }

  for (const [index, tensor] of ir.tensors.entries()) {
    if (tensor.producerNodeId && !nodeById.get(tensor.producerNodeId)?.outputTensorIds.includes(tensor.id)) {
      issues.push(issue("tensor-producer-mismatch", `Producer node "${tensor.producerNodeId}" must output tensor "${tensor.id}"`, `tensors[${index}].producerNodeId`));
    }
    for (const consumerId of tensor.consumerNodeIds) {
      if (!nodeById.get(consumerId)?.inputTensorIds.includes(tensor.id)) {
        issues.push(issue("tensor-consumer-mismatch", `Consumer node "${consumerId}" must input tensor "${tensor.id}"`, `tensors[${index}].consumerNodeIds`));
      }
    }
  }

  for (const [index, edge] of ir.edges.entries()) {
    for (const tensorId of edge.tensorIds) {
      const tensor = tensorById.get(tensorId);
      if (tensor && (tensor.producerNodeId !== edge.sourceNodeId || !tensor.consumerNodeIds.includes(edge.targetNodeId))) {
        issues.push(issue("edge-tensor-mismatch", `Edge tensor "${tensorId}" must be produced by its source and consumed by its target`, `edges[${index}].tensorIds`));
      }
    }
  }

  // 3. Edge endpoints and self-loops.
  const adjacency = new Map<string, Set<string>>();
  for (const [index, edge] of ir.edges.entries()) {
    if (!nodeById.has(edge.sourceNodeId)) issues.push(issue("missing-edge-endpoint", `Edge source "${edge.sourceNodeId}" does not reference a known node`, `edges[${index}].sourceNodeId`));
    if (!nodeById.has(edge.targetNodeId)) issues.push(issue("missing-edge-endpoint", `Edge target "${edge.targetNodeId}" does not reference a known node`, `edges[${index}].targetNodeId`));
    if (edge.sourceNodeId === edge.targetNodeId && edge.relation !== "iteration") issues.push(issue("illegal-self-loop", `Edge ${edge.sourceNodeId} → ${edge.targetNodeId} cannot form a self-loop`, `edges[${index}]`));
    if (edge.relation !== "iteration" && nodeById.has(edge.sourceNodeId) && nodeById.has(edge.targetNodeId)) {
      const outgoing = adjacency.get(edge.sourceNodeId) ?? new Set<string>();
      outgoing.add(edge.targetNodeId);
      adjacency.set(edge.sourceNodeId, outgoing);
    }
  }

  // 4. Input-to-output reachability across non-iteration edges.
  const reachable = findReachable(ir.nodes.filter((node) => node.op === "input").map((node) => node.id), adjacency);
  for (const [index, node] of ir.nodes.entries()) {
    if (node.op === "output" && !reachable.has(node.id)) issues.push(issue("unreachable-output", `Output node "${node.id}" is not reachable from any input node`, `nodes[${index}]`));
  }

  // 5. Merge inputs must be distinct and have arity at least two.
  for (const [index, node] of ir.nodes.entries()) {
    if (node.op !== "add" && node.op !== "concat") continue;
    if (new Set(node.inputTensorIds).size !== node.inputTensorIds.length) {
      issues.push(issue("duplicate-merge-input-tensor", `${node.op} nodes cannot repeat an input tensor`, `nodes[${index}].inputTensorIds`));
    }
    if (node.inputTensorIds.length < 2) issues.push(issue("invalid-merge-arity", `${node.op} nodes require at least two input tensors`, `nodes[${index}].inputTensorIds`));
  }

  // 6. Repeats must identify known nodes inside a group.
  for (const [index, node] of ir.nodes.entries()) {
    if (!node.repeats || node.repeats.count <= 1) continue;
    for (const [unitIndex, unitNodeId] of node.repeats.unitNodeIds.entries()) {
      if (!nodeById.has(unitNodeId) || !groupMembership.has(unitNodeId)) {
        issues.push(issue("invalid-repeat-unit", "Repeated units must reference known nodes in a group", `nodes[${index}].repeats.unitNodeIds[${unitIndex}]`));
      }
    }
  }

  // 7. Confidence is schema-bounded; key nodes and relations need evidence.
  for (const [index, node] of ir.nodes.entries()) {
    if (requiresNodeEvidence(node.op) && node.sourceEvidenceIds.length === 0) issues.push(issue("missing-key-evidence", `${node.op} node requires source evidence`, `nodes[${index}].sourceEvidenceIds`));
  }
  for (const [index, edge] of ir.edges.entries()) {
    if (requiresEdgeEvidence(edge.relation) && edge.evidenceIds.length === 0) issues.push(issue("missing-key-evidence", `${edge.relation} relation requires evidence`, `edges[${index}].evidenceIds`));
  }

  if (evidence) {
    let evidenceIds: Set<string>;
    try {
      evidenceIds = new Set(parseEvidenceBundle(evidence).facts.map((fact) => fact.id));
    } catch (error) {
      return [...issues, issue("invalid-evidence-bundle", error instanceof Error ? error.message : "EvidenceBundle is invalid", "evidence")];
    }
    for (const [path, ids] of evidenceReferences(ir)) {
      for (const evidenceId of ids) {
        if (!evidenceIds.has(evidenceId)) issues.push(issue("unknown-evidence-id", `Evidence id "${evidenceId}" does not reference a known fact`, path));
      }
    }
  }

  return issues;
}

function uniqueIdIndices(items: Array<{ id: string }>, collection: string, issues: CanonicalNetworkIRValidationIssue[]): Map<string, number> {
  const indices = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const singular = collection === "unresolved" ? "unresolved" : collection.slice(0, -1);
    if (indices.has(item.id)) issues.push(issue(`duplicate-${singular}-id`, `Duplicate ${singular} id "${item.id}" is not allowed`, `${collection}[${index}].id`));
    else indices.set(item.id, index);
  }
  return indices;
}

function validateTensorReferences(ids: string[], tensorById: Map<string, CanonicalTensor>, path: string, issues: CanonicalNetworkIRValidationIssue[]): void {
  for (const [index, id] of ids.entries()) {
    if (!tensorById.has(id)) issues.push(issue("missing-tensor-reference", `Tensor "${id}" does not reference a known tensor`, `${path}[${index}]`));
  }
}

function findReachable(inputs: string[], adjacency: Map<string, Set<string>>): Set<string> {
  const reachable = new Set<string>();
  const pending = [...inputs];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) if (!reachable.has(next)) pending.push(next);
  }
  return reachable;
}

function evidenceReferences(ir: CanonicalNetworkIR): Array<[string, string[]]> {
  return [
    ...ir.nodes.map((node, index) => [`nodes[${index}].sourceEvidenceIds`, node.sourceEvidenceIds] as [string, string[]]),
    ...ir.edges.map((edge, index) => [`edges[${index}].evidenceIds`, edge.evidenceIds] as [string, string[]]),
    ...ir.groups.map((group, index) => [`groups[${index}].sourceEvidenceIds`, group.sourceEvidenceIds] as [string, string[]]),
    ...ir.unresolved.map((unresolved, index) => [`unresolved[${index}].evidenceIds`, unresolved.evidenceIds] as [string, string[]]),
  ];
}

function requiresNodeEvidence(op: NodeOp): boolean {
  return op === "input" || op === "output" || op === "add" || op === "concat";
}

function requiresEdgeEvidence(relation: EdgeRelation): boolean {
  return relation === "residual" || relation === "cross_attention";
}

function issue(code: string, message: string, path: string): CanonicalNetworkIRValidationIssue {
  return { code, message, path };
}

function buildValidationMessage(issues: CanonicalNetworkIRValidationIssue[]): string {
  if (issues.length === 0) return "Canonical Network IR validation failed";
  const [firstIssue] = issues;
  return `Canonical Network IR validation failed: ${firstIssue.message} (${firstIssue.path})`;
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((accumulator, segment) => typeof segment === "number" ? `${accumulator}[${segment}]` : accumulator ? `${accumulator}.${segment}` : segment, "");
}
