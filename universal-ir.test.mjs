import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniversalIR,
  normalizeUniversalIR,
  normalizeRecurrentEvidence,
  recurrentEvidenceForNode,
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

test("Universal IR canonicalizes explicit recurrent family aliases", () => {
  const ir = normalizeUniversalIR({ nodes: [{ id: "cell", op: "Cell", family: "lstm" }], edges: [] });
  assert.equal(ir.nodes[0].family, "recurrent");
  assert.equal(ir.nodes[0].compoundKind, undefined);
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

test("Universal IR fails closed for unresolved and low-confidence edges", () => {
  const report = validateUniversalIR({
    nodes: [
      { id: "input", op: "Input", family: "input" },
      { id: "output", op: "Output", family: "output" },
    ],
    edges: [
      { id: "unresolved", source: "input", target: "output", status: "unresolved", evidence: [] },
      { id: "uncertain", source: "input", target: "output", confidence: 0.4, evidence: [{ kind: "guess" }] },
    ],
  });

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.kind === "unresolved-edge"));
  assert.ok(report.issues.some((issue) => issue.kind === "low-confidence-edge"));
});

test("Universal IR preserves explicit recurrent loop edges", () => {
  const report = validateUniversalIR({
    nodes: [{ id: "cell", family: "recurrent", op: "LSTMCell" }],
    edges: [{ id: "state-loop", source: "cell", target: "cell", type: "loop" }],
  });
  assert.equal(report.ok, true);
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

test("Universal IR classifies upsample and pool as distinct families", () => {
  const ir = normalizeUniversalIR({
    nodes: [
      { id: "u1", op: "Upsample" },
      { id: "u2", op: "F.interpolate" },
      { id: "u3", op: "PixelShuffle" },
      { id: "p1", op: "MaxPool2d" },
      { id: "p2", op: "AvgPool2d" },
      { id: "p3", op: "AdaptiveAvgPool2d" },
      { id: "c", op: "ConvTranspose2d" },
    ],
  });
  const familyOf = (id) => ir.nodes.find((node) => node.id === id).family;
  assert.equal(familyOf("u1"), "upsample");
  assert.equal(familyOf("u2"), "upsample");
  assert.equal(familyOf("u3"), "upsample");
  assert.equal(familyOf("p1"), "pool");
  assert.equal(familyOf("p2"), "pool");
  assert.equal(familyOf("p3"), "pool");
  // Transposed conv stays in `conv` — its shape math is a convolution in reverse.
  assert.equal(familyOf("c"), "conv");
});

test("Universal IR validates group membership without duplicating nodes across groups", () => {
  const ok = validateUniversalIR({
    nodes: [{ id: "a", family: "input" }, { id: "b", family: "output" }],
    edges: [{ id: "e", source: "a", target: "b" }],
    groups: [{ id: "g", label: "Backbone", kind: "backbone", nodeIds: ["a", "b"] }],
  });
  assert.equal(ok.ok, true);

  const missing = validateUniversalIR({
    nodes: [{ id: "a", family: "input" }],
    edges: [],
    groups: [{ id: "g", label: "Backbone", kind: "backbone", nodeIds: ["ghost"] }],
  });
  assert.ok(missing.issues.some((issue) => issue.kind === "missing-group-node"));

  const duplicated = validateUniversalIR({
    nodes: [{ id: "a", family: "input" }, { id: "b", family: "output" }],
    edges: [],
    groups: [
      { id: "g1", label: "G1", kind: "module", nodeIds: ["a"] },
      { id: "g2", label: "G2", kind: "module", nodeIds: ["a"] },
    ],
  });
  assert.ok(duplicated.issues.some((issue) => issue.kind === "node-in-multiple-groups"));
});
