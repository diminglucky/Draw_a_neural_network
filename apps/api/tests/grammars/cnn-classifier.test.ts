import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../../src/figure-intent.js";
import { cnnClassifierGrammar } from "../../src/grammars/cnn-classifier.js";
import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";
import { runVisualQa } from "../../src/visual-qa.js";
import { structuralCnnCanonicalIr } from "../fixtures/structural-cnn-figure-analysis.js";

describe("cnn-classifier grammar", () => {
  it("compiles an anonymous spatial classifier topology as a scale-aware narrative", () => {
    const ir = structuralCnnCanonicalIr();
    const intent = defaultFigureIntent();
    const model = cnnClassifierGrammar.compileSemanticModel(ir, intent);
    const plan = cnnClassifierGrammar.compilePlan(model, intent);

    expect(cnnClassifierGrammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.7);
    expect(model.displayNodes.filter((node) => node.role === "tensor_stage")).toHaveLength(2);
    expect(model.sourceMappings.find((mapping) => mapping.displayId === "classifier-head")?.networkNodeIds).toEqual(expect.arrayContaining(["classifier"]));
    expect(plan.primitives.some((item) => item.kind === "residual_skip")).toBe(false);
    expect(plan.primitives.filter((item) => item.kind === "tensor_volume")).toHaveLength(3);
    expect(runVisualQa(plan).blocking).toEqual([]);
  });

  it("fails closed for an unresolved structure and propagates print/density intent into the preview plan", () => {
    const ir = structuralCnnCanonicalIr();
    const blocked = { ...ir, unresolved: [{ id: "merge", question: "Which merge?", severity: "blocking" as const, candidateValues: ["add"], evidenceIds: [] }] };
    const grayscale = { ...defaultFigureIntent(), printMode: "grayscale" as const, stylePreset: "publication_monochrome" as const, density: "detailed" as const };
    const compact = { ...defaultFigureIntent(), density: "compact" as const };

    expect(() => cnnClassifierGrammar.compileSemanticModel(blocked, grayscale)).toThrow(/unresolved/i);
    const detailedPlan = cnnClassifierGrammar.compilePlan(cnnClassifierGrammar.compileSemanticModel(ir, grayscale), grayscale);
    expect(detailedPlan).toMatchObject({ target: "preview", renderIntent: { density: "detailed", printMode: "grayscale" }, qaContract: { printMode: "grayscale" } });
    expect(cnnClassifierGrammar.compilePlan(cnnClassifierGrammar.compileSemanticModel(ir, compact), compact)).toMatchObject({
      renderIntent: { density: "compact", printMode: "color" },
    });
  });

  it("expands the deterministic page before a wider CNN can collide or overflow", () => {
    const base = structuralCnnCanonicalIr();
    const extraNodes = Array.from({ length: 8 }, (_, index) => ({ id: `extra-conv-${index}`, op: "conv2d" as const, inputTensorIds: [], outputTensorIds: [`extra-tensor-${index}`], confidence: 0.9, sourceEvidenceIds: ["fact-conv"], repeats: null }));
    const extraTensors = Array.from({ length: 8 }, (_, index) => ({ id: `extra-tensor-${index}`, name: `extra ${index}`, shape: [7, 7, 512], axes: ["height", "width", "channel"], semanticRole: "activation" as const, dtype: "float32", producerNodeId: `extra-conv-${index}`, consumerNodeIds: [] }));
    const wide = parseCanonicalNetworkIR({ ...base, nodes: [...base.nodes, ...extraNodes], tensors: [...base.tensors, ...extraTensors] });
    const intent = defaultFigureIntent();
    const plan = cnnClassifierGrammar.compilePlan(cnnClassifierGrammar.compileSemanticModel(wide, intent), intent);

    expect(plan.coordinateSpace.width).toBeGreaterThan(1200);
    expect(runVisualQa(plan).blocking).toEqual([]);
  });
});
