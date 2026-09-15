import assert from "node:assert/strict";
import test from "node:test";
import { deriveNeuralSemanticFacts, validateNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { normalizeUniversalIR } from "./universal-ir.mjs";

function fixture() {
  return normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    source: { kind: "fixture", name: "Architecture A" },
    nodes: [
      { id: "image", op: "Input", family: "input", shape: { output: [1, 3, 224, 224] }, confidence: 1, laneId: "scale-224" },
      { id: "stem", op: "AnyProjector", family: "conv", shape: { output: [1, 32, 112, 112] }, confidence: 0.98, laneId: "scale-112" },
      { id: "left", op: "UnknownLeft", family: "custom", confidence: 0.9, laneId: "scale-112" },
      { id: "right", op: "UnknownRight", family: "custom", confidence: 0.9, laneId: "scale-112" },
      { id: "join", op: "Join", family: "merge", confidence: 0.95, laneId: "scale-112" },
      { id: "state", op: "StateCell", family: "recurrent", confidence: 0.88, ports: { inputs: ["x", "h-in"], outputs: ["y", "h-out"] }, attributes: { stateTransitions: [{ sourcePort: "h-out", targetPort: "h-in", sourceEdgeId: "loop" }] } },
      { id: "tokens", op: "TokenProjection", family: "attention", shape: { output: [1, 128, 768] }, confidence: 1 },
      { id: "out", op: "Output", family: "output", shape: { output: [1, 10] }, confidence: 1 },
    ],
    edges: [
      { id: "down", source: "image", target: "stem", type: "signal", confidence: 1 },
      { id: "fork-left", source: "stem", target: "left", type: "signal", confidence: 1 },
      { id: "fork-right", source: "stem", target: "right", type: "signal", confidence: 1 },
      { id: "left-join", source: "left", target: "join", type: "signal", confidence: 1 },
      { id: "right-join", source: "right", target: "join", type: "signal", confidence: 1 },
      { id: "bypass", source: "stem", target: "join", type: "residual", confidence: 0.97 },
      { id: "join-state", source: "join", target: "state", type: "signal", confidence: 0.9 },
      { id: "loop", source: "state", target: "state", type: "state", ports: { source: "h-out", target: "h-in" }, confidence: 0.88 },
      { id: "state-tokens", source: "state", target: "tokens", type: "signal", confidence: 0.9 },
      { id: "tokens-out", source: "tokens", target: "out", type: "output", confidence: 1 },
    ],
    containers: [{ id: "encoder", children: ["stem", "left", "right", "join"] }],
  });
}

test("derives independent domain, effect, topology, role, scale, and certainty facts", () => {
  const facts = deriveNeuralSemanticFacts(fixture());
  assert.equal(facts.version, "neural-semantic-facts/v1");
  assert.equal(facts.nodeFacts.image.dataDomain.value, "spatial");
  assert.equal(facts.nodeFacts.stem.operationEffect.value, "reduce");
  assert.equal(facts.nodeFacts.stem.topology.value.branch, true);
  assert.equal(facts.nodeFacts.join.topology.value.merge, true);
  assert.equal(facts.nodeFacts.left.operationEffect.value, "unknown");
  assert.equal(facts.nodeFacts.tokens.dataDomain.value, "sequence");
  assert.equal(facts.nodeFacts.state.dataDomain.value, "state");
  assert.equal(facts.nodeFacts.state.topology.value.cycle, true);
  assert.equal(facts.nodeFacts.out.structuralRole.value, "output");
  assert.equal(facts.nodeFacts.state.certainty.value, "grounded");
  assert.equal(facts.edgeFacts.bypass.topology.value.bypass, true);
  assert.equal(facts.edgeFacts.down.topology.value.crossScale, true);
  assert.equal(facts.edgeFacts.loop.topology.value.state, true);
});

test("facts preserve evidence and confidence and are deeply immutable", () => {
  const facts = deriveNeuralSemanticFacts(fixture());
  assert.equal(facts.nodeFacts.stem.operationEffect.confidence, 0.98);
  assert.ok(facts.nodeFacts.stem.operationEffect.evidenceIds.length > 0);
  assert.equal(Object.isFrozen(facts), true);
  assert.equal(Object.isFrozen(facts.nodeFacts.stem.topology.value), true);
  assert.throws(() => { facts.nodeFacts.stem.topology.value.branch = false; }, TypeError);
});

test("display labels and architecture names do not change semantic facts", () => {
  const original = fixture();
  const renamed = normalizeUniversalIR({
    ...original,
    source: { ...original.source, name: "Completely Different Product Name" },
    figure: { ...original.figure, title: "Renamed Figure" },
    nodes: original.nodes.map((node) => ({ ...node, label: `Display ${node.id}`, subtitle: "decorative text" })),
  });
  const first = deriveNeuralSemanticFacts(original);
  const second = deriveNeuralSemanticFacts(renamed);
  assert.deepEqual(first.nodeFacts, second.nodeFacts);
  assert.deepEqual(first.edgeFacts, second.edgeFacts);
});

test("validates complete node, edge, and region identity coverage", () => {
  const ir = fixture();
  const facts = deriveNeuralSemanticFacts(ir);
  assert.equal(validateNeuralSemanticFacts(facts, ir).ok, true);
  const incomplete = { ...facts, nodeFacts: { ...facts.nodeFacts } };
  delete incomplete.nodeFacts.join;
  const validation = validateNeuralSemanticFacts(incomplete, ir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-node-facts" && issue.nodeId === "join"));
});

test("covers explicit set, scalar, graph, conditional, inferred, and unresolved facts", () => {
  const ir = normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "set", op: "UserSetInput", family: "custom", compoundKind: "module", attributes: { dataDomain: "set" }, confidence: 1 },
      { id: "graph", op: "UserGraphStep", family: "graph", confidence: 0.7 },
      { id: "scalar", op: "Score", family: "output", shape: { output: [1] }, confidence: 1 },
      { id: "opaque", op: "Unknown", family: "custom", compoundKind: "unresolved", confidence: 1 },
    ],
    edges: [
      { id: "route", source: "set", target: "graph", type: "conditional", confidence: 0.75 },
      { id: "score", source: "graph", target: "scalar", type: "output", confidence: 1 },
      { id: "unknown", source: "scalar", target: "opaque", status: "unresolved", confidence: 1 },
    ],
  });
  const facts = deriveNeuralSemanticFacts(ir);
  assert.equal(facts.nodeFacts.set.dataDomain.value, "set");
  assert.equal(facts.nodeFacts.graph.dataDomain.value, "graph");
  assert.equal(facts.nodeFacts.scalar.dataDomain.value, "scalar");
  assert.equal(facts.nodeFacts.graph.certainty.value, "inferred");
  assert.equal(facts.nodeFacts.opaque.certainty.value, "unresolved");
  assert.equal(facts.edgeFacts.route.relation.value, "conditional");
  assert.equal(facts.edgeFacts.route.certainty.value, "inferred");
  assert.equal(facts.edgeFacts.unknown.certainty.value, "unresolved");
});
