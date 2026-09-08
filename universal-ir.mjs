const VERSION = "universal-neural-ir/v1";

export { normalizeRecurrentEvidence, recurrentEvidenceForNode } from "./semantic-visual-grammar.mjs";

const FAMILY_ALIASES = [
  ["input", /^(input|tensor|placeholder|source)$/i],
  ["output", /^(output|prediction|logits|softmax)$/i],
  ["conv", /conv|convolution/i],
  // Upsample precedes pool so interpolation/upscaling is never classified as
  // downsampling. Transposed conv (ConvTranspose2d) still matches `conv` above,
  // which is intentional: its shape math is a convolution in reverse.
  ["upsample", /upsample|up.?sample|interpolate|pixel.?shuffle|unpool/i],
  ["pool", /pool|downsample|max.?pool|avg.?pool|adaptive.?pool|global.?pool/i],
  ["dense", /linear|dense|dense-layer|neuron|fully.?connected|classifier/i],
  ["attention", /attention|mhsa|mha|transformer/i],
  ["merge", /concat|concatenate|add|sum|merge|join/i],
  ["flatten", /flatten|reshape|view|projection/i],
  ["norm", /norm|batch.?normal|layer.?normal|group.?normal/i],
  ["activation", /relu|gelu|silu|sigmoid|tanh|softmax|activation/i],
  ["recurrent", /lstm|gru|rnn|recurrent/i],
  ["graph", /graph.?conv|message.?pass|gcn|gat|graph/i],
  ["volume", /volume|voxel|3d/i],
];

const KNOWN_FAMILIES = new Set([
  "input", "output", "conv", "upsample", "pool", "dense", "attention", "merge",
  "flatten", "norm", "activation", "recurrent", "graph", "volume", "custom", "unknown",
]);

export function createUniversalIR(document = {}, options = {}) {
  return normalizeUniversalIR({
    version: VERSION,
    source: {
      kind: String(options.sourceKind || document.meta?.framework || "unknown"),
      name: options.sourceName || document.meta?.modelName || "",
      ...(options.source || {}),
    },
    figure: normalizeFigure(document.figure),
    nodes: Array.isArray(document.nodes) ? document.nodes : [],
    edges: Array.isArray(document.edges) ? document.edges : [],
    groups: Array.isArray(document.groups) ? document.groups : [],
    diagnostics: Array.isArray(document.diagnostics) ? document.diagnostics : [],
  });
}

export function normalizeUniversalIR(ir = {}) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes.map((node, index) => normalizeNode(node, index)) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(ir.edges)
    ? ir.edges.map((edge, index) => normalizeEdge(edge, index))
    : [];
  return {
    version: String(ir.version || VERSION),
    source: { kind: String(ir.source?.kind || "unknown"), ...(ir.source || {}) },
    figure: normalizeFigure(ir.figure),
    nodes,
    edges,
    groups: Array.isArray(ir.groups) ? ir.groups.map((group, index) => normalizeGroup(group, index)) : [],
    diagnostics: Array.isArray(ir.diagnostics) ? ir.diagnostics : [],
    nodeIds,
  };
}

export function validateUniversalIR(ir = {}) {
  const normalized = normalizeUniversalIR(ir);
  const issues = [];
  const seen = new Set();
  const edgeIds = new Set();
  normalized.nodes.forEach((node) => {
    if (seen.has(node.id)) issues.push({ kind: "duplicate-node-id", nodeId: node.id });
    seen.add(node.id);
    if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) {
      issues.push({ kind: "invalid-confidence", nodeId: node.id, confidence: node.confidence });
    }
  });
  normalized.edges.forEach((edge) => {
    if (edgeIds.has(edge.id)) issues.push({ kind: "duplicate-edge-id", edgeId: edge.id });
    edgeIds.add(edge.id);
    if (edge.source === edge.target && !["loop", "state", "recurrent-state"].includes(edge.type.toLowerCase())) {
      issues.push({ kind: "self-loop", edgeId: edge.id, nodeId: edge.source });
    }
    if (!normalized.nodeIds.has(edge.source) || !normalized.nodeIds.has(edge.target)) {
      issues.push({ kind: "missing-edge-endpoint", edgeId: edge.id, source: edge.source, target: edge.target });
    }
    if (edge.status.toLowerCase() === "unresolved") {
      issues.push({ kind: "unresolved-edge", edgeId: edge.id });
    }
    if (edge.confidence < 0.85) {
      issues.push({ kind: "low-confidence-edge", edgeId: edge.id, confidence: edge.confidence });
    }
    if (edge.evidenceExplicit && edge.evidence.length === 0) {
      issues.push({ kind: "missing-edge-evidence", edgeId: edge.id });
    }
  });
  const groupedNodeIds = new Set();
  normalized.groups.forEach((group) => {
    group.nodeIds.forEach((nodeId) => {
      if (!normalized.nodeIds.has(nodeId)) {
        issues.push({ kind: "missing-group-node", groupId: group.id, nodeId });
      } else if (groupedNodeIds.has(nodeId)) {
        issues.push({ kind: "node-in-multiple-groups", groupId: group.id, nodeId });
      }
      groupedNodeIds.add(nodeId);
    });
  });
  const inputIds = normalized.nodes.filter((node) => node.family === "input").map((node) => node.id);
  const reachable = new Set(inputIds);
  let changed = true;
  while (changed) {
    changed = false;
    normalized.edges.forEach((edge) => {
      if (reachable.has(edge.source) && normalized.nodeIds.has(edge.target) && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        changed = true;
      }
    });
  }
  normalized.nodes.filter((node) => node.family === "output").forEach((node) => {
    if (inputIds.length && !reachable.has(node.id)) issues.push({ kind: "unreachable-output", nodeId: node.id });
  });
  return {
    ok: issues.length === 0 && normalized.nodes.length > 0,
    issues,
    summary: {
      nodeCount: normalized.nodes.length,
      edgeCount: normalized.edges.length,
      customNodeCount: normalized.nodes.filter((node) => node.family === "custom" || node.compoundKind === "unresolved").length,
      diagnosticCount: normalized.diagnostics.length,
    },
  };
}

export function classifyOperation(op = "", family = "") {
  const declaredFamily = canonicalFamily(family);
  if (KNOWN_FAMILIES.has(declaredFamily) && declaredFamily !== "unknown") return declaredFamily;
  const normalized = String(op).trim();
  return FAMILY_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0] || "custom";
}

function canonicalFamily(family) {
  const value = String(family || "").trim().toLowerCase();
  if (["recurrent", "rnn", "lstm", "gru"].includes(value)) return "recurrent";
  if (["attention", "cross-attention", "cross_attention"].includes(value)) return "attention";
  if (["merge", "concat", "concatenate", "add", "sum", "join"].includes(value)) return "merge";
  return value;
}

function normalizeNode(node = {}, index) {
  const op = String(node.op || node.operation || node.type || node.label || "UnknownOperator");
  const family = classifyOperation(op, node.family);
  const normalized = {
    id: String(node.id || `ir-node-${index + 1}`),
    op,
    family,
    semanticRole: String(node.semanticRole || semanticRoleForFamily(family)),
    stage: Number.isFinite(node.stage) ? node.stage : index,
    order: Number.isFinite(node.order) ? node.order : index,
    label: String(node.label || op),
    subtitle: String(node.subtitle || ""),
    inputs: Array.isArray(node.inputs) ? node.inputs.map(String) : [],
    outputs: Array.isArray(node.outputs) ? node.outputs.map(String) : [],
    ports: normalizePorts(node.ports),
    attributes: isRecord(node.attributes) ? { ...node.attributes } : {},
      source: isRecord(node.source)
      ? { ...node.source }
      : Number.isFinite(node.sourceLine) ? { line: node.sourceLine } : undefined,
      evidence: Array.isArray(node.evidence) ? node.evidence.map((item) => ({ ...item })) : [],
      provenance: node.provenance,
      confidence: Number.isFinite(node.confidence) ? node.confidence : 1,
      status: String(node.status || "confirmed"),
    note: String(node.note || ""),
  };
  normalized.sourceNodeId = String(node.sourceNodeId || normalized.id);
  normalized.sourceNodeIds = Array.isArray(node.sourceNodeIds)
    ? node.sourceNodeIds.map(String)
    : [normalized.sourceNodeId];
  if (node.shape !== undefined) normalized.shape = normalizeShape(node.shape);
  if (node.compoundKind !== undefined) normalized.compoundKind = String(node.compoundKind);
  ["x", "y", "w", "h"].forEach((key) => {
    if (Number.isFinite(node[key])) normalized[key] = node[key];
  });
  if (node.color) normalized.color = String(node.color);
  if (normalized.compoundKind === undefined && family === "custom") normalized.compoundKind = "unresolved";
  if (normalized.compoundKind === undefined && family === "attention" && /transformer/i.test(op)) normalized.compoundKind = "transformer";
  return normalized;
}

function normalizeEdge(edge = {}, index) {
  return {
    id: String(edge.id || `ir-edge-${index + 1}`),
    sourceEdgeId: String(edge.sourceEdgeId || edge.id || `ir-edge-${index + 1}`),
    sourceEndpointIds: normalizeEndpointIds(edge.sourceEndpointIds)
      || normalizeEndpointIds({ source: edge.sourceEndpointId, target: edge.targetEndpointId })
      || normalizeEndpointIds(edge.ports),
    source: String(edge.source || ""),
    target: String(edge.target || ""),
    type: String(edge.type || "signal"),
    label: String(edge.label || ""),
    ports: edge.ports ? { ...edge.ports } : undefined,
    evidence: Array.isArray(edge.evidence) ? edge.evidence.map((item) => ({ ...item })) : [],
    evidenceExplicit: edge.evidenceExplicit !== undefined
      ? edge.evidenceExplicit === true
      : Object.prototype.hasOwnProperty.call(edge, "evidence"),
    provenance: edge.provenance,
    confidence: Number.isFinite(edge.confidence) ? edge.confidence : 1,
    status: String(edge.status || "confirmed"),
  };
}

function normalizeEndpointIds(value) {
  if (!isRecord(value)) return undefined;
  const normalized = {};
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key])) normalized[key] = String(value[key]);
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function copyEvidence(value) {
  return Array.isArray(value) ? value.map((item) => (isRecord(item) ? { ...item } : item)) : [];
}

function normalizeGroup(group = {}, index) {
  return {
    id: String(group.id || `ir-group-${index + 1}`),
    label: String(group.label || group.id || `Group ${index + 1}`),
    nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds.map(String) : [],
    kind: String(group.kind || "module"),
    expandable: group.expandable !== false,
  };
}

function normalizeFigure(figure = {}) {
  return {
    title: String(figure?.title || "Neural Network Architecture"),
    subtitle: String(figure?.subtitle || "Universal Neural Network IR"),
    stages: Array.isArray(figure?.stages) ? figure.stages.map(String) : [],
  };
}

function normalizePorts(ports) {
  if (!isRecord(ports)) return { inputs: [], outputs: [] };
  return {
    inputs: Array.isArray(ports.inputs) ? ports.inputs.map(String) : [],
    outputs: Array.isArray(ports.outputs) ? ports.outputs.map(String) : [],
  };
}

function normalizeShape(shape) {
  if (Array.isArray(shape)) return { output: shape };
  if (!isRecord(shape)) return { output: [String(shape)] };
  return { ...shape };
}

function semanticRoleForFamily(family) {
  if (family === "input") return "input";
  if (family === "output") return "output";
  if (family === "merge") return "merge";
  if (family === "attention") return "contextual_interaction";
  if (family === "custom") return "unresolved_operator";
  return "feature_transform";
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
