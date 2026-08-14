import { z } from "zod";
import { parseEvidenceBundle, type EvidenceBundle, type EvidenceKind } from "./evidence-bundle.js";
import { validateCanonicalNetworkIR, type CanonicalNetworkIR } from "./network-ir-v2.js";

const nodeOpByV1Kind = {
  input: "input",
  output: "output",
  conv: "conv2d",
  "depthwise-conv": "depthwise_conv2d",
  pool: "pool",
  upsample: "upsample",
  add: "add",
  concat: "concat",
  flatten: "flatten",
  dense: "dense",
  classifier: "classifier",
  attention: "attention",
  "transformer-block": "transformer_block",
} as const;

type LegacyNodeKind = keyof typeof nodeOpByV1Kind;
type LegacyStructuralNetworkIR = z.infer<typeof legacyStructuralNetworkIRSchema>;

export interface LegacyNetworkIRAdaptationWarning {
  code: "legacy-skip-not-residual";
  message: string;
  path: string;
}

export interface NetworkIRv1Adaptation {
  canonical: CanonicalNetworkIR;
  evidenceBundle: EvidenceBundle;
  warnings: LegacyNetworkIRAdaptationWarning[];
}

const idSchema = z.string().trim().min(1).max(64);
const nullableTextSchema = z.string().trim().min(1).max(512).nullable().optional().default(null);
const confidenceSchema = z.number().finite().min(0).max(1).nullable().optional().default(null);
const evidenceKindSchema = z.enum(["text", "code", "model", "image"]);
const sourceEvidenceSchema = z.object({
  type: evidenceKindSchema,
  value: z.string().trim().min(1).max(256),
  locator: z.string().max(256).nullable().optional().default(null),
  excerpt: z.string().max(512).nullable().optional().default(null),
}).strip();

// Unknown legacy properties are stripped intentionally. This parser selects structural data only.
const legacyStructuralNetworkIRSchema = z.object({
  figure: z.object({
    id: idSchema,
    title: z.string().trim().min(1).max(256),
    description: nullableTextSchema,
  }).strip(),
  nodes: z.array(z.object({
    id: idSchema,
    kind: z.enum(["input", "output", "conv", "depthwise-conv", "pool", "upsample", "add", "concat", "flatten", "dense", "classifier", "attention", "transformer-block"]),
    label: z.string().trim().min(1).max(256),
    stage: z.number().int().nonnegative(),
    confidence: confidenceSchema,
    sourceEvidence: z.array(sourceEvidenceSchema).default([]),
    tensor: z.object({
      shape: z.array(z.union([z.number().int(), z.string().trim().min(1).max(128)])).default([]),
      dtype: nullableTextSchema,
    }).strip().nullable().optional().default(null),
    repeatCount: z.number().int().positive().optional().default(1),
  }).strip()).min(1),
  edges: z.array(z.object({
    source: idSchema,
    target: idSchema,
    kind: z.string().trim().min(1).max(128),
    skip: z.boolean().optional().default(false),
    confidence: confidenceSchema,
    sourceEvidence: z.array(sourceEvidenceSchema).default([]),
  }).strip()).default([]),
  groups: z.array(z.object({
    id: idSchema,
    label: z.string().trim().min(1).max(256),
    nodeIds: z.array(idSchema).default([]),
    confidence: confidenceSchema,
    sourceEvidence: z.array(sourceEvidenceSchema).default([]),
  }).strip()).default([]),
}).strip();

export function adaptNetworkIRv1ToCanonical(input: unknown): CanonicalNetworkIR {
  return adaptNetworkIRv1(input).canonical;
}

export function adaptNetworkIRv1(input: unknown): NetworkIRv1Adaptation {
  const legacy = legacyStructuralNetworkIRSchema.parse(input);
  const evidence = new LegacyEvidenceBuilder();
  const nodeById = new Map(legacy.nodes.map((node) => [node.id, node]));
  const outgoingByNodeId = new Map<string, number>();
  const incomingTensorIds = new Map<string, Set<string>>();
  const warnings: LegacyNetworkIRAdaptationWarning[] = [];

  for (const [index, edge] of legacy.edges.entries()) {
    outgoingByNodeId.set(edge.source, (outgoingByNodeId.get(edge.source) ?? 0) + 1);
    const ids = incomingTensorIds.get(edge.target) ?? new Set<string>();
    ids.add(tensorIdForNode(edge.source));
    incomingTensorIds.set(edge.target, ids);
    if ((edge.skip || edge.kind === "skip") && nodeById.get(edge.target)?.kind !== "add") {
      warnings.push({
        code: "legacy-skip-not-residual",
        message: `Legacy skip edge ${edge.source} → ${edge.target} is retained as data because its target is not an Add node`,
        path: `edges[${index}]`,
      });
    }
  }

  for (const node of legacy.nodes) {
    if ((node.kind === "add" || node.kind === "concat") && (incomingTensorIds.get(node.id)?.size ?? 0) < 2) {
      throw new Error(`Legacy ${node.kind} node "${node.id}" requires two distinct upstream tensors`);
    }
  }

  const tensors = legacy.nodes
    .filter((node) => node.kind !== "output" || (outgoingByNodeId.get(node.id) ?? 0) > 0)
    .map((node) => ({
      id: tensorIdForNode(node.id),
      name: node.label,
      shape: node.tensor?.shape ?? [],
      axes: inferAxes(node.tensor?.shape ?? []),
      semanticRole: inferTensorRole(node.kind),
      dtype: node.tensor?.dtype ?? null,
      producerNodeId: node.id,
      consumerNodeIds: [...new Set(legacy.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target))],
    }));

  const groups = legacy.groups.map((group) => ({
    id: group.id,
    label: group.label,
    nodeIds: group.nodeIds,
    confidence: group.confidence,
    sourceEvidenceIds: evidence.materialize(`group-${group.id}`, group.sourceEvidence, group.id, "group", group.confidence),
  }));
  const groupedNodeIds = new Set(groups.flatMap((group) => group.nodeIds));
  const groupIds = new Set(groups.map((group) => group.id));
  for (const node of legacy.nodes) {
    if (node.repeatCount > 1 && !groupedNodeIds.has(node.id)) {
      const id = uniqueLegacyRepeatGroupId(node.id, groupIds);
      groupIds.add(id);
      groups.push({ id, label: `Repeated ${node.label}`, nodeIds: [node.id], confidence: node.confidence, sourceEvidenceIds: [] });
    }
  }

  const canonical: CanonicalNetworkIR = {
    version: 2,
    figure: { id: legacy.figure.id, title: legacy.figure.title, description: legacy.figure.description },
    tensors,
    nodes: legacy.nodes.map((node) => {
      const op = mapNodeOp(node.kind);
      const factIds = evidence.materialize(`node-${node.id}`, node.sourceEvidence, node.id, "node", node.confidence);
      return {
        id: node.id,
        op,
        inputTensorIds: [...(incomingTensorIds.get(node.id) ?? new Set<string>())],
        outputTensorIds: tensors.some((tensor) => tensor.producerNodeId === node.id) ? [tensorIdForNode(node.id)] : [],
        confidence: node.confidence,
        sourceEvidenceIds: factIds.length > 0 ? factIds : requiresNodeEvidence(op) ? [evidence.synthesize(`node-${node.id}`, node.id, `inferred-${op}`, op, node.confidence)] : [],
        repeats: node.repeatCount > 1 ? { count: node.repeatCount, unitNodeIds: [node.id] } : null,
      };
    }),
    edges: legacy.edges.map((edge, index) => {
      const relation = isResidualEdge(edge, nodeById) ? "residual" : "data";
      const factIds = evidence.materialize(`edge-${index + 1}`, edge.sourceEvidence, `${edge.source}->${edge.target}`, "edge", edge.confidence);
      return {
        id: `legacy-edge-${index + 1}`,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        relation,
        tensorIds: [tensorIdForNode(edge.source)],
        confidence: edge.confidence,
        evidenceIds: factIds.length > 0 ? factIds : relation === "residual" ? [evidence.synthesize(`edge-${index + 1}`, `${edge.source}->${edge.target}`, "inferred-residual", "residual", edge.confidence)] : [],
      };
    }),
    groups,
    unresolved: [],
  };
  const evidenceBundle = evidence.build();
  const validation = validateCanonicalNetworkIR(canonical, evidenceBundle);
  if (!validation.valid) {
    throw new Error(`Legacy structural adaptation produced invalid Canonical NetworkIR: ${validation.issues[0]?.message ?? "unknown validation error"}`);
  }

  return { canonical, evidenceBundle, warnings };
}

function mapNodeOp(kind: LegacyNodeKind): CanonicalNetworkIR["nodes"][number]["op"] {
  return nodeOpByV1Kind[kind];
}

function tensorIdForNode(nodeId: string): string {
  return `tensor-${nodeId}`;
}

function uniqueLegacyRepeatGroupId(nodeId: string, existingIds: Set<string>): string {
  const base = `legacy-repeat-group-${nodeId}`;
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function inferAxes(shape: Array<number | string>): string[] {
  if (shape.length === 1) return ["feature"];
  if (shape.length === 2) return ["height", "width"];
  if (shape.length === 3) return ["height", "width", "channel"];
  if (shape.length === 4) return ["batch", "channel", "height", "width"];
  return shape.map((_, index) => `dimension-${index}`);
}

function inferTensorRole(kind: LegacyNodeKind): CanonicalNetworkIR["tensors"][number]["semanticRole"] {
  if (kind === "input") return "input";
  if (kind === "output") return "output";
  if (kind === "classifier" || kind === "dense") return "logits";
  return "activation";
}

function requiresNodeEvidence(op: CanonicalNetworkIR["nodes"][number]["op"]): boolean {
  return op === "input" || op === "output" || op === "add" || op === "concat";
}

function isResidualEdge(edge: LegacyStructuralNetworkIR["edges"][number], nodeById: Map<string, LegacyStructuralNetworkIR["nodes"][number]>): boolean {
  return (edge.skip || edge.kind === "skip") && nodeById.get(edge.target)?.kind === "add";
}

class LegacyEvidenceBuilder {
  private readonly sources = new Map<EvidenceKind, { id: string; kind: EvidenceKind; name: string }>();
  private readonly facts: EvidenceBundle["facts"] = [];

  materialize(scope: string, sourceEvidence: LegacyStructuralNetworkIR["nodes"][number]["sourceEvidence"], subject: string, predicate: string, confidence: number | null): string[] {
    return sourceEvidence.map((source, index) => this.add(`legacy-fact-${scope}-${index + 1}`, subject, predicate, source.value, source, confidence));
  }

  synthesize(scope: string, subject: string, predicate: string, value: string, confidence: number | null): string {
    return this.add(`legacy-fact-inferred-${scope}`, subject, predicate, value, { type: "model", value: "Legacy structural inference", locator: null, excerpt: null }, confidence);
  }

  build(): EvidenceBundle {
    return parseEvidenceBundle({ version: 1, sources: [...this.sources.values()], facts: this.facts, unresolved: [] });
  }

  private add(id: string, subject: string, predicate: string, value: string, source: { type: EvidenceKind; value: string; locator: string | null; excerpt: string | null }, confidence: number | null): string {
    const sourceId = `legacy-source-${source.type}`;
    if (!this.sources.has(source.type)) this.sources.set(source.type, { id: sourceId, kind: source.type, name: `Legacy v1 ${source.type} evidence` });
    this.facts.push({ id, subject, predicate, value, confidence: confidence ?? 0.5, source: { sourceId, kind: source.type, locator: source.locator, excerpt: source.excerpt } });
    return id;
  }
}
