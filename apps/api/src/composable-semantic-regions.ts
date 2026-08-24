import { compareCodeUnits } from "./stable-string-order.js";
import {
  parseUniversalGraphSpec,
  type UniversalGraphSpec,
  type UniversalNode,
} from "./universal-graph-spec.js";

export type ComposableSemanticRegionKind =
  | "scale_transition"
  | "repeat_group"
  | "add_merge"
  | "concat_fusion"
  | "token_attention"
  | "custom_module"
  | "multi_branch"
  | "candidate_feedback";

export interface ComposableSemanticRegion {
  regionId: string;
  kind: ComposableSemanticRegionKind;
  label: string;
  state: "formal" | "candidate";
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  sourceGroupIds: string[];
  evidenceIds: string[];
}

/**
 * Projects only UGS facts that have passed the canonical validator.  This
 * boundary intentionally has no layout, renderer, native, or application
 * concerns: later stages decide how a semantic region should be drawn.
 */
export function deriveComposableSemanticRegions(input: UniversalGraphSpec): ComposableSemanticRegion[] {
  const ugs = parseUniversalGraphSpec(input);
  const portOwners = new Map(ugs.ports.map((port) => [port.portId, port.nodeId]));
  const nodeById = new Map(ugs.nodes.map((node) => [node.nodeId, node]));

  const candidateRegions = deriveCandidateFeedbackRegions(ugs, portOwners);
  if (candidateRegions.length > 0) return sortRegions(candidateRegions);

  const regions: ComposableSemanticRegion[] = [
    ...deriveScaleTransitions(ugs, nodeById, portOwners),
    ...deriveRepeatGroups(ugs, nodeById),
    ...deriveMerges(ugs, portOwners),
    ...deriveAttention(ugs),
    ...deriveCustomModules(ugs),
    ...deriveMultiBranches(ugs, portOwners),
  ];
  return sortRegions(regions);
}

function deriveCandidateFeedbackRegions(ugs: UniversalGraphSpec, portOwners: Map<string, string>): ComposableSemanticRegion[] {
  const topologyEdges = ugs.edges.filter((edge) => edge.relation === "candidate" || edge.knowledge === "candidate" || edge.relation === "feedback");
  const topologyQuestions = ugs.unresolved.filter((item) => item.scope === "topology" && item.severity === "blocking");
  return [
    ...topologyEdges.map((edge) => region({
      regionId: `candidate_feedback:edge:${edge.edgeId}`,
      kind: "candidate_feedback",
      label: edge.relation === "feedback" ? "Feedback topology pending confirmation" : "Candidate topology pending confirmation",
      state: "candidate",
      sourceNodeIds: compactSorted([portOwners.get(edge.sourcePortId), portOwners.get(edge.targetPortId)]),
      sourceEdgeIds: [edge.edgeId],
      sourceGroupIds: [],
      evidenceIds: edge.evidenceIds,
    })),
    ...topologyQuestions.map((item) => region({
      regionId: `candidate_feedback:unresolved:${item.id}`,
      kind: "candidate_feedback",
      label: "Topology pending confirmation",
      state: "candidate",
      sourceNodeIds: [],
      sourceEdgeIds: [],
      sourceGroupIds: [],
      evidenceIds: item.evidenceIds,
    })),
  ];
}

function deriveScaleTransitions(
  ugs: UniversalGraphSpec,
  nodeById: Map<string, UniversalNode>,
  portOwners: Map<string, string>,
): ComposableSemanticRegion[] {
  return ugs.edges.flatMap((edge) => {
    if (edge.relation !== "data" || edge.knowledge !== "proven") return [];
    const sourceNode = nodeById.get(portOwners.get(edge.sourcePortId) ?? "");
    const targetNode = nodeById.get(portOwners.get(edge.targetPortId) ?? "");
    if (!sourceNode || !targetNode || !hasDifferingSpatialFacts(sourceNode, targetNode)) return [];
    return [region({
      regionId: `scale_transition:${edge.edgeId}`,
      kind: "scale_transition",
      label: "Spatial scale transition",
      state: "formal",
      sourceNodeIds: [sourceNode.nodeId, targetNode.nodeId],
      sourceEdgeIds: [edge.edgeId],
      sourceGroupIds: [],
      evidenceIds: [...sourceNode.evidenceIds, ...targetNode.evidenceIds, ...sourceNode.tensorFacts!.evidenceIds, ...targetNode.tensorFacts!.evidenceIds, ...edge.evidenceIds],
    })];
  });
}

function hasDifferingSpatialFacts(source: UniversalNode, target: UniversalNode): boolean {
  const sourceFacts = source.tensorFacts;
  const targetFacts = target.tensorFacts;
  if (!sourceFacts || !targetFacts || sourceFacts.evidenceIds.length === 0 || targetFacts.evidenceIds.length === 0) return false;
  const sourceHeight = sourceFacts.dimensions.height;
  const sourceWidth = sourceFacts.dimensions.width;
  const targetHeight = targetFacts.dimensions.height;
  const targetWidth = targetFacts.dimensions.width;
  if (![sourceHeight, sourceWidth, targetHeight, targetWidth].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) return false;
  return sourceHeight !== targetHeight || sourceWidth !== targetWidth;
}

function deriveRepeatGroups(ugs: UniversalGraphSpec, nodeById: Map<string, UniversalNode>): ComposableSemanticRegion[] {
  const groupById = new Map(ugs.groups.map((group) => [group.groupId, group]));
  return ugs.nodes.flatMap((node) => {
    const repeatCount = node.attributes.repeatCount;
    const repeatGroupId = node.attributes.repeatGroupId;
    if (typeof repeatCount !== "number" || !Number.isInteger(repeatCount) || repeatCount <= 1 || typeof repeatGroupId !== "string") return [];
    const group = groupById.get(repeatGroupId);
    if (!group || node.evidenceIds.length === 0 || group.evidenceIds.length === 0) return [];
    const sourceNodes = [node.nodeId, ...group.memberNodeIds].filter((nodeId) => nodeById.has(nodeId));
    if (sourceNodes.length === 0) return [];
    return [region({
      regionId: `repeat_group:${group.groupId}:${node.nodeId}`,
      kind: "repeat_group",
      label: `Repeat × ${repeatCount}`,
      state: "formal",
      sourceNodeIds: sourceNodes,
      sourceEdgeIds: [],
      sourceGroupIds: [group.groupId],
      evidenceIds: [...node.evidenceIds, ...group.evidenceIds],
    })];
  });
}

function deriveMerges(ugs: UniversalGraphSpec, portOwners: Map<string, string>): ComposableSemanticRegion[] {
  return ugs.nodes.flatMap((node) => {
    const mergeKind = node.attributes.mergeKind;
    if (mergeKind !== "add" && mergeKind !== "concat") return [];
    const incoming = ugs.edges.filter((edge) => edge.knowledge === "proven" && edge.relation !== "candidate" && edge.relation !== "feedback" && portOwners.get(edge.targetPortId) === node.nodeId);
    const upstreamOwners = compactSorted(incoming.map((edge) => portOwners.get(edge.sourcePortId)));
    if (upstreamOwners.length < 2 || node.evidenceIds.length === 0) return [];
    return [region({
      regionId: `${mergeKind === "add" ? "add_merge" : "concat_fusion"}:${node.nodeId}`,
      kind: mergeKind === "add" ? "add_merge" : "concat_fusion",
      label: mergeKind === "add" ? "Add merge" : "Concat fusion",
      state: "formal",
      sourceNodeIds: [node.nodeId, ...upstreamOwners],
      sourceEdgeIds: incoming.map((edge) => edge.edgeId),
      sourceGroupIds: [],
      evidenceIds: [...node.evidenceIds, ...incoming.flatMap((edge) => edge.evidenceIds)],
    })];
  });
}

function deriveAttention(ugs: UniversalGraphSpec): ComposableSemanticRegion[] {
  return ugs.nodes.flatMap((node) => {
    const attentionKind = node.attributes.attentionKind;
    const semanticRole = attentionKind === "self" ? "self_attention" : attentionKind === "cross" ? "cross_attention" : null;
    if (!semanticRole || !node.semanticHints.includes("attention") || !node.semanticHints.includes(semanticRole) || node.evidenceIds.length === 0) return [];
    return [region({
      regionId: `token_attention:${node.nodeId}`,
      kind: "token_attention",
      label: attentionKind === "self" ? "Self attention" : "Cross attention",
      state: "formal",
      sourceNodeIds: [node.nodeId],
      sourceEdgeIds: [],
      sourceGroupIds: [],
      evidenceIds: node.evidenceIds,
    })];
  });
}

function deriveCustomModules(ugs: UniversalGraphSpec): ComposableSemanticRegion[] {
  return ugs.nodes.filter((node) => node.kind === "custom_module" && node.evidenceIds.length > 0).map((node) => region({
    regionId: `custom_module:${node.nodeId}`,
    kind: "custom_module",
    label: "Custom module",
    state: "formal",
    sourceNodeIds: [node.nodeId],
    sourceEdgeIds: [],
    sourceGroupIds: [],
    evidenceIds: node.evidenceIds,
  }));
}

function deriveMultiBranches(ugs: UniversalGraphSpec, portOwners: Map<string, string>): ComposableSemanticRegion[] {
  return ugs.nodes.flatMap((node) => {
    const outgoing = ugs.edges.filter((edge) => edge.knowledge === "proven" && edge.relation === "data" && portOwners.get(edge.sourcePortId) === node.nodeId);
    const targetOwners = compactSorted(outgoing.map((edge) => portOwners.get(edge.targetPortId)));
    if (targetOwners.length < 2 || node.evidenceIds.length === 0) return [];
    return [region({
      regionId: `multi_branch:${node.nodeId}`,
      kind: "multi_branch",
      label: "Multi-branch topology",
      state: "formal",
      sourceNodeIds: [node.nodeId, ...targetOwners],
      sourceEdgeIds: outgoing.map((edge) => edge.edgeId),
      sourceGroupIds: [],
      evidenceIds: [...node.evidenceIds, ...outgoing.flatMap((edge) => edge.evidenceIds)],
    })];
  });
}

function region(input: ComposableSemanticRegion): ComposableSemanticRegion {
  return {
    ...input,
    sourceNodeIds: compactSorted(input.sourceNodeIds),
    sourceEdgeIds: compactSorted(input.sourceEdgeIds),
    sourceGroupIds: compactSorted(input.sourceGroupIds),
    evidenceIds: compactSorted(input.evidenceIds),
  };
}

function compactSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort(compareCodeUnits);
}

function sortRegions(regions: ComposableSemanticRegion[]): ComposableSemanticRegion[] {
  return [...regions].sort((left, right) => compareCodeUnits(left.regionId, right.regionId));
}
