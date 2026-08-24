import type { ArchitectureEdge, ArchitectureIRNode, ArchitectureIRv3, TypedPort, UnresolvedQuestion } from "./network-ir-v3.js";
import { parseUniversalGraphSpec, UNIVERSAL_TENSOR_AXIS_ORDER, type UniversalEdgeRelation, type UniversalEvidence, type UniversalGraphSpec, type UniversalNode, type UniversalNodeKind, type UniversalTensorAxis, type UniversalTensorDimension, type UniversalTensorFacts } from "./universal-graph-spec.js";
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
    nodes: ir.nodes.map((node) => projectNode(node, repeatGroupIds, projectedEvidence.idsBySourceEvidenceId, projectedEvidence.sourceEvidenceIds)),
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
        evidenceIds: projectStructuralEvidenceIds(module.evidenceIds, "group", module.id, projectedEvidence.idsBySourceEvidenceId),
      })),
      ...ir.nodes.filter((node) => node.repeat).map((node) => ({
        groupId: repeatGroupIds.get(node.id)!,
        label: `${node.semanticRole} unit`,
        memberNodeIds: [...node.repeat!.unitNodeIds],
        evidenceIds: projectStructuralEvidenceIds(node.evidenceIds, "node", node.id, projectedEvidence.idsBySourceEvidenceId),
      })),
    ],
    evidence: safeEvidence,
    topologyConfidence: ir.unresolved.some((item) => isTopologyQuestion(item) && item.severity === "blocking") ? 0.5 : 1,
    unresolved: ir.unresolved.map((question) => projectUnresolved(question, projectedEvidence.idsBySourceEvidenceId)),
  });
}

function projectNode(
  node: ArchitectureIRNode,
  repeatGroupIds: Map<string, string>,
  evidenceIdsBySourceEvidenceId: Map<string, string[]>,
  sourceEvidenceIds: Set<string>,
): UniversalNode {
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
    evidenceIds: projectStructuralEvidenceIds(node.evidenceIds, "node", node.id, evidenceIdsBySourceEvidenceId),
    tensorFacts: projectTensorFacts(node, evidenceIdsBySourceEvidenceId, sourceEvidenceIds),
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
    knowledge: edge.evidenceIds.length === 0 ? "declared" as const : "proven" as const,
    evidenceIds: projectStructuralEvidenceIds(edge.evidenceIds, "edge", edge.id, evidenceIdsBySourceEvidenceId),
  };
}

function projectEvidence(ir: ArchitectureIRv3): { items: UniversalEvidence[]; idsBySourceEvidenceId: Map<string, string[]>; sourceEvidenceIds: Set<string> } {
  const idsBySourceEvidenceId = new Map<string, string[]>();
  const sourceEvidenceIds = new Set<string>();
  const referencedEvidenceIds = collectReferencedEvidenceIds(ir);
  const reservedEvidenceIds = new Set([...Object.keys(ir.evidenceIndex), ...referencedEvidenceIds]);
  const items = Object.entries(ir.evidenceIndex).sort(([left], [right]) => compareCodeUnits(left, right)).flatMap(([evidenceId, refs]) => {
    const projectedIds = refs.map((_, index) => index === 0 ? evidenceId : allocateDerivedEvidenceId(evidenceId, index + 1, reservedEvidenceIds));
    if (projectedIds.length > 0) {
      idsBySourceEvidenceId.set(evidenceId, projectedIds);
      sourceEvidenceIds.add(evidenceId);
    }
    return refs.map((ref, index) => ({
      evidenceId: projectedIds[index]!,
      sourceId: ref.sourceId,
      sourceHash: ref.sourceSha256,
      locator: `evidence:${evidenceId}:${index + 1}`,
      excerptDigest: ref.excerptDigest,
    }));
  });

  for (const evidenceId of referencedEvidenceIds) {
    if (idsBySourceEvidenceId.has(evidenceId)) continue;
    idsBySourceEvidenceId.set(evidenceId, [evidenceId]);
    items.push(structuralFallbackEvidence(evidenceId));
  }

  return { items: items.sort((left, right) => compareCodeUnits(left.evidenceId, right.evidenceId)), idsBySourceEvidenceId, sourceEvidenceIds };
}

function projectTensorFacts(
  node: ArchitectureIRNode,
  evidenceIdsBySourceEvidenceId: Map<string, string[]>,
  sourceEvidenceIds: Set<string>,
): UniversalTensorFacts | null {
  const evidenceIds = projectEvidenceIds(node.evidenceIds.filter((id) => sourceEvidenceIds.has(id)), evidenceIdsBySourceEvidenceId);
  if (evidenceIds.length === 0) return null;

  const projectedShapes = [...node.inputPorts, ...node.outputPorts]
    .flatMap((port) => port.shape ? [projectTensorShape(port.shape)] : [])
    .filter((facts): facts is Omit<UniversalTensorFacts, "evidenceIds"> => facts !== null);
  const distinctShapes = new Map(projectedShapes.map((facts) => [JSON.stringify(facts), facts]));
  if (distinctShapes.size !== 1) return null;

  return { ...distinctShapes.values().next().value!, evidenceIds };
}

function projectTensorShape(shape: NonNullable<TypedPort["shape"]>): Omit<UniversalTensorFacts, "evidenceIds"> | null {
  const facts = new Map<UniversalTensorAxis, UniversalTensorDimension>();
  for (const [index, sourceAxis] of shape.axes.entries()) {
    const axis = projectTensorAxis(sourceAxis);
    if (!axis) continue;
    const dimension = shape.dimensions[index]!;
    facts.set(axis, dimension.kind === "known" ? dimension.value : dimension.kind === "symbol" ? "symbolic" : "unknown");
  }
  const axes = UNIVERSAL_TENSOR_AXIS_ORDER.filter((axis) => facts.has(axis));
  if (axes.length === 0) return null;
  return { axes, dimensions: Object.fromEntries(axes.map((axis) => [axis, facts.get(axis)!])) };
}

function projectTensorAxis(axis: string): UniversalTensorAxis | null {
  switch (axis) {
    case "B": return "batch";
    case "C": return "channels";
    case "H": return "height";
    case "W": return "width";
    case "T": return "tokens";
    case "F": return "features";
    default: return null;
  }
}

function collectReferencedEvidenceIds(ir: ArchitectureIRv3): string[] {
  return unique([
    ...ir.nodes.flatMap((node) => structuralSourceEvidenceIds(node.evidenceIds, "node", node.id)),
    ...ir.edges.flatMap((edge) => structuralSourceEvidenceIds(edge.evidenceIds, "edge", edge.id)),
    ...ir.modules.flatMap((module) => structuralSourceEvidenceIds(module.evidenceIds, "group", module.id)),
    ...ir.unresolved.flatMap((question) => structuralSourceEvidenceIds(question.evidenceFactIds, "unresolved", question.id)),
  ]).sort(compareCodeUnits);
}

function structuralFallbackEvidence(evidenceId: string): UniversalEvidence {
  return {
    evidenceId,
    sourceId: "architecture-v3",
    sourceHash: "0".repeat(64),
    locator: `architecture-v3:${evidenceId}`,
    excerptDigest: "0".repeat(64),
  };
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
    evidenceIds: projectStructuralEvidenceIds(question.evidenceFactIds, "unresolved", question.id, evidenceIdsBySourceEvidenceId),
  };
}

function projectStructuralEvidenceIds(
  sourceEvidenceIds: string[],
  kind: "node" | "edge" | "group" | "unresolved",
  entityId: string,
  idsBySourceEvidenceId: Map<string, string[]>,
): string[] {
  return projectEvidenceIds(structuralSourceEvidenceIds(sourceEvidenceIds, kind, entityId), idsBySourceEvidenceId);
}

function structuralSourceEvidenceIds(
  sourceEvidenceIds: string[],
  kind: "node" | "edge" | "group" | "unresolved",
  entityId: string,
): string[] {
  return sourceEvidenceIds.length > 0 ? sourceEvidenceIds : [`architecture-v3-${kind}:${entityId}`];
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
