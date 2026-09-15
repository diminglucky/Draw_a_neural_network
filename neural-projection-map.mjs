const VERSION = "neural-projection-map/v1";
const DETAILS = new Set(["overview", "balanced", "full"]);

export function createProjectionMap(ir = {}, facts = {}, intent = {}) {
  const detail = DETAILS.has(intent.detail) ? intent.detail : "balanced";
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  const projections = detail === "overview"
    ? overviewProjections(nodes, edges, facts)
    : nodes.map((node) => createProjection(projectionKind(node, detail), [node.id], facts));
  const nodeToProjection = {};
  for (const projection of projections) for (const nodeId of projection.orderedNodeIds) nodeToProjection[nodeId] = projection.id;

  const projectionById = new Map(projections.map((projection) => [projection.id, projection]));
  const edgeToProjection = {};
  for (const edge of edges) {
    const sourceProjectionId = nodeToProjection[edge.source];
    const targetProjectionId = nodeToProjection[edge.target];
    const internal = sourceProjectionId === targetProjectionId && edge.source !== edge.target;
    const mapping = {
      projectionId: internal ? sourceProjectionId : null,
      disposition: internal ? "internal" : "visible",
      sourceProjectionId,
      targetProjectionId,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      sourcePortId: edge.sourceEndpointIds?.source || edge.ports?.source || null,
      targetPortId: edge.sourceEndpointIds?.target || edge.ports?.target || null,
    };
    edgeToProjection[edge.id] = mapping;
    if (internal) projectionById.get(sourceProjectionId)?.internalEdgeIds.push(edge.id);
    else {
      const sourceProjection = projectionById.get(sourceProjectionId);
      const targetProjection = projectionById.get(targetProjectionId);
      sourceProjection?.visibleEdgeIds.push(edge.id);
      targetProjection?.visibleEdgeIds.push(edge.id);
      sourceProjection?.exitPorts.push({ edgeId: edge.id, nodeId: edge.source, portId: mapping.sourcePortId });
      targetProjection?.entryPorts.push({ edgeId: edge.id, nodeId: edge.target, portId: mapping.targetPortId });
    }
  }
  for (const projection of projections) {
    projection.internalEdgeIds.sort(byEdgeOrder(edges));
    projection.visibleEdgeIds = [...new Set(projection.visibleEdgeIds)].sort(byEdgeOrder(edges));
  }

  const defaultBudget = detail === "overview" ? 120 : detail === "balanced" ? 300 : 800;
  const budget = Number.isFinite(intent.maxPrimaryPrimitives) ? intent.maxPrimaryPrimitives : defaultBudget;
  const diagnostics = projections.length > budget
    ? [{ code: "projection-budget-exceeded", severity: "warning", projectionCount: projections.length, budget }]
    : [];
  return { version: VERSION, irVersion: String(ir.version || ""), detail, projections, nodeToProjection, edgeToProjection, diagnostics };
}

export function validateProjectionMap(map = {}, ir = {}) {
  const issues = [];
  if (map.version !== VERSION) issues.push({ code: "invalid-projection-map-version" });
  const projectionById = new Map((map.projections || []).map((projection) => [projection.id, projection]));
  const assignedNodes = new Map();
  for (const projection of map.projections || []) {
    for (const nodeId of projection.orderedNodeIds || []) {
      if (assignedNodes.has(nodeId)) issues.push({ code: "duplicate-node-projection", nodeId });
      assignedNodes.set(nodeId, projection.id);
    }
  }
  for (const node of ir.nodes || []) {
    if (!map.nodeToProjection?.[node.id] || !assignedNodes.has(node.id)) issues.push({ code: "missing-node-projection", nodeId: node.id });
    else if (!projectionById.has(map.nodeToProjection[node.id])) issues.push({ code: "unknown-node-projection", nodeId: node.id });
  }
  const inDegree = degreeIndex(ir.edges, "target");
  const outDegree = degreeIndex(ir.edges, "source");
  for (const edge of ir.edges || []) {
    const mapping = map.edgeToProjection?.[edge.id];
    if (!mapping) {
      issues.push({ code: "missing-edge-projection", edgeId: edge.id });
      continue;
    }
    if (!["visible", "internal", "hidden"].includes(mapping.disposition)) issues.push({ code: "invalid-edge-disposition", edgeId: edge.id });
    if (mapping.sourceNodeId !== edge.source || mapping.targetNodeId !== edge.target
      || mapping.sourceProjectionId !== map.nodeToProjection?.[edge.source]
      || mapping.targetProjectionId !== map.nodeToProjection?.[edge.target]) {
      issues.push({ code: "edge-endpoint-projection-mismatch", edgeId: edge.id });
    }
    const expectedSourcePort = edge.sourceEndpointIds?.source || edge.ports?.source || null;
    const expectedTargetPort = edge.sourceEndpointIds?.target || edge.ports?.target || null;
    if (mapping.sourcePortId !== expectedSourcePort || mapping.targetPortId !== expectedTargetPort) {
      issues.push({ code: "edge-port-projection-mismatch", edgeId: edge.id });
    }
    const protectedRelation = isProtectedEdge(edge, inDegree, outDegree);
    if (protectedRelation && mapping.disposition === "hidden") issues.push({ code: "protected-edge-hidden", edgeId: edge.id });
    if (mapping.disposition === "hidden") {
      const owner = projectionById.get(mapping.projectionId);
      if (!owner?.hiddenEdgeIds?.includes(edge.id)) issues.push({ code: "hidden-edge-not-explicit", edgeId: edge.id });
    }
    if (mapping.disposition === "internal") {
      const owner = projectionById.get(mapping.projectionId);
      if (!owner?.internalEdgeIds?.includes(edge.id)) issues.push({ code: "internal-edge-not-explicit", edgeId: edge.id });
    }
  }
  return { ok: issues.length === 0, issues, summary: { projectionCount: map.projections?.length || 0, nodeCount: Object.keys(map.nodeToProjection || {}).length, edgeCount: Object.keys(map.edgeToProjection || {}).length } };
}

function overviewProjections(nodes, edges, facts) {
  const projections = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const kind = run.length > 1 ? "sequence-collapse" : projectionKind(run[0], "overview");
    projections.push(createProjection(kind, run.map((node) => node.id), facts));
    run = [];
  };
  for (const node of nodes) {
    if (!isSafeLinearNode(node, facts)) {
      flush();
      projections.push(createProjection(projectionKind(node, "overview"), [node.id], facts));
      continue;
    }
    const previous = run.at(-1);
    if (previous && (!hasEdge(previous.id, node.id, edges) || String(previous.containerId || "") !== String(node.containerId || ""))) flush();
    run.push(node);
  }
  flush();
  return projections;
}

function projectionKind(node, detail) {
  if (detail === "full") return "direct";
  if (Number(node.repeatCount || node.repeat || 1) > 1) return "repeat-collapse";
  const internal = node.attributes?.internalGraph || node.internalGraph;
  if (internal?.status === "grounded" && Array.isArray(internal.nodes) && internal.nodes.length) return detail === "overview" ? "callout-expansion" : "inline-expansion";
  if (node.compoundKind === "unresolved" || (node.family === "custom" && node.compoundKind !== "module")) return "opaque-module";
  return "direct";
}

function isSafeLinearNode(node, facts) {
  if (projectionKind(node, "overview") !== "direct") return false;
  const role = facts.nodeFacts?.[node.id]?.structuralRole?.value;
  const topology = facts.nodeFacts?.[node.id]?.topology?.value || {};
  return !["input", "output", "branch", "merge", "stateful"].includes(role)
    && !topology.bypass && !topology.cycle && !topology.conditional;
}

function createProjection(kind, nodeIds, facts) {
  const first = nodeIds[0];
  const evidenceIds = [...new Set(nodeIds.flatMap((nodeId) => Object.values(facts.nodeFacts?.[nodeId] || {}).flatMap((entry) => entry?.evidenceIds || [])))];
  return {
    id: `projection:${kind}:${first}`,
    kind,
    orderedNodeIds: [...nodeIds],
    internalEdgeIds: [],
    visibleEdgeIds: [],
    hiddenEdgeIds: [],
    entryPorts: [],
    exitPorts: [],
    reason: `structural:${kind}`,
    evidenceIds,
  };
}

function isProtectedEdge(edge, inDegree, outDegree) {
  const type = String(edge.type || "").toLowerCase();
  return /state|loop|recurrent|feedback|residual|skip|bypass|output|condition|control|route|gate/.test(type)
    || (outDegree.get(String(edge.source)) || 0) > 1
    || (inDegree.get(String(edge.target)) || 0) > 1;
}

function degreeIndex(edges = [], key) {
  const result = new Map();
  for (const edge of edges) result.set(String(edge[key]), (result.get(String(edge[key])) || 0) + (edge.source === edge.target ? 0 : 1));
  return result;
}

function hasEdge(source, target, edges) { return edges.some((edge) => edge.source === source && edge.target === target); }
function byEdgeOrder(edges) { const order = new Map(edges.map((edge, index) => [edge.id, index])); return (left, right) => order.get(left) - order.get(right); }
