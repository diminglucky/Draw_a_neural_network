const VERSION = "neural-semantic-facts/v1";

export function deriveNeuralSemanticFacts(ir = {}) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const incoming = indexEdges(edges, "target");
  const outgoing = indexEdges(edges, "source");
  const cyclicNodeIds = findCyclicNodes(nodes, edges);
  const nodeFacts = {};
  for (const node of nodes) {
    const nodeId = String(node.id);
    const inEdges = incoming.get(nodeId) || [];
    const outEdges = outgoing.get(nodeId) || [];
    const confidence = boundedConfidence(node.confidence);
    const evidenceIds = evidenceIdsFor(node, `node:${nodeId}`);
    nodeFacts[nodeId] = {
      nodeId,
      dataDomain: fact(dataDomain(node), evidenceIds, confidence),
      operationEffect: fact(operationEffect(node, inEdges, nodeById), evidenceIds, confidence),
      topology: fact({
        inDegree: inEdges.length,
        outDegree: outEdges.length,
        branch: outEdges.filter(nonLoop).length > 1,
        merge: inEdges.filter(nonLoop).length > 1,
        bypass: [...inEdges, ...outEdges].some(isBypass),
        cycle: cyclicNodeIds.has(nodeId),
        conditional: [...inEdges, ...outEdges].some(isConditional),
        crossScale: [...inEdges, ...outEdges].some((edge) => isCrossScale(edge, nodeById)),
      }, edgeEvidenceIds([...inEdges, ...outEdges], evidenceIds), minimumConfidence([node, ...inEdges, ...outEdges])),
      structuralRole: fact(structuralRole(node, inEdges, outEdges, cyclicNodeIds), evidenceIds, confidence),
      spatialScale: fact(spatialScale(node), evidenceIds, confidence),
      certainty: fact(certainty(node), evidenceIds, confidence),
      ports: fact({ inputs: [...(node.ports?.inputs || [])], outputs: [...(node.ports?.outputs || [])] }, evidenceIds, confidence),
    };
  }

  const edgeFacts = {};
  for (const edge of edges) {
    const edgeId = String(edge.id);
    const evidenceIds = evidenceIdsFor(edge, `edge:${edgeId}`);
    const confidence = boundedConfidence(edge.confidence);
    edgeFacts[edgeId] = {
      edgeId,
      relation: fact(relationFor(edge), evidenceIds, confidence),
      topology: fact({
        bypass: isBypass(edge),
        state: isState(edge),
        cycle: cyclicNodeIds.has(String(edge.source)) && reaches(String(edge.target), String(edge.source), edges),
        conditional: isConditional(edge),
        crossScale: isCrossScale(edge, nodeById),
      }, evidenceIds, confidence),
      endpoints: fact({
        sourceNodeId: String(edge.source),
        targetNodeId: String(edge.target),
        sourcePortId: edge.sourceEndpointIds?.source || edge.ports?.source || null,
        targetPortId: edge.sourceEndpointIds?.target || edge.ports?.target || null,
      }, evidenceIds, confidence),
      certainty: fact(certainty(edge), evidenceIds, confidence),
    };
  }

  const regionFacts = {};
  for (const region of [...(ir.containers || []), ...(ir.groups || [])]) {
    const regionId = String(region.id);
    const memberIds = Array.isArray(region.nodeIds) ? region.nodeIds.map(String) : (region.children || []).map(String).filter((id) => nodeById.has(id));
    regionFacts[regionId] = {
      regionId,
      memberNodeIds: fact(memberIds, [`region:${regionId}:membership`], 1),
      structuralRole: fact(String(region.kind || "region"), [`region:${regionId}:kind`], 1),
    };
  }

  return deepFreeze({ version: VERSION, irVersion: String(ir.version || ""), nodeFacts, edgeFacts, regionFacts, diagnostics: [] });
}

export function validateNeuralSemanticFacts(facts = {}, ir = {}) {
  const issues = [];
  if (facts.version !== VERSION) issues.push({ code: "invalid-semantic-facts-version" });
  if (facts.irVersion !== String(ir.version || "")) issues.push({ code: "ir-version-mismatch" });
  validateCoverage(ir.nodes, facts.nodeFacts, "node", issues);
  validateCoverage(ir.edges, facts.edgeFacts, "edge", issues);
  const regions = [...(ir.containers || []), ...(ir.groups || [])];
  validateCoverage(regions, facts.regionFacts, "region", issues);
  return { ok: issues.length === 0, issues, summary: { nodeCount: Object.keys(facts.nodeFacts || {}).length, edgeCount: Object.keys(facts.edgeFacts || {}).length, regionCount: Object.keys(facts.regionFacts || {}).length } };
}

function dataDomain(node) {
  const declared = String(node.attributes?.dataDomain || "").toLowerCase();
  if (["spatial", "sequence", "vector", "set", "graph", "state", "scalar", "unknown"].includes(declared)) return declared;
  if (node.family === "recurrent" || hasStatePorts(node)) return "state";
  if (node.family === "graph") return "graph";
  if (node.family === "attention") return "sequence";
  const shape = outputShape(node);
  if (shape.length >= 4) return "spatial";
  if (shape.length === 3) return "sequence";
  if (shape.length === 2) return "vector";
  if (shape.length === 1) return shape[0] === 1 ? "scalar" : "vector";
  return "unknown";
}

function operationEffect(node, incoming, nodeById) {
  if (node.family === "pool") return "reduce";
  if (node.family === "upsample") return "expand";
  if (node.family === "flatten") return "reshape";
  if (["merge", "attention", "graph"].includes(node.family)) return "aggregate";
  if (["input", "output", "activation", "norm", "recurrent"].includes(node.family)) return "preserve";
  const sourceShape = outputShape(nodeById.get(incoming.find(nonLoop)?.source));
  const targetShape = outputShape(node);
  const scale = compareSpatialScale(sourceShape, targetShape);
  if (scale) return scale;
  if (["conv", "dense"].includes(node.family)) return "project";
  return "unknown";
}

function structuralRole(node, incoming, outgoing, cyclicNodeIds) {
  if (node.family === "input") return "input";
  if (node.family === "output") return "output";
  if (node.family === "merge" || incoming.filter(nonLoop).length > 1) return "merge";
  if (outgoing.filter(nonLoop).length > 1) return "branch";
  if (cyclicNodeIds.has(String(node.id)) || node.family === "recurrent") return "stateful";
  return node.compoundKind === "unresolved" ? "opaque" : "transform";
}

function spatialScale(node) {
  if (node.laneId) return { laneId: String(node.laneId), dimensions: spatialDimensions(outputShape(node)) };
  const dimensions = spatialDimensions(outputShape(node));
  return dimensions.length ? { laneId: null, dimensions } : null;
}

function relationFor(edge) {
  if (isState(edge)) return "state";
  if (isBypass(edge)) return "bypass";
  if (isConditional(edge)) return "conditional";
  if (String(edge.type).toLowerCase() === "output") return "output";
  return "data";
}

function certainty(value) {
  if (String(value.status || "").toLowerCase() === "unresolved" || value.compoundKind === "unresolved") return "unresolved";
  return boundedConfidence(value.confidence) >= 0.85 ? "grounded" : "inferred";
}

function isCrossScale(edge, nodeById) {
  const source = nodeById.get(String(edge.source));
  const target = nodeById.get(String(edge.target));
  if (!source || !target) return false;
  if (source.laneId && target.laneId) return String(source.laneId) !== String(target.laneId);
  return Boolean(compareSpatialScale(outputShape(source), outputShape(target)));
}

function compareSpatialScale(source, target) {
  const left = spatialDimensions(source);
  const right = spatialDimensions(target);
  if (left.length !== 2 || right.length !== 2 || !left.every(Number.isFinite) || !right.every(Number.isFinite)) return null;
  const sourceArea = left[0] * left[1];
  const targetArea = right[0] * right[1];
  return targetArea < sourceArea ? "reduce" : targetArea > sourceArea ? "expand" : null;
}

function spatialDimensions(shape) { return shape.length >= 4 ? shape.slice(-2).map(Number) : []; }
function outputShape(node) { const value = node?.shape?.output; return Array.isArray(value) ? value : []; }
function hasStatePorts(node) { return [...(node.ports?.inputs || []), ...(node.ports?.outputs || [])].some((port) => /(^|[-_])(?:h|c|state)(?:$|[-_])/i.test(String(port))); }
function isBypass(edge) { return /residual|skip|bypass/i.test(String(edge.type || "")); }
function isState(edge) { return /state|loop|recurrent|feedback/i.test(String(edge.type || "")); }
function isConditional(edge) { return /condition|control|route|gate/i.test(String(edge.type || "")); }
function nonLoop(edge) { return String(edge.source) !== String(edge.target); }

function findCyclicNodes(nodes, edges) {
  const result = new Set();
  for (const node of nodes) if (reaches(String(node.id), String(node.id), edges, true)) result.add(String(node.id));
  return result;
}

function reaches(start, target, edges, requireEdge = false) {
  const queue = [start];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (String(edge.source) !== current) continue;
      const next = String(edge.target);
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

function fact(value, evidenceIds, confidence) { return { value, evidenceIds: [...new Set(evidenceIds)], confidence: boundedConfidence(confidence) }; }
function evidenceIdsFor(value, fallback) { const ids = (value.evidence || []).map((item) => String(item.evidenceId || item.id || "")).filter(Boolean); return ids.length ? ids : [`derived:${fallback}`]; }
function edgeEvidenceIds(edges, fallback) { return [...new Set(edges.flatMap((edge) => evidenceIdsFor(edge, `edge:${edge.id}`)).concat(fallback))]; }
function minimumConfidence(values) { return Math.min(...values.map((value) => boundedConfidence(value.confidence))); }
function boundedConfidence(value) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; }

function validateCoverage(items = [], index = {}, kind, issues) {
  const expected = new Set(items.map((item) => String(item.id)));
  for (const id of expected) if (!index || !Object.hasOwn(index, id)) issues.push({ code: `missing-${kind}-facts`, [`${kind}Id`]: id });
  for (const id of Object.keys(index || {})) if (!expected.has(id)) issues.push({ code: `orphan-${kind}-facts`, [`${kind}Id`]: id });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
