const PHASES = ["body", "structure", "relation", "decoration", "normalize"];
const COORDINATE_KEYS = new Set(["x", "y", "w", "h", "width", "height", "bounds", "points", "anchors", "zIndex"]);

export function createDefaultNeuralVisualRules() {
  return [
    bodyRule("opaque-body", 100, (c) => ["opaque-module", "callout-expansion"].includes(c.projection.kind), "boundary", "callout", ["opaque"]),
    bodyRule("repeat-body", 95, (c) => c.projection.kind === "repeat-collapse", "structure", "stack", ["repeat"]),
    bodyRule("merge-body", 90, (c) => hasRole(c, "merge"), "structure", "glyph", ["merge"]),
    bodyRule("state-body", 85, (c) => hasDomain(c, "state"), "operator", "cell", ["stateful"]),
    bodyRule("sequence-body", 80, (c) => hasDomain(c, "sequence"), "data", "strip", ["sequence"]),
    bodyRule("input-plane-body", 75, (c) => hasRole(c, "input") && hasDomain(c, "spatial"), "data", "plane", ["spatial", "input"]),
    bodyRule("scale-change-body", 70, (c) => hasEffect(c, "reduce") || hasEffect(c, "expand"), "operator", "wedge", ["scale-change"]),
    bodyRule("spatial-volume-body", 65, (c) => hasDomain(c, "spatial"), "data", "volume", ["spatial"]),
    bodyRule("fallback-body", 1, () => true, "operator", "band", ["operator"]),
    {
      id: "split-structure", phase: "structure", priority: 50,
      match: (c) => c.nodeFacts.some((facts) => facts.topology?.value?.branch),
      emit: () => [{ category: "structure", form: "glyph", semanticTags: ["split"], data: { structure: "split" } }],
    },
    { id: "relation-phase", phase: "relation", priority: 0, match: () => false, emit: () => [] },
    {
      id: "repeat-decoration", phase: "decoration", priority: 30,
      match: (c) => c.projection.kind === "repeat-collapse" || c.nodes.some((node) => Number(node.repeatCount || node.repeat || 1) > 1),
      emit: (c) => [{ category: "annotation", form: "text", semanticTags: ["repeat"], data: { decoration: "repeat", count: Math.max(...c.nodes.map((node) => Number(node.repeatCount || node.repeat || 1))) } }],
    },
    {
      id: "label-decoration", phase: "decoration", priority: 10, match: () => true,
      emit: (c) => [{ category: "annotation", form: "text", semanticTags: ["label"], labels: c.nodes.map((node) => node.label || node.op || node.id), data: { decoration: "label" } }],
    },
    { id: "normalize-phase", phase: "normalize", priority: 0, match: () => false, emit: () => [] },
  ];
}

export function applyNeuralVisualRules(context, rules = createDefaultNeuralVisualRules()) {
  const validation = validateVisualRuleRegistry(rules);
  if (!validation.ok) throw new TypeError(`Invalid visual rule registry: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  const result = { body: [], structure: [], relations: [], decorations: [], normalize: [], appliedRuleIds: [] };
  for (const phase of PHASES) {
    const matches = rules.filter((rule) => rule.phase === phase && rule.match(context)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const selected = phase === "body" ? selectExclusiveBody(matches) : matches;
    for (const rule of selected) {
      const emitted = rule.emit(context) || [];
      if (containsCoordinates(emitted)) throw new TypeError(`Visual rule ${rule.id} emitted coordinates.`);
      result.appliedRuleIds.push(rule.id);
      const target = phase === "relation" ? result.relations : phase === "decoration" ? result.decorations : result[phase];
      target.push(...emitted);
    }
  }
  if (result.body.length !== 1) throw new TypeError(`Visual rules must emit exactly one body; received ${result.body.length}.`);
  return result;
}

export function validateVisualRuleRegistry(rules = []) {
  const issues = [];
  const ids = new Set();
  for (const rule of rules) {
    if (!rule?.id || ids.has(rule.id)) issues.push({ code: rule?.id ? "duplicate-rule-id" : "missing-rule-id", ruleId: rule?.id });
    ids.add(rule?.id);
    if (!PHASES.includes(rule?.phase)) issues.push({ code: "invalid-rule-phase", ruleId: rule?.id });
    if (!Number.isFinite(rule?.priority)) issues.push({ code: "invalid-rule-priority", ruleId: rule?.id });
    if (typeof rule?.match !== "function" || typeof rule?.emit !== "function") issues.push({ code: "invalid-rule-function", ruleId: rule?.id });
  }
  return { ok: issues.length === 0, issues };
}

function selectExclusiveBody(matches) {
  if (!matches.length) return [];
  const highest = matches[0].priority;
  const winners = matches.filter((rule) => rule.priority === highest);
  if (winners.length > 1) throw new TypeError(`exclusive body rule conflict: ${winners.map((rule) => rule.id).join(", ")}`);
  return winners;
}

function bodyRule(id, priority, match, category, form, semanticTags) {
  return { id, phase: "body", priority, match, emit: () => [{ category, form, semanticTags }] };
}
function hasDomain(context, value) { return context.nodeFacts.some((facts) => facts.dataDomain?.value === value); }
function hasEffect(context, value) { return context.nodeFacts.some((facts) => facts.operationEffect?.value === value); }
function hasRole(context, value) { return context.nodeFacts.some((facts) => facts.structuralRole?.value === value); }
function containsCoordinates(value) {
  if (Array.isArray(value)) return value.some(containsCoordinates);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => COORDINATE_KEYS.has(key) || containsCoordinates(child));
}
