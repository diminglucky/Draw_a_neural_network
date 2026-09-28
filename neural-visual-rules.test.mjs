import assert from "node:assert/strict";
import test from "node:test";
import { applyNeuralVisualRules, createDefaultNeuralVisualRules, validateVisualRuleRegistry } from "./neural-visual-rules.mjs";

const context = {
  projection: { id: "p", kind: "direct", orderedNodeIds: ["n"], evidenceIds: ["ev"] },
  nodes: [{ id: "n", family: "conv", label: "Display only", repeatCount: 3 }],
  nodeFacts: [{ dataDomain: { value: "spatial" }, operationEffect: { value: "project" }, topology: { value: {} }, structuralRole: { value: "transform" } }],
};

test("default rules use fixed phases and emit one body plus additive decorations", () => {
  const rules = createDefaultNeuralVisualRules();
  assert.deepEqual([...new Set(rules.map((rule) => rule.phase))], ["body", "structure", "relation", "decoration", "normalize"]);
  const result = applyNeuralVisualRules(context, rules);
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].form, "volume");
  assert.ok(result.decorations.some((primitive) => primitive.form === "text"));
});

test("equal-priority exclusive body matches are rejected", () => {
  const rules = [
    { id: "one", phase: "body", priority: 10, match: () => true, emit: () => [{ category: "operator", form: "band" }] },
    { id: "two", phase: "body", priority: 10, match: () => true, emit: () => [{ category: "operator", form: "wedge" }] },
  ];
  assert.throws(() => applyNeuralVisualRules(context, rules), /exclusive body rule conflict/);
});

test("scale-change bodies carry explicit direction instead of one ambiguous wedge", () => {
  const rules = createDefaultNeuralVisualRules();
  const reduce = applyNeuralVisualRules({
    ...context,
    nodeFacts: [{ dataDomain: { value: "spatial" }, operationEffect: { value: "reduce" }, topology: { value: {} }, structuralRole: { value: "transform" } }],
  }, rules);
  const expand = applyNeuralVisualRules({
    ...context,
    nodeFacts: [{ dataDomain: { value: "spatial" }, operationEffect: { value: "expand" }, topology: { value: {} }, structuralRole: { value: "transform" } }],
  }, rules);
  assert.equal(reduce.body[0].form, "wedge");
  assert.equal(reduce.body[0].data.scaleChange, "reduce");
  assert.equal(expand.body[0].data.scaleChange, "expand");
});

test("invalid phases and rules that emit coordinates are rejected", () => {
  assert.equal(validateVisualRuleRegistry([{ id: "bad", phase: "paint", priority: 1, match: () => true, emit: () => [] }]).ok, false);
  assert.throws(() => applyNeuralVisualRules(context, [{ id: "coords", phase: "body", priority: 1, match: () => true, emit: () => [{ category: "operator", form: "band", x: 10 }] }]), /coordinates/);
});
