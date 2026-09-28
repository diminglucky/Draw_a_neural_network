const UNCERTAIN_DIAGNOSTIC_KINDS = new Set([
  "prompt-topology-unresolved",
  "dynamic-control-flow",
  "unresolved-source",
  "select-architecture-candidate",
]);

export function containsUncertainTopology(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUncertainTopology);
  if (["unresolved", "needs_resolution", "contradicted"].includes(value.status)) return true;
  if (Array.isArray(value.unresolvedQuestions) && value.unresolvedQuestions.length > 0) return true;
  if (UNCERTAIN_DIAGNOSTIC_KINDS.has(value.kind || value.code)) return true;
  return Array.isArray(value.diagnostics) && value.diagnostics.some(containsUncertainTopology)
    || Array.isArray(value.nodes) && value.nodes.some(containsUncertainTopology);
}

export function collectUncertainNodes(value, acc = []) {
  if (!value || typeof value !== "object") return acc;
  if (Array.isArray(value)) {
    value.forEach((item) => collectUncertainNodes(item, acc));
    return acc;
  }
  if (["unresolved", "needs_resolution", "contradicted"].includes(value.status)
    || Array.isArray(value.unresolvedQuestions) && value.unresolvedQuestions.length > 0) {
    acc.push(String(value.request?.requestedIdentity || value.identity?.resolvedName || value.id || "architecture"));
  }
  if (Array.isArray(value.nodes)) value.nodes.forEach((node) => collectUncertainNodes(node, acc));
  if (Array.isArray(value.diagnostics)) value.diagnostics.forEach((diag) => collectUncertainNodes(diag, acc));
  return acc;
}
