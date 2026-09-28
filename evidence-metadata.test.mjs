import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvidenceMetadata, validateEvidenceMetadata } from "./evidence-metadata.mjs";

test("normalizes node and edge evidence into stable metadata", () => {
  const ir = normalizeEvidenceMetadata({
    source: { analyzer: "python-ast", name: "Net" },
    nodes: [{
      id: "conv",
      evidence: [{ kind: "source", line: 12 }],
      confidence: 0.8,
    }],
    edges: [{
      id: "flow",
      evidence: [{ kind: "source", line: 13 }],
    }],
  }, { sourceId: "source-1" });

  assert.equal(ir.evidenceMetadataVersion, "evidence-metadata/v1");
  assert.equal(ir.nodes[0].evidence[0].sourceId, "source-1");
  assert.equal(ir.nodes[0].evidence[0].analyzer, "python-ast");
  assert.match(ir.nodes[0].evidence[0].evidenceId, /^evidence-/);
  assert.deepEqual(ir.nodes[0].sourceLocation, { line: 12 });
  assert.equal(validateEvidenceMetadata(ir).ok, true);
});

test("validation rejects missing evidence identity and provenance", () => {
  const validation = validateEvidenceMetadata({
    evidenceMetadataVersion: "evidence-metadata/v1",
    nodes: [{ id: "n", evidence: [{ kind: "source" }] }],
    edges: [{ id: "e", evidence: [] }],
  });

  assert.ok(validation.issues.some((issue) => issue.code === "missing-evidence-id"));
  assert.ok(validation.issues.some((issue) => issue.code === "missing-evidence-source"));
});

test("normalizes sourceLine, config paths, and artifact indexes into one location contract", () => {
  const ir = normalizeEvidenceMetadata({
    nodes: [
      { id: "conv", sourceLine: 42, evidence: [{ kind: "source" }] },
      { id: "config", evidence: [{ kind: "config-declaration", path: ["pipeline", "3"], declarationIndex: 7 }] },
      { id: "onnx", evidence: [{ kind: "onnx-node", nodeIndex: 2, name: "Conv_0" }] },
    ],
    edges: [],
  }, { sourceId: "mixed", analyzer: "mixed" });

  assert.deepEqual(ir.nodes[0].sourceLocation, { line: 42 });
  assert.deepEqual(ir.nodes[1].sourceLocation, { path: ["pipeline", "3"], index: 7 });
  assert.deepEqual(ir.nodes[2].sourceLocation, { index: 2, name: "Conv_0" });
  assert.equal(validateEvidenceMetadata(ir).ok, true);
});
