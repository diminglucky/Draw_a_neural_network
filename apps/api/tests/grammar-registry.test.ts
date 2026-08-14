import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { createPublicationGrammarRegistry, GrammarRegistry, type FigureGrammar } from "../src/grammar-registry.js";
import { parseCanonicalNetworkIR } from "../src/network-ir-v2.js";

function ir(blocking = false) {
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "network", title: "Network", description: null },
    tensors: [{ id: "tensor", name: "tensor", shape: [1], axes: ["feature"], semanticRole: "input", dtype: null, producerNodeId: "input", consumerNodeIds: ["output"] }],
    nodes: [
      { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
      { id: "output", op: "output", inputTensorIds: ["tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
    ],
    edges: [{ id: "flow", sourceNodeId: "input", targetNodeId: "output", relation: "data", tensorIds: ["tensor"], confidence: 1, evidenceIds: ["fact-output"] }],
    groups: [],
    unresolved: blocking ? [{ id: "merge", question: "Which merge?", severity: "blocking", candidateValues: ["add"], evidenceIds: [] }] : [],
  });
}

function grammar(id: "cnn-classifier" | "encoder-decoder" | "residual-backbone" | "token-transformer", score: number, blockers: string[] = []): FigureGrammar {
  return { id, version: 1, evaluate: () => ({ grammarId: id, score, reasons: [`${id} score`], blockers }) };
}

describe("GrammarRegistry", () => {
  it("registers the deterministic preview grammar families", () => {
    expect(createPublicationGrammarRegistry().registeredIds()).toEqual(["cnn-classifier", "encoder-decoder", "residual-backbone", "token-transformer", "multi-branch-fusion"]);
  });

  it("uses the grammar ID as a stable tie break instead of registration order", () => {
    const registry = new GrammarRegistry([
      grammar("residual-backbone", 0.8),
      grammar("cnn-classifier", 0.8),
    ]);

    const result = registry.select(ir(), defaultFigureIntent());

    expect(result.status).toBe("selected");
    expect(result.selected?.id).toBe("cnn-classifier");
    expect(result.candidates.map((candidate) => candidate.grammarId)).toEqual(["cnn-classifier", "residual-backbone"]);
  });

  it("does not select a grammar when its own blockers apply", () => {
    const registry = new GrammarRegistry([grammar("cnn-classifier", 0.95, ["requires single backbone"])]);

    expect(registry.select(ir(), defaultFigureIntent())).toMatchObject({
      status: "needs_confirmation",
      selected: null,
      blockers: ["requires single backbone"],
    });
  });

  it("requires confirmation when the best valid grammar is below 0.70", () => {
    const registry = new GrammarRegistry([grammar("cnn-classifier", 0.69)]);

    expect(registry.select(ir(), defaultFigureIntent())).toMatchObject({
      status: "needs_confirmation",
      selected: null,
      candidates: [expect.objectContaining({ grammarId: "cnn-classifier", score: 0.69 })],
    });
  });

  it("fails closed before grammar evaluation when Canonical IR contains a blocking unresolved fact", () => {
    const registry = new GrammarRegistry([grammar("cnn-classifier", 0.99)]);

    expect(registry.select(ir(true), defaultFigureIntent())).toMatchObject({
      status: "needs_confirmation",
      selected: null,
      candidates: [],
      blockers: [expect.stringContaining("merge")],
    });
  });
});
