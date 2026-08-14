import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../../src/figure-intent.js";
import { GrammarRegistry } from "../../src/grammar-registry.js";
import { cnnClassifierGrammar } from "../../src/grammars/cnn-classifier.js";
import { encoderDecoderGrammar } from "../../src/grammars/encoder-decoder.js";
import { residualBackboneGrammar } from "../../src/grammars/residual-backbone.js";
import { tokenTransformerGrammar } from "../../src/grammars/token-transformer.js";
import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";
import { runVisualQa } from "../../src/visual-qa.js";
import { vitCanonicalIr } from "../fixtures/vit-canonical-ir.js";

describe("token-transformer grammar", () => {
  it("selects and compiles a ViT token encoder rather than a spatial CNN or U-Net", () => {
    const ir = vitCanonicalIr();
    const intent = defaultFigureIntent();
    const registry = new GrammarRegistry([cnnClassifierGrammar, encoderDecoderGrammar, residualBackboneGrammar, tokenTransformerGrammar]);
    const model = tokenTransformerGrammar.compileSemanticModel(ir, intent);
    const plan = tokenTransformerGrammar.compilePlan(model, intent);

    expect(registry.select(ir, intent).selected?.id).toBe("token-transformer");
    expect(tokenTransformerGrammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.7);
    expect(model.regions.map((region) => region.id)).toEqual(expect.arrayContaining(["tokenization", "transformer-encoder", "head"]));
    expect(model.displayNodes.find((node) => node.id === "transformer-encoder")?.semantic.repeatCount).toBe(12);
    expect(model.displayNodes.find((node) => node.id === "transformer-encoder")?.summary).toContain("tokens × features");
    expect(model.displayRelations.some((relation) => relation.role === "attention")).toBe(true);
    expect(plan.primitives.every((item) => ["block_frame", "annotation_track"].includes(item.kind))).toBe(true);
    expect(plan.primitives.some((item) => item.kind === "residual_skip" || item.kind === "merge_marker")).toBe(false);
    expect(plan.relations.some((item) => item.kind === "residual_skip" || item.kind === "merge_marker")).toBe(false);
    expect(model.sourceMappings.find((mapping) => mapping.displayId === "input-stage")?.edgeIds).toContain("edge-input-embedding");
    expect(model.sourceMappings.find((mapping) => mapping.displayId === "tokenization")?.edgeIds).toContain("edge-position-transformer");
    expect(plan.sourceMappings.find((mapping) => mapping.displayId === "transformer-encoder")?.networkNodeIds).toContain("transformer-encoder");
    expect(plan.sourceMappings.find((mapping) => mapping.displayId === "transformer-encoder")?.edgeIds).toContain("edge-transformer-classifier");
    expect(plan.annotations.find((annotation) => annotation.id === "label-tokenization")?.text).toBe("Tokenize · tokens × features");
    expect(plan.annotations.find((annotation) => annotation.id === "label-transformer-encoder")?.text).toBe("Transformer encoder ×12 · tokens × features");
    expect(plan.annotations.every((annotation) => annotation.text.length <= 48)).toBe(true);
    expect(runVisualQa(plan).blocking).toEqual([]);
  });

  it("fails closed when a transformer claim lacks token axes or a transformer block", () => {
    const ir = vitCanonicalIr();
    const noTokens = { ...ir, tensors: ir.tensors.map((tensor) => tensor.axes.includes("token") ? { ...tensor, axes: ["feature", "depth"] } : tensor) };
    const noTransformer = { ...ir, nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, op: "dense" as const, repeats: null } : node) };

    expect(tokenTransformerGrammar.evaluate(noTokens, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("token") ]));
    expect(tokenTransformerGrammar.evaluate(noTransformer, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("transformer") ]));
  });

  it.each(["cross_attention", "residual", "iteration"] as const)("fails closed when the token path contains a %s relation", (relation) => {
    const ir = vitCanonicalIr();
    const semanticRelation = parseCanonicalNetworkIR({
      ...ir,
      edges: [
        ...ir.edges,
        {
          ...ir.edges[2]!,
          id: `edge-${relation}`,
          relation,
        },
      ],
    });
    const registry = new GrammarRegistry([tokenTransformerGrammar]);

    expect(tokenTransformerGrammar.evaluate(semanticRelation, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("non-data") ]));
    expect(registry.select(semanticRelation, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed rather than omitting a second Transformer stage", () => {
    const ir = vitCanonicalIr();
    const twoTransformerStages = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.flatMap((node) => node.id === "transformer-encoder"
        ? [
          {
            ...node,
            id: "transformer-encoder-1",
            outputTensorIds: ["transformer-stage-1-tokens"],
            repeats: { count: 6, unitNodeIds: ["transformer-encoder-1"] },
          },
          {
            ...node,
            id: "transformer-encoder-2",
            inputTensorIds: ["transformer-stage-1-tokens"],
            outputTensorIds: ["encoded-tokens"],
            repeats: { count: 6, unitNodeIds: ["transformer-encoder-2"] },
          },
        ]
        : [node]),
      tensors: [
        ...ir.tensors.map((tensor) => {
          if (tensor.id === "tokens") return { ...tensor, consumerNodeIds: ["transformer-encoder-1"] };
          if (tensor.id === "encoded-tokens") return { ...tensor, producerNodeId: "transformer-encoder-2" };
          return tensor;
        }),
        {
          id: "transformer-stage-1-tokens",
          name: "first transformer tokens",
          shape: [197, 768],
          axes: ["token", "feature"],
          semanticRole: "activation",
          dtype: "float32",
          producerNodeId: "transformer-encoder-1",
          consumerNodeIds: ["transformer-encoder-2"],
        },
      ],
      edges: [
        ...ir.edges.map((edge) => {
          if (edge.id === "edge-position-transformer") return { ...edge, targetNodeId: "transformer-encoder-1" };
          if (edge.id === "edge-transformer-classifier") return { ...edge, sourceNodeId: "transformer-encoder-2" };
          return edge;
        }),
        {
          id: "edge-transformer-stages",
          sourceNodeId: "transformer-encoder-1",
          targetNodeId: "transformer-encoder-2",
          relation: "data",
          tensorIds: ["transformer-stage-1-tokens"],
          confidence: 0.95,
          evidenceIds: ["fact-transformer"],
        },
      ],
      groups: [{ ...ir.groups[0]!, nodeIds: ["transformer-encoder-1", "transformer-encoder-2"] }],
    });

    expect(tokenTransformerGrammar.evaluate(twoTransformerStages, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("exactly one repeated transformer block") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(twoTransformerStages, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when Transformer execution precedes tokenization", () => {
    const ir = vitCanonicalIr();
    const outOfOrder = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => {
        if (node.id === "transformer-encoder") return { ...node, inputTensorIds: ["image"], outputTensorIds: ["patch-tokens"] };
        if (node.id === "patch-embedding") return { ...node, inputTensorIds: ["patch-tokens"], outputTensorIds: ["tokens"] };
        if (node.id === "position-embedding") return { ...node, inputTensorIds: ["tokens"], outputTensorIds: ["encoded-tokens"] };
        return node;
      }),
      tensors: ir.tensors.map((tensor) => {
        if (tensor.id === "image") return { ...tensor, consumerNodeIds: ["transformer-encoder"] };
        if (tensor.id === "patch-tokens") return { ...tensor, producerNodeId: "transformer-encoder", consumerNodeIds: ["patch-embedding"] };
        if (tensor.id === "tokens") return { ...tensor, producerNodeId: "patch-embedding", consumerNodeIds: ["position-embedding"] };
        if (tensor.id === "encoded-tokens") return { ...tensor, producerNodeId: "position-embedding", consumerNodeIds: ["classifier"] };
        return tensor;
      }),
      edges: ir.edges.map((edge) => {
        if (edge.id === "edge-input-embedding") return { ...edge, targetNodeId: "transformer-encoder" };
        if (edge.id === "edge-patch-position") return { ...edge, sourceNodeId: "transformer-encoder", targetNodeId: "patch-embedding" };
        if (edge.id === "edge-position-transformer") return { ...edge, sourceNodeId: "patch-embedding", targetNodeId: "position-embedding" };
        if (edge.id === "edge-transformer-classifier") return { ...edge, sourceNodeId: "position-embedding" };
        return edge;
      }),
    });

    expect(tokenTransformerGrammar.evaluate(outOfOrder, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("tokenization must precede") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(outOfOrder, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when a feedback edge turns the apparent spine into a data cycle", () => {
    const ir = vitCanonicalIr();
    const cyclic = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => {
        if (node.id === "input") return { ...node, inputTensorIds: ["feedback"] };
        if (node.id === "output") return { ...node, outputTensorIds: ["feedback"] };
        return node;
      }),
      tensors: [...ir.tensors, { id: "feedback", name: "feedback", shape: [1], axes: ["feature"], semanticRole: "state", dtype: "float32", producerNodeId: "output", consumerNodeIds: ["input"] }],
      edges: [...ir.edges, { id: "edge-feedback", sourceNodeId: "output", targetNodeId: "input", relation: "data", tensorIds: ["feedback"], confidence: 0.95, evidenceIds: ["fact-output"] }],
    });

    expect(tokenTransformerGrammar.evaluate(cyclic, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("unambiguous linear token data path") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(cyclic, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when the Transformer consumes an unedged side tensor", () => {
    const ir = vitCanonicalIr();
    const hiddenInput = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, inputTensorIds: [...node.inputTensorIds, "image"] } : node),
      tensors: ir.tensors.map((tensor) => tensor.id === "image" ? { ...tensor, consumerNodeIds: [...tensor.consumerNodeIds, "transformer-encoder"] } : tensor),
    });

    expect(tokenTransformerGrammar.evaluate(hiddenInput, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("unambiguous linear token data path") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(hiddenInput, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when a data edge carries a second Transformer input tensor", () => {
    const ir = vitCanonicalIr();
    const hiddenEdgeTensor = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => {
        if (node.id === "position-embedding") return { ...node, outputTensorIds: [...node.outputTensorIds, "side-feature"] };
        if (node.id === "transformer-encoder") return { ...node, inputTensorIds: [...node.inputTensorIds, "side-feature"] };
        return node;
      }),
      tensors: [...ir.tensors, { id: "side-feature", name: "side feature", shape: [32], axes: ["feature"], semanticRole: "activation", dtype: "float32", producerNodeId: "position-embedding", consumerNodeIds: ["transformer-encoder"] }],
      edges: ir.edges.map((edge) => edge.id === "edge-position-transformer" ? { ...edge, tensorIds: [...edge.tensorIds, "side-feature"] } : edge),
    });

    expect(tokenTransformerGrammar.evaluate(hiddenEdgeTensor, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("unambiguous linear token data path") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(hiddenEdgeTensor, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it.each([
    ["is absent", (ir: ReturnType<typeof vitCanonicalIr>) => ({ ...ir, nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, repeats: null } : node) })],
    ["has count one", (ir: ReturnType<typeof vitCanonicalIr>) => ({ ...ir, nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, repeats: { count: 1, unitNodeIds: ["transformer-encoder"] } } : node) })],
    ["identifies an embedding as the repeated unit", (ir: ReturnType<typeof vitCanonicalIr>) => ({
      ...ir,
      nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, repeats: { count: 12, unitNodeIds: ["patch-embedding"] } } : node),
      groups: [{ ...ir.groups[0]!, nodeIds: ["patch-embedding", "transformer-encoder"] }],
    })],
  ])("fails closed when Transformer repeat metadata %s", (_label, mutate) => {
    const malformedRepeat = parseCanonicalNetworkIR(mutate(vitCanonicalIr()));

    expect(tokenTransformerGrammar.evaluate(malformedRepeat, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("repeat metadata") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(malformedRepeat, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when tokenization does not emit a token-feature representation", () => {
    const ir = vitCanonicalIr();
    const nonTokenEmbedding = parseCanonicalNetworkIR({
      ...ir,
      tensors: ir.tensors.map((tensor) => tensor.id === "tokens" ? { ...tensor, axes: ["feature", "depth"] } : tensor),
    });

    expect(tokenTransformerGrammar.evaluate(nonTokenEmbedding, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("tokenization output") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(nonTokenEmbedding, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when Transformer repeat metadata lacks group evidence", () => {
    const ir = vitCanonicalIr();
    const unevidencedRepeat = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => node.id === "transformer-encoder" ? { ...node, sourceEvidenceIds: [] } : node),
      groups: ir.groups.map((group) => ({ ...group, sourceEvidenceIds: [] })),
    });

    expect(tokenTransformerGrammar.evaluate(unevidencedRepeat, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("repeat metadata") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(unevidencedRepeat, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when a visible Transformer flow lacks edge evidence", () => {
    const ir = vitCanonicalIr();
    const unevidencedFlow = parseCanonicalNetworkIR({
      ...ir,
      edges: ir.edges.map((edge) => edge.id === "edge-position-transformer" ? { ...edge, evidenceIds: [] } : edge),
    });

    expect(tokenTransformerGrammar.evaluate(unevidencedFlow, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("visible flow") ]));
    expect(new GrammarRegistry([tokenTransformerGrammar]).select(unevidencedFlow, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("truncates a long figure title to fit the fixed title annotation", () => {
    const ir = parseCanonicalNetworkIR({ ...vitCanonicalIr(), figure: { id: "vit-long-title", title: "Vision Transformer architecture for high-resolution multi-modal representation learning with publication-ready semantic precision", description: null } });
    const plan = tokenTransformerGrammar.compilePlan(tokenTransformerGrammar.compileSemanticModel(ir, defaultFigureIntent()), defaultFigureIntent());
    const title = plan.annotations.find((annotation) => annotation.id === "title");

    expect(title?.text.length).toBeLessThanOrEqual(64);
    expect(title?.text.endsWith("…")).toBe(true);
    expect(runVisualQa(plan).blocking).toEqual([]);
  });
});
