import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";
import { normalizeUniversalIR, validateUniversalIR } from "./universal-ir.mjs";

test("network normalization delegates Universal IR normalization", () => {
  const value = { nodes: [{ id: "x", op: "MysteryOp", family: "custom" }], edges: [] };
  assert.deepEqual(normalizeNetworkIR(value), normalizeUniversalIR(value));
});

test("network validation delegates Universal IR validation", () => {
  const value = { nodes: [{ id: "x", op: "Input", family: "input" }], edges: [] };
  assert.deepEqual(validateNetworkIR(value), validateUniversalIR(value));
});

test("network normalization retains evidence boundary metadata and unresolved markers", () => {
  const value = {
    nodes: [{
      id: "n1",
      op: "Conv2d",
      family: "conv",
      compoundKind: "unresolved",
      evidence: [{ evidenceId: "e1", provenance: { source: "trace" }, confidence: 0.4, status: "unresolved" }],
      provenance: { source: "trace" },
      confidence: 0.4,
      status: "unresolved",
    }],
    edges: [{
      id: "edge-1",
      source: "n1",
      target: "n1",
      type: "loop",
      evidence: [{ evidenceId: "e1" }],
      provenance: { source: "trace" },
      confidence: 0.4,
      status: "unresolved",
    }],
  };

  const ir = normalizeNetworkIR(value);
  assert.equal(ir.nodes[0].compoundKind, "unresolved");
  assert.deepEqual(ir.nodes[0].provenance, { source: "trace" });
  assert.equal(ir.nodes[0].status, "unresolved");
  assert.deepEqual(ir.nodes[0].evidence[0], value.nodes[0].evidence[0]);
  assert.deepEqual(ir.edges[0].provenance, { source: "trace" });
  assert.equal(ir.edges[0].status, "unresolved");
  assert.deepEqual(ir.edges[0].evidence[0], value.edges[0].evidence[0]);
});
