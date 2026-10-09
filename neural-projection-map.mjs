import { normalizeNeuralBlocks } from "./neural-block-ir.mjs";

const VERSION = "neural-projection-map/v1";
const DETAILS = new Set(["overview", "balanced", "full"]);

export function createProjectionMap(ir = {}, facts = {}, intent = {}) {
  const detail = DETAILS.has(intent.detail) ? intent.detail : "balanced";
  const normalizedOverrides = normalizeBlockOverrides(intent.blockOverrides || {});
  const normalizedIntent = {
    ...intent,
    blocks: normalizeNeuralBlocks(intent.blocks, ir),
    blockOverrides: normalizedOverrides.overrides,
  };
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  const projections = detail === "overview"
    ? overviewProjections(nodes, edges, facts)
    : detail === "full"
      ? nodes.map((node) => createProjection(projectionKind(node, detail), [node.id], facts))
      : blockAwareProjections(nodes, edges, facts, detail, normalizedIntent.blocks, ir, normalizedIntent);
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
    const sourcePortOverride = projectionById.get(sourceProjectionId)?.portIdByEdge?.[edge.id]?.source;
    const targetPortOverride = projectionById.get(targetProjectionId)?.portIdByEdge?.[edge.id]?.target;
    if (sourcePortOverride) mapping.sourceBlockPortId = sourcePortOverride;
    if (targetPortOverride) mapping.targetBlockPortId = targetPortOverride;
    edgeToProjection[edge.id] = mapping;
    if (internal) projectionById.get(sourceProjectionId)?.internalEdgeIds.push(edge.id);
    else {
      const sourceProjection = projectionById.get(sourceProjectionId);
      const targetProjection = projectionById.get(targetProjectionId);
      sourceProjection?.visibleEdgeIds.push(edge.id);
      targetProjection?.visibleEdgeIds.push(edge.id);
      if (!sourceProjection?.portIdByEdge?.[edge.id]?.source) {
        sourceProjection?.exitPorts.push({ edgeId: edge.id, nodeId: edge.source, portId: mapping.sourcePortId });
      }
      if (!targetProjection?.portIdByEdge?.[edge.id]?.target) {
        targetProjection?.entryPorts.push({ edgeId: edge.id, nodeId: edge.target, portId: mapping.targetPortId });
      }
    }
  }
  for (const projection of projections) {
    projection.internalEdgeIds.sort(byEdgeOrder(edges));
    projection.visibleEdgeIds = [...new Set(projection.visibleEdgeIds)].sort(byEdgeOrder(edges));
  }

  const defaultBudget = detail === "overview" ? 120 : detail === "balanced" ? 300 : 800;
  const budget = Number.isFinite(intent.maxPrimaryPrimitives) ? intent.maxPrimaryPrimitives : defaultBudget;
  const diagnostics = [
    ...normalizedOverrides.diagnostics,
    ...(projections.length > budget
      ? [{ code: "projection-budget-exceeded", severity: "warning", projectionCount: projections.length, budget }]
      : []),
  ];
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

function blockAwareProjections(nodes, edges, facts, detail, blockIr, ir, intent = {}) {
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const sourceOrder = new Map(nodes.map((node, index) => [String(node.id), index]));
  const regionByNode = nodeRegions(ir || { nodes });
  const assigned = new Set();
  const projections = [];
  const blocks = (blockIr?.blocks || [])
    .filter((block) => Array.isArray(block.nodeIds) && block.nodeIds.length > 1 && block.nodeIds.every((nodeId) => nodeIds.has(String(nodeId))))
    .filter((block) => canProjectBlock(block, edges, regionByNode, nodeById, intent))
    .sort((left, right) => blockPriority(left.kind) - blockPriority(right.kind)
      || Math.min(...left.nodeIds.map((nodeId) => sourceOrder.get(String(nodeId)) ?? Infinity))
        - Math.min(...right.nodeIds.map((nodeId) => sourceOrder.get(String(nodeId)) ?? Infinity)));

  for (const block of blocks) {
    if (block.nodeIds.some((nodeId) => assigned.has(String(nodeId)))) continue;
    const orderedNodeIds = [...block.nodeIds].sort((left, right) => (sourceOrder.get(String(left)) ?? 0) - (sourceOrder.get(String(right)) ?? 0));
    const projection = createProjection(`block-${block.kind}`, orderedNodeIds, facts);
    projection.blockId = String(block.id);
    projection.blockKind = String(block.kind);
    projection.blockDetails = { ...block };
    projection.entryPorts = uniqueBlockPorts(block.entryPortMappings || [], "entry");
    projection.exitPorts = uniqueBlockPorts(block.exitPortMappings || [], "exit");
    projection.portIdByEdge = {};
    for (const port of projection.entryPorts) {
      if (!port.edgeId) continue;
      projection.portIdByEdge[port.edgeId] = { ...(projection.portIdByEdge[port.edgeId] || {}), target: port.id };
    }
    for (const port of projection.exitPorts) {
      if (!port.edgeId) continue;
      projection.portIdByEdge[port.edgeId] = { ...(projection.portIdByEdge[port.edgeId] || {}), source: port.id };
    }
    projection.reason = String(block.reason || `block:${block.kind}`);
    projections.push(projection);
    orderedNodeIds.forEach((nodeId) => assigned.add(String(nodeId)));
  }

  for (const node of nodes) {
    if (assigned.has(String(node.id))) continue;
    projections.push(createProjection(projectionKind(node, detail), [node.id], facts));
  }
  return projections.sort((left, right) =>
    Math.min(...left.orderedNodeIds.map((nodeId) => sourceOrder.get(String(nodeId)) ?? Infinity))
    - Math.min(...right.orderedNodeIds.map((nodeId) => sourceOrder.get(String(nodeId)) ?? Infinity)));
}

function nodeRegions(ir) {
  const result = new Map();
  for (const node of ir.nodes || []) {
    const nodeId = String(node.id);
    if (node.containerId) result.set(nodeId, `container:${node.containerId}`);
  }
  for (const group of ir.groups || []) {
    for (const nodeId of group.nodeIds || []) {
      const id = String(nodeId);
      if (!result.has(id)) result.set(id, `group:${group.id}`);
    }
  }
  return result;
}

function canProjectBlock(block, edges, regionByNode, nodeById, intent = {}) {
  const nodeIdSet = new Set(block.nodeIds.map(String));
  const override = intent.blockOverrides?.[block.id] || {};
  if (override.expanded === true) return false;
  if (override.expanded === false && override.locked === true) return true;
  if ((intent.expandBlockKinds || []).map(String).includes(String(block.kind))) return false;
  if (intent.forceBlockProjection !== true && block.nodeIds.some((nodeId) => nodeById.get(String(nodeId))?.attributes?.workspaceUi)) {
    return false;
  }
  const regions = new Set(block.nodeIds.map((nodeId) => regionByNode.get(String(nodeId)) || "unscoped"));
  if (regions.size > 1) return false;

  const incomingOutside = new Map();
  const outgoingOutside = new Map();
  for (const edge of edges) {
    const source = String(edge.source);
    const target = String(edge.target);
    if (!nodeIdSet.has(source) && nodeIdSet.has(target)) incomingOutside.set(source, (incomingOutside.get(source) || 0) + 1);
    if (nodeIdSet.has(source) && !nodeIdSet.has(target)) outgoingOutside.set(target, (outgoingOutside.get(target) || 0) + 1);
  }
  for (const outsideId of incomingOutside.keys()) {
    if (outgoingOutside.has(outsideId)) return false;
  }
  return true;
}

function normalizeBlockOverrides(overrides = {}) {
  const normalized = {};
  const diagnostics = [];
  for (const [blockId, value] of Object.entries(overrides || {})) {
    if (!value || typeof value !== "object") continue;
    const expanded = value.expanded === true;
    const locked = value.locked === true;
    if (expanded && locked) {
      diagnostics.push({
        code: "block-lock-expand-conflict",
        severity: "warning",
        blockId: String(blockId),
        message: "Block lock wins over expand; the block will remain collapsed.",
      });
    }
    normalized[String(blockId)] = { expanded: locked ? false : expanded, locked };
  }
  return { overrides: normalized, diagnostics };
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

function blockPriority(kind) {
  const order = {
    "repeat-block": 5,
    "residual-block": 10,
    "attention-block": 20,
    "ffn-block": 30,
    "encoder-stage": 40,
    "decoder-stage": 50,
    "multi-scale-fusion": 60,
    "moe-block": 70,
    "recurrent-cell": 80,
    "graph-block": 85,
    "conv-block": 90,
    "detection-head": 100,
  };
  return order[kind] ?? 999;
}

function clonePorts(ports = []) {
  return (Array.isArray(ports) ? ports : []).map((port) => ({ ...port }));
}

function uniqueBlockPorts(mappings = [], side) {
  const used = new Set();
  return mappings.map((mapping, index) => {
    const base = String(mapping.portId || mapping.edgeId || `${side}-${index + 1}`);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return {
      id,
      portId: id,
      nodeId: String(mapping.nodeId || ""),
      edgeId: String(mapping.edgeId || ""),
    };
  });
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
