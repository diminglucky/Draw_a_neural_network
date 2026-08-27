import { normalizeUniversalIR } from "./universal-ir.mjs";

export function buildVisioRenderRequest({ documentPath, pageName = "Page-1", ir, source, framework } = {}) {
  const path = String(documentPath || "").trim();
  if (!path) throw new Error("documentPath is required to render into an existing Visio document.");
  if (!ir && !(typeof source === "string" && source.trim())) {
    throw new Error("Universal IR or source code is required to render into Visio.");
  }
  return {
    url: "/api/render-visio",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentPath: path,
        pageName: String(pageName || "Page-1"),
        ...(ir ? { ir } : { source, framework }),
      }),
    },
    body: {
      documentPath: path,
      pageName: String(pageName || "Page-1"),
      ...(ir ? { ir } : { source, framework }),
    },
  };
}

export function mergeCanvasStateIntoUniversalIR({ stateIR = {}, figure = {}, nodes = [], edges = [] } = {}) {
  const originalNodes = new Map((Array.isArray(stateIR.nodes) ? stateIR.nodes : []).map((node) => [String(node.id), node]));
  const currentNodes = Array.isArray(nodes) ? nodes : [];
  const currentEdges = Array.isArray(edges) ? edges : [];
  return normalizeUniversalIR({
    ...stateIR,
    figure: figure && Object.keys(figure).length ? figure : stateIR.figure,
    nodes: currentNodes.map((node, index) => {
      const original = originalNodes.get(String(node.id)) || {};
      const family = familyForVisualType(node.type) || original.family || "custom";
      return {
        ...original,
        ...node,
        id: String(node.id || original.id || `canvas-node-${index + 1}`),
        family,
        op: node.op || original.op || node.label || "CanvasOperator",
        confidence: Number.isFinite(node.confidence) ? node.confidence : (Number.isFinite(original.confidence) ? original.confidence : 1),
        evidence: Array.isArray(node.evidence) ? node.evidence : (Array.isArray(original.evidence) ? original.evidence : []),
      };
    }),
    edges: currentEdges,
  });
}

function familyForVisualType(type) {
  const map = {
    tensor: "input",
    conv: "conv",
    "volume-stack": "volume",
    volume: "volume",
    pool: "pool",
    flatten: "flatten",
    "dense-layer": "dense",
    concat: "merge",
    attention: "attention",
    encoder: "attention",
    output: "output",
    compound: "custom",
    block: "custom",
  };
  return map[String(type || "")] || null;
}

export async function renderCurrentIRToVisio(options = {}) {
  const request = buildVisioRenderRequest(options);
  const response = await fetch(request.url, request.init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Visio render failed with HTTP ${response.status}`);
  return payload;
}
