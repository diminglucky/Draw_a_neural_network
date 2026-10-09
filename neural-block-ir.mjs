import { CANONICAL_MODEL_GRAPH_VERSION } from "./canonical-model-graph.mjs";

export const NEURAL_BLOCK_IR_VERSION = "neural-block-ir/v2";
export const LEGACY_NEURAL_BLOCK_IR_VERSIONS = Object.freeze([
  "neural-block-ir/v0",
  "neural-block-ir/v1",
]);
export const SUPPORTED_NEURAL_BLOCK_IR_VERSIONS = Object.freeze([
  ...LEGACY_NEURAL_BLOCK_IR_VERSIONS,
  NEURAL_BLOCK_IR_VERSION,
]);

const BLOCK_KINDS = new Set([
  "conv-block",
  "residual-block",
  "attention-block",
  "ffn-block",
  "encoder-stage",
  "decoder-stage",
  "multi-scale-fusion",
  "detection-head",
  "recurrent-cell",
  "moe-block",
  "repeat-block",
  "graph-block",
]);

const BLOCK_BADGES = Object.freeze({
  "conv-block": "conv",
  "residual-block": "residual",
  "attention-block": "attention",
  "ffn-block": "FFN",
  "encoder-stage": "encoder",
  "decoder-stage": "decoder",
  "multi-scale-fusion": "fusion",
  "detection-head": "head",
  "recurrent-cell": "state",
  "moe-block": "MoE",
  "repeat-block": "xN",
  "graph-block": "GNN",
});

const BLOCK_LAYOUT_HINTS = Object.freeze({
  "conv-block": Object.freeze({ stack: "horizontal", direction: "right" }),
  "residual-block": Object.freeze({ lane: "bypass", reserve: "top" }),
  "attention-block": Object.freeze({ stack: "vertical", repeatSymbol: "xN" }),
  "ffn-block": Object.freeze({ stack: "vertical", repeatSymbol: "xN" }),
  "encoder-stage": Object.freeze({ column: "encoder", direction: "down" }),
  "decoder-stage": Object.freeze({ column: "decoder", direction: "up" }),
  "multi-scale-fusion": Object.freeze({ lanes: "multi-scale" }),
  "detection-head": Object.freeze({ column: "head", terminal: true }),
  "recurrent-cell": Object.freeze({ stateRail: true }),
  "moe-block": Object.freeze({ routing: "expert" }),
  "repeat-block": Object.freeze({ repeat: "xN" }),
  "graph-block": Object.freeze({ messagePassing: true, layout: "irregular" }),
});

export function deriveNeuralBlocks(input = {}, facts = {}) {
  const canonicalModel = input?.version === CANONICAL_MODEL_GRAPH_VERSION ? input : null;
  const ir = canonicalModel?.ir || input;
  const nodes = (canonicalModel?.nodes || ir.nodes || []).map((node) => ({ ...node, blockNodeId: nodeId(node) }));
  const edges = (canonicalModel?.edges || ir.edges || []).map((edge) => ({
    ...edge,
    blockSource: String(edge.canonicalSource || edge.source),
    blockTarget: String(edge.canonicalTarget || edge.target),
    blockEdgeId: String(edge.id),
  }));
  const nodeById = new Map(nodes.map((node) => [node.blockNodeId, node]));
  const outgoing = indexEdges(edges, "blockSource");
  const incoming = indexEdges(edges, "blockTarget");
  const order = topologicalOrder(nodes, edges);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const blocks = [];
  const claimed = new Set();

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "recurrent" && !["lstm", "gru", "rnn"].includes(String(node.op || "").toLowerCase())) continue;
    addBlock(blocks, "recurrent-cell", [node.blockNodeId], edges, facts, "recurrent state operator");
  }

  for (const run of repeatRuns(order, outgoing, incoming, nodeById)) {
    addBlock(blocks, "repeat-block", run, edges, facts, "consecutive identical operators");
    run.forEach((id) => claimed.add(String(id)));
  }

  for (const motif of facts.motifs?.motifs || []) {
    if (motif.kind !== "multi-scale-fusion") continue;
    addBlock(blocks, "multi-scale-fusion", motif.nodeIds, edges, facts, "multi-scale fusion motif");
  }

  const graphNodeIds = new Set((facts.motifs?.motifs || [])
    .filter((motif) => motif.kind === "graph-message-passing")
    .flatMap((motif) => motif.nodeIds || [])
    .map(String));
  for (const component of connectedComponents(graphNodeIds, edges, nodeById, orderIndex)) {
    addBlock(blocks, "graph-block", component, edges, facts, "graph message-passing evidence");
    component.forEach((id) => claimed.add(String(id)));
  }

  const multiScaleTargets = new Set((facts.motifs?.motifs || [])
    .filter((motif) => motif.kind === "multi-scale-fusion")
    .map((motif) => String(motif.nodeIds?.at(-1) || ""))
    .filter(Boolean));
  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "merge" || multiScaleTargets.has(node.blockNodeId)) continue;
    const incomingEdges = (incoming.get(node.blockNodeId) || []).filter((edge) => String(edge.blockSource) !== node.blockNodeId);
    if (incomingEdges.length < 3) continue;
    const routed = incomingEdges.some((edge) => isRoutingEdge(edge));
    const namedExperts = incomingEdges.filter((edge) => isNamedExpert(nodeById.get(String(edge.blockSource)))).length;
    if (!routed && namedExperts < 2) continue;
    const branchNodeIds = incomingEdges.map((edge) => String(edge.blockSource));
    addBlock(blocks, "moe-block", [...branchNodeIds, node.blockNodeId], edges, facts, "multiple routed branches converge");
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "pool") continue;
    const nodeIds = collectBackwardRun(node.blockNodeId, incoming, nodeById, new Set(["conv", "norm", "activation"]), 6, orderIndex);
    if (nodeIds.some((id) => nodeById.get(id)?.family === "conv")) {
      addBlock(blocks, "encoder-stage", nodeIds, edges, facts, "downsampling stage with upstream convolution evidence");
    }
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "upsample") continue;
    const nodeIds = collectForwardRun(node.blockNodeId, outgoing, nodeById, new Set(["upsample", "conv", "norm", "activation"]), 6, orderIndex);
    if (nodeIds.some((id) => nodeById.get(id)?.family === "conv")) {
      addBlock(blocks, "decoder-stage", nodeIds, edges, facts, "upsampling stage with downstream convolution evidence");
    }
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "output") continue;
    const incomingEdges = incoming.get(node.blockNodeId) || [];
    const sourceIds = incomingEdges
      .map((edge) => String(edge.blockSource))
      .filter((sourceId) => ["conv", "dense", "flatten", "norm", "activation"].includes(String(nodeById.get(sourceId)?.family || "")));
    addBlock(blocks, "detection-head", [...sourceIds, node.blockNodeId], edges, facts, "terminal output head");
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (node.family !== "merge" && !["add", "sum", "merge"].includes(String(node.op || "").toLowerCase())) continue;
    const incomingEdges = incoming.get(node.blockNodeId) || [];
    if (incomingEdges.length < 2) continue;
    if (!incomingEdges.some((edge) => /residual|skip|bypass/i.test(String(edge.type || "")))) continue;
    const start = nearestCommonAncestor(node.blockNodeId, incoming, orderIndex);
    if (!start) continue;
    const nodeIds = residualMembers(start, node.blockNodeId, outgoing, orderIndex)
      .filter((nodeId) => String(nodeId) !== String(start));
    if (nodeIds.length < 3 || !nodeIds.some((id) => ["conv", "dense", "attention"].includes(String(nodeById.get(id)?.family || "")))) continue;
    addBlock(blocks, "residual-block", nodeIds, edges, facts, "merge node with bypassed computation path");
    nodeIds.forEach((id) => claimed.add(String(id)));
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (claimed.has(node.blockNodeId) || node.family !== "attention") continue;
    const nodeIds = collectForwardRun(node.blockNodeId, outgoing, nodeById, new Set(["attention", "norm", "activation", "merge"]), 4, orderIndex);
    addBlock(blocks, "attention-block", nodeIds, edges, facts, "attention with adjacent normalization or merge");
    nodeIds.forEach((id) => claimed.add(String(id)));
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (claimed.has(node.blockNodeId) || node.family !== "dense") continue;
    const nodeIds = collectForwardRun(node.blockNodeId, outgoing, nodeById, new Set(["dense", "activation"]), 3, orderIndex);
    if (nodeIds.filter((id) => nodeById.get(id)?.family === "dense").length >= 2 || nodeIds.length === 1) {
      addBlock(blocks, "ffn-block", nodeIds, edges, facts, "dense or feed-forward operator run");
      nodeIds.forEach((id) => claimed.add(id));
    }
  }

  for (const node of order.map((id) => nodeById.get(id)).filter(Boolean)) {
    if (claimed.has(node.blockNodeId) || node.family !== "conv") continue;
    const nodeIds = collectForwardRun(node.blockNodeId, outgoing, nodeById, new Set(["conv", "norm", "activation"]), 4, orderIndex);
    addBlock(blocks, "conv-block", nodeIds, edges, facts, "convolution with adjacent norm or activation");
    nodeIds.forEach((id) => claimed.add(id));
  }

  const nodeToBlock = Object.fromEntries(nodes.map((node) => [node.blockNodeId, []]));
  for (const block of blocks) {
    for (const id of block.nodeIds) {
      if (!nodeToBlock[id]) continue;
      nodeToBlock[id].push(block.id);
    }
  }

  return deepFreeze({
    version: NEURAL_BLOCK_IR_VERSION,
    irVersion: String(ir.version || ""),
    blocks,
    nodeToBlock,
    diagnostics: [],
  });
}

export function validateNeuralBlocks(value = {}, input = {}) {
  const ir = input?.version === CANONICAL_MODEL_GRAPH_VERSION ? input.ir : input;
  const issues = [];
  if (!SUPPORTED_NEURAL_BLOCK_IR_VERSIONS.includes(String(value.version || ""))) {
    issues.push({ code: "invalid-neural-block-ir-version", value: value.version });
  }
  if (value.irVersion !== String(ir.version || "")) issues.push({ code: "block-ir-version-mismatch" });
  const nodeIds = new Set((ir.nodes || []).map((node) => String(node.id)));
  const edgeIds = new Set((ir.edges || []).map((edge) => String(edge.id)));
  const blockIds = new Set();
  for (const block of value.blocks || []) {
    if (!block.id || blockIds.has(block.id)) issues.push({ code: block.id ? "duplicate-block-id" : "missing-block-id", blockId: block.id });
    blockIds.add(block.id);
    if (!BLOCK_KINDS.has(block.kind)) issues.push({ code: "invalid-block-kind", blockId: block.id, kind: block.kind });
    if (!Array.isArray(block.nodeIds) || block.nodeIds.length === 0) issues.push({ code: "empty-block", blockId: block.id });
    for (const nodeId of block.nodeIds || []) {
      if (!nodeIds.has(String(nodeId))) issues.push({ code: "missing-block-node", blockId: block.id, nodeId });
    }
    for (const nodeId of block.entryNodeIds || []) {
      if (!block.nodeIds?.map(String).includes(String(nodeId))) issues.push({ code: "entry-node-outside-block", blockId: block.id, nodeId });
    }
    for (const nodeId of block.exitNodeIds || []) {
      if (!block.nodeIds?.map(String).includes(String(nodeId))) issues.push({ code: "exit-node-outside-block", blockId: block.id, nodeId });
    }
    validateBlockPorts(block.entryPorts, block.id, "entry", issues);
    validateBlockPorts(block.exitPorts, block.id, "exit", issues);
    for (const mapping of block.entryPortMappings || []) {
      if (mapping.edgeId && edgeIds.size && !edgeIds.has(String(mapping.edgeId))) issues.push({ code: "missing-entry-port-edge", blockId: block.id, edgeId: mapping.edgeId });
      if (mapping.nodeId && !block.nodeIds?.map(String).includes(String(mapping.nodeId))) issues.push({ code: "entry-port-node-outside-block", blockId: block.id, nodeId: mapping.nodeId });
    }
    for (const mapping of block.exitPortMappings || []) {
      if (mapping.edgeId && edgeIds.size && !edgeIds.has(String(mapping.edgeId))) issues.push({ code: "missing-exit-port-edge", blockId: block.id, edgeId: mapping.edgeId });
      if (mapping.nodeId && !block.nodeIds?.map(String).includes(String(mapping.nodeId))) issues.push({ code: "exit-port-node-outside-block", blockId: block.id, nodeId: mapping.nodeId });
    }
  }
  const blockNodeIndex = new Map(Object.entries(indexBlockNodes(value.blocks || [])));
  for (const [nodeId, blockIdsForNode] of Object.entries(value.nodeToBlock || {})) {
    if (!nodeIds.has(String(nodeId))) issues.push({ code: "orphan-block-node-index", nodeId });
    for (const blockId of blockIdsForNode || []) {
      if (!blockIds.has(String(blockId))) issues.push({ code: "dangling-block-index", nodeId, blockId });
    }
    const expected = blockNodeIndex.get(String(nodeId)) || [];
    const actual = [...(blockIdsForNode || [])].map(String).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      issues.push({ code: "incomplete-block-node-index", nodeId, expected, actual });
    }
  }
  for (const nodeId of blockNodeIndex.keys()) {
    if (!Object.hasOwn(value.nodeToBlock || {}, nodeId)) issues.push({ code: "missing-block-node-index", nodeId });
  }
  return { ok: issues.length === 0, issues, summary: { blockCount: value.blocks?.length || 0 } };
}

export function upgradeNeuralBlocks(value = {}, input = {}) {
  const ir = input?.version === CANONICAL_MODEL_GRAPH_VERSION ? input.ir : input;
  const sourceVersion = String(value.version || "");
  const blocks = (value.blocks || []).map((block) => {
    const nodeIds = (block.nodeIds || []).map(String);
    const entryNodeIds = normalizedSubset(block.entryNodeIds, nodeIds, nodeIds);
    const exitNodeIds = normalizedSubset(block.exitNodeIds, nodeIds, nodeIds);
    const kind = String(block.kind || "unknown");
    const badge = blockBadgeForKind(kind);
    const layoutHint = layoutHintForBlockKind(kind);
    return {
      ...block,
      id: String(block.id || `block:${kind}:${nodeIds.join("+")}`),
      kind,
      nodeIds,
      edgeIds: (block.edgeIds || []).map(String),
      entryNodeIds,
      exitNodeIds,
      entryPorts: cloneValue(block.entryPorts),
      exitPorts: cloneValue(block.exitPorts),
      entryPortMappings: cloneValue(block.entryPortMappings),
      exitPortMappings: cloneValue(block.exitPortMappings),
      reason: String(block.reason || `migrated ${sourceVersion || "unknown"} block`),
      confidence: Number.isFinite(block.confidence) ? block.confidence : 1,
      evidenceIds: (block.evidenceIds || []).map(String),
      ...(badge ? { blockBadge: badge } : {}),
      ...(layoutHint ? { layoutHint } : {}),
    };
  });
  const nodeToBlock = indexBlockNodes(blocks);
  for (const [nodeId, blockIdsForNode] of Object.entries(value.nodeToBlock || {})) {
    if (!nodeToBlock[nodeId]) nodeToBlock[nodeId] = [];
    nodeToBlock[nodeId] = [...new Set([...nodeToBlock[nodeId], ...(blockIdsForNode || []).map(String)])].sort();
  }
  for (const nodeId of Object.keys(nodeToBlock)) nodeToBlock[nodeId] = [...new Set(nodeToBlock[nodeId])].sort();
  const upgraded = {
    ...value,
    version: NEURAL_BLOCK_IR_VERSION,
    irVersion: String(value.irVersion || ir.version || ""),
    blocks,
    nodeToBlock,
    diagnostics: [
      ...(value.diagnostics || []),
      ...(sourceVersion && sourceVersion !== NEURAL_BLOCK_IR_VERSION
        ? [{ code: "neural-block-ir-migrated", severity: "info", from: sourceVersion, to: NEURAL_BLOCK_IR_VERSION }]
        : []),
    ],
  };
  return deepFreeze(upgraded);
}

export function normalizeNeuralBlocks(value, input = {}) {
  if (!value || !Array.isArray(value.blocks)) return value;
  return upgradeNeuralBlocks(value, input);
}

export function blockBadgeForKind(kind) {
  return BLOCK_BADGES[String(kind || "")] || "";
}

export function layoutHintForBlockKind(kind) {
  const hint = BLOCK_LAYOUT_HINTS[String(kind || "")];
  return hint ? { ...hint } : null;
}

function addBlock(blocks, kind, nodeIdsValue, edges, facts, reason) {
  const nodeIds = [...new Set(nodeIdsValue.map(String).filter(Boolean))];
  if (!nodeIds.length) return;
  const nodeIdSet = new Set(nodeIds);
  const internalEdges = edges.filter((edge) => nodeIdSet.has(edge.blockSource) && nodeIdSet.has(edge.blockTarget));
  const edgeIds = internalEdges.map((edge) => edge.blockEdgeId);
  const incomingEdges = edges.filter((edge) => !nodeIdSet.has(edge.blockSource) && nodeIdSet.has(edge.blockTarget));
  const outgoingEdges = edges.filter((edge) => nodeIdSet.has(edge.blockSource) && !nodeIdSet.has(edge.blockTarget));
  const entryNodeIds = [...new Set(incomingEdges.map((edge) => String(edge.blockTarget)))]
    .filter((nodeId) => kind !== "residual-block" || String(nodeId) !== String(nodeIds.at(-1)));
  const exitNodeIds = [...new Set(outgoingEdges.map((edge) => String(edge.blockSource)))];
  const entryPorts = preferredPorts(entryNodeIds, facts, "inputs");
  const exitPorts = preferredPorts(exitNodeIds, facts, "outputs");
  const entryPortMappings = incomingEdges
    .filter((edge) => kind !== "residual-block" || String(edge.blockTarget) !== String(nodeIds.at(-1)))
    .map((edge) => ({
      edgeId: String(edge.blockEdgeId),
      nodeId: String(edge.blockTarget),
      sourceNodeId: String(edge.blockSource),
      portId: String(edge.targetEndpointIds?.target || edge.ports?.target || ""),
    }));
  const exitPortMappings = outgoingEdges.map((edge) => ({
    edgeId: String(edge.blockEdgeId),
    nodeId: String(edge.blockSource),
    targetNodeId: String(edge.blockTarget),
    portId: String(edge.sourceEndpointIds?.source || edge.ports?.source || ""),
  }));
  const id = `block:${kind}:${nodeIds.join("+")}`;
  const evidenceIds = [...new Set(nodeIds.flatMap((nodeId) => Object.values(facts.nodeFacts?.[nodeId] || {}).flatMap((fact) => fact?.evidenceIds || [])))].sort();
  blocks.push({
    id,
    kind,
    nodeIds,
    edgeIds,
    entryNodeIds,
    exitNodeIds,
    entryPorts,
    exitPorts,
    entryPortMappings,
    exitPortMappings,
    reason,
    ...(kind === "repeat-block" ? { repeatCount: nodeIds.length } : {}),
    ...(kind === "moe-block" ? { expertCount: Math.max(1, entryNodeIds.length) } : {}),
    ...(blockBadgeForKind(kind) ? { blockBadge: blockBadgeForKind(kind) } : {}),
    ...(layoutHintForBlockKind(kind) ? { layoutHint: layoutHintForBlockKind(kind) } : {}),
    confidence: minimumConfidence(nodeIds, facts),
    evidenceIds,
  });
}

function connectedComponents(nodeIds, edges, nodeById, orderIndex) {
  const remaining = new Set([...nodeIds].filter((id) => nodeById.has(String(id))));
  const components = [];
  while (remaining.size) {
    const start = [...remaining].sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0) || left.localeCompare(right))[0];
    const component = [];
    const queue = [start];
    remaining.delete(start);
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const edge of edges) {
        const source = String(edge.blockSource);
        const target = String(edge.blockTarget);
        const next = source === String(current) && remaining.has(target)
          ? target
          : target === String(current) && remaining.has(source)
            ? source
            : "";
        if (!next) continue;
        remaining.delete(next);
        queue.push(next);
      }
    }
    components.push(component.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0)));
  }
  return components;
}

function isRoutingEdge(edge = {}) {
  return /route|router|expert|gate|moe|conditional|control/i.test(String(edge.type || ""));
}

function isNamedExpert(node = {}) {
  return /expert|moe|ffn-expert/i.test(`${String(node.op || "")} ${String(node.label || "")}`);
}

function repeatRuns(order, outgoing, incoming, nodeById) {
  const runs = [];
  let current = [];
  const flush = () => {
    if (current.length >= 3) runs.push([...current]);
    current = [];
  };
  for (const id of order) {
    const node = nodeById.get(id);
    const key = `${String(node?.family || "")}:${String(node?.op || "")}`;
    const previous = current.length ? nodeById.get(current.at(-1)) : null;
    const previousKey = previous ? `${String(previous.family || "")}:${String(previous.op || "")}` : "";
    const connected = previous ? (outgoing.get(String(previous.blockNodeId)) || []).some((edge) => String(edge.blockTarget) === String(id)) : false;
    const linear = previous
      ? (outgoing.get(String(previous.blockNodeId)) || []).length === 1 && (incoming.get(String(id)) || []).length === 1
      : true;
    if (!["conv", "dense", "attention", "norm"].includes(String(node?.family || "")) || key !== previousKey || (previous && (!connected || !linear))) {
      flush();
      current = ["conv", "dense", "attention", "norm"].includes(String(node?.family || "")) ? [id] : [];
      continue;
    }
    current.push(id);
  }
  flush();
  return runs;
}

function preferredPorts(nodeIds, facts, side) {
  const ports = nodeIds.flatMap((nodeId) => facts.nodeFacts?.[nodeId]?.ports?.value?.[side] || []).map(String).filter(Boolean);
  return [...new Set(ports)];
}

function nearestCommonAncestor(targetId, incoming, orderIndex) {
  const incomingEdges = incoming.get(targetId) || [];
  const sets = incomingEdges.map((edge) => ancestorSet(edge.blockSource, incoming));
  if (sets.length < 2) return "";
  const common = [...sets[0]].filter((id) => sets.every((set) => set.has(id)));
  return common.sort((a, b) => (orderIndex.get(b) ?? -1) - (orderIndex.get(a) ?? -1))[0] || "";
}

function ancestorSet(startId, incoming) {
  const seen = new Set([String(startId)]);
  const queue = [String(startId)];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of incoming.get(current) || []) {
      const next = String(edge.blockSource);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function residualMembers(startId, targetId, outgoing, orderIndex) {
  const result = new Set([String(startId), String(targetId)]);
  const queue = [String(startId)];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of outgoing.get(current) || []) {
      const next = String(edge.blockTarget);
      if (next === targetId) {
        result.add(next);
        continue;
      }
      if ((orderIndex.get(next) ?? Infinity) > (orderIndex.get(targetId) ?? Infinity)) continue;
      if (result.has(next)) continue;
      result.add(next);
      queue.push(next);
    }
  }
  return [...result].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
}

function collectForwardRun(startId, outgoing, nodeById, allowedFamilies, maxLength, orderIndex) {
  const result = [String(startId)];
  let current = String(startId);
  while (result.length < maxLength) {
    const nextEdges = (outgoing.get(current) || []).filter((edge) =>
      !isProtectedContinuation(edge)
      && allowedFamilies.has(String(nodeById.get(String(edge.blockTarget))?.family || "")));
    if (nextEdges.length !== 1) break;
    const next = String(nextEdges[0].blockTarget);
    if (result.includes(next)) break;
    result.push(next);
    current = next;
  }
  return result.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
}

function collectBackwardRun(startId, incoming, nodeById, allowedFamilies, maxLength, orderIndex) {
  const result = [String(startId)];
  let current = String(startId);
  while (result.length < maxLength) {
    const previousEdges = (incoming.get(current) || []).filter((edge) =>
      !isProtectedContinuation(edge)
      && allowedFamilies.has(String(nodeById.get(String(edge.blockSource))?.family || "")));
    if (previousEdges.length !== 1) break;
    const previous = String(previousEdges[0].blockSource);
    if (result.includes(previous)) break;
    result.push(previous);
    current = previous;
  }
  return result.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
}

function topologicalOrder(nodes, edges) {
  const ids = nodes.map((node) => node.blockNodeId);
  const incomingCount = new Map(ids.map((id) => [id, 0]));
  const outgoing = indexEdges(edges, "blockSource");
  for (const edge of edges) incomingCount.set(edge.blockTarget, (incomingCount.get(edge.blockTarget) || 0) + 1);
  const queue = ids.filter((id) => (incomingCount.get(id) || 0) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const edge of outgoing.get(id) || []) {
      incomingCount.set(edge.blockTarget, (incomingCount.get(edge.blockTarget) || 0) - 1);
      if (incomingCount.get(edge.blockTarget) === 0) queue.push(edge.blockTarget);
    }
  }
  return order.length === ids.length ? order : ids;
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

function isProtectedContinuation(edge = {}) {
  return /state|loop|feedback|residual|skip|bypass|cross-scale|conditional|control|gate/i.test(String(edge.type || ""));
}

function minimumConfidence(nodeIds, facts) {
  const values = nodeIds.map((id) => facts.nodeFacts?.[id]?.certainty?.confidence).filter(Number.isFinite);
  return values.length ? Math.min(...values) : 1;
}

function validateBlockPorts(ports, blockId, side, issues) {
  const seen = new Set();
  for (const port of ports || []) {
    const id = String(typeof port === "string" ? port : (port?.id || port?.portId || ""));
    if (!id) {
      issues.push({ code: `missing-${side}-port-id`, blockId });
      continue;
    }
    if (seen.has(id)) issues.push({ code: `duplicate-${side}-port-id`, blockId, portId: id });
    seen.add(id);
  }
}

function indexBlockNodes(blocks = []) {
  const index = {};
  for (const block of blocks) {
    for (const nodeId of block.nodeIds || []) {
      const id = String(nodeId);
      if (!index[id]) index[id] = [];
      index[id].push(String(block.id));
    }
  }
  for (const nodeId of Object.keys(index)) index[nodeId] = [...new Set(index[nodeId])].sort();
  return index;
}

function normalizedSubset(value, allowed, fallback) {
  const allowedSet = new Set((allowed || []).map(String));
  const requested = Array.isArray(value) ? value.map(String).filter((id) => allowedSet.has(id)) : [];
  return [...new Set(requested.length ? requested : fallback)];
}

function cloneValue(value) {
  return Array.isArray(value)
    ? value.map((item) => item && typeof item === "object" ? { ...item } : item)
    : [];
}

function nodeId(node) {
  return String(node.canonicalId || node.id);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
