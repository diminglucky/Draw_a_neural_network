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

test("preserves node and edge evidence metadata through Universal IR conversion", () => {
  const graph = createEvidenceGraph({
    input: { kind: "source", source: "model.py" },
    records: [{
      evidenceId: "e-meta",
      source: { file: "model.py", line: 12 },
      provenance: { extractor: "static", stage: "extract" },
      confidence: 0.81,
      status: "confirmed",
    }],
    nodes: [{
      id: "source",
      op: "Input",
      family: "input",
      evidence: ["e-meta"],
      provenance: { extractor: "static", stage: "normalize" },
      confidence: 0.72,
      status: "confirmed",
    }, {
      id: "opaque",
      op: "OpaqueBlock",
      family: "conv",
      compoundKind: "unresolved",
      evidence: [{
        evidenceId: "inline-node-evidence",
        provenance: { extractor: "vision", stage: "extract" },
        confidence: 0.34,
        status: "unresolved",
      }],
    }],
    edges: [{
      id: "source-opaque",
      source: "source",
      target: "opaque",
      evidence: ["e-meta"],
      provenance: { extractor: "static", stage: "normalize" },
      confidence: 0.63,
      status: "unresolved",
    }],
  });

  const ir = evidenceGraphToUniversalIR(graph);

  assert.deepEqual(ir.nodes[0].provenance, { extractor: "static", stage: "normalize" });
  assert.equal(ir.nodes[0].confidence, 0.72);
  assert.equal(ir.nodes[0].status, "confirmed");
  assert.deepEqual(ir.nodes[0].evidence[0], graph.records[0]);
  assert.deepEqual(ir.nodes[1].evidence[0], {
    evidenceId: "inline-node-evidence",
    provenance: { extractor: "vision", stage: "extract" },
    confidence: 0.34,
    status: "unresolved",
  });
  assert.deepEqual(ir.edges[0].provenance, { extractor: "static", stage: "normalize" });
  assert.equal(ir.edges[0].confidence, 0.63);
  assert.equal(ir.edges[0].status, "unresolved");
  assert.deepEqual(ir.edges[0].evidence[0], graph.records[0]);
  assert.equal(ir.nodes[1].compoundKind, "unresolved");
});
