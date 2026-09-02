import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceGraph, createEvidenceRecord, evidenceGraphToUniversalIR } from "./evidence-graph.mjs";

test("creates bounded confirmed evidence with stable explicit IDs", () => {
  const first = createEvidenceRecord({ evidenceId: "e-1", source: { file: "model.py", line: 4 }, confidence: 2 });
  const second = createEvidenceRecord({ evidenceId: "e-1", source: "same" });
  assert.equal(first.evidenceId, second.evidenceId);
  assert.equal(first.status, "confirmed");
  assert.equal(first.confidence, 1);
});

test("preserves unresolved records, compound markers, and conflict diagnostics in a graph and IR", () => {
  const unresolved = createEvidenceRecord({ evidenceId: "u-1", source: "trace", status: "unresolved", confidence: 0.4, family: "mystery" });
  const graph = createEvidenceGraph({
    input: { kind: "source", source: "model.py" }, records: [unresolved],
    nodes: [{ id: "n1", op: "MysteryBlock", family: "conv", compoundKind: "unresolved", evidence: [unresolved.evidenceId], confidence: 0.4 }],
    edges: [{ id: "e1", source: "n1", target: "n1", type: "signal", evidence: [unresolved.evidenceId], confidence: 0.25 }],
    diagnostics: [{ kind: "conflict", evidenceId: "u-1" }],
  });
  assert.equal(graph.records[0].status, "unresolved");
  assert.deepEqual(graph.diagnostics, [{ kind: "conflict", evidenceId: "u-1" }]);
  const ir = evidenceGraphToUniversalIR(graph);
  assert.equal(ir.nodes[0].compoundKind, "unresolved");
  assert.equal(ir.nodes[0].evidence[0].evidenceId, "u-1");
  assert.equal(ir.nodes[0].confidence, 0.4);
  assert.equal(ir.edges[0].evidence[0].evidenceId, "u-1");
  assert.equal(ir.edges[0].confidence, 0.25);
  assert.deepEqual(ir.diagnostics, graph.diagnostics);
});
