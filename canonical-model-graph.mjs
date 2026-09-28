import { normalizeNetworkIR } from "./network-ir.mjs";

export const CANONICAL_MODEL_GRAPH_VERSION = "canonical-model-graph/v1";

export function buildCanonicalModelGraph(ir = {}) {
  const normalized = normalizeNetworkIR(ir);
  const nodes = normalized.nodes.map((node, index) => ({
    ...node,
    canonicalId: String(node.id),
    sourceOrder: index,
  }));
  const edges = normalized.edges.map((edge) => ({
    ...edge,
    canonicalSource: String(edge.source),
    canonicalTarget: String(edge.target),
  }));
  const nodeById = new Map(nodes.map((node) => [node.canonicalId, node]));
  const incoming = indexEdges(edges, "canonicalTarget");
  const moduleTree = buildModuleTree(nodes, normalized);
  const tensorContracts = Object.fromEntries(nodes.map((node) => [
    node.canonicalId,
    buildTensorContract(node, incoming.get(node.canonicalId) || [], nodeById),
  ]));
  return {
    version: CANONICAL_MODEL_GRAPH_VERSION,
    irVersion: String(normalized.version || ""),
    ir: { ...normalized, nodes, edges },
    nodes,
    edges,
    moduleTree,
    tensorContracts,
    controlFlow: buildControlFlow(nodes, edges),
    diagnostics: [],
  };
}

export function validateCanonicalModelGraph(graph = {}) {
  const issues = [];
  if (graph.version !== CANONICAL_MODEL_GRAPH_VERSION) issues.push({ code: "invalid-canonical-model-graph-version", value: graph.version });
  const nodeIds = new Set();
  for (const node of graph.nodes || []) {
    const id = String(node?.canonicalId || "");
    if (!id) issues.push({ code: "missing-canonical-node-id" });
    else if (nodeIds.has(id)) issues.push({ code: "duplicate-canonical-node-id", nodeId: id });
    else nodeIds.add(id);
  }
  for (const nodeId of nodeIds) {
    if (!graph.tensorContracts || !Object.hasOwn(graph.tensorContracts, nodeId)) issues.push({ code: "missing-tensor-contract", nodeId });
  }
  for (const group of graph.moduleTree || []) {
    for (const nodeId of group.nodeIds || []) {
      if (!nodeIds.has(String(nodeId))) issues.push({ code: "module-tree-missing-node", groupId: group.id, nodeId });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      nodeCount: graph.nodes?.length || 0,
      edgeCount: graph.edges?.length || 0,
      moduleCount: graph.moduleTree?.length || 0,
      unresolvedTensorCount: Object.values(graph.tensorContracts || {}).filter((contract) => contract.status === "unresolved").length,
    },
  };
}

function buildTensorContract(node, incomingEdges, nodeById) {
  return {
    nodeId: node.canonicalId,
    status: node.shape ? "resolved" : "unresolved",
    inputs: incomingEdges.map((edge) => ({
      edgeId: String(edge.id),
      sourceNodeId: String(edge.canonicalSource),
      contract: tensorContractFor(nodeById.get(String(edge.canonicalSource))?.shape),
    })),
    output: tensorContractFor(node.shape),
  };
}

function tensorContractFor(shape) {
  if (!shape) return { status: "unresolved" };
  const output = Array.isArray(shape.output) ? shape.output.map(String) : null;
  if (!output?.length) return { status: "unresolved" };
  return {
    status: String(shape.source || "inferred"),
    shape: output,
    ordering: String(shape.ordering || "unknown"),
    confidence: Number.isFinite(shape.confidence) ? shape.confidence : 1,
    evidence: Array.isArray(shape.evidence) ? shape.evidence.map((item) => ({ ...item })) : [],
  };
}

function buildModuleTree(nodes, ir) {
  const nodeIds = new Set(nodes.map((node) => node.canonicalId));
  const groups = new Map();
  for (const source of [...(ir.containers || []), ...(ir.groups || [])]) {
    const id = String(source.id || "");
    if (!id) continue;
    groups.set(id, {
      id,
      label: String(source.label || id),
      kind: String(source.kind || "module"),
      parentId: String(source.parentId || ""),
      nodeIds: [],
      childGroupIds: [],
    });
  }
  for (const node of nodes) {
    const containerId = String(node.containerId || "");
    if (!containerId) continue;
    if (!groups.has(containerId)) {
      groups.set(containerId, { id: containerId, label: containerId, kind: "module", parentId: "", nodeIds: [], childGroupIds: [] });
    }
    groups.get(containerId).nodeIds.push(node.canonicalId);
  }
  for (const group of groups.values()) {
    if (group.parentId && groups.has(group.parentId)) groups.get(group.parentId).childGroupIds.push(group.id);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    nodeIds: group.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
    childGroupIds: [...new Set(group.childGroupIds)],
  }));
}

function buildControlFlow(nodes, edges) {
  const cyclicNodeIds = nodes
    .filter((node) => reaches(node.canonicalId, node.canonicalId, edges, true))
    .map((node) => node.canonicalId);
  return {
    cyclicNodeIds,
    stateEdgeIds: edges.filter((edge) => /state|loop|feedback|recurrent/i.test(String(edge.type || ""))).map((edge) => String(edge.id)),
    conditionalEdgeIds: edges.filter((edge) => /condition|control|route|gate/i.test(String(edge.type || ""))).map((edge) => String(edge.id)),
    unresolvedNodeIds: nodes.filter((node) => node.compoundKind === "unresolved" || node.status === "unresolved").map((node) => node.canonicalId),
  };
}

function reaches(start, target, edges, requireEdge = false) {
  const queue = [start];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (String(edge.canonicalSource) !== current) continue;
      const next = String(edge.canonicalTarget);
      if (next === target && (requireEdge || current !== target)) return true;
      if (!visited.has(next)) queue.push(next);
    }
  }
  return false;
}

function indexEdges(edges, key) {
  const index = new Map();
  for (const edge of edges) {
    const id = String(edge[key]);
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(edge);
  }
  return index;
}
