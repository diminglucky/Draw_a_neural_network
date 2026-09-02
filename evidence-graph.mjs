import { createUniversalIR } from "./universal-ir.mjs";

const VERSION = "evidence-graph/v1";

export function createEvidenceRecord(input = {}) {
  const confidence = Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 1;
  return {
    evidenceId: String(input.evidenceId || stableEvidenceId(input)),
    source: input.source,
    confidence,
    status: String(input.status || "confirmed"),
    ...input,
    confidence,
    evidenceId: String(input.evidenceId || stableEvidenceId(input)),
  };
}

export function createEvidenceGraph({ input, records = [], nodes = [], edges = [], diagnostics = [] } = {}) {
  return {
    version: VERSION,
    input,
    records: records.map(createEvidenceRecord),
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge })),
    diagnostics: [...diagnostics],
  };
}

export function evidenceGraphToUniversalIR(graph = {}) {
  const records = Array.isArray(graph.records) ? graph.records.map(createEvidenceRecord) : [];
  const byId = new Map(records.map((record) => [record.evidenceId, record]));
  const evidence = (items) => (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === "string") return byId.get(item) || { evidenceId: item, status: "unresolved", confidence: 0 };
    return item;
  });
  const nodes = (graph.nodes || []).map((node) => ({ ...node, evidence: evidence(node.evidence) }));
  const edges = (graph.edges || []).map((edge) => ({ ...edge, evidence: evidence(edge.evidence) }));
  const ir = createUniversalIR({ nodes, edges, diagnostics: graph.diagnostics || [] }, {
    sourceKind: graph.input?.framework || graph.input?.kind || "unknown",
    source: { input: graph.input },
  });
  ir.nodes.forEach((node, index) => {
    const marker = graph.nodes?.[index]?.compoundKind;
    if (marker !== undefined) node.compoundKind = marker;
  });
  return ir;
}

function stableEvidenceId(input) {
  const value = JSON.stringify({ source: input.source, claim: input.claim, family: input.family });
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `evidence-${(hash >>> 0).toString(16)}`;
}
