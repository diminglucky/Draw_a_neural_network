import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../../src/figure-intent.js";
import { multiBranchFusionGrammar } from "../../src/grammars/multi-branch-fusion.js";
import { GrammarRegistry } from "../../src/grammar-registry.js";
import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";
import { runVisualQa } from "../../src/visual-qa.js";
import { multiBranchFusionCanonicalIr } from "../fixtures/multi-branch-fusion-canonical-ir.js";

describe("multi-branch-fusion grammar", () => {
  it("compiles an evidence-backed dual token tower into a central cross-attention figure", () => {
    const ir = multiBranchFusionCanonicalIr();
    const intent = defaultFigureIntent();
    const model = multiBranchFusionGrammar.compileSemanticModel(ir, intent);
    const plan = multiBranchFusionGrammar.compilePlan(model, intent);

    expect(new GrammarRegistry([multiBranchFusionGrammar]).select(ir, intent).selected?.id).toBe("multi-branch-fusion");
    expect(multiBranchFusionGrammar.evaluate(ir, intent).score).toBeGreaterThanOrEqual(0.7);
    expect(model.regions.map((region) => region.id)).toEqual(["left-tower", "right-tower", "fusion", "head"]);
    expect(model.displayNodes.find((node) => node.id === "left-tower")?.label).toBe("Left token tower");
    expect(model.displayNodes.find((node) => node.id === "right-tower")?.label).toBe("Right token tower");
    expect(model.regions.find((region) => region.id === "left-tower")?.label).toBe("Left tower");
    expect(model.regions.find((region) => region.id === "right-tower")?.label).toBe("Right tower");
    expect(model.displayRelations.filter((relation) => relation.role === "attention")).toHaveLength(2);
    expect(model.sourceMappings.every((mapping) => mapping.networkNodeIds.length + mapping.tensorIds.length + mapping.edgeIds.length > 0)).toBe(true);
    expect(plan.grammar.id).toBe("multi-branch-fusion");
    expect(plan.primitives.some((primitive) => primitive.kind === "merge_marker")).toBe(true);
    expect(runVisualQa(plan).blocking).toEqual([]);
  });

  it("fails closed when the fusion edge evidence is absent", () => {
    const ir = multiBranchFusionCanonicalIr();
    const unevidenced = {
      ...ir,
      edges: ir.edges.map((edge) => edge.id === "edge-vision-fusion" ? { ...edge, evidenceIds: [] } : edge),
    };

    expect(multiBranchFusionGrammar.evaluate(unevidenced, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("fusion") ]));
    expect(new GrammarRegistry([multiBranchFusionGrammar]).select(unevidenced, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("fails closed when a third input tower is present", () => {
    const ir = multiBranchFusionCanonicalIr();
    const threeTowers = parseCanonicalNetworkIR({
      ...ir,
      tensors: [...ir.tensors, { id: "extra-tokens", name: "extra tokens", shape: [8, 768], axes: ["token", "feature"], semanticRole: "input", dtype: "float32", producerNodeId: "extra-input", consumerNodeIds: [] }],
      nodes: [...ir.nodes, { id: "extra-input", op: "input", inputTensorIds: [], outputTensorIds: ["extra-tokens"], confidence: 0.95, sourceEvidenceIds: ["fact-extra-input"], repeats: null }],
    });

    expect(multiBranchFusionGrammar.evaluate(threeTowers, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("exactly two input") ]));
    expect(new GrammarRegistry([multiBranchFusionGrammar]).select(threeTowers, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it("rejects a tower whose fusion representation is not token-feature data", () => {
    const ir = multiBranchFusionCanonicalIr();
    const malformed = parseCanonicalNetworkIR({
      ...ir,
      tensors: ir.tensors.map((tensor) => tensor.id === "vision-features" ? { ...tensor, axes: ["height", "width"] } : tensor),
    });

    expect(multiBranchFusionGrammar.evaluate(malformed, defaultFigureIntent()).blockers).toEqual(expect.arrayContaining([expect.stringContaining("token-feature") ]));
  });

  it.each([
    ["concat", "Concatenation"],
    ["add", "Addition"],
  ] as const)("supports a verified binary %s as a distinct two-tower fusion mode", (op, expectedLabel) => {
    const ir = multiBranchFusionCanonicalIr();
    const binaryFusion = parseCanonicalNetworkIR({
      ...ir,
      nodes: ir.nodes.map((node) => node.id === "cross-attention" ? { ...node, op } : node),
      edges: ir.edges.map((edge) => edge.targetNodeId === "cross-attention" ? { ...edge, relation: "data" as const } : edge),
    });
    const model = multiBranchFusionGrammar.compileSemanticModel(binaryFusion, defaultFigureIntent());

    expect(model.displayNodes.find((node) => node.id === "fusion")?.label).toContain(expectedLabel);
    expect(model.displayRelations.filter((relation) => relation.role === "attention")).toHaveLength(0);
    expect(runVisualQa(multiBranchFusionGrammar.compilePlan(model, defaultFigureIntent())).blocking).toEqual([]);
  });

  it.each([
    ["has a second fusion node", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({ ...ir, nodes: [...ir.nodes, { id: "second-fusion", op: "attention" as const, inputTensorIds: [], outputTensorIds: [], confidence: 0.95, sourceEvidenceIds: ["fact-second-fusion"], repeats: null }] })],
    ["contains a detached operator", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({ ...ir, nodes: [...ir.nodes, { id: "detached-dense", op: "dense" as const, inputTensorIds: [], outputTensorIds: [], confidence: 0.95, sourceEvidenceIds: ["fact-detached"], repeats: null }] })],
    ["adds a hidden side tensor to a tower", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({
      ...ir,
      tensors: [...ir.tensors, { id: "hidden-side", name: "hidden side", shape: [196, 768], axes: ["token", "feature"], semanticRole: "activation" as const, dtype: "float32", producerNodeId: "vision-embedding", consumerNodeIds: [] }],
      nodes: ir.nodes.map((node) => node.id === "vision-embedding" ? { ...node, outputTensorIds: [...node.outputTensorIds, "hidden-side"] } : node),
    })],
  ])("fails closed when the graph %s", (_label, mutate) => {
    const malformed = parseCanonicalNetworkIR(mutate(multiBranchFusionCanonicalIr()));

    expect(new GrammarRegistry([multiBranchFusionGrammar]).select(malformed, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });

  it.each([
    ["has no source evidence on the fusion node", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({ ...ir, nodes: ir.nodes.map((node) => node.id === "cross-attention" ? { ...node, sourceEvidenceIds: [] } : node) })],
    ["uses a residual edge inside a tower", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({ ...ir, edges: ir.edges.map((edge) => edge.id === "edge-vision-input" ? { ...edge, relation: "residual" as const } : edge) })],
    ["feeds the prediction tensor back into a tower", (ir: ReturnType<typeof multiBranchFusionCanonicalIr>) => ({
      ...ir,
      tensors: ir.tensors.map((tensor) => tensor.id === "logits" ? { ...tensor, consumerNodeIds: [...tensor.consumerNodeIds, "vision-embedding"] } : tensor),
      nodes: ir.nodes.map((node) => node.id === "vision-embedding" ? { ...node, inputTensorIds: [...node.inputTensorIds, "logits"] } : node),
      edges: [...ir.edges, { id: "edge-feedback", sourceNodeId: "prediction-head", targetNodeId: "vision-embedding", relation: "data" as const, tensorIds: ["logits"], confidence: 0.95, evidenceIds: ["fact-feedback"] }],
    })],
  ])("fails closed when the graph %s", (_label, mutate) => {
    const malformed = parseCanonicalNetworkIR(mutate(multiBranchFusionCanonicalIr()));

    expect(multiBranchFusionGrammar.evaluate(malformed, defaultFigureIntent()).blockers.length).toBeGreaterThan(0);
    expect(new GrammarRegistry([multiBranchFusionGrammar]).select(malformed, defaultFigureIntent())).toMatchObject({ status: "needs_confirmation", selected: null });
  });
});
