import { describe, expect, it } from "vitest";
import { compileComposableDagFigure } from "../src/composable-dag-figure-compiler.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { cnnGoldIr, encoderDecoderGoldIr, residualGoldIr, tokenTransformerGoldIr } from "./fixtures/figure-component-gold-ir.js";

const input = (architectureIr: ReturnType<typeof cnnGoldIr>) => ({ architectureIr, intent: defaultFigureIntent(), layoutSeed: "fixture-seed" });

describe("ComposableDagFigureCompiler", () => {
  it.each([
    ["cnn", cnnGoldIr],
    ["residual", residualGoldIr],
    ["encoder-decoder", encoderDecoderGoldIr],
    ["token-transformer", tokenTransformerGoldIr],
  ])("compiles the %s semantic DAG without model-name branching", (_name, fixture) => {
    const result = compileComposableDagFigure(input(fixture()));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.components.length).toBeGreaterThan(0);
    expect(result.plan.connections.length).toBeGreaterThan(0);
    expect(result.plan.components.every((component) => component.bounds.width > 0 && component.bounds.height > 0)).toBe(true);
    expect(result.plan.connections.every((connection) => connection.route.length >= 2)).toBe(true);
  });

  it("is byte-deterministic for the same IR, intent, and seed", () => {
    const first = compileComposableDagFigure(input(encoderDecoderGoldIr()));
    const second = compileComposableDagFigure(input(encoderDecoderGoldIr()));
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps repeat semantics and evidence in the compiled plan", () => {
    const result = compileComposableDagFigure(input(tokenTransformerGoldIr()));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.components.find((component) => component.id === "repeat")).toMatchObject({ repeat: { count: 12, expansionPolicy: "collapsed" }, evidenceIds: ["evidence-repeat"] });
    expect(result.plan.components.find((component) => component.id === "attention")?.inputPorts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "query", semanticType: "query" }),
      expect.objectContaining({ id: "key", semanticType: "key" }),
      expect.objectContaining({ id: "value", semanticType: "value" }),
    ]));
    expect(result.plan.sourceMappings).toContainEqual({ semanticId: "attention", evidenceIds: ["evidence-attention"] });
  });

  it("fails closed for blocking unresolved IR", () => {
    const architectureIr = cnnGoldIr();
    architectureIr.unresolved = [{ id: "question-1", severity: "blocking", conflictKey: "merge-kind", candidateValues: ["add", "concat"], evidenceFactIds: [], dependencyQuestionIds: [] }];
    expect(compileComposableDagFigure(input(architectureIr))).toMatchObject({ status: "unresolved", unresolved: [{ code: "component-contract", componentId: undefined }] });
  });

  it("returns an explicit cycle result instead of inventing a layout", () => {
    const architectureIr = cnnGoldIr();
    architectureIr.edges = [
      ...architectureIr.edges,
      { id: "cycle", source: { nodeId: "operator", portId: "out" }, target: { nodeId: "operator", portId: "in" }, transport: "data", evidenceIds: ["evidence-main"] },
    ];
    const result = compileComposableDagFigure(input(architectureIr));
    expect(result).toMatchObject({ status: "unresolved", unresolved: [{ code: "cycle" }] });
  });

  it("does not read legacy Canvas geometry or emit renderer commands", () => {
    const result = compileComposableDagFigure(input(cnnGoldIr()));
    expect(JSON.stringify(result)).not.toMatch(/canvas|svg|png|visio|command|path/i);
  });
});
