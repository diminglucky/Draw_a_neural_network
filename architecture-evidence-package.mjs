import { createHash } from "node:crypto";

const VERSION = "architecture-evidence-package/v1";
const CLAIM_STATUSES = new Set(["grounded", "inferred", "unresolved", "contradicted"]);

export function createArchitectureEvidencePackage(value = {}) {
  const sources = (value.sources || []).map(normalizeSource);
  const defaultSourceIds = sources.length === 1 ? [sources[0].id] : [];
  const claims = (value.claims || []).map((claim, index) => ({
    ...claim,
    id: String(claim.id || `claim-${index + 1}`),
    subjectId: String(claim.subjectId || ""),
    predicate: String(claim.predicate || ""),
    sourceIds: Array.isArray(claim.sourceIds) && claim.sourceIds.length ? claim.sourceIds.map(String) : [...defaultSourceIds],
    confidence: Number.isFinite(claim.confidence) ? claim.confidence : 1,
    status: String(claim.status || "grounded"),
  }));
  const graph = value.graph || {};
  return {
    version: VERSION,
    status: String(value.status || "grounded"),
    request: { ...(value.request || {}) },
    identity: { ...(value.identity || {}) },
    sources,
    claims,
    graph: {
      nodes: [...(graph.nodes || [])], edges: [...(graph.edges || [])], ports: [...(graph.ports || [])],
      tensors: [...(graph.tensors || [])], containers: [...(graph.containers || [])],
    },
    diagnostics: [...(value.diagnostics || [])],
    unresolvedQuestions: [...(value.unresolvedQuestions || [])],
  };
}

export function validateArchitectureEvidencePackage(pkg = {}) {
  const issues = [];
  if (pkg.version !== VERSION) issues.push({ code: "invalid-evidence-package-version" });
  const sourceIds = new Set();
  for (const source of pkg.sources || []) {
    if (!source.id || sourceIds.has(source.id)) issues.push({ code: source.id ? "duplicate-source-id" : "missing-source-id", sourceId: source.id });
    sourceIds.add(source.id);
    if (!/^[a-f0-9]{64}$/.test(String(source.sha256 || ""))) issues.push({ code: "invalid-source-hash", sourceId: source.id });
    if (/^https?:/i.test(String(source.uri || "")) && !String(source.revision || "").trim()) issues.push({ code: "mutable-source", sourceId: source.id });
    if (!Number.isFinite(source.authority) || source.authority < 0) issues.push({ code: "invalid-source-authority", sourceId: source.id });
  }
  const grounded = new Map();
  for (const claim of pkg.claims || []) {
    if (!CLAIM_STATUSES.has(claim.status)) issues.push({ code: "invalid-claim-status", claimId: claim.id });
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) issues.push({ code: "invalid-claim-confidence", claimId: claim.id });
    for (const sourceId of claim.sourceIds || []) if (!sourceIds.has(sourceId)) issues.push({ code: "missing-claim-source", claimId: claim.id, sourceId });
    if (claim.status !== "grounded") continue;
    const key = `${claim.subjectId}\u0000${claim.predicate}`;
    const encoded = stableJson(claim.value);
    if (grounded.has(key) && grounded.get(key) !== encoded) issues.push({ code: "contradicted-claim", subjectId: claim.subjectId, predicate: claim.predicate });
    grounded.set(key, encoded);
  }
  return { ok: issues.length === 0, issues, summary: { sourceCount: pkg.sources?.length || 0, claimCount: pkg.claims?.length || 0, issueCount: issues.length } };
}

function normalizeSource(source = {}) {
  const content = source.content === undefined ? "" : typeof source.content === "string" ? source.content : stableJson(source.content);
  const sha256 = String(source.sha256 || createHash("sha256").update(content).digest("hex"));
  const identity = stableJson({ kind: source.kind || "unknown", uri: source.uri || "", revision: source.revision || "", path: source.path || "", sha256 });
  return { ...source, id: String(source.id || `source-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`), sha256, authority: Number.isFinite(source.authority) ? source.authority : 0 };
}

function stableJson(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
