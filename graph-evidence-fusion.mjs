import { normalizeEvidenceMetadata } from "./evidence-metadata.mjs";

export const GRAPH_EVIDENCE_FUSION_VERSION = "graph-evidence-fusion/v1";

export function fuseGraphEvidence(sources = []) {
  const ranked = [...sources]
    .map((source, index) => ({
      id: String(source.id || `source-${index + 1}`),
      authority: Number.isFinite(source.authority) ? source.authority : 0,
      analyzer: String(source.analyzer || "unknown"),
      ir: normalizeEvidenceMetadata(source.ir || {}, { sourceId: source.id, analyzer: source.analyzer }),
    }))
    .sort((left, right) => right.authority - left.authority || left.id.localeCompare(right.id));
  const nodeMap = new Map();
  const edgeMap = new Map();
  const edgeByTopology = new Map();
  const conflicts = [];
  const provenance = { nodes: {}, edges: {}, alignments: [] };

  for (const source of ranked) {
    const incomingNodes = source.ir.nodes || [];
    const alignment = alignSourceNodes([...nodeMap.values()], incomingNodes);
    provenance.alignments.push({
      sourceId: source.id,
      mappedNodeCount: alignment.mapping.size,
      unmappedNodeCount: incomingNodes.length - alignment.mapping.size,
      mapping: Object.fromEntries(alignment.mapping),
    });

    if (
      nodeMap.size > 0
      && incomingNodes.length > 0
      && alignment.mapping.size === 0
      && hasGroundedTopology(source.ir)
    ) {
      conflicts.push({
        kind: "alignment-conflict",
        subjectId: source.id,
        existingSourceId: provenance.alignments.find((item) => item.sourceId !== source.id)?.sourceId || "",
        incomingSourceId: source.id,
        severity: "error",
        message: "The source graph has grounded topology but cannot be aligned to the higher-authority graph.",
      });
    }

    for (const node of incomingNodes) {
      const incomingNodeId = String(node.id || "");
      if (!incomingNodeId) continue;
      const nodeId = String(alignment.mapping.get(incomingNodeId) || incomingNodeId);
      const canonicalNode = canonicalizeNode(node, nodeId);
      const existing = nodeMap.get(nodeId);
      if (!existing) {
        nodeMap.set(nodeId, canonicalNode);
        provenance.nodes[nodeId] = [{ id: source.id, analyzer: source.analyzer, authority: source.authority, sourceNodeId: incomingNodeId }];
        continue;
      }
      provenance.nodes[nodeId].push({ id: source.id, analyzer: source.analyzer, authority: source.authority, sourceNodeId: incomingNodeId });
      if (nodeSignature(existing) !== nodeSignature(canonicalNode)) {
        conflicts.push({
          kind: "node-conflict",
          subjectId: nodeId,
          existingSourceId: provenance.nodes[nodeId][0].id,
          incomingSourceId: source.id,
          severity: isTopologyNodeConflict(existing, canonicalNode) ? "error" : "warning",
        });
      }
    }
    for (const edge of source.ir.edges || []) {
      const edgeId = String(edge.id || "");
      if (!edgeId) continue;
      const canonicalEdge = canonicalizeEdge(edge, alignment.mapping);
      const topologyKey = edgeTopologyKey(canonicalEdge);
      const existingById = edgeMap.get(canonicalEdge.id);
      const existingByTopology = edgeByTopology.get(topologyKey);
      const existing = existingById || existingByTopology;
      if (!existing) {
        edgeMap.set(canonicalEdge.id, canonicalEdge);
        edgeByTopology.set(topologyKey, canonicalEdge);
        provenance.edges[canonicalEdge.id] = [{ id: source.id, analyzer: source.analyzer, authority: source.authority, sourceEdgeId: String(edge.id || "") }];
        continue;
      }
      if (existingById && existingByTopology && existingById !== existingByTopology) {
        conflicts.push({
          kind: "edge-conflict",
          subjectId: canonicalEdge.id,
          existingSourceId: provenance.edges[existingById.id]?.[0]?.id || "",
          incomingSourceId: source.id,
          severity: "error",
          message: "The same edge identity maps to different topology records.",
        });
        continue;
      }
      provenance.edges[existing.id].push({ id: source.id, analyzer: source.analyzer, authority: source.authority, sourceEdgeId: String(edge.id || "") });
      if (edgeSemanticSignature(existing) !== edgeSemanticSignature(canonicalEdge)) {
        conflicts.push({
          kind: "edge-conflict",
          subjectId: existing.id,
          existingSourceId: provenance.edges[existing.id][0].id,
          incomingSourceId: source.id,
          severity: "error",
        });
      }
    }
  }

  const blocked = conflicts.some((conflict) => conflict.severity === "error");
  return {
    version: GRAPH_EVIDENCE_FUSION_VERSION,
    status: blocked ? "contradicted" : "grounded",
    blocked,
    ir: {
      version: String(ranked[0]?.ir.version || "universal-neural-ir/v1"),
      source: ranked[0]?.ir.source || { kind: "fusion" },
      nodes: [...nodeMap.values()],
      edges: [...edgeMap.values()],
      groups: ranked[0]?.ir.groups || [],
      containers: ranked[0]?.ir.containers || [],
      diagnostics: conflicts,
    },
    conflicts,
    provenance,
  };
}

function alignSourceNodes(existingNodes, incomingNodes) {
  const mapping = new Map();
  const usedExisting = new Set();
  const existingByIdentity = new Map();
  for (const node of existingNodes) {
    for (const identity of nodeIdentities(node)) {
      if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, node.id);
    }
  }

  for (const node of incomingNodes) {
    const candidates = new Set();
    for (const identity of nodeIdentities(node)) {
      const existingId = existingByIdentity.get(identity);
      if (existingId && !usedExisting.has(existingId)) candidates.add(existingId);
    }
    if (candidates.size === 1) {
      const existingId = [...candidates][0];
      mapping.set(String(node.id), existingId);
      usedExisting.add(existingId);
    }
  }

  const remainingExisting = existingNodes
    .filter((node) => !usedExisting.has(String(node.id)))
    .sort(nodeOrderComparator(existingNodes));
  const remainingIncoming = incomingNodes
    .filter((node) => !mapping.has(String(node.id)))
    .sort(nodeOrderComparator(incomingNodes));

  if (remainingExisting.length > 0 && remainingExisting.length === remainingIncoming.length) {
    for (let index = 0; index < remainingExisting.length; index += 1) {
      mapping.set(String(remainingIncoming[index].id), String(remainingExisting[index].id));
    }
  }

  return { mapping };
}

function nodeIdentities(node = {}) {
  return [...new Set([
    node.id,
    node.sourceNodeId,
    ...(Array.isArray(node.sourceNodeIds) ? node.sourceNodeIds : []),
    ...(Array.isArray(node.attributes?.sourceNodeIds) ? node.attributes.sourceNodeIds : []),
  ].filter((value) => value !== undefined && value !== null && String(value)).map(String))];
}

function nodeOrderComparator(nodes) {
  const indexById = new Map(nodes.map((node, index) => [String(node?.id || ""), index]));
  return (left, right) => {
    const leftOrder = Number.isFinite(left?.order) ? left.order : Number.isFinite(left?.stage) ? left.stage : indexById.get(String(left?.id || "")) ?? 0;
    const rightOrder = Number.isFinite(right?.order) ? right.order : Number.isFinite(right?.stage) ? right.stage : indexById.get(String(right?.id || "")) ?? 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  };
}

function canonicalizeNode(node = {}, canonicalId) {
  return {
    ...clone(node),
    id: String(canonicalId),
  };
}

function canonicalizeEdge(edge = {}, mapping) {
  return {
    ...clone(edge),
    source: String(mapping.get(String(edge.source || "")) || edge.source || ""),
    target: String(mapping.get(String(edge.target || "")) || edge.target || ""),
  };
}

function edgeTopologyKey(edge = {}) {
  return `${String(edge.source || "")}\u0000${String(edge.target || "")}`;
}

function hasGroundedTopology(ir = {}) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  if (!nodes.length) return false;
  if (nodes.length === 1 && /unresolved|prompt.*hypothesis|hypothesis/i.test(String(nodes[0]?.op || ""))) return false;
  return nodes.some((node) => {
    const confidence = Number.isFinite(node?.confidence) ? node.confidence : 1;
    return confidence >= 0.6 && String(node?.compoundKind || "") !== "unresolved" && String(node?.status || "") !== "unresolved";
  });
}

function nodeSignature(node = {}) {
  return stableJson({
    id: node.id,
    op: node.op,
    family: node.family,
    compoundKind: node.compoundKind,
    shape: node.shape,
    ports: normalizePorts(node.ports),
  });
}

function edgeSignature(edge = {}, includeId = true) {
  return stableJson({
    ...(includeId ? { id: edge.id } : {}),
    source: edge.source,
    target: edge.target,
    type: String(edge.type || "signal"),
    ports: edge.ports,
    sourceEndpointIds: edge.sourceEndpointIds,
  });
}

function edgeSemanticSignature(edge = {}) {
  return edgeSignature(edge, false);
}

function isTopologyNodeConflict(left, right) {
  return left.op !== right.op || left.family !== right.family || stableJson(normalizePorts(left.ports)) !== stableJson(normalizePorts(right.ports));
}

function normalizePorts(ports) {
  return {
    inputs: Array.isArray(ports?.inputs) ? ports.inputs.map(String) : [],
    outputs: Array.isArray(ports?.outputs) ? ports.outputs.map(String) : [],
  };
}

function stableJson(value) {
  if (value === undefined) return "";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
