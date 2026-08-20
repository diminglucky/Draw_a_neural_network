import { getUniversalGraphEligibility, type UniversalGraphSpec } from "./universal-graph-spec.js";

export type GeneralPublicationComponentRole = "input" | "output" | "generic_module" | "custom_operator" | "custom_module" | "split" | "merge_add" | "merge_concat" | "custom_fusion" | "repeat_badge" | "candidate_region";

export interface GeneralPublicationComponent {
  componentId: string;
  role: GeneralPublicationComponentRole;
  label: string;
  count?: number;
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  evidenceIds: string[];
  layoutOrder: { rank: number; order: number };
}

export interface GeneralPublicationRelation {
  relationId: string;
  role: "flow" | "skip" | "merge" | "condition" | "feedback";
  sourceComponentId: string;
  targetComponentId: string;
  sourceEdgeIds: string[];
  evidenceIds: string[];
}

export interface GeneralPublicationGraph {
  version: 1;
  graphId: string;
  detail: "overview" | "architecture" | "operator_detail";
  exportEligibility: "eligible" | "ineligible";
  components: GeneralPublicationComponent[];
  relations: GeneralPublicationRelation[];
  sourceMappings: Array<{ componentId: string; sourceNodeIds: string[]; sourceEdgeIds: string[]; evidenceIds: string[] }>;
}

export function composeGeneralPublicationGraph(ugs: UniversalGraphSpec, intent: { detail: "overview" | "architecture" | "operator_detail" }): GeneralPublicationGraph {
  const rankByNodeId = ranksFor(ugs);
  const nodeComponentId = (nodeId: string) => `node:${nodeId}`;
  const orderedNodes = [...ugs.nodes].sort((left, right) => rankByNodeId.get(left.nodeId)! - rankByNodeId.get(right.nodeId)! || left.nodeId.localeCompare(right.nodeId));
  const components: GeneralPublicationComponent[] = [];

  for (const [order, node] of orderedNodes.entries()) {
    const rank = rankByNodeId.get(node.nodeId)!;
    components.push({
      componentId: nodeComponentId(node.nodeId),
      role: roleForNode(node),
      label: node.label,
      sourceNodeIds: [node.nodeId],
      sourceEdgeIds: [],
      evidenceIds: uniqueSorted(node.evidenceIds),
      layoutOrder: { rank, order },
    });
    if (node.kind === "custom_module" && node.inputPortIds.length > 1) {
      components.push({
        componentId: `fusion:${node.nodeId}`,
        role: "custom_fusion",
        label: node.label,
        sourceNodeIds: [node.nodeId],
        sourceEdgeIds: [],
        evidenceIds: uniqueSorted(node.evidenceIds),
        layoutOrder: { rank, order: order + orderedNodes.length },
      });
    }
    const repeatCount = node.attributes.repeatCount;
    if (typeof repeatCount === "number" && repeatCount > 1) {
      const repeatGroupId = node.attributes.repeatGroupId;
      const repeatGroup = typeof repeatGroupId === "string" ? ugs.groups.find((group) => group.groupId === repeatGroupId) : undefined;
      components.push({
        componentId: `repeat:${node.nodeId}`,
        role: "repeat_badge",
        label: `×${repeatCount}`,
        count: repeatCount,
        sourceNodeIds: uniqueSorted([node.nodeId, ...(repeatGroup?.memberNodeIds ?? [])]),
        sourceEdgeIds: [],
        evidenceIds: uniqueSorted([...node.evidenceIds, ...(repeatGroup?.evidenceIds ?? [])]),
        layoutOrder: { rank, order: order + orderedNodes.length * 2 },
      });
    }
  }

  const relations: GeneralPublicationRelation[] = [];
  const candidateEdges = [];
  for (const edge of [...ugs.edges].sort((left, right) => left.edgeId.localeCompare(right.edgeId))) {
    const sourceNodeId = portOwner(ugs, edge.sourcePortId);
    const targetNodeId = portOwner(ugs, edge.targetPortId);
    if (!sourceNodeId || !targetNodeId) continue;
    if (edge.relation === "candidate" || edge.knowledge === "candidate" || edge.relation === "feedback") {
      candidateEdges.push({ edge, sourceNodeId, targetNodeId });
      continue;
    }
    relations.push({
      relationId: `relation:${edge.edgeId}`,
      role: relationRole(edge.relation),
      sourceComponentId: nodeComponentId(sourceNodeId),
      targetComponentId: nodeComponentId(targetNodeId),
      sourceEdgeIds: [edge.edgeId],
      evidenceIds: uniqueSorted(edge.evidenceIds),
    });
  }
  for (const [index, candidate] of candidateEdges.entries()) {
    components.push({
      componentId: `candidate:${candidate.edge.edgeId}`,
      role: "candidate_region",
      label: "Topology candidate",
      sourceNodeIds: [candidate.sourceNodeId, candidate.targetNodeId].sort(),
      sourceEdgeIds: [candidate.edge.edgeId],
      evidenceIds: uniqueSorted(candidate.edge.evidenceIds),
      layoutOrder: { rank: Math.max(rankByNodeId.get(candidate.sourceNodeId) ?? 0, rankByNodeId.get(candidate.targetNodeId) ?? 0), order: orderedNodes.length * 3 + index },
    });
  }
  const blockingTopologyUnresolved = ugs.unresolved
    .filter((item) => item.scope === "topology" && item.severity === "blocking")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const [index, unresolved] of blockingTopologyUnresolved.entries()) {
    const sourceNodeIds = ugs.nodes
      .filter((node) => node.evidenceIds.some((evidenceId) => unresolved.evidenceIds.includes(evidenceId)))
      .map((node) => node.nodeId)
      .sort((left, right) => left.localeCompare(right));
    components.push({
      componentId: `candidate:unresolved:${unresolved.id}`,
      role: "candidate_region",
      label: "Topology candidate",
      sourceNodeIds,
      sourceEdgeIds: [],
      evidenceIds: uniqueSorted(unresolved.evidenceIds),
      layoutOrder: {
        rank: Math.max(0, ...sourceNodeIds.map((nodeId) => rankByNodeId.get(nodeId) ?? 0)),
        order: orderedNodes.length * 3 + candidateEdges.length + index,
      },
    });
  }

  const sortedComponents = [...components].sort((left, right) => left.layoutOrder.rank - right.layoutOrder.rank || left.layoutOrder.order - right.layoutOrder.order || left.componentId.localeCompare(right.componentId));
  const eligibility = getUniversalGraphEligibility(ugs);
  const exportEligibility = candidateEdges.some((item) => item.edge.relation === "feedback") ? "ineligible" : eligibility.export;
  return {
    version: 1,
    graphId: ugs.graphId,
    detail: intent.detail,
    exportEligibility,
    components: sortedComponents,
    relations,
    sourceMappings: sortedComponents.map((component) => ({
      componentId: component.componentId,
      sourceNodeIds: [...component.sourceNodeIds],
      sourceEdgeIds: [...component.sourceEdgeIds],
      evidenceIds: [...component.evidenceIds],
    })),
  };
}

function ranksFor(ugs: UniversalGraphSpec): Map<string, number> {
  const rankByNodeId = new Map(ugs.nodes.map((node) => [node.nodeId, 0]));
  const edges = ugs.edges
    .filter((edge) => edge.relation !== "candidate" && edge.knowledge !== "candidate" && edge.relation !== "feedback")
    .map((edge) => ({ edge, sourceNodeId: portOwner(ugs, edge.sourcePortId), targetNodeId: portOwner(ugs, edge.targetPortId) }))
    .filter((item): item is { edge: UniversalGraphSpec["edges"][number]; sourceNodeId: string; targetNodeId: string } => item.sourceNodeId !== null && item.targetNodeId !== null)
    .sort((left, right) => left.edge.edgeId.localeCompare(right.edge.edgeId));
  for (let iteration = 0; iteration < ugs.nodes.length; iteration += 1) {
    let changed = false;
    for (const item of edges) {
      const nextRank = (rankByNodeId.get(item.sourceNodeId) ?? 0) + 1;
      if (nextRank > (rankByNodeId.get(item.targetNodeId) ?? 0)) {
        rankByNodeId.set(item.targetNodeId, nextRank);
        changed = true;
      }
    }
    if (!changed) return rankByNodeId;
  }
  return rankByNodeId;
}

function portOwner(ugs: UniversalGraphSpec, portId: string): string | null {
  return ugs.ports.find((port) => port.portId === portId)?.nodeId ?? null;
}

function roleForNode(node: UniversalGraphSpec["nodes"][number]): GeneralPublicationComponentRole {
  if (node.kind === "input") return "input";
  if (node.kind === "output") return "output";
  if (node.kind === "custom_operator") return "custom_operator";
  if (node.kind === "custom_module") return "custom_module";
  if (node.semanticHints.includes("split")) return "split";
  if (node.attributes.mergeKind === "add") return "merge_add";
  if (node.attributes.mergeKind === "concat") return "merge_concat";
  return "generic_module";
}

function relationRole(relation: UniversalGraphSpec["edges"][number]["relation"]): GeneralPublicationRelation["role"] {
  if (relation === "skip") return "skip";
  if (relation === "merge") return "merge";
  if (relation === "condition") return "condition";
  if (relation === "feedback") return "feedback";
  return "flow";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
