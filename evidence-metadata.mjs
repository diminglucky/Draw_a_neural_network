import { createHash } from "node:crypto";

export const EVIDENCE_METADATA_VERSION = "evidence-metadata/v1";

export function normalizeEvidenceMetadata(ir = {}, options = {}) {
  const sourceId = String(options.sourceId || ir.source?.sourceId || ir.source?.id || ir.source?.name || "source");
  const analyzer = String(options.analyzer || ir.source?.analyzer || "unknown");
  return {
    ...ir,
    evidenceMetadataVersion: EVIDENCE_METADATA_VERSION,
    nodes: (ir.nodes || []).map((node) => normalizeItem(node, { sourceId, analyzer, kind: "node" })),
    edges: (ir.edges || []).map((edge) => normalizeItem(edge, { sourceId, analyzer, kind: "edge" })),
  };
}

export function validateEvidenceMetadata(ir = {}) {
  const issues = [];
  if (ir.evidenceMetadataVersion !== EVIDENCE_METADATA_VERSION) {
    issues.push({ code: "invalid-evidence-metadata-version", value: ir.evidenceMetadataVersion });
  }
  validateItems(ir.nodes, "node", issues);
  validateItems(ir.edges, "edge", issues);
  return { ok: issues.length === 0, issues, summary: { nodeCount: ir.nodes?.length || 0, edgeCount: ir.edges?.length || 0 } };
}

function normalizeItem(item = {}, context) {
  const evidence = (Array.isArray(item.evidence) ? item.evidence : []).map((entry, index) =>
    normalizeEvidenceEntry(entry, { ...context, itemId: item.id, index }));
  const sourceLocation = normalizeLocation(item.sourceLocation)
    || locationFromItem(item)
    || evidence.map(entry => normalizeLocation(entry)).find(Boolean);
  return {
    ...item,
    confidence: boundedConfidence(item.confidence),
    ...(sourceLocation ? { sourceLocation } : {}),
    evidence,
  };
}

function normalizeEvidenceEntry(entry, context) {
  const value = typeof entry === "string" ? { id: entry } : { ...(entry || {}) };
  const kind = String(value.kind || value.type || context.kind);
  const evidenceId = String(value.evidenceId || value.id || stableEvidenceId(context, value));
  const location = normalizeLocation(value);
  return {
    ...value,
    evidenceId,
    kind,
    sourceId: String(value.sourceId || context.sourceId),
    analyzer: String(value.analyzer || context.analyzer),
    ...(location || {}),
  };
}

function locationFromItem(item = {}) {
  return normalizeLocation({
    line: item.sourceLine ?? item.line ?? item.lineno,
    column: item.sourceColumn ?? item.column,
    path: item.path ?? item.declarationPath,
    index: item.index ?? item.nodeIndex ?? item.declarationIndex,
    name: item.nodeName,
    uri: item.uri ?? item.sourceUri,
  });
}

function normalizeLocation(value = {}) {
  if (!value || typeof value !== "object") return undefined;
  const nested = value.sourceLocation && typeof value.sourceLocation === "object" ? value.sourceLocation : {};
  const line = firstFinite(value.line, value.sourceLine, value.lineno, nested.line);
  const column = firstFinite(value.column, value.sourceColumn, value.col, value.colOffset, nested.column);
  const path = firstDefined(value.path, value.declarationPath, nested.path);
  const index = firstFinite(value.index, value.nodeIndex, value.declarationIndex, nested.index);
  const name = firstString(value.nodeName, value.name, nested.name);
  const uri = firstString(value.uri, value.sourceUri, nested.uri);
  const location = {
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(path !== undefined ? { path: clonePath(path) } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(name ? { name } : {}),
    ...(uri ? { uri } : {}),
  };
  return Object.keys(location).length ? location : undefined;
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return Number(value);
  }
  return undefined;
}

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value)) return String(value);
  }
  return "";
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function clonePath(value) {
  return Array.isArray(value) ? value.map(String) : String(value);
}

function validateItems(items = [], itemKind, issues) {
  for (const item of items || []) {
    if (!Array.isArray(item.evidence)) {
      issues.push({ code: `missing-${itemKind}-evidence`, [`${itemKind}Id`]: item.id });
      continue;
    }
    const ids = new Set();
    for (const entry of item.evidence) {
      if (!entry?.evidenceId) issues.push({ code: "missing-evidence-id", [`${itemKind}Id`]: item.id });
      else if (ids.has(entry.evidenceId)) issues.push({ code: "duplicate-evidence-id", [`${itemKind}Id`]: item.id, evidenceId: entry.evidenceId });
      else ids.add(entry.evidenceId);
      if (!entry?.sourceId) issues.push({ code: "missing-evidence-source", [`${itemKind}Id`]: item.id });
      if (!entry?.analyzer) issues.push({ code: "missing-evidence-analyzer", [`${itemKind}Id`]: item.id });
    }
  }
}

function stableEvidenceId(context, value) {
  const payload = JSON.stringify({
    itemId: String(context.itemId || ""),
    index: context.index,
    kind: String(value.kind || value.type || context.kind || ""),
    line: value.line ?? value.sourceLine ?? value.lineno ?? null,
    path: value.path ?? value.declarationPath ?? null,
    locationIndex: value.index ?? value.nodeIndex ?? value.declarationIndex ?? null,
    detail: value.detail ?? value.message ?? value.expression ?? "",
  });
  return `evidence-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function boundedConfidence(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
