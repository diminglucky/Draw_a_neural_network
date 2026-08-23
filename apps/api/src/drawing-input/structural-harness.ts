import { createHash } from "node:crypto";
import { compareCodeUnits } from "../stable-string-order.js";
import { parseUniversalGraphSpec, type UniversalGraphSpec, type UniversalNodeKind } from "../universal-graph-spec.js";
import type { EvidenceFact, EvidencePack, EvidenceSourceKind } from "./evidence-pack.js";
import type { ProviderContextPayload } from "./provider-context.js";
import type { DrawingWorkflowHarness, DrawingWorkflowInterpreter } from "../drawing-run/langgraph-workflow.js";
import { DRAWING_CLARIFICATION_CONFIRMATION_HASH } from "../drawing-run/contracts.js";
import { digestDrawingArtifact, type DrawingArtifactStore } from "./drawing-artifacts.js";
import { DrawingWorkflowError, classifyProviderFailure } from "../drawing-run/errors.js";

export type LocalNodeKind = "input" | "output" | "operator" | "module";
export type LocalEdgeRelation = "data" | "skip" | "merge" | "condition" | "feedback";
export type LocalUnresolvedScope = "operation" | "shape" | "topology";

export interface InterpreterLocalNode {
  localRef: string;
  kind: LocalNodeKind;
  displayLabel: string;
  inputLocalRefs: readonly string[];
  outputLocalRefs: readonly string[];
  evidenceRefs: readonly string[];
}

export interface InterpreterLocalPort {
  localRef: string;
  nodeLocalRef: string;
  direction: "input" | "output";
  displayLabel: string | null;
  evidenceRefs: readonly string[];
}

export interface InterpreterLocalEdge {
  localRef: string;
  sourcePortLocalRef: string;
  targetPortLocalRef: string;
  relation: LocalEdgeRelation;
  evidenceRefs: readonly string[];
}

export interface InterpreterLocalUnresolved {
  localRef: string;
  scope: LocalUnresolvedScope;
  severity: "blocking" | "warning";
  evidenceRefs: readonly string[];
}

export interface InterpreterLocalProposal {
  version: 2;
  nodes: readonly InterpreterLocalNode[];
  ports: readonly InterpreterLocalPort[];
  edges: readonly InterpreterLocalEdge[];
  unresolved: readonly InterpreterLocalUnresolved[];
}

export type StructuralHarnessResult =
  | { kind: "formal"; ugs: UniversalGraphSpec; ugsHash: string; evidencePackHash: string; proposalHash: string }
  | { kind: "clarification"; candidateUgs: UniversalGraphSpec; candidateUgsHash: string; evidencePackHash: string; proposalHash: string; clarification: StructuralClarification }
  | { kind: "rejected"; errorCategory: "validation" | "provider_invalid"; reasonCode: string; proposalHash: string; evidencePackHash: string };

export interface StructuralClarification {
  code: "ambiguous_structure" | "low_confidence_structure" | "blocking_unresolved";
  prompt: string;
  evidenceIds: string[];
  hash: string;
}

export interface LocalProposalProvider {
  propose(input: ProviderContextPayload): Promise<unknown>;
}

export interface LocalProposalStore {
  put(ownerId: string, proposalHash: string, proposal: unknown): Promise<void>;
  get(ownerId: string, proposalHash: string): Promise<unknown | null>;
}

export class InMemoryLocalProposalStore implements LocalProposalStore {
  private readonly proposals = new Map<string, unknown>();
  async put(ownerId: string, proposalHash: string, proposal: unknown): Promise<void> {
    assertOwner(ownerId);
    if (digestLocalProposal(proposal) !== proposalHash.toLowerCase()) throw new Error("Local proposal hash does not match proposal");
    this.proposals.set(`${ownerId}:${proposalHash.toLowerCase()}`, structuredClone(proposal));
  }
  async get(ownerId: string, proposalHash: string): Promise<unknown | null> {
    assertOwner(ownerId);
    const proposal = this.proposals.get(`${ownerId}:${proposalHash.toLowerCase()}`);
    if (proposal === undefined) return null;
    if (digestLocalProposal(proposal) !== proposalHash.toLowerCase()) throw new Error("Stored local proposal hash does not match proposal");
    return structuredClone(proposal);
  }
}

export function createStoredArchitectureInterpreter(provider: LocalProposalProvider, proposals: LocalProposalStore): DrawingWorkflowInterpreter {
  return {
    async interpret(input: ProviderContextPayload, scope): Promise<{ proposalHash: string }> {
      if (!scope) throw new Error("Stored architecture interpretation requires owner scope");
      let proposal: unknown;
      try {
        proposal = await provider.propose(input);
      } catch (error) {
        throw new DrawingWorkflowError(classifyProviderFailure(error), "Architecture Provider request failed", error);
      }
      const proposalHash = digestLocalProposal(proposal);
      await proposals.put(scope.ownerId, proposalHash, proposal);
      return { proposalHash };
    },
  };
}

export function digestLocalProposal(value: unknown): string {
  return digest(value);
}

export class ReceiptBoundStructuralHarness implements DrawingWorkflowHarness {
  constructor(
    private readonly evidencePacks: { get(ownerId: string, hash: string): Promise<EvidencePack | null> },
    private readonly proposals: LocalProposalStore,
    private readonly artifacts?: DrawingArtifactStore,
  ) {}

  async assess(input: { runId: string; ownerId: string; deviceId: string; revision: number; evidencePackHash: string; proposalHash: string | null; clarificationAnswerHash?: string | null }): Promise<{ kind: "formal"; ugsHash: string; candidateHash: string } | { kind: "clarification"; candidateHash: string; clarificationHash: string } | { kind: "rejected"; errorCategory: "validation" | "provider_unavailable" | "provider_timeout" | "provider_invalid" }> {
    const evidencePack = await this.evidencePacks.get(input.ownerId, input.evidencePackHash);
    if (!evidencePack) return { kind: "rejected", errorCategory: "provider_invalid" };
    const proposal = input.proposalHash
      ? await this.proposals.get(input.ownerId, input.proposalHash)
      : createDeterministicLocalProposal(evidencePack);
    if (!proposal) return { kind: "rejected", errorCategory: input.proposalHash ? "provider_invalid" : "validation" };
    const proposalHash = digest(proposal);
    if (input.proposalHash && proposalHash !== input.proposalHash) return { kind: "rejected", errorCategory: "provider_invalid" };
    const result = assessInterpreterProposal({ evidencePack, proposal, confirmBlocking: input.clarificationAnswerHash === DRAWING_CLARIFICATION_CONFIRMATION_HASH });
    if (result.kind === "formal") {
      await this.artifacts?.putUgs(input.ownerId, result.ugsHash, result.ugs);
      return { kind: "formal", ugsHash: result.ugsHash, candidateHash: result.ugsHash };
    }
    if (result.kind === "clarification") {
      await this.artifacts?.putUgs(input.ownerId, result.candidateUgsHash, result.candidateUgs);
      return { kind: "clarification", candidateHash: result.candidateUgsHash, clarificationHash: result.clarification.hash };
    }
    return { kind: "rejected", errorCategory: result.errorCategory === "provider_invalid" ? "provider_invalid" : "validation" };
  }
}

export function createDeterministicLocalProposal(evidencePack: EvidencePack): InterpreterLocalProposal | null {
  const nodes = new Map<string, { kind: LocalNodeKind; evidenceRefs: string[] }>();
  const ports = new Map<string, { nodeLocalRef: string; direction: "input" | "output"; evidenceRefs: string[] }>();
  const edges = new Map<string, { sourcePortLocalRef: string; targetPortLocalRef: string; relation: LocalEdgeRelation; evidenceRefs: string[] }>();
  const nodeEvidence = new Map<string, string[]>();
  const descriptions: Array<{ fact: EvidenceFact; kind: string | null; subject: Record<string, any> | null; payload: Record<string, any> | null }> = evidencePack.facts.map((fact) => {
    const decoded = decodeStructuralFact(fact.semanticKey);
    return decoded ? { fact, kind: decoded.kind, subject: decoded.subject, payload: decoded.payload } : { fact, kind: null, subject: null, payload: null };
  });

  for (const item of descriptions) {
    const { fact, kind, subject, payload } = item;
    if (kind === "node_exists" || kind === "node_kind") {
      const nodeId = typeof subject?.nodeId === "string" ? subject.nodeId : null;
      if (!nodeId) continue;
      const existing = nodes.get(nodeId) ?? { kind: "operator" as LocalNodeKind, evidenceRefs: [] };
      if (kind === "node_exists") existing.kind = nodeKind(payload ?? {});
      if (kind === "node_kind" && payload && typeof payload.semanticRole === "string") {
        existing.kind = payload.semanticRole === "input" ? "input" : payload.semanticRole === "output" ? "output" : existing.kind;
      }
      existing.evidenceRefs.push(fact.localFactRef);
      nodes.set(nodeId, existing);
      continue;
    }
    if (kind === "edge_exists") {
      const sourcePortId = typeof subject?.sourcePortId === "string" ? subject.sourcePortId : null;
      const targetPortId = typeof subject?.targetPortId === "string" ? subject.targetPortId : null;
      if (!sourcePortId || !targetPortId) continue;
      const edgeId = `edge:${sourcePortId}:${targetPortId}`;
      const relation = edgeRelationFromPayload(payload ?? {});
      if (!relation) continue;
      const existing = edges.get(edgeId);
      if (existing && (existing.sourcePortLocalRef !== sourcePortId || existing.targetPortLocalRef !== targetPortId || existing.relation !== relation)) return null;
      edges.set(edgeId, { sourcePortLocalRef: sourcePortId, targetPortLocalRef: targetPortId, relation, evidenceRefs: unique([...(existing?.evidenceRefs ?? []), fact.localFactRef]) });
      ensureInferredPort(ports, sourcePortId, "output", fact.localFactRef);
      ensureInferredPort(ports, targetPortId, "input", fact.localFactRef);
      continue;
    }
    const summary = fact.summary;
    const node = summary.match(/^node\s+(\S+)\s+(input|output|operator|module)\s+/);
    if (node) {
      const existing = nodes.get(node[1]!) ?? { kind: node[2] as LocalNodeKind, evidenceRefs: [] };
      existing.kind = node[2] as LocalNodeKind;
      existing.evidenceRefs.push(fact.localFactRef);
      nodes.set(node[1]!, existing);
      continue;
    }
    const port = summary.match(/^port\s+(\S+)\s+(input|output)\s+node\s+(\S+)$/);
    if (port) {
      ports.set(port[1]!, { nodeLocalRef: port[3]!, direction: port[2] as "input" | "output", evidenceRefs: [fact.localFactRef] });
      continue;
    }
    const edge = summary.match(/^edge\s+(\S+)\s+(\S+)\s+to\s+(\S+)\s+(data|skip|merge|condition|feedback)$/);
    if (edge) {
      const existing = edges.get(edge[1]!);
      if (existing && (existing.sourcePortLocalRef !== edge[2] || existing.targetPortLocalRef !== edge[3] || existing.relation !== edge[4])) return null;
      edges.set(edge[1]!, { sourcePortLocalRef: edge[2]!, targetPortLocalRef: edge[3]!, relation: edge[4] as LocalEdgeRelation, evidenceRefs: unique([...(existing?.evidenceRefs ?? []), fact.localFactRef]) });
    }
  }

  for (const [, port] of ports) if (!nodes.has(port.nodeLocalRef)) return null;
  for (const [edgeId, edge] of edges) {
    const source = ports.get(edge.sourcePortLocalRef);
    const target = ports.get(edge.targetPortLocalRef);
    if (!source || !target) return null;
    if (!nodes.has(source.nodeLocalRef) || !nodes.has(target.nodeLocalRef)) return null;
  }
  const unresolved = evidencePack.unresolved.map((item, index) => ({
    localRef: `unresolved:${index + 1}`,
    scope: "topology" as const,
    severity: item.severity,
    evidenceRefs: matchingFactRefs(evidencePack, item),
  })).filter((item) => item.evidenceRefs.length > 0);
  if (nodes.size === 0 || edges.size === 0 || ![...nodes.values()].some((node) => node.kind === "input") || ![...nodes.values()].some((node) => node.kind === "output")) return null;
  const inputPorts = new Map<string, string[]>();
  const outputPorts = new Map<string, string[]>();
  for (const [portId, port] of ports) {
    const target = port.direction === "input" ? inputPorts : outputPorts;
    target.set(port.nodeLocalRef, [...(target.get(port.nodeLocalRef) ?? []), portId]);
  }
  return {
    version: 2,
    nodes: [...nodes.entries()].map(([localRef, node]) => ({ localRef, kind: node.kind, displayLabel: node.kind === "input" ? "Input" : node.kind === "output" ? "Output" : node.kind === "module" ? "Custom module" : "Custom operator", inputLocalRefs: inputPorts.get(localRef) ?? [], outputLocalRefs: outputPorts.get(localRef) ?? [], evidenceRefs: unique(node.evidenceRefs) })),
    ports: [...ports.entries()].map(([localRef, port]) => ({ localRef, nodeLocalRef: port.nodeLocalRef, direction: port.direction, displayLabel: null, evidenceRefs: unique(port.evidenceRefs) })),
    edges: [...edges.entries()].map(([localRef, edge]) => ({ localRef, ...edge, evidenceRefs: unique(edge.evidenceRefs) })),
    unresolved,
  };
}

function decodeStructuralFact(value: string): { kind: string; subject: Record<string, any>; payload: Record<string, any> } | null {
  const first = value.indexOf(":");
  if (first < 1) return null;
  try {
    const subjectStart = first + 1;
    const subjectEnd = jsonValueEnd(value, subjectStart);
    if (subjectEnd < 0 || value[subjectEnd] !== ":") return null;
    const subject = JSON.parse(value.slice(subjectStart, subjectEnd));
    const payload = JSON.parse(value.slice(subjectEnd + 1));
    if (!subject || typeof subject !== "object" || !payload || typeof payload !== "object") return null;
    return { kind: value.slice(0, first), subject, payload };
  } catch {
    return null;
  }
}

function jsonValueEnd(value: string, start: number): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function nodeKind(payload: Record<string, any>): LocalNodeKind {
  if (payload.operatorKind === "input" || payload.semanticRole === "input") return "input";
  if (payload.operatorKind === "output" || payload.semanticRole === "output") return "output";
  return payload.operatorKind === "module" ? "module" : "operator";
}

function edgeRelationFromPayload(payload: Record<string, any>): LocalEdgeRelation | null {
  if (payload.transport === "data" || payload.relation === "data") return "data";
  if (["skip", "merge", "condition", "feedback"].includes(payload.relation)) return payload.relation as LocalEdgeRelation;
  return null;
}

function ensureInferredPort(ports: Map<string, { nodeLocalRef: string; direction: "input" | "output"; evidenceRefs: string[] }>, portId: string, direction: "input" | "output", evidenceRef: string): void {
  const separator = portId.lastIndexOf(":");
  if (separator < 1) return;
  const nodeLocalRef = portId.slice(0, separator);
  const existing = ports.get(portId);
  if (existing && (existing.nodeLocalRef !== nodeLocalRef || existing.direction !== direction)) return;
  ports.set(portId, { nodeLocalRef, direction, evidenceRefs: unique([...(existing?.evidenceRefs ?? []), evidenceRef]) });
}

function matchingFactRefs(evidencePack: EvidencePack, unresolved: EvidencePack["unresolved"][number]): string[] {
  return evidencePack.facts.filter((fact) => fact.evidence.sourceHash === unresolved.sourceHash && fact.evidence.locatorKind === unresolved.locatorKind && fact.evidence.locatorOrdinal === unresolved.locatorOrdinal).map((fact) => fact.localFactRef);
}

const MAX_NODES = 256;
const MAX_PORTS = 1_024;
const MAX_EDGES = 2_048;
const MAX_UNRESOLVED = 64;
const localRefPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const factRefPattern = /^fact:f:[0-9]+$/;
const unsafeTextPattern = /[\u0000-\u001f\u007f]|(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:https?:\/\/)|(?:\b(?:api[_-]?key|bearer|password|token|credential|secret|path|filename|source|provider|renderer|worker|visio|com|shell|exec|eval)\b)|(?:<\/?(?:svg|xml|script|visio)\b)/i;

export function assessInterpreterProposal(input: { evidencePack: EvidencePack; proposal: unknown; confirmBlocking?: boolean }): StructuralHarnessResult {
  const proposalHash = digest(input.proposal);
  const evidencePackHash = input.evidencePack.hash;
  let proposal: InterpreterLocalProposal;
  try {
    proposal = parseInterpreterLocalProposal(input.proposal);
  } catch {
    return { kind: "rejected", errorCategory: "provider_invalid", reasonCode: "invalid_local_proposal", proposalHash, evidencePackHash };
  }

  const evidence = new EvidenceIndex(input.evidencePack);
  try {
    const normalized = normalizeProposal(proposal, evidence);
    const canonical = canonicalize(normalized, evidence);
    if (input.confirmBlocking && canonical.blockingReasons.length > 0) {
      const formalUgs = buildUgs(canonical, evidence, false, undefined, true);
      const formalUgsHash = digest(formalUgs);
      return { kind: "formal", ugs: formalUgs, ugsHash: formalUgsHash, evidencePackHash, proposalHash };
    }
    const candidateUgs = buildUgs(canonical, evidence, canonical.blockingReasons.length > 0);
    const candidateUgsHash = digest(candidateUgs);
    if (canonical.blockingReasons.length === 0) {
      return { kind: "formal", ugs: candidateUgs, ugsHash: candidateUgsHash, evidencePackHash, proposalHash };
    }
    const reason = canonical.blockingReasons[0]!;
    const clarification = clarificationFor(reason, candidateUgs);
    const clarifiedUgs = buildUgs(canonical, evidence, true, clarification);
    return {
      kind: "clarification",
      candidateUgs: clarifiedUgs,
      candidateUgsHash: digest(clarifiedUgs),
      evidencePackHash,
      proposalHash,
      clarification,
    };
  } catch (error) {
    const reasonCode = error instanceof HarnessValidationError ? error.code : "invalid_structural_relation";
    return { kind: "rejected", errorCategory: "validation", reasonCode, proposalHash, evidencePackHash };
  }
}

function parseInterpreterLocalProposal(value: unknown): InterpreterLocalProposal {
  const root = record(value, "proposal");
  exactKeys(root, ["version", "nodes", "ports", "edges", "unresolved"]);
  if (root.version !== 2 || !Array.isArray(root.nodes) || !Array.isArray(root.ports) || !Array.isArray(root.edges) || !Array.isArray(root.unresolved)) throw new HarnessValidationError("invalid_local_proposal");
  if (root.nodes.length === 0 || root.nodes.length > MAX_NODES || root.ports.length > MAX_PORTS || root.edges.length > MAX_EDGES || root.unresolved.length > MAX_UNRESOLVED) throw new HarnessValidationError("capacity_exceeded");
  const nodes = root.nodes.map((item, index) => {
    const node = record(item, `nodes[${index}]`);
    exactKeys(node, ["localRef", "kind", "displayLabel", "inputLocalRefs", "outputLocalRefs", "evidenceRefs"]);
    return {
      localRef: localRef(node.localRef),
      kind: oneOf(node.kind, ["input", "output", "operator", "module"] as const),
      displayLabel: displayLabel(node.displayLabel),
      inputLocalRefs: refList(node.inputLocalRefs, `nodes[${index}].inputLocalRefs`),
      outputLocalRefs: refList(node.outputLocalRefs, `nodes[${index}].outputLocalRefs`),
      evidenceRefs: factRefList(node.evidenceRefs, `nodes[${index}].evidenceRefs`),
    };
  });
  const ports = root.ports.map((item, index) => {
    const port = record(item, `ports[${index}]`);
    exactKeys(port, ["localRef", "nodeLocalRef", "direction", "displayLabel", "evidenceRefs"]);
    return {
      localRef: localRef(port.localRef),
      nodeLocalRef: localRef(port.nodeLocalRef),
      direction: oneOf(port.direction, ["input", "output"] as const),
      displayLabel: port.displayLabel === null ? null : displayLabel(port.displayLabel),
      evidenceRefs: factRefList(port.evidenceRefs, `ports[${index}].evidenceRefs`),
    };
  });
  const edges = root.edges.map((item, index) => {
    const edge = record(item, `edges[${index}]`);
    exactKeys(edge, ["localRef", "sourcePortLocalRef", "targetPortLocalRef", "relation", "evidenceRefs"]);
    return {
      localRef: localRef(edge.localRef),
      sourcePortLocalRef: localRef(edge.sourcePortLocalRef),
      targetPortLocalRef: localRef(edge.targetPortLocalRef),
      relation: oneOf(edge.relation, ["data", "skip", "merge", "condition", "feedback"] as const),
      evidenceRefs: factRefList(edge.evidenceRefs, `edges[${index}].evidenceRefs`),
    };
  });
  const unresolved = root.unresolved.map((item, index) => {
    const unresolvedItem = record(item, `unresolved[${index}]`);
    exactKeys(unresolvedItem, ["localRef", "scope", "severity", "evidenceRefs"]);
    return {
      localRef: localRef(unresolvedItem.localRef),
      scope: oneOf(unresolvedItem.scope, ["operation", "shape", "topology"] as const),
      severity: oneOf(unresolvedItem.severity, ["blocking", "warning"] as const),
      evidenceRefs: factRefList(unresolvedItem.evidenceRefs, `unresolved[${index}].evidenceRefs`),
    };
  });
  unique(nodes.map((item) => item.localRef), "duplicate_node_local_ref");
  unique(ports.map((item) => item.localRef), "duplicate_port_local_ref");
  unique(edges.map((item) => item.localRef), "duplicate_edge_local_ref");
  unique(unresolved.map((item) => item.localRef), "duplicate_unresolved_local_ref");
  return { version: 2, nodes, ports, edges, unresolved };
}

type NormalizedProposal = InterpreterLocalProposal & {
  lowConfidence: StructuralReason[];
};

type StructuralReason = { code: StructuralClarification["code"]; evidenceIds: string[]; sortKey: string };

function normalizeProposal(proposal: InterpreterLocalProposal, evidence: EvidenceIndex): NormalizedProposal {
  const nodeByRef = new Map(proposal.nodes.map((node) => [node.localRef, node]));
  const portByRef = new Map(proposal.ports.map((port) => [port.localRef, port]));
  const edgeByRef = new Map(proposal.edges.map((edge) => [edge.localRef, edge]));
  for (const port of proposal.ports) {
    if (!nodeByRef.has(port.nodeLocalRef)) throw new HarnessValidationError("unknown_port_owner");
    checkEvidence(port.evidenceRefs, evidence);
  }
  for (const node of proposal.nodes) {
    checkEvidence(node.evidenceRefs, evidence);
    for (const ref of [...node.inputLocalRefs, ...node.outputLocalRefs]) {
      if (!portByRef.has(ref)) throw new HarnessValidationError("unknown_node_port");
      const port = portByRef.get(ref)!;
      if (node.inputLocalRefs.includes(ref) && port.direction !== "input") throw new HarnessValidationError("node_input_direction");
      if (node.outputLocalRefs.includes(ref) && port.direction !== "output") throw new HarnessValidationError("node_output_direction");
      if (port.nodeLocalRef !== node.localRef) throw new HarnessValidationError("port_owner_mismatch");
    }
    if ((node.kind === "input" && node.inputLocalRefs.length > 0) || (node.kind === "output" && node.outputLocalRefs.length > 0)) throw new HarnessValidationError("terminal_direction");
  }
  for (const port of proposal.ports) checkEvidence(port.evidenceRefs, evidence);
  for (const edge of proposal.edges) {
    checkEvidence(edge.evidenceRefs, evidence);
    const source = portByRef.get(edge.sourcePortLocalRef);
    const target = portByRef.get(edge.targetPortLocalRef);
    if (!source || !target) throw new HarnessValidationError("unknown_edge_port");
    if (source.direction !== "output" || target.direction !== "input") throw new HarnessValidationError("edge_direction");
    if (source.nodeLocalRef === target.nodeLocalRef && edge.relation !== "feedback") throw new HarnessValidationError("self_edge");
  }
  const lowConfidence: StructuralReason[] = [];
  const incoming = new Map<string, InterpreterLocalEdge[]>();
  const outgoing = new Map<string, InterpreterLocalEdge[]>();
  for (const edge of proposal.edges) {
    const source = portByRef.get(edge.sourcePortLocalRef)!;
    const target = portByRef.get(edge.targetPortLocalRef)!;
    incoming.set(target.nodeLocalRef, [...(incoming.get(target.nodeLocalRef) ?? []), edge]);
    outgoing.set(source.nodeLocalRef, [...(outgoing.get(source.nodeLocalRef) ?? []), edge]);
  }
  const inputNodes = proposal.nodes.filter((node) => node.kind === "input").map((node) => node.localRef);
  const outputNodes = proposal.nodes.filter((node) => node.kind === "output").map((node) => node.localRef);
  const reachableFromInput = walkNodes(inputNodes, outgoing, portByRef, "forward");
  const canReachOutput = walkNodes(outputNodes, incoming, portByRef, "backward");
  if (proposal.nodes.some((node) => !reachableFromInput.has(node.localRef) || !canReachOutput.has(node.localRef))) {
    throw new HarnessValidationError("unreachable_node");
  }
  for (const node of proposal.nodes) {
    const nodeIncoming = incoming.get(node.localRef) ?? [];
    const mergeLike = nodeIncoming.filter((edge) => edge.relation === "merge" || edge.relation === "skip");
    if (nodeIncoming.length > 1 && mergeLike.length === 0) {
      lowConfidence.push({
        code: "ambiguous_structure",
        evidenceIds: publicEvidenceIds(nodeIncoming.flatMap((edge) => edge.evidenceRefs), evidence),
        sortKey: `ambiguous-merge:${canonicalEvidenceSort(nodeIncoming.flatMap((edge) => edge.evidenceRefs), evidence)}`,
      });
    }
    if (nodeIncoming.some((edge) => edge.relation === "merge") && nodeIncoming.length < 2) {
      throw new HarnessValidationError("merge_arity");
    }
  }
  for (const node of proposal.nodes) {
    if (node.kind === "input" || node.kind === "output") {
      const confidence = evidence.minimumConfidence(node.evidenceRefs);
      if (confidence !== null && confidence < 0.8) lowConfidence.push({ code: "low_confidence_structure", evidenceIds: publicEvidenceIds(node.evidenceRefs, evidence), sortKey: `terminal:${publicEvidenceIds(node.evidenceRefs, evidence).join(",")}` });
    }
  }
  for (const edge of proposal.edges) {
    const confidence = evidence.minimumConfidence(edge.evidenceRefs);
    if (confidence !== null && confidence < 0.8) lowConfidence.push({ code: "low_confidence_structure", evidenceIds: publicEvidenceIds(edge.evidenceRefs, evidence), sortKey: `edge:${edge.relation}:${publicEvidenceIds(edge.evidenceRefs, evidence).join(",")}` });
  }
  for (const item of proposal.unresolved) {
    checkEvidence(item.evidenceRefs, evidence);
    if (item.severity === "blocking") lowConfidence.push({ code: "blocking_unresolved", evidenceIds: publicEvidenceIds(item.evidenceRefs, evidence), sortKey: `unresolved:${unresolvedTie(item, evidence)}` });
  }
  for (const node of proposal.nodes) {
    const operations = verifiedSemanticHints(node, evidence).filter((hint) => hint.startsWith("operation:"));
    if (operations.length > 1) {
      lowConfidence.push({
        code: "ambiguous_structure",
        evidenceIds: publicEvidenceIds(node.evidenceRefs, evidence),
        sortKey: `operation-conflict:${publicEvidenceIds(node.evidenceRefs, evidence).join(",")}`,
      });
    }
  }
  if (!proposal.nodes.some((node) => node.kind === "input") || !proposal.nodes.some((node) => node.kind === "output")) throw new HarnessValidationError("missing_terminal");
  return { ...proposal, lowConfidence };
}

interface CanonicalProposal {
  nodes: Array<{ source: InterpreterLocalNode; id: string; fingerprint: string; index: number }>;
  ports: Array<{ source: InterpreterLocalPort; id: string; index: number }>;
  edges: Array<{ source: InterpreterLocalEdge; id: string; index: number }>;
  unresolved: InterpreterLocalUnresolved[];
  blockingReasons: StructuralReason[];
}

function canonicalize(proposal: NormalizedProposal, evidence: EvidenceIndex): CanonicalProposal {
  const nodeByRef = new Map(proposal.nodes.map((node) => [node.localRef, node]));
  const portByRef = new Map(proposal.ports.map((port) => [port.localRef, port]));
  const incoming = new Map<string, InterpreterLocalEdge[]>();
  const outgoing = new Map<string, InterpreterLocalEdge[]>();
  for (const edge of proposal.edges) {
    const source = portByRef.get(edge.sourcePortLocalRef)!;
    const target = portByRef.get(edge.targetPortLocalRef)!;
    const sourceEdges = outgoing.get(source.nodeLocalRef) ?? [];
    sourceEdges.push(edge);
    outgoing.set(source.nodeLocalRef, sourceEdges);
    const targetEdges = incoming.get(target.nodeLocalRef) ?? [];
    targetEdges.push(edge);
    incoming.set(target.nodeLocalRef, targetEdges);
  }
  let labels = new Map(proposal.nodes.map((node) => [node.localRef, nodeFingerprintBase(node, evidence)]));
  for (let round = 0; round < proposal.nodes.length + 2; round += 1) {
    const next = new Map<string, string>();
    for (const node of proposal.nodes) {
      const inbound = (incoming.get(node.localRef) ?? []).map((edge) => relationSignature(edge, "in", portByRef, nodeByRef, labels)).sort(compareCodeUnits);
      const outbound = (outgoing.get(node.localRef) ?? []).map((edge) => relationSignature(edge, "out", portByRef, nodeByRef, labels)).sort(compareCodeUnits);
      next.set(node.localRef, digest(`${labels.get(node.localRef)}|in:${inbound.join(",")}|out:${outbound.join(",")}`));
    }
    if ([...next.entries()].every(([key, value]) => value === labels.get(key))) break;
    labels = next;
  }
  const nodeEntries = proposal.nodes.map((node) => ({ source: node, fingerprint: labels.get(node.localRef)!, tie: canonicalNodeTie(node, incoming, outgoing, portByRef, labels, evidence) }));
  nodeEntries.sort((left, right) => compareCodeUnits(`${left.fingerprint}|${left.tie}`, `${right.fingerprint}|${right.tie}`));
  const blockingReasons = [...proposal.lowConfidence];
  for (let index = 1; index < nodeEntries.length; index += 1) {
    if (nodeEntries[index - 1]!.fingerprint === nodeEntries[index]!.fingerprint && nodeEntries[index - 1]!.tie === nodeEntries[index]!.tie) {
      blockingReasons.push({ code: "ambiguous_structure", evidenceIds: publicEvidenceIds(nodeEntries[index]!.source.evidenceRefs, evidence), sortKey: `symmetric:${nodeEntries[index]!.fingerprint}` });
    }
  }
  const nodes = nodeEntries.map((entry, index) => ({ source: entry.source, fingerprint: entry.fingerprint, id: `node:n:${index + 1}`, index }));
  const nodeIndexByLocalRef = new Map(nodes.map((node) => [node.source.localRef, node.index]));
  const portEntries = proposal.ports.map((source) => ({
    source,
    tie: canonicalPortTie(source, proposal.edges, nodeIndexByLocalRef, portByRef, evidence),
  }));
  portEntries.sort((left, right) => compareCodeUnits(left.tie, right.tie));
  for (let index = 1; index < portEntries.length; index += 1) {
    if (portEntries[index - 1]!.tie === portEntries[index]!.tie) {
      blockingReasons.push({
        code: "ambiguous_structure",
        evidenceIds: publicEvidenceIds(portEntries[index]!.source.evidenceRefs, evidence),
        sortKey: `symmetric-port:${portEntries[index]!.tie}`,
      });
    }
  }
  const ports = portEntries.map((entry, index) => ({ source: entry.source, id: `port:p:${index + 1}`, index }));
  const portIdByLocalRef = new Map(ports.map((port) => [port.source.localRef, port.id]));
  const portIndexByLocalRef = new Map(ports.map((port) => [port.source.localRef, port.index]));
  const edgeEntries = proposal.edges.map((source) => ({
    source,
    tie: edgeTie(source, nodeIndexByLocalRef, portIndexByLocalRef, portByRef, evidence),
  }));
  edgeEntries.sort((left, right) => compareCodeUnits(left.tie, right.tie));
  for (let index = 1; index < edgeEntries.length; index += 1) {
    if (edgeEntries[index - 1]!.tie === edgeEntries[index]!.tie) {
      blockingReasons.push({
        code: "ambiguous_structure",
        evidenceIds: publicEvidenceIds(edgeEntries[index]!.source.evidenceRefs, evidence),
        sortKey: `symmetric-edge:${edgeEntries[index]!.tie}`,
      });
    }
  }
  const edges = edgeEntries.map((entry, index) => ({ source: entry.source, id: `edge:e:${index + 1}`, index }));
  const unresolved = proposal.unresolved.slice().sort((left, right) => compareCodeUnits(unresolvedTie(left, evidence), unresolvedTie(right, evidence)));
  return { nodes, ports, edges, unresolved, blockingReasons: blockingReasons.sort((left, right) => compareCodeUnits(left.sortKey, right.sortKey)) };
}

function buildUgs(canonical: CanonicalProposal, evidence: EvidenceIndex, candidate: boolean, clarification?: StructuralClarification, confirmed = false): UniversalGraphSpec {
  const nodeByLocalRef = new Map(canonical.nodes.map((node) => [node.source.localRef, node]));
  const portByLocalRef = new Map(canonical.ports.map((port) => [port.source.localRef, port]));
  const referencedEvidence = new Set(canonical.nodes.flatMap((node) => [...node.source.evidenceRefs, ...node.source.inputLocalRefs.flatMap((ref) => [])])
    .concat(canonical.ports.flatMap((port) => [...port.source.evidenceRefs]))
    .concat(canonical.edges.flatMap((edge) => [...edge.source.evidenceRefs]))
    .concat(canonical.unresolved.flatMap((item) => [...item.evidenceRefs])));
  const evidenceItems = [...referencedEvidence].map((ref) => evidence.forFact(ref)).sort((left, right) => compareCodeUnits(left.evidence.evidenceId, right.evidence.evidenceId));
  const sourceIds = dedupe(evidenceItems.map((item) => publicSourceId(item.evidence.sourceKind))).sort(compareCodeUnits);
  const sourceHashes = dedupe(evidenceItems.map((item) => item.evidence.sourceHash)).sort(compareCodeUnits);
  const safeSourceIds = sourceIds.length > 0 ? sourceIds : ["architecture_fact"];
  const safeSourceHashes = sourceHashes.length > 0 ? sourceHashes : ["0".repeat(64)];
  const ugs = {
    version: 1 as const,
    graphId: "graph:canonical",
    revision: 1,
    sourceIds: safeSourceIds,
    sourceHashes: safeSourceHashes,
    nodes: canonical.nodes.map((node) => ({
      nodeId: node.id,
      kind: projectNodeKind(node.source.kind),
      label: projectNodeLabel(node.source, evidence),
      semanticHints: [node.source.kind, ...verifiedSemanticHints(node.source, evidence)],
      inputPortIds: node.source.inputLocalRefs.map((ref) => portByLocalRef.get(ref)?.id).filter((id): id is string => Boolean(id)).sort(compareCodeUnits),
      outputPortIds: node.source.outputLocalRefs.map((ref) => portByLocalRef.get(ref)?.id).filter((id): id is string => Boolean(id)).sort(compareCodeUnits),
      attributes: {},
      shapeClaim: "unknown" as const,
      operationKnowledge: node.source.kind === "operator" ? "custom" as const : "inferred" as const,
      evidenceIds: publicEvidenceIds(node.source.evidenceRefs, evidence),
    })),
    ports: canonical.ports.map((port) => ({
      portId: port.id,
      nodeId: nodeByLocalRef.get(port.source.nodeLocalRef)!.id,
      direction: port.source.direction,
      label: null,
      representation: null,
      semanticType: null,
      evidenceIds: publicEvidenceIds(port.source.evidenceRefs, evidence),
    })),
    edges: canonical.edges.map((edge) => ({
      edgeId: edge.id,
      sourcePortId: portByLocalRef.get(edge.source.sourcePortLocalRef)!.id,
      targetPortId: portByLocalRef.get(edge.source.targetPortLocalRef)!.id,
      relation: candidate ? "candidate" as const : edge.source.relation,
      knowledge: candidate ? "candidate" as const : "proven" as const,
      evidenceIds: publicEvidenceIds(edge.source.evidenceRefs, evidence),
    })),
    groups: [],
    evidence: evidenceItems.map((item) => ({
      evidenceId: item.evidence.evidenceId,
      sourceId: publicSourceId(item.evidence.sourceKind),
      sourceHash: item.evidence.sourceHash,
      locator: `${item.evidence.locatorKind}:${item.evidence.locatorOrdinal}`,
      excerptDigest: item.evidence.excerptDigest,
    })),
    topologyConfidence: candidate ? 0.5 : 1,
    unresolved: [
      ...canonical.unresolved.filter((item) => !(confirmed && item.severity === "blocking")).map((item, index) => ({ id: `unresolved:u:${index + 1}`, scope: item.scope, severity: item.severity, evidenceIds: publicEvidenceIds(item.evidenceRefs, evidence) })),
      ...(clarification ? [{ id: `clarification:${clarification.hash.slice(0, 16)}`, scope: "topology" as const, severity: "blocking" as const, evidenceIds: clarification.evidenceIds }] : []),
    ],
  };
  return parseUniversalGraphSpec(ugs);
}

class HarnessValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}

class EvidenceIndex {
  private readonly facts = new Map<string, EvidenceFact>();
  constructor(pack: EvidencePack) {
    for (const fact of pack.facts) this.facts.set(fact.localFactRef, fact);
  }
  get(ref: string): EvidenceFact {
    const fact = this.facts.get(ref);
    if (!fact) throw new HarnessValidationError("unknown_evidence_fact");
    return fact;
  }
  forFact(ref: string): EvidenceFact { return this.get(ref); }
  minimumConfidence(refs: readonly string[]): number | null { const values = refs.map((ref) => this.get(ref).confidence).filter((value): value is number => value !== null); return values.length === 0 ? null : Math.min(...values); }
}

function checkEvidence(refs: readonly string[], evidence: EvidenceIndex): void { if (refs.length === 0) throw new HarnessValidationError("missing_evidence"); for (const ref of refs) evidence.get(ref); }
function publicEvidenceIds(refs: readonly string[], evidence: EvidenceIndex): string[] { return dedupe(refs.map((ref) => evidence.get(ref).evidence.evidenceId)).sort(compareCodeUnits); }
function nodeFingerprintBase(node: InterpreterLocalNode, evidence: EvidenceIndex): string { return `${node.kind}|in:${node.inputLocalRefs.length}|out:${node.outputLocalRefs.length}|e:${publicEvidenceIds(node.evidenceRefs, evidence).join(",")}`; }
function relationSignature(edge: InterpreterLocalEdge, side: "in" | "out", ports: Map<string, InterpreterLocalPort>, nodes: Map<string, InterpreterLocalNode>, labels: Map<string, string>): string { const ref = side === "in" ? edge.sourcePortLocalRef : edge.targetPortLocalRef; const port = ports.get(ref)!; const node = nodes.get(port.nodeLocalRef)!; return `${edge.relation}|${side}|${node.kind}|${labels.get(node.localRef)}`; }
function canonicalNodeTie(node: InterpreterLocalNode, incoming: Map<string, InterpreterLocalEdge[]>, outgoing: Map<string, InterpreterLocalEdge[]>, ports: Map<string, InterpreterLocalPort>, labels: Map<string, string>, evidence: EvidenceIndex): string { return `${node.kind}|${node.inputLocalRefs.map((ref) => ports.get(ref)?.direction).join(",")}|${node.outputLocalRefs.map((ref) => ports.get(ref)?.direction).join(",")}|in:${(incoming.get(node.localRef) ?? []).map((edge) => `${edge.relation}:${labels.get(ports.get(edge.sourcePortLocalRef)!.nodeLocalRef)}`).sort(compareCodeUnits).join(",")}|out:${(outgoing.get(node.localRef) ?? []).map((edge) => `${edge.relation}:${labels.get(ports.get(edge.targetPortLocalRef)!.nodeLocalRef)}`).sort(compareCodeUnits).join(",")}|e:${publicEvidenceIds(node.evidenceRefs, evidence).join(",")}`; }
function canonicalPortTie(port: InterpreterLocalPort, edges: readonly InterpreterLocalEdge[], nodeIndex: Map<string, number>, ports: Map<string, InterpreterLocalPort>, evidence: EvidenceIndex): string {
  const incident = edges
    .filter((edge) => edge.sourcePortLocalRef === port.localRef || edge.targetPortLocalRef === port.localRef)
    .map((edge) => {
      const oppositeRef = edge.sourcePortLocalRef === port.localRef ? edge.targetPortLocalRef : edge.sourcePortLocalRef;
      const opposite = ports.get(oppositeRef)!;
      return `${edge.relation}|${nodeIndex.get(opposite.nodeLocalRef)}|${opposite.direction}|e:${publicEvidenceIds(edge.evidenceRefs, evidence).join(",")}|p:${publicEvidenceIds(opposite.evidenceRefs, evidence).join(",")}`;
    })
    .sort(compareCodeUnits);
  return `${nodeIndex.get(port.nodeLocalRef)}|${port.direction}|e:${publicEvidenceIds(port.evidenceRefs, evidence).join(",")}|i:${incident.join(",")}`;
}
function edgeTie(edge: InterpreterLocalEdge, nodeIndex: Map<string, number>, portIndex: Map<string, number>, ports: Map<string, InterpreterLocalPort>, evidence: EvidenceIndex): string {
  return `${nodeIndex.get(ports.get(edge.sourcePortLocalRef)!.nodeLocalRef)}|p:${portIndex.get(edge.sourcePortLocalRef)}|${nodeIndex.get(ports.get(edge.targetPortLocalRef)!.nodeLocalRef)}|p:${portIndex.get(edge.targetPortLocalRef)}|${edge.relation}|${publicEvidenceIds(edge.evidenceRefs, evidence).join(",")}`;
}
function clarificationFor(reason: StructuralReason, ugs: UniversalGraphSpec): StructuralClarification { const code = reason.code; const prompt = code === "ambiguous_structure" ? "Two structural branches remain indistinguishable from verified evidence. Confirm which relation or label distinguishes them." : code === "low_confidence_structure" ? "A terminal or edge relation is below the confidence required for formal topology. Confirm its direction and meaning." : "A blocking structural question remains unresolved. Confirm the missing operation or relation before formalization."; const hash = digest({ code, prompt, evidenceIds: reason.evidenceIds, ugsHash: digest(ugs) }); return { code, prompt, evidenceIds: reason.evidenceIds, hash }; }
function projectNodeKind(kind: LocalNodeKind): UniversalNodeKind { return kind === "input" ? "input" : kind === "output" ? "output" : kind === "module" ? "custom_module" : "custom_operator"; }
function publicSourceId(sourceKind: EvidenceSourceKind): string { return `source:${sourceKind.replaceAll("_", "-")}`; }
function projectNodeLabel(node: InterpreterLocalNode, evidence: EvidenceIndex): string {
  if (node.kind === "input") return "Input";
  if (node.kind === "output") return "Output";
  const hints = verifiedSemanticHints(node, evidence);
  const operation = hints.find((hint) => hint.startsWith("operation:"))?.slice("operation:".length);
  if (operation) return operationLabel(operation);
  return node.kind === "module" ? "Custom module" : "Custom operator";
}
function verifiedSemanticHints(node: InterpreterLocalNode, evidence: EvidenceIndex): string[] {
  const hints = new Set<string>();
  for (const ref of node.evidenceRefs) {
    const fact = evidence.get(ref);
    if (fact.sourceKind !== "typed_declaration" && fact.sourceKind !== "static_analysis") continue;
    const summary = fact.summary.toLowerCase();
    if (/\badd(?:ition)?\b/.test(summary)) hints.add("operation:add");
    if (/\bconcat(?:enat(?:e|ion))?\b|\bcat\b/.test(summary)) hints.add("operation:concat");
    if (/\bgated[_ -]?sum\b/.test(summary)) hints.add("operation:gated_sum");
    if (/\battention\b/.test(summary)) hints.add("operation:attention");
    if (/\brepeat(?:group|block)?\b/.test(summary)) hints.add("operation:repeat");
  }
  return [...hints].sort(compareCodeUnits);
}
function operationLabel(operation: string): string { return operation === "add" ? "Add" : operation === "concat" ? "Concat" : operation === "gated_sum" ? "Gated sum" : operation === "attention" ? "Attention" : operation === "repeat" ? "Repeat" : "Custom operator"; }
function walkNodes(starts: readonly string[], relations: Map<string, InterpreterLocalEdge[]>, ports: Map<string, InterpreterLocalPort>, direction: "forward" | "backward"): Set<string> {
  const visited = new Set(starts);
  const pending = [...starts];
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const edge of relations.get(current) ?? []) {
      // Feedback is preserved as a relation, but cannot establish the primary input/output path.
      if (edge.relation === "feedback") continue;
      const portRef = direction === "forward" ? edge.targetPortLocalRef : edge.sourcePortLocalRef;
      const next = ports.get(portRef)!.nodeLocalRef;
      if (!visited.has(next)) { visited.add(next); pending.push(next); }
    }
  }
  return visited;
}
function canonicalEvidenceSort(refs: readonly string[], evidence: EvidenceIndex): string { return publicEvidenceIds(refs, evidence).join(","); }
function unresolvedTie(item: InterpreterLocalUnresolved, evidence: EvidenceIndex): string { return `${publicEvidenceIds(item.evidenceRefs, evidence).join(",")}\u0000${item.scope}\u0000${item.severity}`; }
function record(value: unknown, location: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new HarnessValidationError(`invalid_object_${location}`); return value as Record<string, any>; }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new HarnessValidationError("unknown_proposal_field"); }
function localRef(value: unknown): string { if (typeof value !== "string" || !localRefPattern.test(value)) throw new HarnessValidationError("invalid_local_ref"); return value; }
function displayLabel(value: unknown): string { if (typeof value !== "string" || value.length === 0 || value.length > 160 || unsafeTextPattern.test(value)) throw new HarnessValidationError("unsafe_display_text"); return value; }
function refList(value: unknown, code: string): string[] { if (!Array.isArray(value) || value.length > 64) throw new HarnessValidationError(`invalid_ref_list_${code}`); const refs = value.map(localRef); unique(refs, "duplicate_relation_ref"); return refs; }
function factRefList(value: unknown, code: string): string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new HarnessValidationError(`invalid_fact_list_${code}`); const refs = value.map((item) => { if (typeof item !== "string" || !factRefPattern.test(item)) throw new HarnessValidationError("invalid_fact_ref"); return item; }); unique(refs, "duplicate_fact_ref"); return refs; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) throw new HarnessValidationError("invalid_enum"); return value as T; }
function unique<T>(values: readonly T[], code = "duplicate_value"): T[] { if (new Set(values).size !== values.length) throw new HarnessValidationError(code); return [...values]; }
function dedupe<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function digest(value: unknown): string { return digestDrawingArtifact(value); }

function assertOwner(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Local proposal owner is invalid");
}
