import { createHash } from "node:crypto";

const IMMUTABLE_REVISION = /^[a-f0-9]{7,64}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

export function validateSourceProvenance(source = {}) {
  const issues = [];
  const remote = /^https?:/i.test(String(source.uri || ""));
  if (remote && !IMMUTABLE_REVISION.test(String(source.revision || ""))) {
    issues.push({ code: "mutable-revision", sourceId: source.id });
  }
  if (remote && !SHA256.test(String(source.sha256 || ""))) {
    issues.push({ code: "invalid-source-hash", sourceId: source.id });
  }
  if (source.content !== undefined && SHA256.test(String(source.sha256 || ""))) {
    const content = typeof source.content === "string" ? source.content : stableJson(source.content);
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== String(source.sha256).toLowerCase()) {
      issues.push({ code: "source-hash-mismatch", sourceId: source.id, expected: source.sha256, actual });
    }
  }
  if (!Number.isFinite(source.authority) || source.authority < 0) {
    issues.push({ code: "invalid-source-authority", sourceId: source.id });
  }
  return { ok: issues.length === 0, issues };
}

export function rankProvenanceSources(sources = []) {
  const ranked = [...sources].sort((left, right) =>
    Number(right.authority || 0) - Number(left.authority || 0)
    || String(left.id || "").localeCompare(String(right.id || "")));
  const diagnostics = [];
  const claims = new Map();
  for (const source of ranked) {
    for (const claim of source.claims || []) {
      const key = `${claim.subjectId}\u0000${claim.predicate}`;
      const value = stableJson(claim.value);
      const stronger = claims.get(key);
      if (stronger && stronger.value !== value) {
        diagnostics.push({
          code: "stronger-source-conflict",
          subjectId: claim.subjectId,
          predicate: claim.predicate,
          strongerSourceId: stronger.sourceId,
          conflictingSourceId: source.id,
        });
      } else if (!stronger) {
        claims.set(key, { value, sourceId: source.id });
      }
    }
  }
  Object.defineProperties(ranked, {
    blocked: { value: diagnostics.length > 0, enumerable: false },
    diagnostics: { value: diagnostics, enumerable: false },
  });
  return ranked;
}

function stableJson(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
