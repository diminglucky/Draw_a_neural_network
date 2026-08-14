import { describe, expect, it } from "vitest";
import { parseCanonicalNetworkIR, validateCanonicalNetworkIR } from "../src/network-ir-v2.js";

function validCnnIr(): any {
  return {
    version: 2,
    figure: { id: "cnn", title: "Simple CNN", description: null },
    tensors: [
      { id: "tensor-1", name: "input", shape: [224, 224, 3], axes: ["height", "width", "channel"], semanticRole: "input", dtype: "float32", producerNodeId: "input-1", consumerNodeIds: ["conv-1"] },
      { id: "tensor-2", name: "features", shape: [224, 224, 64], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "conv-1", consumerNodeIds: ["output-1"] },
    ],
    nodes: [
      { id: "input-1", op: "input", inputTensorIds: [], outputTensorIds: ["tensor-1"], confidence: 1, sourceEvidenceIds: ["fact-input"] },
      { id: "conv-1", op: "conv2d", inputTensorIds: ["tensor-1"], outputTensorIds: ["tensor-2"], confidence: 0.9, sourceEvidenceIds: ["fact-conv"] },
      { id: "output-1", op: "output", inputTensorIds: ["tensor-2"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"] },
    ],
    edges: [
      { id: "edge-1", sourceNodeId: "input-1", targetNodeId: "conv-1", relation: "data", tensorIds: ["tensor-1"], confidence: 1, evidenceIds: ["fact-input"] },
      { id: "edge-2", sourceNodeId: "conv-1", targetNodeId: "output-1", relation: "data", tensorIds: ["tensor-2"], confidence: 0.9, evidenceIds: ["fact-output"] },
    ],
    groups: [],
    unresolved: [],
  };
}

function validResidualIr(): any {
  return {
    ...validCnnIr(),
    tensors: [
      { id: "tensor-1", name: "input", shape: [224, 224, 64], axes: ["height", "width", "channel"], semanticRole: "input", dtype: "float32", producerNodeId: "input-1", consumerNodeIds: ["conv-1", "add-1"] },
      { id: "tensor-2", name: "branch", shape: [224, 224, 64], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "conv-1", consumerNodeIds: ["add-1"] },
      { id: "tensor-3", name: "merged", shape: [224, 224, 64], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "add-1", consumerNodeIds: ["output-1"] },
    ],
    nodes: [
      { id: "input-1", op: "input", inputTensorIds: [], outputTensorIds: ["tensor-1"], confidence: 1, sourceEvidenceIds: ["fact-input"] },
      { id: "conv-1", op: "conv2d", inputTensorIds: ["tensor-1"], outputTensorIds: ["tensor-2"], confidence: 0.9, sourceEvidenceIds: ["fact-conv"] },
      { id: "add-1", op: "add", inputTensorIds: ["tensor-1", "tensor-2"], outputTensorIds: ["tensor-3"], confidence: 0.9, sourceEvidenceIds: ["fact-add"] },
      { id: "output-1", op: "output", inputTensorIds: ["tensor-3"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"] },
    ],
    edges: [
      { id: "edge-1", sourceNodeId: "input-1", targetNodeId: "conv-1", relation: "data", tensorIds: ["tensor-1"], confidence: 1, evidenceIds: ["fact-input"] },
      { id: "edge-2", sourceNodeId: "input-1", targetNodeId: "add-1", relation: "residual", tensorIds: ["tensor-1"], confidence: 0.9, evidenceIds: ["fact-add"] },
      { id: "edge-3", sourceNodeId: "conv-1", targetNodeId: "add-1", relation: "data", tensorIds: ["tensor-2"], confidence: 0.9, evidenceIds: ["fact-add"] },
      { id: "edge-4", sourceNodeId: "add-1", targetNodeId: "output-1", relation: "data", tensorIds: ["tensor-3"], confidence: 0.9, evidenceIds: ["fact-output"] },
    ],
  };
}

describe("Canonical NetworkIR v2", () => {
  it("parses a structural graph without visual fields", () => {
    const parsed = parseCanonicalNetworkIR(validCnnIr());
    expect(parsed).toMatchObject({ version: 2, unresolved: [] });
    expect(JSON.stringify(parsed)).not.toMatch(/visualRole|visualEncoding|color|perspective|depth|renderer|primitive|outputPath/i);
  });

  it("accepts blocking unresolved entries during default Phase 1 validation", () => {
    const ir = {
      ...validCnnIr(),
      unresolved: [{ id: "unresolved-1", question: "Which merge?", severity: "blocking", candidateValues: ["add"], evidenceIds: [] }],
    };

    expect(validateCanonicalNetworkIR(ir)).toMatchObject({ valid: true, ir });
    expect(parseCanonicalNetworkIR(ir)).toMatchObject({ unresolved: ir.unresolved });
  });

  it("rejects blocking unresolved entries when render-ready validation is explicit", () => {
    const result = validateCanonicalNetworkIR({
      ...validCnnIr(),
      unresolved: [{ id: "unresolved-1", question: "Which merge?", severity: "blocking", candidateValues: ["add"], evidenceIds: [] }],
    }, undefined, { renderReady: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "blocking-unresolved", path: "unresolved[0]" }),
    ]));
  });

  it("throws when parsing render-ready IR with a blocking unresolved entry", () => {
    const ir = {
      ...validCnnIr(),
      unresolved: [{ id: "unresolved-1", question: "Which merge?", severity: "blocking", candidateValues: ["add"], evidenceIds: [] }],
    };

    expect(() => parseCanonicalNetworkIR(ir, undefined, { renderReady: true })).toThrow(/unresolved\[0\]/);
  });

  it("rejects a residual Add node with fewer than two input tensors", () => {
    const result = validateCanonicalNetworkIR({
      ...validCnnIr(),
      nodes: [{ ...validCnnIr().nodes[1], id: "add-1", op: "add", inputTensorIds: ["tensor-1"] }],
    });
    expect(result).toMatchObject({ valid: false });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-merge-arity", path: "nodes[0].inputTensorIds" }),
    ]));
  });

  it("requires evidence for a key residual relation", () => {
    const result = validateCanonicalNetworkIR({
      ...validResidualIr(),
      edges: validResidualIr().edges.map((edge: any) => ({ ...edge, evidenceIds: [] })),
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-key-evidence" }),
    ]));
  });

  it("rejects duplicate unresolved IDs before later semantic checks", () => {
    const ir = validCnnIr();
    ir.unresolved = [
      { id: "unresolved-1", question: "Which merge?", severity: "warning", candidateValues: ["add"], evidenceIds: [] },
      { id: "unresolved-1", question: "Which merge?", severity: "warning", candidateValues: ["concat"], evidenceIds: [] },
    ];
    const result = validateCanonicalNetworkIR(ir);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-unresolved-id", path: "unresolved[1].id" }),
    ]));
  });

  it("rejects duplicate tensor IDs as merge inputs", () => {
    const ir = validResidualIr();
    ir.nodes[2].inputTensorIds = ["tensor-1", "tensor-1"];
    const result = validateCanonicalNetworkIR(ir);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-merge-input-tensor", path: "nodes[2].inputTensorIds" }),
    ]));
  });

  it("rejects unknown tensor references and inconsistent tensor ownership", () => {
    const ir = validCnnIr();
    ir.nodes[1].inputTensorIds = ["tensor-1", "missing-tensor"];
    ir.tensors[0].consumerNodeIds = [];
    const result = validateCanonicalNetworkIR(ir);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-tensor-reference", path: "nodes[1].inputTensorIds[1]" }),
      expect.objectContaining({ code: "tensor-consumer-mismatch", path: "tensors[0].consumerNodeIds" }),
    ]));
  });

  it("rejects non-iteration self loops and disconnected outputs", () => {
    const ir = validCnnIr();
    ir.edges = [{ ...ir.edges[0], sourceNodeId: "conv-1", targetNodeId: "conv-1" }];
    const result = validateCanonicalNetworkIR(ir);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "illegal-self-loop", path: "edges[0]" }),
      expect.objectContaining({ code: "unreachable-output", path: "nodes[2]" }),
    ]));
  });

  it("rejects repeated units outside a declared group and visual fields", () => {
    const ir = validCnnIr();
    ir.nodes[1].repeats = { count: 2, unitNodeIds: ["conv-1"] };
    ir.nodes[1].visualRole = "feature-map-stack";
    const result = validateCanonicalNetworkIR(ir);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "schema:unrecognized_keys", path: "nodes[1]" }),
    ]));
  });

  it("checks evidence IDs against a supplied EvidenceBundle", () => {
    const result = validateCanonicalNetworkIR(validCnnIr(), {
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "model.py" }],
      facts: [{ id: "fact-input", subject: "input-1", predicate: "op", value: "input", confidence: 1, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } }],
      unresolved: [],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unknown-evidence-id" }),
    ]));
  });
});
