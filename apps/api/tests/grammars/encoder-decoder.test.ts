import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../../src/figure-intent.js";
import { GrammarRegistry } from "../../src/grammar-registry.js";
import { cnnClassifierGrammar } from "../../src/grammars/cnn-classifier.js";
import { encoderDecoderGrammar } from "../../src/grammars/encoder-decoder.js";
import { residualBackboneGrammar } from "../../src/grammars/residual-backbone.js";
import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";
import { runVisualQa } from "../../src/visual-qa.js";
import { unetCanonicalIr } from "../fixtures/unet-canonical-ir.js";

describe("encoder-decoder grammar", () => {
  it("selects and compiles a U-Net as compact encoder, bottleneck, decoder, and Concat semantics", () => {
    const ir = unetCanonicalIr();
    const intent = defaultFigureIntent();
    const registry = new GrammarRegistry([cnnClassifierGrammar, encoderDecoderGrammar, residualBackboneGrammar]);
    const model = encoderDecoderGrammar.compileSemanticModel(ir, intent);
    const plan = encoderDecoderGrammar.compilePlan(model, intent);

    expect(registry.select(ir, intent).selected?.id).toBe("encoder-decoder");
    expect(encoderDecoderGrammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.7);
    expect(model.regions.map((region) => region.id)).toEqual(expect.arrayContaining(["encoder", "bottleneck", "decoder"]));
    expect(model.displayNodes.filter((node) => node.role === "tensor_stage")).toHaveLength(5);
    expect(model.displayRelations.filter((relation) => relation.role === "concat")).toHaveLength(2);
    expect(plan.primitives.some((item) => item.kind === "residual_skip")).toBe(false);
    expect(plan.relations.some((item) => item.kind === "residual_skip")).toBe(false);
    expect(plan.primitives.filter((item) => item.kind === "merge_marker")).toHaveLength(2);
    expect(plan.relations.filter((item) => item.kind === "merge_marker")).toHaveLength(2);
    for (const marker of plan.primitives.filter((item) => item.kind === "merge_marker")) {
      const mapping = plan.sourceMappings.find((item) => item.displayId === marker.sourceDisplayId);
      expect(mapping?.networkNodeIds.some((id) => id.startsWith("concat-"))).toBe(true);
      expect(mapping?.edgeIds.some((id) => id.includes("concat-"))).toBe(true);
    }
    expect(runVisualQa(plan).blocking).toEqual([]);
  });

  it("fails closed when U-Net cross-scale pairing cannot be verified", () => {
    const ir = unetCanonicalIr();
    const malformed = {
      ...ir,
      tensors: ir.tensors.map((tensor) => tensor.id === "up-2-tensor" ? { ...tensor, shape: [96, 96, 256] } : tensor),
    };

    expect(encoderDecoderGrammar.evaluate(malformed, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("scale") ]));
    expect(new GrammarRegistry([encoderDecoderGrammar]).select(malformed, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("derives encoder, bottleneck, and decoder order from directed tensor flow instead of the IR node array order", () => {
    const ir = unetCanonicalIr();
    const upsampleOne = ir.nodes.find((node) => node.id === "up-1")!;
    const reordered = { ...ir, nodes: [upsampleOne, ...ir.nodes.filter((node) => node.id !== "up-1")] };
    const model = encoderDecoderGrammar.compileSemanticModel(reordered, defaultFigureIntent());

    expect(model.sourceMappings.find((mapping) => mapping.displayId === "bottleneck-stage")?.networkNodeIds).toContain("bottleneck");
    expect(model.displayRelations.find((relation) => relation.id === "upsample-1")).toMatchObject({ sourceDisplayId: "bottleneck-stage", targetDisplayId: "decoder-stage-1" });
  });

  it("lays out every verified scale level distinctly instead of clamping deeper U-Nets into one row", () => {
    const intent = defaultFigureIntent();
    const base = encoderDecoderGrammar.compileSemanticModel(unetCanonicalIr(), intent);
    const encoderStage = { ...base.displayNodes.find((node) => node.id === "encoder-stage-2")!, id: "encoder-stage-3", label: "Encoder level 3", semantic: { stage: 3, scaleHeight: 32, scaleWidth: 32, repeatCount: 1 } };
    const decoderStage = { ...base.displayNodes.find((node) => node.id === "decoder-stage-1")!, id: "decoder-stage-3", label: "Decoder level 3", semantic: { stage: 7, scaleHeight: 32, scaleWidth: 32, repeatCount: 1, merge: "Concat" } };
    const model = {
      ...base,
      displayNodes: [...base.displayNodes.filter((node) => node.id !== "output-head"), encoderStage, decoderStage, base.displayNodes.find((node) => node.id === "output-head")!],
      sourceMappings: [
        ...base.sourceMappings,
        { ...base.sourceMappings.find((mapping) => mapping.displayId === "encoder-stage-2")!, displayId: "encoder-stage-3" },
        { ...base.sourceMappings.find((mapping) => mapping.displayId === "decoder-stage-1")!, displayId: "decoder-stage-3" },
      ],
    };
    const plan = encoderDecoderGrammar.compilePlan(model, intent);
    const encoderY = plan.primitives.filter((item) => item.sourceDisplayId.startsWith("encoder-stage-")).map((item) => item.bounds.y);
    const decoderY = plan.primitives.filter((item) => item.sourceDisplayId.startsWith("decoder-stage-") && item.kind === "block_frame").map((item) => item.bounds.y);

    expect(new Set(encoderY)).toHaveLength(3);
    expect(new Set(decoderY)).toHaveLength(3);
    expect(plan.coordinateSpace.height).toBeGreaterThan(730);
  });

  it("fails closed instead of choosing one of multiple independent input/output towers", () => {
    const ir = unetCanonicalIr();
    const multipleTowers = parseCanonicalNetworkIR({
      ...ir,
      nodes: [
        ...ir.nodes,
        { id: "aux-input", op: "input", inputTensorIds: [], outputTensorIds: ["aux-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
        { id: "aux-output", op: "output", inputTensorIds: ["aux-tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
      ],
      tensors: [...ir.tensors, { id: "aux-tensor", name: "auxiliary", shape: [1], axes: ["feature"], semanticRole: "input", dtype: "float32", producerNodeId: "aux-input", consumerNodeIds: ["aux-output"] }],
      edges: [...ir.edges, { id: "edge-auxiliary", sourceNodeId: "aux-input", targetNodeId: "aux-output", relation: "data", tensorIds: ["aux-tensor"], confidence: 1, evidenceIds: ["fact-output"] }],
    });

    expect(encoderDecoderGrammar.evaluate(multipleTowers, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("exactly one input"), expect.stringContaining("exactly one output")]));
    expect(new GrammarRegistry([encoderDecoderGrammar]).select(multipleTowers, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed rather than silently omitting a third Concat input branch", () => {
    const ir = unetCanonicalIr();
    const nonBinaryConcat = parseCanonicalNetworkIR({
      ...ir,
      nodes: [
        ...ir.nodes.map((node) => node.id === "concat-2" ? { ...node, inputTensorIds: [...node.inputTensorIds, "side-2-tensor"] } : node),
        { id: "side-2", op: "conv2d", inputTensorIds: ["enc-2-tensor"], outputTensorIds: ["side-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"], repeats: null },
      ],
      tensors: [
        ...ir.tensors.map((tensor) => tensor.id === "enc-2-tensor" ? { ...tensor, consumerNodeIds: [...tensor.consumerNodeIds, "side-2"] } : tensor),
        { id: "side-2-tensor", name: "side branch", shape: [128, 128, 32], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "side-2", consumerNodeIds: ["concat-2"] },
      ],
      edges: [
        ...ir.edges,
        { id: "edge-enc-2-side-2", sourceNodeId: "enc-2", targetNodeId: "side-2", relation: "data", tensorIds: ["enc-2-tensor"], confidence: 0.95, evidenceIds: ["fact-encoder"] },
        { id: "edge-side-2-concat-2", sourceNodeId: "side-2", targetNodeId: "concat-2", relation: "data", tensorIds: ["side-2-tensor"], confidence: 0.95, evidenceIds: ["fact-concat-2"] },
      ],
    });

    expect(encoderDecoderGrammar.evaluate(nonBinaryConcat, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("exactly two inputs")]));
    expect(new GrammarRegistry([encoderDecoderGrammar]).select(nonBinaryConcat, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when a connected off-path branch would be omitted from the binary U-Net figure", () => {
    const ir = unetCanonicalIr();
    const offPathBranch = parseCanonicalNetworkIR({
      ...ir,
      nodes: [
        ...ir.nodes,
        { id: "side-a", op: "conv2d", inputTensorIds: ["enc-2-tensor"], outputTensorIds: ["side-a-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"], repeats: null },
      ],
      tensors: [
        ...ir.tensors.map((tensor) => tensor.id === "enc-2-tensor" ? { ...tensor, consumerNodeIds: [...tensor.consumerNodeIds, "side-a"] } : tensor),
        { id: "side-a-tensor", name: "side a", shape: [128, 128, 32], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "side-a", consumerNodeIds: [] },
      ],
      edges: [
        ...ir.edges,
        { id: "edge-enc-2-side-a", sourceNodeId: "enc-2", targetNodeId: "side-a", relation: "data", tensorIds: ["enc-2-tensor"], confidence: 0.95, evidenceIds: ["fact-encoder"] },
      ],
    });

    expect(encoderDecoderGrammar.evaluate(offPathBranch, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("every data node")]));
    expect(new GrammarRegistry([encoderDecoderGrammar]).select(offPathBranch, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });
});
