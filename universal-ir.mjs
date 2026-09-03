const VERSION = "universal-neural-ir/v1";

import { compileSemanticVisualNodes } from "./semantic-visual-grammar.mjs";

export { normalizeRecurrentEvidence, recurrentEvidenceForNode } from "./semantic-visual-grammar.mjs";

const FAMILY_ALIASES = [
  ["input", /^(input|tensor|placeholder|source)$/i],
  ["output", /^(output|prediction|logits|softmax)$/i],
  ["conv", /conv|convolution/i],
  ["pool", /pool|downsample|upsample|interpolate/i],
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
  "input", "output", "conv", "pool", "dense", "attention", "merge", "flatten",
  "norm", "activation", "recurrent", "graph", "volume", "custom", "unknown",
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

export function projectUniversalIRToCanvas(ir = {}) {
  const normalized = normalizeUniversalIR(ir);
  const semanticNodes = compileSemanticVisualNodes(normalized.nodes, normalized.edges);
  const nodes = semanticNodes.map((node, index) => {
    const typeInfo = canvasTypeForFamily(node.family, node);
    return {
      id: node.id,
      type: typeInfo.type,
      compoundKind: node.compoundKind || typeInfo.compoundKind,
      x: Number.isFinite(node.x) ? node.x : 280 + index * 220,
      y: Number.isFinite(node.y) ? node.y : 620,
      w: Number.isFinite(node.w) ? node.w : typeInfo.w,
      h: Number.isFinite(node.h) ? node.h : typeInfo.h,
      stage: Number.isFinite(node.stage) ? node.stage : index,
      label: node.figureLabel || node.label,
      subtitle: node.figureSubtitle || node.subtitle || shapeLabel(node.shape),
      color: node.color || typeInfo.color,
      op: node.op,
      family: node.family,
      semanticRole: node.semanticRole,
      visualRole: node.visualRole,
      inputGrammar: node.inputGrammar,
      styleProfile: node.styleProfile,
      labelSlots: node.labelSlots,
      geometryData: node.geometryData,
      shape: node.shape,
      ports: node.ports,
      attributes: node.attributes,
      source: node.source,
      evidence: node.evidence,
      confidence: node.confidence,
      note: node.note || (node.compoundKind === "unresolved" ? "structure requires review" : ""),
    };
  });
  return {
    figure: normalized.figure,
    paletteName: "dopamine",
    nodes,
    edges: normalized.edges.map((edge) => ({
      ...edge,
      color: edge.color || (edge.type === "skip" ? "#00d4aa" : edge.type === "attention" ? "#ff2aa3" : "#2846d8"),
    })),
    ir: normalized,
  };
}

export function classifyOperation(op = "", family = "") {
  const declaredFamily = String(family || "").trim().toLowerCase();
  if (KNOWN_FAMILIES.has(declaredFamily) && declaredFamily !== "unknown") return declaredFamily;
  const normalized = String(op).trim();
  return FAMILY_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0] || "custom";
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

function canvasTypeForFamily(family, node) {
  const common = { w: 160, h: 110, color: "#a855ff" };
  if (family === "input") {
    const inputTypes = {
      "image-input": ["image-input", 122, 214, "#4D9DBB"],
      "sequence-input": ["sequence-input", 150, 72, "#4D9DBB"],
      "state-input": ["state-input", 86, 132, "#815AA0"],
      "vector-input": ["vector-input", 58, 150, "#5C9A69"],
      "volume-input": ["volume-input", 132, 204, "#43878C"],
      "unknown-input": ["unknown-input", 104, 160, "#9D8A65"],
    };
    const [type, w, h, color] = inputTypes[node.visualRole] || ["unknown-input", 104, 160, "#9D8A65"];
    return { type, w, h, color };
  }
  if (family === "output") return { type: "output", w: 110, h: 148, color: "#ff4fd8" };
  if (family === "conv") return { type: "conv", w: 86, h: 220, color: "#ff2aa3" };
  if (family === "volume") return { type: "volume-stack", w: 138, h: 230, color: "#2f6bff" };
  if (family === "pool") return { type: "pool", w: 92, h: 92, color: "#ffe94a" };
  if (family === "flatten") return { type: "flatten", w: 150, h: 138, color: "#ff2aa3" };
  if (family === "dense") return { type: "dense-layer", w: 132, h: 210, color: "#2f6bff" };
  if (family === "merge") return { type: "concat", w: 82, h: 82, color: "#00d4aa" };
  if (family === "attention") return { type: "compound", compoundKind: node.compoundKind || "attention", w: 320, h: 250, color: "#a855ff" };
  if (family === "recurrent" || family === "graph") return { type: "compound", compoundKind: "operator", w: 320, h: 250, color: "#a855ff" };
  if (family === "custom" || node.compoundKind === "unresolved") return { type: "compound", compoundKind: "unresolved", w: 320, h: 250, color: "#a855ff" };
  return { ...common, type: "compound", compoundKind: "operator" };
}

function semanticRoleForFamily(family) {
  if (family === "input") return "input";
  if (family === "output") return "output";
  if (family === "merge") return "merge";
  if (family === "attention") return "contextual_interaction";
  if (family === "custom") return "unresolved_operator";
  return "feature_transform";
}

function shapeLabel(shape) {
  const value = shape?.output || shape?.input;
  return Array.isArray(value) ? value.join(" × ") : "";
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
