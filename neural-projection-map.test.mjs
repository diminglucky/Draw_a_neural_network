import assert from "node:assert/strict";
import test from "node:test";
import { createProjectionMap, validateProjectionMap } from "./neural-projection-map.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { deriveNeuralBlocks } from "./neural-block-ir.mjs";
import { normalizeUniversalIR } from "./universal-ir.mjs";

function linearIR() {
  return normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "in", family: "input", op: "Input", ports: { outputs: ["x"] } },
      { id: "a", family: "conv", op: "OperatorA", containerId: "body", repeatCount: 1 },
      { id: "b", family: "norm", op: "OperatorB", containerId: "body" },
      { id: "c", family: "activation", op: "OperatorC", containerId: "body", ports: { outputs: ["feature"] } },
      { id: "out", family: "output", op: "Output", ports: { inputs: ["prediction"] } },
    ],
    edges: [
      { id: "e0", source: "in", target: "a", ports: { source: "x", target: "input" } },
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
      { id: "e3", source: "c", target: "out", type: "output", ports: { source: "feature", target: "prediction" } },
    ],
  });
}

test("full projection maps every node directly and every edge visibly", () => {
  const ir = linearIR();
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "full" });
  assert.equal(map.version, "neural-projection-map/v1");
  assert.ok(map.projections.every((projection) => projection.kind === "direct"));
  assert.ok(Object.values(map.edgeToProjection).every((mapping) => mapping.disposition === "visible"));
  assert.equal(validateProjectionMap(map, ir).ok, true);
});

test("full projection ignores Block IR collapse even when blocks are supplied", () => {
  const ir = linearIR();
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const map = createProjectionMap(ir, facts, { detail: "full", blocks });
  assert.ok(map.projections.every((projection) => projection.kind === "direct"));
  assert.deepEqual(map.projections.map((projection) => projection.orderedNodeIds), [["in"], ["a"], ["b"], ["c"], ["out"]]);
});

test("overview collapses a safe linear run and explicitly accounts for internal edges", () => {
  const ir = linearIR();
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "overview" });
  const collapsed = map.projections.find((projection) => projection.kind === "sequence-collapse");
  assert.deepEqual(collapsed.orderedNodeIds, ["a", "b", "c"]);
  assert.deepEqual(collapsed.internalEdgeIds, ["e1", "e2"]);
  assert.equal(map.edgeToProjection.e1.disposition, "internal");
  assert.equal(map.edgeToProjection.e3.disposition, "visible");
  assert.deepEqual(collapsed.entryPorts, [{ edgeId: "e0", nodeId: "a", portId: "input" }]);
  assert.deepEqual(collapsed.exitPorts, [{ edgeId: "e3", nodeId: "c", portId: "feature" }]);
  assert.equal(validateProjectionMap(map, ir).ok, true);
});

test("repeat, opaque, and grounded branch modules use distinct generic projection kinds", () => {
  const ir = normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "repeat", family: "conv", op: "Whatever", repeatCount: 4 },
      { id: "opaque", family: "custom", op: "Unknown", compoundKind: "unresolved" },
      { id: "expanded", family: "custom", op: "UserModule", compoundKind: "module", attributes: { internalGraph: { status: "grounded", nodes: [{ id: "i" }, { id: "l" }, { id: "r" }, { id: "m" }], edges: [{ source: "i", target: "l" }, { source: "i", target: "r" }, { source: "l", target: "m" }, { source: "r", target: "m" }] } } },
    ],
    edges: [],
  });
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "balanced" });
  assert.equal(map.projections.find((item) => item.orderedNodeIds.includes("repeat")).kind, "repeat-collapse");
  assert.equal(map.projections.find((item) => item.orderedNodeIds.includes("opaque")).kind, "opaque-module");
  assert.equal(map.projections.find((item) => item.orderedNodeIds.includes("expanded")).kind, "inline-expansion");
});

test("branch, state, bypass, and output relations remain visible under a tight budget", () => {
  const ir = normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "source", family: "input" }, { id: "left", family: "conv" }, { id: "right", family: "conv" },
      { id: "merge", family: "merge" }, { id: "state", family: "recurrent" }, { id: "out", family: "output" },
    ],
    edges: [
      { id: "left", source: "source", target: "left" }, { id: "right", source: "source", target: "right" },
      { id: "left-merge", source: "left", target: "merge" }, { id: "right-merge", source: "right", target: "merge" },
      { id: "skip", source: "source", target: "merge", type: "residual" },
      { id: "to-state", source: "merge", target: "state" }, { id: "state-loop", source: "state", target: "state", type: "state" },
      { id: "output", source: "state", target: "out", type: "output" },
    ],
  });
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "overview", maxPrimaryPrimitives: 2 });
  for (const edgeId of ["left", "right", "left-merge", "right-merge", "skip", "state-loop", "output"]) {
    assert.equal(map.edgeToProjection[edgeId].disposition, "visible", `${edgeId} must remain visible`);
  }
  assert.ok(map.diagnostics.some((item) => item.code === "projection-budget-exceeded"));
});

test("validation rejects missing coverage and hidden protected relations", () => {
  const ir = linearIR();
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "full" });
  delete map.nodeToProjection.b;
  map.edgeToProjection.e3.disposition = "hidden";
  const validation = validateProjectionMap(map, ir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-node-projection"));
  assert.ok(validation.issues.some((issue) => issue.code === "protected-edge-hidden"));
});

test("validation rejects endpoint, port, and internal-edge accounting drift", () => {
  const ir = linearIR();
  const map = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "overview" });
  map.edgeToProjection.e0.targetNodeId = "wrong";
  map.edgeToProjection.e0.targetPortId = null;
  map.projections.find((projection) => projection.kind === "sequence-collapse").internalEdgeIds = [];
  const validation = validateProjectionMap(map, ir);
  assert.ok(validation.issues.some((issue) => issue.code === "edge-endpoint-projection-mismatch" && issue.edgeId === "e0"));
  assert.ok(validation.issues.some((issue) => issue.code === "edge-port-projection-mismatch" && issue.edgeId === "e0"));
  assert.ok(validation.issues.some((issue) => issue.code === "internal-edge-not-explicit" && issue.edgeId === "e1"));
});

test("projection decisions are deterministic and independent of display names", () => {
  const ir = linearIR();
  const renamed = normalizeUniversalIR({ ...ir, source: { name: "Other" }, nodes: ir.nodes.map((node) => ({ ...node, label: `Renamed ${node.id}` })) });
  const first = createProjectionMap(ir, deriveNeuralSemanticFacts(ir), { detail: "overview" });
  const second = createProjectionMap(renamed, deriveNeuralSemanticFacts(renamed), { detail: "overview" });
  assert.deepEqual(first, second);
});

test("balanced projection collapses Block IR boundaries before individual nodes", () => {
  const ir = linearIR();
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const map = createProjectionMap(ir, facts, { detail: "balanced", blocks });
  const convBlock = map.projections.find((projection) => projection.blockKind === "conv-block");
  assert.deepEqual(convBlock.orderedNodeIds, ["a", "b", "c"]);
  assert.equal(convBlock.kind, "block-conv-block");
  assert.equal(validateProjectionMap(map, ir).ok, true);
});

test("balanced projection skips blocks that contain manually positioned workspace nodes", () => {
  const ir = linearIR();
  ir.nodes.find((node) => node.id === "b").attributes = { workspaceUi: { x: 400, y: 200, w: 80, h: 60 } };
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const map = createProjectionMap(ir, facts, { detail: "balanced", blocks });
  assert.equal(map.projections.some((projection) => projection.blockKind === "conv-block"), false);
  assert.equal(map.projections.find((projection) => projection.orderedNodeIds.includes("b")).kind, "direct");
});

test("balanced projection can expand selected block kinds", () => {
  const ir = linearIR();
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const expanded = createProjectionMap(ir, facts, { detail: "balanced", blocks, expandBlockKinds: ["conv-block"] });
  assert.equal(expanded.projections.some((projection) => projection.blockKind === "conv-block"), false);
  assert.deepEqual(expanded.projections.map((projection) => projection.orderedNodeIds), [["in"], ["a"], ["b"], ["c"], ["out"]]);

  const collapsed = createProjectionMap(ir, facts, { detail: "balanced", blocks });
  assert.equal(collapsed.projections.some((projection) => projection.blockKind === "conv-block"), true);
});

test("balanced projection honors per-block expand and locked collapse overrides", () => {
  const ir = linearIR();
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const block = blocks.blocks.find((item) => item.kind === "conv-block");

  const expanded = createProjectionMap(ir, facts, {
    detail: "balanced",
    blocks,
    blockOverrides: { [block.id]: { expanded: true, locked: false } },
  });
  assert.equal(expanded.projections.some((projection) => projection.blockId === block.id), false);

  const locked = createProjectionMap(ir, facts, {
    detail: "balanced",
    blocks,
    blockOverrides: { [block.id]: { expanded: false, locked: true } },
  });
  assert.equal(locked.projections.some((projection) => projection.blockId === block.id), true);
});

test("locked block overrides win over conflicting expand flags and emit diagnostics", () => {
  const ir = linearIR();
  const facts = deriveNeuralSemanticFacts(ir);
  const blocks = deriveNeuralBlocks(ir, facts);
  const block = blocks.blocks.find((item) => item.kind === "conv-block");
  const map = createProjectionMap(ir, facts, {
    detail: "balanced",
    blocks,
    blockOverrides: { [block.id]: { expanded: true, locked: true } },
  });
  assert.equal(map.projections.some((projection) => projection.blockId === block.id), true);
  assert.ok(map.diagnostics.some((issue) => issue.code === "block-lock-expand-conflict" && issue.blockId === block.id));
});

test("block port mappings produce unique edge port ids for MIMO blocks", () => {
  const ir = normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "a", family: "conv", op: "Conv2d" },
      { id: "b", family: "conv", op: "Conv2d" },
      { id: "merge", family: "merge", op: "Concat" },
    ],
    edges: [
      { id: "e1", source: "a", target: "merge", ports: { target: "in" } },
      { id: "e2", source: "b", target: "merge", ports: { target: "in" } },
    ],
  });
  const blocks = {
    version: "neural-block-ir/v1",
    blocks: [{
      id: "block:conv-block:a+b",
      kind: "conv-block",
      nodeIds: ["a", "b"],
      entryPortMappings: [],
      exitPortMappings: [
        { edgeId: "e1", nodeId: "a", targetNodeId: "merge", portId: "out" },
        { edgeId: "e2", nodeId: "b", targetNodeId: "merge", portId: "out" },
      ],
    }],
  };
  const facts = deriveNeuralSemanticFacts(ir);
  const map = createProjectionMap(ir, facts, { detail: "balanced", blocks });
  const projection = map.projections.find((item) => item.blockKind === "conv-block");
  assert.deepEqual(projection.exitPorts.map((port) => port.id), ["out", "out-2"]);
  assert.equal(map.edgeToProjection.e1.sourceBlockPortId, "out");
  assert.equal(map.edgeToProjection.e2.sourceBlockPortId, "out-2");
});
