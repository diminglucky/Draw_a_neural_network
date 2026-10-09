export const NEURAL_MOTIFS_VERSION = "neural-motifs/v1";

export function deriveNeuralMotifs(ir = {}, facts = {}) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const motifs = [];
  const nodeToMotifs = Object.fromEntries(nodes.map((node) => [String(node.id), []]));
  const edgeToMotifs = Object.fromEntries(edges.map((edge) => [String(edge.id), []]));
  const add = (kind, nodeIds, edgeIds, reason) => {
    const normalizedNodeIds = orderedIds(nodeIds, nodes);
    const normalizedEdgeIds = orderedIds(edgeIds, edges);
    if (!normalizedNodeIds.length && !normalizedEdgeIds.length) return;
    const id = `motif:${kind}:${normalizedNodeIds.join("+") || normalizedEdgeIds.join("+")}`;
    const evidenceIds = [...new Set([
      ...normalizedNodeIds.flatMap((nodeId) => factEvidence(facts.nodeFacts?.[nodeId])),
      ...normalizedEdgeIds.flatMap((edgeId) => factEvidence(facts.edgeFacts?.[edgeId])),
    ])].sort();
    const motif = {
      id,
      kind,
      nodeIds: normalizedNodeIds,
      edgeIds: normalizedEdgeIds,
      reason,
      confidence: motifConfidence(normalizedNodeIds, normalizedEdgeIds, facts),
      evidenceIds,
    };
    motifs.push(motif);
    for (const nodeId of normalizedNodeIds) nodeToMotifs[nodeId].push(id);
    for (const edgeId of normalizedEdgeIds) edgeToMotifs[edgeId].push(id);
  };

  for (const node of nodes) {
    const nodeId = String(node.id);
    if (Number(node.repeatCount || node.repeat || 1) > 1) {
      add("repeat-stack", [nodeId], [], "repetition evidence");
    }
    if (String(node.family || "").toLowerCase() === "attention") {
      add("attention-region", [nodeId], [], "attention operator");
    }
    const domain = facts.nodeFacts?.[nodeId]?.dataDomain?.value;
    const family = String(node.family || "").toLowerCase();
    if (family !== "input" && (family === "graph" || domain === "graph")) {
      add("graph-message-passing", [nodeId], [], "graph-domain evidence");
    }
    if (node.compoundKind === "unresolved") {
      add("opaque-module", [nodeId], [], "unknown internal topology");
    }
  }

  const crossScaleByTarget = new Map();
  for (const edge of edges) {
    const edgeId = String(edge.id);
    const sourceNodeId = String(edge.source);
    const targetNodeId = String(edge.target);
    const edgeFacts = facts.edgeFacts?.[edgeId];
    const relation = edgeFacts?.relation?.value || relationFromEdge(edge);
    if (relation === "bypass" || edgeFacts?.topology?.value?.bypass) {
      add("residual-bypass", [sourceNodeId, targetNodeId], [edgeId], "bypass edge");
    }
    if (relation === "state" || edgeFacts?.topology?.value?.state) {
      add("state-feedback", [sourceNodeId, targetNodeId], [edgeId], "state edge");
    }
    if (relation === "conditional" || edgeFacts?.topology?.value?.conditional) {
      add("conditional-route", [sourceNodeId, targetNodeId], [edgeId], "conditional edge");
    }
    if (edgeFacts?.topology?.value?.crossScale) {
      if (!crossScaleByTarget.has(targetNodeId)) crossScaleByTarget.set(targetNodeId, []);
      crossScaleByTarget.get(targetNodeId).push(edgeId);
    }
  }

  for (const [targetNodeId, edgeIds] of crossScaleByTarget) {
    if (edgeIds.length < 2) continue;
    const targetRole = facts.nodeFacts?.[targetNodeId]?.structuralRole?.value;
    if (targetRole !== "merge" && String(nodeById.get(targetNodeId)?.family || "").toLowerCase() !== "merge") continue;
    const nodeIds = [...new Set(edgeIds.map((edgeId) => String(edges.find((edge) => String(edge.id) === edgeId)?.source || "")))]
      .filter(Boolean)
      .concat(targetNodeId);
    add("multi-scale-fusion", nodeIds, edgeIds, "multiple cross-scale inputs converge on a merge");
  }

  return deepFreeze({
    version: NEURAL_MOTIFS_VERSION,
    irVersion: String(ir.version || ""),
    motifs,
    nodeToMotifs,
    edgeToMotifs,
    diagnostics: [],
  });
}

export function validateNeuralMotifs(value = {}, ir = {}) {
  const issues = [];
  if (value.version !== NEURAL_MOTIFS_VERSION) issues.push({ code: "invalid-neural-motifs-version" });
  if (value.irVersion !== String(ir.version || "")) issues.push({ code: "ir-version-mismatch" });
  const nodeIds = new Set((ir.nodes || []).map((node) => String(node.id)));
  const edgeIds = new Set((ir.edges || []).map((edge) => String(edge.id)));
  const motifIds = new Set();
  for (const motif of value.motifs || []) {
    if (!motif.id || motifIds.has(motif.id)) issues.push({ code: motif.id ? "duplicate-motif-id" : "missing-motif-id", motifId: motif.id });
    motifIds.add(motif.id);
    for (const nodeId of motif.nodeIds || []) if (!nodeIds.has(String(nodeId))) issues.push({ code: "missing-motif-node", motifId: motif.id, nodeId });
    for (const edgeId of motif.edgeIds || []) if (!edgeIds.has(String(edgeId))) issues.push({ code: "missing-motif-edge", motifId: motif.id, edgeId });
  }
  validateMotifIndex(value.nodeToMotifs, nodeIds, motifIds, "node", issues);
  validateMotifIndex(value.edgeToMotifs, edgeIds, motifIds, "edge", issues);
  for (const motif of value.motifs || []) {
    for (const nodeId of motif.nodeIds || []) {
      if (!(value.nodeToMotifs?.[nodeId] || []).includes(motif.id)) {
        issues.push({ code: "missing-node-motif-index", motifId: motif.id, nodeId });
      }
    }
    for (const edgeId of motif.edgeIds || []) {
      if (!(value.edgeToMotifs?.[edgeId] || []).includes(motif.id)) {
        issues.push({ code: "missing-edge-motif-index", motifId: motif.id, edgeId });
      }
    }
  }
  return { ok: issues.length === 0, issues, summary: { motifCount: value.motifs?.length || 0 } };
}

function validateMotifIndex(index = {}, expectedIds, motifIds, kind, issues) {
  for (const id of expectedIds) {
    if (!Object.hasOwn(index, id)) {
      issues.push({ code: `missing-${kind}-motif-index`, [`${kind}Id`]: id });
      continue;
    }
    for (const motifId of index[id] || []) {
      if (!motifIds.has(motifId)) issues.push({ code: "dangling-motif-index", motifId, [`${kind}Id`]: id });
    }
  }
  for (const id of Object.keys(index || {})) {
    if (!expectedIds.has(id)) issues.push({ code: `orphan-${kind}-motif-index`, [`${kind}Id`]: id });
  }
}

function relationFromEdge(edge = {}) {
  const type = String(edge.type || "").toLowerCase();
  if (/state|loop|recurrent|feedback/.test(type)) return "state";
  if (/residual|skip|bypass/.test(type)) return "bypass";
  if (/condition|control|route|gate/.test(type)) return "conditional";
  return type === "output" ? "output" : "data";
}

function orderedIds(ids = [], items = []) {
  const requested = new Set(ids.map(String));
  return items.map((item) => String(item.id)).filter((id) => requested.has(id));
}

function factEvidence(fact = {}) {
  return Object.values(fact || {}).flatMap((entry) => entry?.evidenceIds || []).map(String);
}

function motifConfidence(nodeIds, edgeIds, facts) {
  const values = [
    ...nodeIds.map((id) => facts.nodeFacts?.[id]?.certainty?.confidence),
    ...edgeIds.map((id) => facts.edgeFacts?.[id]?.certainty?.confidence),
  ].filter(Number.isFinite);
  return values.length ? Math.min(...values) : 1;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
