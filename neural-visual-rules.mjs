const PHASES = ["body", "structure", "relation", "decoration", "normalize"];
const COORDINATE_KEYS = new Set(["x", "y", "w", "h", "width", "height", "bounds", "points", "anchors", "zIndex"]);

export function createDefaultNeuralVisualRules() {
  return [
    bodyRule("opaque-body", 100, (c) => ["opaque-module", "callout-expansion"].includes(c.projection.kind), "boundary", "callout", ["opaque"]),
    bodyRule("repeat-body", 95, (c) => c.projection.kind === "repeat-collapse", "structure", "stack", ["repeat"]),
    bodyRule("residual-block-body", 92, (c) => hasBlockKind(c, "residual-block"), "structure", "band", ["residual"]),
    bodyRule("conv-block-body", 92, (c) => hasBlockKind(c, "conv-block"), "data", "volume", ["conv"]),
    bodyRule("detection-head-body", 92, (c) => hasBlockKind(c, "detection-head"), "structure", "band", ["head"]),
    bodyRule("merge-body", 90, (c) => hasRole(c, "merge"), "structure", "glyph", ["merge"]),
    bodyRule("state-body", 85, (c) => hasDomain(c, "state"), "operator", "cell", ["stateful"]),
    bodyRule("attention-body", 82, (c) => hasMotif(c, "attention-region"), "operator", "stack", ["attention", "sequence"]),
    bodyRule("attention-family-body", 81, (c) => hasFamily(c, "attention"), "operator", "stack", ["attention", "sequence"]),
    // Only a tensor *boundary* (input, output, volume) gets a data-shape form.
    // Letting every sequence-domain operator inherit `strip` painted LayerNorm,
    // GELU and every MatMul as the same ticked band, which is what made a
    // transformer figure read as one repeated grey block.
    bodyRule("sequence-body", 80, (c) => hasDomain(c, "sequence") && hasDataFamily(c), "data", "strip", ["sequence"]),
    bodyRule("dense-body", 79, (c) => hasFamily(c, "dense"), "operator", "stack", ["linear"]),
    // Shape-preserving elementwise operators keep the tensor form of the values
    // they touch, so a spatial BatchNorm stays a cuboid and a sequence-domain
    // LayerNorm becomes a compact bar.
    bodyRule("norm-spatial-body", 78, (c) => hasFamily(c, "norm") && hasDomain(c, "spatial"), "data", "volume", ["spatial", "norm"]),
    bodyRule("norm-body", 77, (c) => hasFamily(c, "norm"), "operator", "band", ["norm"]),
    bodyRule("activation-spatial-body", 76, (c) => hasFamily(c, "activation") && hasDomain(c, "spatial"), "data", "volume", ["spatial", "activation"]),
    bodyRule("activation-body", 75, (c) => hasFamily(c, "activation"), "operator", "band", ["activation"]),
    bodyRule("reshape-body", 74, (c) => hasFamily(c, "flatten"), "operator", "band", ["reshape"]),
    bodyRule("sequence-operator-body", 73, (c) => hasDomain(c, "sequence"), "operator", "band", ["sequence", "operator"]),
    bodyRule("input-plane-body", 72, (c) => hasRole(c, "input") && hasDomain(c, "spatial"), "data", "plane", ["spatial", "input"]),
    bodyRule("scale-reduce-body", 70, (c) => hasEffect(c, "reduce"), "operator", "wedge", ["scale-change", "reduce"], { scaleChange: "reduce" }),
    bodyRule("scale-expand-body", 69, (c) => hasEffect(c, "expand"), "operator", "wedge", ["scale-change", "expand"], { scaleChange: "expand" }),
    bodyRule("graph-body", 68, (c) => hasMotif(c, "graph-message-passing"), "operator", "cell", ["graph"]),
    bodyRule("conditional-body", 67, (c) => hasMotif(c, "conditional-route"), "structure", "glyph", ["conditional"]),
    bodyRule("spatial-volume-body", 65, (c) => hasDomain(c, "spatial"), "data", "volume", ["spatial"]),
    bodyRule("conv-volume-body", 64, (c) => hasFamily(c, "conv"), "data", "volume", ["spatial", "conv"]),
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
      emit: (c) => {
        const count = Math.max(...c.nodes.map((node) => Number(node.repeatCount || node.repeat || 1)));
        return [{ category: "annotation", form: "text", semanticTags: ["repeat"], labels: [`x${count}`], data: { decoration: "repeat", count } }];
      },
    },
    {
      id: "label-decoration", phase: "decoration", priority: 10, match: () => true,
      emit: (c) => [{ category: "annotation", form: "text", semanticTags: ["label"], labels: c.nodes.map(publicationLabel), data: { decoration: "label" } }],
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

// 张量边界：这些投影代表"数据本身"，可以用张量形状（strip / plane / volume）表达。
const DATA_FAMILIES = new Set(["input", "output", "volume"]);

function bodyRule(id, priority, match, category, form, semanticTags, data = {}) {
  return {
    id, phase: "body", priority, match,
    emit: (context) => [{
      category,
      form,
      semanticTags,
      // 把声明的张量形状随图元一起带下去：布局层据此按真实尺寸比例决定盒子大小，
      // 渲染层据此标注 C x H x W。没有形状时保持固定的默认尺寸。
      data: { ...data, ...tensorShapeData(context) },
    }],
  };
}

function tensorShapeData(context = {}) {
  for (const node of context.nodes || []) {
    const dims = Array.isArray(node?.shape?.output) ? node.shape.output : [];
    if (dims.length < 2) continue;
    const numeric = dims.map(Number);
    if (!numeric.every((value) => Number.isFinite(value))) continue;
    return { tensorShape: numeric };
  }
  return {};
}

function hasDataFamily(context) { return context.nodes.some((node) => DATA_FAMILIES.has(String(node.family || ""))); }
function hasDomain(context, value) { return context.nodeFacts.some((facts) => facts.dataDomain?.value === value); }
function hasEffect(context, value) { return context.nodeFacts.some((facts) => facts.operationEffect?.value === value); }
function hasRole(context, value) { return context.nodeFacts.some((facts) => facts.structuralRole?.value === value); }
function hasFamily(context, value) { return context.nodes.some((node) => String(node.family || "") === value); }
function hasBlockKind(context, value) { return String(context.projection?.blockKind || "") === value; }
function hasMotif(context, kind) {
  const ids = new Set(context.nodes.map((node) => String(node.id)));
  return (context.motifs?.motifs || []).some((motif) => motif.kind === kind && motif.nodeIds.some((nodeId) => ids.has(String(nodeId))));
}
function containsCoordinates(value) {
  if (Array.isArray(value)) return value.some(containsCoordinates);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => COORDINATE_KEYS.has(key) || containsCoordinates(child));
}

function publicationLabel(node = {}) {
  const title = String(node.label || node.op || node.id || "").trim();
  const shape = Array.isArray(node.shape?.output) ? node.shape.output.map(String) : [];
  while (shape.length > 1 && ["1", "-1", "null", "undefined"].includes(shape[0])) shape.shift();
  const assumption = node.shape?.source === "assumed-default" ? "*" : "";
  return shape.length ? `${title}\n${shape.join(" x ")}${assumption}` : title;
}
