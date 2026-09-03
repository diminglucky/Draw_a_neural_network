import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniversalIR,
  normalizeUniversalIR,
  normalizeRecurrentEvidence,
  recurrentEvidenceForNode,
  projectUniversalIRToCanvas,
  validateUniversalIR,
} from "./universal-ir.mjs";

test("Universal IR normalizes explicit recurrent evidence without inferring topology from names", () => {
  const node = {
    id: "cell",
    family: "recurrent",
    op: "LSTMCell",
    attributes: {
      repetition: { axis: "time", instances: ["t-1", "t", "t+1"], sharedParameters: true },
      stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", kind: "carry", sourceEdgeId: "state-edge" }],
      internalGraph: {
        nodes: [{ id: "actual", op: "Linear" }],
        edges: [],
        ports: { inputs: ["x"], states: ["h_prev"], outputs: ["h_next"] },
      },
    },
  };
  const edges = [{ id: "state-edge", source: "cell", target: "cell", type: "state", ports: { source: "h_prev", target: "h_next" } }];

  const evidence = normalizeRecurrentEvidence(node, edges);
  assert.equal(evidence.repetition.axis, "time");
  assert.deepEqual(evidence.repetition.instances, ["t-1", "t", "t+1"]);
  assert.deepEqual(evidence.stateTransitions[0].sourceEndpointIds, { source: "h_prev", target: "h_next" });
  assert.equal(evidence.internalGraph.nodes[0].id, "actual");
  assert.equal(evidence.internalGraph.nodes.some((child) => /gate|forget|input|output/i.test(child.id)), false);
  assert.deepEqual(recurrentEvidenceForNode(node, edges), evidence);
});

test("Universal IR drops invalid internal edges and marks missing internal topology unresolved", () => {
  const evidence = normalizeRecurrentEvidence({
    id: "opaque",
    family: "recurrent",
    op: "GRU",
    attributes: {
      internalGraph: {
        nodes: [{ id: "known" }],
        edges: [
          { id: "valid", source: "known", target: "known" },
          { id: "ghost", source: "known", target: "missing" },
        ],
      },
    },
  }, []);
  assert.deepEqual(evidence.internalGraph.edges.map((edge) => edge.id), ["valid"]);
  assert.equal(evidence.internalGraph.nodes.some((node) => node.id === "missing"), false);
  assert.ok(evidence.internalGraph.diagnostics.some((item) => item.kind === "invalid-internal-edge"));

  const unresolved = recurrentEvidenceForNode({ id: "r", family: "recurrent", op: "LSTMCell" }, []);
  assert.equal(unresolved.internalGraph.status, "unresolved");
  assert.match(unresolved.internalGraph.reason, /internal topology/i);
});

test("Universal IR keeps transition edge and endpoint identities stable", () => {
  const evidence = normalizeRecurrentEvidence({
    id: "cell",
    attributes: { stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", sourceEdgeId: "source-state" }] },
  }, [{ id: "layout-state", sourceEdgeId: "source-state", ports: { source: "hidden-out", target: "hidden-in" } }]);
  assert.equal(evidence.stateTransitions[0].sourceEdgeId, "source-state");
  assert.deepEqual(evidence.stateTransitions[0].sourceEndpointIds, { source: "hidden-out", target: "hidden-in" });
});

test("Universal IR marks invalid internal topology unresolved", () => {
  const evidence = normalizeRecurrentEvidence({
    id: "cell",
    attributes: { internalGraph: { nodes: [{ id: "known" }], edges: [{ id: "ghost", source: "known", target: "missing" }] } },
  }, []);
  assert.match(evidence.internalGraph.status, /unresolved|invalid/);
  assert.ok(evidence.internalGraph.diagnostics.some((item) => item.kind === "invalid-internal-edge"));
});

test("Universal IR fails closed when a state transition references an unknown edge", () => {
  const evidence = normalizeRecurrentEvidence({
    id: "cell",
    attributes: { stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", sourceEdgeId: "missing-edge" }] },
  }, []);
  assert.equal(evidence.stateTransitions[0].status, "unresolved");
  assert.ok(evidence.diagnostics.some((item) => item.kind === "missing-state-transition-edge"));
});

test("Universal IR rejects a signal edge masquerading as a state transition", () => {
  const evidence = normalizeRecurrentEvidence({
    id: "cell",
    attributes: { stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", sourceEdgeId: "signal-edge" }] },
  }, [{ id: "signal-edge", source: "input", target: "cell", type: "signal", ports: { source: "x", target: "h_prev" } }]);
  assert.equal(evidence.stateTransitions[0].status, "unresolved");
  assert.ok(evidence.diagnostics.some((item) => item.kind === "invalid-state-transition-edge"));
});

const customGraph = {
  figure: {
    title: "Custom multimodal graph",
    subtitle: "branch, custom operator, and merge",
    stages: ["Input", "Branches", "Merge", "Output"],
  },
  nodes: [
    { id: "input", op: "Input", family: "input", stage: 0, label: "Image + Text", shape: ["B", "N", 768] },
    {
      id: "custom",
      op: "CustomCrossModalBlock",
      family: "custom",
      stage: 1,
      label: "CustomCrossModalBlock",
      inputs: ["input"],
      outputs: ["custom-out"],
      ports: { inputs: ["image", "text"], outputs: ["fused"] },
      source: { file: "model.py", line: 42, symbol: "CustomCrossModalBlock.forward" },
      confidence: 0.73,
    },
    { id: "conv", op: "Conv2d", family: "conv", stage: 1, label: "Conv2d", inputs: ["input"], outputs: ["conv-out"] },
    { id: "merge", op: "Add", family: "merge", stage: 2, label: "Add", inputs: ["custom", "conv"], outputs: ["merged"] },
    { id: "output", op: "Output", family: "output", stage: 3, label: "Prediction", inputs: ["merge"] },
  ],
  edges: [
    { id: "input-custom", source: "input", target: "custom", type: "signal" },
    { id: "input-conv", source: "input", target: "conv", type: "signal" },
    { id: "custom-merge", source: "custom", target: "merge", type: "skip" },
    { id: "conv-merge", source: "conv", target: "merge", type: "signal" },
    { id: "merge-output", source: "merge", target: "output", type: "signal" },
  ],
};

test("Universal IR preserves arbitrary operators, ports, shapes, evidence, and confidence", () => {
  const ir = createUniversalIR(customGraph, { sourceKind: "pytorch" });
  const custom = ir.nodes.find((node) => node.id === "custom");

  assert.equal(ir.version, "universal-neural-ir/v1");
  assert.equal(ir.source.kind, "pytorch");
  assert.equal(custom.op, "CustomCrossModalBlock");
  assert.equal(custom.family, "custom");
  assert.deepEqual(custom.ports.inputs, ["image", "text"]);
  assert.equal(custom.shape, undefined);
  assert.equal(custom.source.line, 42);
  assert.equal(custom.confidence, 0.73);
  assert.equal(validateUniversalIR(ir).ok, true);
});

test("Universal IR projects custom and merge semantics without collapsing custom nodes to blocks", () => {
  const ir = normalizeUniversalIR(createUniversalIR(customGraph));
  const document = projectUniversalIRToCanvas(ir);
  const custom = document.nodes.find((node) => node.id === "custom");
  const merge = document.nodes.find((node) => node.id === "merge");

  assert.equal(custom.type, "compound");
  assert.equal(custom.compoundKind, "unresolved");
  assert.equal(custom.op, "CustomCrossModalBlock");
  assert.deepEqual(custom.ports.inputs, ["image", "text"]);
  assert.equal(merge.type, "concat");
  assert.equal(document.edges.length, 5);
  assert.deepEqual(document.figure.stages, customGraph.figure.stages);
});

test("Universal IR validation fails closed for missing endpoints and invalid confidence", () => {
  const ir = createUniversalIR({
    nodes: [{ id: "only", op: "Unknown", family: "custom", confidence: 1.2 }],
    edges: [{ id: "broken", source: "only", target: "missing" }],
  });
  const report = validateUniversalIR(ir);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.kind === "missing-edge-endpoint"));
  assert.ok(report.issues.some((issue) => issue.kind === "invalid-confidence"));
});

test("Universal IR treats unknown declared families as unresolved custom operators", () => {
  const ir = normalizeUniversalIR({
    nodes: [{ id: "mystery", op: "MysteryOp", family: "made-up-family" }],
    edges: [],
  });
  assert.equal(ir.nodes[0].family, "custom");
  assert.equal(ir.nodes[0].compoundKind, "unresolved");
});

test("Universal IR preserves explicit compound and unresolved markers on known operators", () => {
  const ir = normalizeUniversalIR({
    nodes: [
      { id: "compound", op: "Conv2d", family: "conv", compoundKind: "residual-block" },
      { id: "unresolved", op: "Conv2d", family: "conv", compoundKind: "unresolved" },
    ],
    edges: [],
  });

  assert.equal(ir.nodes[0].compoundKind, "residual-block");
  assert.equal(ir.nodes[1].compoundKind, "unresolved");
});

test("Universal IR rejects self-loops, duplicate edge IDs, and unreachable outputs", () => {
  const report = validateUniversalIR({
    nodes: [
      { id: "input", op: "Input", family: "input" },
      { id: "output", op: "Output", family: "output" },
      { id: "dead", op: "Custom", family: "custom" },
    ],
    edges: [
      { id: "loop", source: "input", target: "input" },
      { id: "duplicate", source: "input", target: "dead" },
      { id: "duplicate", source: "dead", target: "dead" },
    ],
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.kind === "self-loop"));
  assert.ok(report.issues.some((issue) => issue.kind === "duplicate-edge-id"));
  assert.ok(report.issues.some((issue) => issue.kind === "unreachable-output"));
});

test("Universal IR preserves explicit recurrent loop edges", () => {
  const report = validateUniversalIR({
    nodes: [{ id: "cell", family: "recurrent", op: "LSTMCell" }],
    edges: [{ id: "state-loop", source: "cell", target: "cell", type: "loop" }],
  });
  assert.equal(report.ok, true);
});

test("Universal IR canvas projection preserves semantic input primitives", () => {
  const ir = normalizeUniversalIR({
    nodes: [
      { id: "image", family: "input", label: "pixels", shape: { output: [1, 3, 224, 224] } },
      { id: "sequence", family: "input", label: "tokens", ports: { outputs: ["tokens", "time"] } },
      { id: "state", family: "input", label: "hidden state", ports: { outputs: ["h_prev", "c_prev"] } },
      { id: "vector", family: "input", shape: { output: [1, 128] } },
      { id: "volume", family: "input", label: "voxel volume", shape: { output: [1, 1, 64, 64, 64] } },
      { id: "unknown", family: "input", shape: { output: [1, 7, 11] } },
    ],
    edges: [],
  });
  const canvas = projectUniversalIRToCanvas(ir);
  assert.deepEqual(
    canvas.nodes.map((node) => [node.id, node.visualRole, node.type]),
    [
      ["image", "image-input", "image-input"],
      ["sequence", "sequence-input", "sequence-input"],
      ["state", "state-input", "state-input"],
      ["vector", "vector-input", "vector-input"],
      ["volume", "volume-input", "volume-input"],
      ["unknown", "unknown-input", "unknown-input"],
    ],
  );
  assert.equal(canvas.nodes[0].geometryData.inputGrammar, "image-input");
  assert.equal(canvas.nodes[0].geometryData.channelCount, 3);
});

test("Universal IR normalizes source identities before any renderer projection", () => {
  const ir = normalizeUniversalIR({
    nodes: [{ id: "layout-input", sourceNodeId: "source-input", sourceNodeIds: ["source-input", "alias-input"], family: "input" }],
    edges: [{ id: "layout-edge", sourceEdgeId: "source-edge", source: "layout-input", target: "layout-input", sourceEndpointIds: { source: "state-out", target: "state-in" }, type: "loop" }],
  });
  assert.equal(ir.nodes[0].sourceNodeId, "source-input");
  assert.deepEqual(ir.nodes[0].sourceNodeIds, ["source-input", "alias-input"]);
  assert.equal(ir.edges[0].sourceEdgeId, "source-edge");
  assert.deepEqual(ir.edges[0].sourceEndpointIds, { source: "state-out", target: "state-in" });
});

test("Universal IR derives endpoint identities from evidenced edge ports", () => {
  const ir = normalizeUniversalIR({
    nodes: [
      { id: "sequence", family: "input" },
      { id: "cell", family: "recurrent" },
    ],
    edges: [{
      id: "sequence-cell",
      source: "sequence",
      target: "cell",
      ports: { source: "tokens", target: "x" },
    }],
  });
  assert.deepEqual(ir.edges[0].sourceEndpointIds, { source: "tokens", target: "x" });
});
