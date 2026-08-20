import type { ArchitectureEdge, ArchitectureIRNode, ArchitectureIRv3, TypedPort, UnresolvedQuestion } from "./network-ir-v3.js";
import { parseUniversalGraphSpec, type UniversalEdgeRelation, type UniversalEvidence, type UniversalGraphSpec, type UniversalNode, type UniversalNodeKind } from "./universal-graph-spec.js";
import { compareCodeUnits } from "./stable-string-order.js";

const knownOperatorRoles = new Set([
  "conv2d", "normalization", "activation", "pool", "dense", "flatten", "identity_projection",
  "token_projection", "encoder_stage", "decoder_stage", "self_attention", "cross_attention",
]);

export function projectArchitectureIrV3ToUniversalGraphSpec(ir: ArchitectureIRv3): UniversalGraphSpec {
  const projectedEvidence = projectEvidence(ir);
  const sourceIds = unique(projectedEvidence.items.map((item) => item.sourceId));
  const sourceHashes = unique(projectedEvidence.items.map((item) => item.sourceHash));
  const safeEvidence = projectedEvidence.items.length > 0 ? projectedEvidence.items : [{ evidenceId: "architecture-v3", sourceId: "architecture-v3", sourceHash: "0".repeat(64), locator: "architecture-v3", excerptDigest: "0".repeat(64) }];
  const repeatGroupIds = allocateRepeatGroupIds(ir);

  return parseUniversalGraphSpec({
    version: 1,
    graphId: ir.graphId,
    revision: 1,
    sourceIds: sourceIds.length > 0 ? sourceIds : ["architecture-v3"],
    sourceHashes: sourceHashes.length > 0 ? sourceHashes : ["0".repeat(64)],
    nodes: ir.nodes.map((node) => projectNode(node, repeatGroupIds, projectedEvidence.idsBySourceEvidenceId)),
    ports: ir.nodes.flatMap((node) => [
      ...node.inputPorts.map((port) => projectPort(node.id, port, "input")),
      ...node.outputPorts.map((port) => projectPort(node.id, port, "output")),
    ]),
    edges: ir.edges.map((edge) => projectEdge(edge, projectedEvidence.idsBySourceEvidenceId)),
    groups: [
      ...ir.modules.map((module) => ({
        groupId: module.id,
        label: module.label,
        memberNodeIds: [...module.memberNodeIds],
        evidenceIds: projectEvidenceIds(module.evidenceIds, projectedEvidence.idsBySourceEvidenceId),
      })),
      ...ir.nodes.filter((node) => node.repeat).map((node) => ({
        groupId: repeatGroupIds.get(node.id)!,
        label: `${node.semanticRole} unit`,
        memberNodeIds: [...node.repeat!.unitNodeIds],
        evidenceIds: projectEvidenceIds(node.evidenceIds, projectedEvidence.idsBySourceEvidenceId),
      })),
    ],
    evidence: safeEvidence,
    topologyConfidence: ir.unresolved.some((item) => isTopologyQuestion(item) && item.severity === "blocking") ? 0.5 : 1,
    unresolved: ir.unresolved.map((question) => projectUnresolved(question, projectedEvidence.idsBySourceEvidenceId)),
  });
}

function projectNode(node: ArchitectureIRNode, repeatGroupIds: Map<string, string>, evidenceIdsBySourceEvidenceId: Map<string, string[]>): UniversalNode {
  const kind = projectNodeKind(node);
  return {
    nodeId: node.id,
    kind,
    label: node.semanticRole,
    semanticHints: semanticHints(node),
    inputPortIds: node.inputPorts.map((port) => portId(node.id, port.id)),
    outputPortIds: node.outputPorts.map((port) => portId(node.id, port.id)),
    attributes: nodeAttributes(node, repeatGroupIds),
    shapeClaim: nodeHasKnownShape(node) ? "proven" : "unknown",
    operationKnowledge: kind === "custom_operator" || kind === "custom_module" ? "custom" : "known",
    evidenceIds: projectEvidenceIds(node.evidenceIds, evidenceIdsBySourceEvidenceId),
  };
}

function projectNodeKind(node: ArchitectureIRNode): UniversalNodeKind {
  if (node.kind === "input") return "input";
  if (node.kind === "output") return "output";
  if (node.kind === "module") return "custom_module";
  if (node.kind === "process") return "state";
  if (node.kind === "repeat") return "container";
  if (node.kind === "operator" && !knownOperatorRoles.has(node.semanticRole)) return "custom_operator";
  return "operator";
}

function semanticHints(node: ArchitectureIRNode): string[] {
  const hints = [node.kind, node.semanticRole];
  if (node.kind === "merge") hints.push(node.mergeKind);
  if (node.kind === "attention") hints.push(node.attentionKind);
  if (node.repeat) hints.push("repeat");
  return unique(hints);
}

function nodeAttributes(node: ArchitectureIRNode, repeatGroupIds: Map<string, string>): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {};
  if (node.kind === "merge") attributes.mergeKind = node.mergeKind;
  if (node.kind === "attention") attributes.attentionKind = node.attentionKind;
  if (node.repeat) {
    attributes.repeatCount = node.repeat.count === "unknown" ? null : node.repeat.count;
    attributes.repeatExpansion = node.repeat.expansionPolicy;
    attributes.repeatGroupId = repeatGroupIds.get(node.id)!;
  }
  return attributes;
}

function allocateRepeatGroupIds(ir: ArchitectureIRv3): Map<string, string> {
  const reservedIds = new Set(ir.modules.map((module) => module.id));
  const allocated = new Map<string, string>();
  for (const node of ir.nodes.filter((item) => item.repeat)) {
    const base = `repeat-unit:${node.id}`;
    let groupId = base;
    let suffix = 1;
    while (reservedIds.has(groupId)) groupId = `${base}:projection-${suffix++}`;
    reservedIds.add(groupId);
    allocated.set(node.id, groupId);
  }
  return allocated;
}

function projectPort(nodeId: string, port: TypedPort, direction: "input" | "output") {
  return {
    portId: portId(nodeId, port.id),
    nodeId,
    direction,
    label: null,
    representation: port.representation,
    semanticType: port.semanticType,
    evidenceIds: [],
  };
}

function projectEdge(edge: ArchitectureEdge, evidenceIdsBySourceEvidenceId: Map<string, string[]>) {
  const relation: UniversalEdgeRelation = edge.transport === "condition" ? "condition" : edge.transport === "feedback" ? "feedback" : "data";
  return {
    edgeId: edge.id,
    sourcePortId: portId(edge.source.nodeId, edge.source.portId),
    targetPortId: portId(edge.target.nodeId, edge.target.portId),
    relation,
    knowledge: "proven" as const,
    evidenceIds: projectEvidenceIds(edge.evidenceIds, evidenceIdsBySourceEvidenceId),
  };
}

function projectEvidence(ir: ArchitectureIRv3): { items: UniversalEvidence[]; idsBySourceEvidenceId: Map<string, string[]> } {
  const idsBySourceEvidenceId = new Map<string, string[]>();
  const reservedEvidenceIds = new Set(Object.keys(ir.evidenceIndex));
  const items = Object.entries(ir.evidenceIndex).sort(([left], [right]) => compareCodeUnits(left, right)).flatMap(([evidenceId, refs]) => {
    const projectedIds = refs.map((_, index) => index === 0 ? evidenceId : allocateDerivedEvidenceId(evidenceId, index + 1, reservedEvidenceIds));
    idsBySourceEvidenceId.set(evidenceId, projectedIds);
    return refs.map((ref, index) => ({
      evidenceId: projectedIds[index]!,
      sourceId: ref.sourceId,
      sourceHash: ref.sourceSha256,
      locator: `evidence:${evidenceId}:${index + 1}`,
      excerptDigest: ref.excerptDigest,
    }));
  });
  return { items, idsBySourceEvidenceId };
}

function allocateDerivedEvidenceId(sourceEvidenceId: string, ordinal: number, reservedEvidenceIds: Set<string>): string {
  const base = `${sourceEvidenceId}:source-${ordinal}`;
  let candidate = base;
  let suffix = 2;
  while (reservedEvidenceIds.has(candidate)) candidate = `${base}:projection-${suffix++}`;
  reservedEvidenceIds.add(candidate);
  return candidate;
}

function projectUnresolved(question: UnresolvedQuestion, evidenceIdsBySourceEvidenceId: Map<string, string[]>) {
  return {
    id: question.id,
    scope: isTopologyQuestion(question) ? "topology" as const : isShapeQuestion(question) ? "shape" as const : "operation" as const,
    severity: question.severity,
    evidenceIds: projectEvidenceIds(question.evidenceFactIds, evidenceIdsBySourceEvidenceId),
  };
}

function projectEvidenceIds(sourceEvidenceIds: string[], idsBySourceEvidenceId: Map<string, string[]>): string[] {
  return unique(sourceEvidenceIds.flatMap((evidenceId) => idsBySourceEvidenceId.get(evidenceId) ?? [evidenceId]));
}

function isTopologyQuestion(question: UnresolvedQuestion): boolean {
  return /(?:topology|edge|connect|direction|branch|merge|concat|add)/i.test(question.conflictKey);
}

function isShapeQuestion(question: UnresolvedQuestion): boolean {
  return /(?:shape|dimension|axis|channel|width|height)/i.test(question.conflictKey);
}

function nodeHasKnownShape(node: ArchitectureIRNode): boolean {
  return [...node.inputPorts, ...node.outputPorts].some((port) => port.shape?.dimensions.every((dimension) => dimension.kind === "known"));
}

function portId(nodeId: string, localPortId: string): string {
  return `${nodeId}:${localPortId}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
