import { describe, expect, it } from "vitest";
import { createFigureComponentGraph, FIGURE_COMPONENT_CONTRACT_VERSION } from "../src/figure-components.js";
import { cnnGoldIr, encoderDecoderGoldIr, residualGoldIr, tokenTransformerGoldIr } from "./fixtures/figure-component-gold-ir.js";

describe("Figure Component contract", () => {
  it.each([
    ["cnn", cnnGoldIr],
    ["residual", residualGoldIr],
    ["encoder-decoder", encoderDecoderGoldIr],
    ["token-transformer", tokenTransformerGoldIr],
  ])("maps the %s gold IR without presentation geometry", (_name, fixture) => {
    const result = createFigureComponentGraph(fixture());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.graph.version).toBe(FIGURE_COMPONENT_CONTRACT_VERSION);
    expect(result.graph.manifest.supportsLayout).toBe(false);
    expect(result.graph.manifest.supportsRendering).toBe(false);
    expect(result.graph.components.length).toBeGreaterThan(0);
    expect(result.graph.connections.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.graph)).not.toMatch(/\b(x|y|width|height|color|path|command)\b/i);
  });

  it("preserves module ownership, semantic ports, repeat semantics, and evidence IDs", () => {
    const source = cnnGoldIr();
    source.modules = [{ id: "module:stem", label: "Stem", parentModuleId: null, memberNodeIds: ["operator"], interfacePortIds: ["operator:in", "operator:out"], collapsedByDefault: true, evidenceIds: ["evidence-main"] }];
    const result = createFigureComponentGraph(source);
    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") return;
    expect(result.graph.components.find((component) => component.id === "operator")).toMatchObject({ parentModuleId: "module:stem", evidenceIds: ["evidence-main"] });
    expect(result.graph.connections[0]).toMatchObject({ source: { nodeId: "input", portId: "out" }, target: { nodeId: "operator", portId: "in" } });

    const transformer = createFigureComponentGraph(tokenTransformerGoldIr());
    expect(transformer).toMatchObject({ status: "ready" });
    if (transformer.status !== "ready") return;
    expect(transformer.graph.components.find((component) => component.id === "repeat")?.repeat).toEqual({ count: 12, unitNodeIds: ["attention"], expansionPolicy: "collapsed" });
  });

  it("returns an explicit unresolved result for blocking questions", () => {
    const source = cnnGoldIr();
    source.unresolved = [{ id: "question-1", severity: "blocking", conflictKey: "merge-kind", candidateValues: ["add", "concat"], evidenceFactIds: [], dependencyQuestionIds: [] }];
    expect(createFigureComponentGraph(source)).toEqual({
      status: "unresolved",
      graphId: "gold:cnn",
      unresolved: [{ code: "blocking-unresolved", message: "Architecture IR contains blocking question merge-kind", questionId: "question-1" }],
    });
  });

  it("rejects process nodes and feedback edges instead of inventing render semantics", () => {
    const source = cnnGoldIr();
    source.nodes[1] = { ...source.nodes[1]!, id: "process", kind: "process", semanticRole: "iterative", inputPorts: source.nodes[1]!.inputPorts, outputPorts: source.nodes[1]!.outputPorts, evidenceIds: ["evidence-main"] };
    source.edges = [
      { ...source.edges[0]!, target: { nodeId: "process", portId: "in" } },
      { ...source.edges[1]!, source: { nodeId: "process", portId: "out" } },
      { id: "feedback-process", source: { nodeId: "process", portId: "out" }, target: { nodeId: "process", portId: "in" }, transport: "feedback", evidenceIds: ["evidence-main"] },
    ];
    source.processes = [{ id: "process-loop", kind: "iterative", bodyNodeIds: ["process"], stateInputPortIds: ["process:in"], stateOutputPortIds: ["process:out"], iterationCount: "unknown", termination: "unknown" }];
    const result = createFigureComponentGraph(source);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;
    expect(result.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported-node-kind", nodeId: "process" }),
      expect.objectContaining({ code: "unsupported-edge-transport", edgeId: "feedback-process" }),
    ]));
  });
});
