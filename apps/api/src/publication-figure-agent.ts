import type { AgentAttachment, AgentProvider } from "./adapters.js";
import type { CanvasSnapshot } from "./agent-actions.js";
import { mergeAgentTaskIntent, parseAgentTaskIntent, type AgentTaskIntent } from "./agent-intent.js";
import { parseAnalysisProposal, proposalEvidenceBundle, type AnalysisProposal } from "./analysis-proposal.js";
import { ApiErrorCode, FoundationError } from "./domain.js";
import { publicEvidenceSummary, type EvidenceBundle, type EvidenceSource, type ProposedUnresolved } from "./evidence-bundle.js";
import { adaptNetworkIRv1, type LegacyNetworkIRAdaptationWarning } from "./network-ir-v1-adapter.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "./network-ir-v2.js";

export interface FigureAnalysisInput {
  userId: string;
  conversationId: string;
  message: string;
  attachments: AgentAttachment[];
  draftRef: { draftId: string; revision: number } | null;
  canvas?: CanvasSnapshot;
}

export interface FigureAnalysisResult {
  status: "needs_confirmation" | "ready_for_preview";
  taskIntent: AgentTaskIntent;
  evidence: ReturnType<typeof publicEvidenceSummary>;
  canonicalNetworkIR: CanonicalNetworkIR;
  blockingQuestions: Array<{ id: string; question: string; candidateValues: string[] }>;
  warnings: string[];
  readyForVisio: false;
}

export interface PublicationFigureAgentOptions {
  provider: Pick<AgentProvider, "buildAnalysisProposal">;
  parseCanonicalNetworkIR?: typeof parseCanonicalNetworkIR;
  now?: () => string;
}

export class PublicationFigureAgent {
  private readonly provider: Pick<AgentProvider, "buildAnalysisProposal">;
  private readonly parseCanonical: typeof parseCanonicalNetworkIR;

  constructor(options: PublicationFigureAgentOptions) {
    this.provider = options.provider;
    this.parseCanonical = options.parseCanonicalNetworkIR ?? parseCanonicalNetworkIR;
  }

  async analyze(input: FigureAnalysisInput): Promise<FigureAnalysisResult> {
    const userIntent = parseAgentTaskIntent({
      message: input.message,
      attachments: input.attachments,
      draftRef: input.draftRef,
    });
    const evidenceSources = buildEvidenceSources(input.attachments);
    const rawProposal = await this.provider.buildAnalysisProposal({
      userId: input.userId,
      conversationId: input.conversationId,
      message: input.message,
      attachments: input.attachments,
      ...(input.canvas ? { canvas: input.canvas } : {}),
      taskIntent: userIntent,
      evidenceSources,
    });

    try {
      const proposal = parseAnalysisProposal(rawProposal);
      const evidenceBundle = proposalEvidenceBundle(proposal, evidenceSources);
      const taskIntent = mergeAgentTaskIntent(userIntent, proposal.taskIntentSuggestion);
      const normalized = normalizeCanonicalCandidate(proposal, evidenceBundle);
      const canonicalNetworkIR = this.parseCanonical(normalized.candidate, evidenceBundle);
      const blockingQuestions = [
        ...proposal.unresolved
          .filter((item) => item.severity === "blocking")
          .map(({ id, question, candidateValues }) => ({ id, question, candidateValues })),
        ...deriveCriticalStructuralQuestions(canonicalNetworkIR),
      ].slice(0, 1);

      return {
        status: blockingQuestions.length > 0 ? "needs_confirmation" : "ready_for_preview",
        taskIntent,
        evidence: publicEvidenceSummary(evidenceBundle),
        canonicalNetworkIR,
        blockingQuestions,
        warnings: [...proposal.warnings, ...normalized.warnings],
        readyForVisio: false,
      };
    } catch (error) {
      throw invalidFigureAnalysis(error);
    }
  }
}

function buildEvidenceSources(attachments: AgentAttachment[]): EvidenceSource[] {
  return [
    { id: "source-text-1", kind: "text", name: "User request" },
    ...attachments.map((attachment, index) => ({
      id: `source-attachment-${index + 1}`,
      kind: attachment.kind,
      name: attachment.name.slice(0, 256),
    })),
  ];
}

function normalizeCanonicalCandidate(
  proposal: AnalysisProposal,
  evidenceBundle: EvidenceBundle,
): { candidate: CanonicalNetworkIR; warnings: string[] } {
  const candidate = proposal.networkCandidate as Candidate;
  if (candidate.nodes.every((node) => typeof node.op === "string")) {
    return { candidate: normalizeV2Candidate(candidate, proposal.unresolved, evidenceBundle), warnings: [] };
  }

  const projected = projectLegacyCandidate(candidate);
  const adapted = adaptNetworkIRv1(projected.candidate);
  return {
    candidate: bindProposalEvidence(adapted.canonical, proposal.unresolved, evidenceBundle),
    warnings: [...projected.warnings, ...adapted.warnings.map(formatAdaptationWarning)],
  };
}

type Candidate = {
  figure: { id: string; title: string; description?: string | null };
  tensors?: Array<Record<string, unknown>>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
};

function normalizeV2Candidate(candidate: Candidate, unresolved: ProposedUnresolved[], evidence: EvidenceBundle): CanonicalNetworkIR {
  const factIds = evidence.facts.map((fact) => fact.id);
  const tensors = (candidate.tensors ?? []).map((tensor) => {
    const shape = arrayOfNumberOrString(tensor.shape);
    return {
      id: String(tensor.id),
      name: typeof tensor.name === "string" ? tensor.name : String(tensor.id),
      shape,
      axes: arrayOfStrings(tensor.axes).length === shape.length ? arrayOfStrings(tensor.axes) : inferAxes(shape),
      semanticRole: normalizeTensorRole(tensor.semanticRole),
      dtype: typeof tensor.dtype === "string" ? tensor.dtype : null,
      producerNodeId: typeof tensor.producerNodeId === "string" ? tensor.producerNodeId : null,
      consumerNodeIds: arrayOfStrings(tensor.consumerNodeIds),
    };
  });
  const outputTensorIdsByNode = new Map<string, string[]>();
  for (const tensor of tensors) {
    if (tensor.producerNodeId) outputTensorIdsByNode.set(tensor.producerNodeId, [...(outputTensorIdsByNode.get(tensor.producerNodeId) ?? []), tensor.id]);
  }

  const nodes = candidate.nodes.map((node) => ({
    id: String(node.id),
    op: String(node.op),
    inputTensorIds: arrayOfStrings(node.inputTensorIds),
    outputTensorIds: arrayOfStrings(node.outputTensorIds).length > 0
      ? arrayOfStrings(node.outputTensorIds)
      : outputTensorIdsByNode.get(String(node.id)) ?? [],
    confidence: typeof node.confidence === "number" ? node.confidence : null,
    sourceEvidenceIds: evidenceIdsFor(node, factIds),
    repeats: isRecord(node.repeats) ? {
      count: Number(node.repeats.count),
      unitNodeIds: arrayOfStrings(node.repeats.unitNodeIds),
    } : null,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = candidate.edges.map((edge, index) => {
    const sourceNodeId = stringField(edge, "sourceNodeId", "source");
    const targetNodeId = stringField(edge, "targetNodeId", "target");
    return {
      id: `proposal-edge-${index + 1}`,
      sourceNodeId,
      targetNodeId,
      relation: normalizeRelation(edge, targetNodeId, nodeById),
      tensorIds: arrayOfStrings(edge.tensorIds).length > 0
        ? arrayOfStrings(edge.tensorIds)
        : nodeById.get(sourceNodeId)?.outputTensorIds ?? [],
      confidence: typeof edge.confidence === "number" ? edge.confidence : null,
      evidenceIds: evidenceIdsFor(edge, factIds),
    };
  });

  return {
    version: 2,
    figure: {
      id: candidate.figure.id,
      title: candidate.figure.title,
      description: candidate.figure.description ?? null,
    },
    tensors,
    nodes: nodes as CanonicalNetworkIR["nodes"],
    edges: edges as CanonicalNetworkIR["edges"],
    groups: candidate.groups.map((group) => ({
      id: String(group.id),
      label: String(group.label),
      nodeIds: arrayOfStrings(group.nodeIds),
      confidence: typeof group.confidence === "number" ? group.confidence : null,
      sourceEvidenceIds: evidenceIdsFor(group, factIds),
    })),
    unresolved,
  };
}

const supportedLegacyKinds = new Set([
  "input", "output", "conv", "depthwise-conv", "pool", "upsample", "add", "concat",
  "flatten", "dense", "classifier", "attention", "transformer-block",
]);
const omittedCompatibilityKinds = new Set(["activation", "normalization", "embedding", "token"]);

function projectLegacyCandidate(candidate: Candidate): { candidate: Candidate; warnings: string[] } {
  const mappedNodes = candidate.nodes.map((node) => {
    if (node.kind === "residual") return { ...node, kind: "conv" };
    return node;
  });
  for (const node of mappedNodes) {
    const kind = String(node.kind ?? "");
    if (!supportedLegacyKinds.has(kind) && !omittedCompatibilityKinds.has(kind)) {
      throw new Error(`Unsupported structural node kind: ${kind || "missing"}`);
    }
  }

  const keptIds = new Set(mappedNodes.filter((node) => supportedLegacyKinds.has(String(node.kind))).map((node) => String(node.id)));
  const edges = collapseOmittedNodes(mappedNodes, candidate.edges, keptIds);
  const warnings = mappedNodes
    .filter((node) => omittedCompatibilityKinds.has(String(node.kind)))
    .map((node) => `Legacy ${String(node.kind)} node "${String(node.id)}" was folded into canonical data flow.`);
  return {
    candidate: {
      figure: candidate.figure,
      nodes: mappedNodes.filter((node) => keptIds.has(String(node.id))),
      edges,
      groups: candidate.groups
        .map((group) => ({ ...group, nodeIds: arrayOfStrings(group.nodeIds).filter((id) => keptIds.has(id)) }))
        .filter((group) => arrayOfStrings(group.nodeIds).length > 0),
    },
    warnings,
  };
}

function collapseOmittedNodes(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>, keptIds: Set<string>): Array<Record<string, unknown>> {
  const outgoing = new Map<string, Array<Record<string, unknown>>>();
  for (const edge of edges) {
    const source = stringField(edge, "source", "sourceNodeId");
    outgoing.set(source, [...(outgoing.get(source) ?? []), edge]);
  }
  const collapsed: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const source of keptIds) {
    const pending = (outgoing.get(source) ?? []).map((edge) => ({ edge, traversed: new Set<string>() }));
    while (pending.length > 0) {
      const current = pending.shift()!;
      const target = stringField(current.edge, "target", "targetNodeId");
      if (keptIds.has(target)) {
        const key = `${source}->${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          collapsed.push({ ...current.edge, source, target });
        }
        continue;
      }
      if (current.traversed.has(target)) continue;
      const traversed = new Set(current.traversed).add(target);
      for (const next of outgoing.get(target) ?? []) pending.push({ edge: next, traversed });
    }
  }
  return collapsed;
}

function bindProposalEvidence(canonical: CanonicalNetworkIR, unresolved: ProposedUnresolved[], evidence: EvidenceBundle): CanonicalNetworkIR {
  const factIds = evidence.facts.map((fact) => fact.id);
  return {
    ...canonical,
    nodes: canonical.nodes.map((node) => ({ ...node, sourceEvidenceIds: factIds })),
    edges: canonical.edges.map((edge) => ({ ...edge, evidenceIds: factIds })),
    groups: canonical.groups.map((group) => ({ ...group, sourceEvidenceIds: factIds })),
    unresolved,
  };
}

function deriveCriticalStructuralQuestions(canonical: CanonicalNetworkIR): Array<{ id: string; question: string; candidateValues: string[] }> {
  const derived: Array<{ id: string; question: string; candidateValues: string[] }> = [];
  for (const [index, node] of canonical.nodes.entries()) {
    if (!isLowExplicitConfidence(node.confidence)) continue;
    if (node.op === "add" || node.op === "concat") {
      derived.push({
        id: `derived-node-${index + 1}-merge-kind`,
        question: "Is this merge an Add or Concat operation?",
        candidateValues: ["add", "concat"],
      });
    } else if (node.op === "input") {
      derived.push({
        id: `derived-node-${index + 1}-input-kind`,
        question: "Is this node an input or intermediate node?",
        candidateValues: ["input", "intermediate"],
      });
    } else if (node.op === "output") {
      derived.push({
        id: `derived-node-${index + 1}-output-kind`,
        question: "Is this node an output or intermediate node?",
        candidateValues: ["output", "intermediate"],
      });
    }
  }
  for (const [index, edge] of canonical.edges.entries()) {
    if (!isLowExplicitConfidence(edge.confidence)) continue;
    if (edge.relation === "residual") {
      derived.push({
        id: `derived-edge-${index + 1}-residual-kind`,
        question: "Is this connection residual or data flow?",
        candidateValues: ["residual", "data"],
      });
    } else if (edge.relation === "cross_attention") {
      derived.push({
        id: `derived-edge-${index + 1}-cross-attention-kind`,
        question: "Is this connection cross-attention or data flow?",
        candidateValues: ["cross_attention", "data"],
      });
    } else if (edge.relation === "data") {
      derived.push({
        id: `derived-edge-${index + 1}-data-connection`,
        question: "Are these nodes connected or not connected?",
        candidateValues: ["connected", "not_connected"],
      });
    }
  }
  return derived;
}

function isLowExplicitConfidence(confidence: number | null): boolean {
  return confidence !== null && confidence < 0.85;
}

function evidenceIdsFor(value: Record<string, unknown>, fallback: string[]): string[] {
  const direct = arrayOfStrings(value.sourceEvidenceIds ?? value.evidenceIds);
  return direct.length > 0 ? direct : fallback;
}

function normalizeRelation(
  edge: Record<string, unknown>,
  targetNodeId: string,
  nodeById: Map<string, { op: string }>,
): string {
  const relation = typeof edge.relation === "string" ? edge.relation : typeof edge.kind === "string" ? edge.kind : "data";
  if ((edge.skip === true || relation === "skip" || relation === "residual") && nodeById.get(targetNodeId)?.op === "add") return "residual";
  if (["data", "residual", "cross_attention", "iteration"].includes(relation)) return relation;
  return "data";
}

function inferAxes(shape: Array<number | string>): string[] {
  if (shape.length === 1) return ["feature"];
  if (shape.length === 2) return ["height", "width"];
  if (shape.length === 3) return ["height", "width", "channel"];
  if (shape.length === 4) return ["batch", "channel", "height", "width"];
  return shape.map((_, index) => `dimension-${index}`);
}

function normalizeTensorRole(value: unknown): CanonicalNetworkIR["tensors"][number]["semanticRole"] {
  return ["input", "activation", "output", "logits", "state", "unknown"].includes(String(value))
    ? value as CanonicalNetworkIR["tensors"][number]["semanticRole"]
    : "unknown";
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOfNumberOrString(value: unknown): Array<number | string> {
  return Array.isArray(value) ? value.filter((item): item is number | string => typeof item === "number" || typeof item === "string") : [];
}

function stringField(value: Record<string, unknown>, primary: string, fallback: string): string {
  if (typeof value[primary] === "string") return value[primary];
  if (typeof value[fallback] === "string") return value[fallback];
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatAdaptationWarning(warning: LegacyNetworkIRAdaptationWarning): string {
  return `${warning.message} (${warning.path})`;
}

function invalidFigureAnalysis(error: unknown): FoundationError {
  const cause = error instanceof Error ? error.message : "Invalid publication figure analysis";
  return new FoundationError(
    ApiErrorCode.VALIDATION_FAILED,
    "Publication figure analysis failed validation",
    502,
    { figureAnalysisCode: ApiErrorCode.FIGURE_ANALYSIS_INVALID, cause },
  );
}
