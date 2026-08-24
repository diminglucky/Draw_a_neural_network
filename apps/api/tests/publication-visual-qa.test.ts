import { describe, expect, it } from "vitest";
import { compileComposableDagFigure } from "../src/composable-dag-figure-compiler.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { applyPublicationVisualTokens, runPublicationVisualQa } from "../src/publication-visual-qa.js";
import { cnnGoldIr, tokenTransformerGoldIr } from "./fixtures/figure-component-gold-ir.js";

function compiled() {
  const result = compileComposableDagFigure({ architectureIr: cnnGoldIr(), intent: defaultFigureIntent(), layoutSeed: "visual-qa-seed" });
  if (result.status !== "ready") throw new Error("fixture must compile");
  return result.plan;
}

describe("Publication visual QA", () => {
  it("passes a deterministic v3 plan with publication tokens", () => {
    const first = applyPublicationVisualTokens(compiled());
    const second = applyPublicationVisualTokens(compiled());
    expect(first).toEqual(second);
    expect(runPublicationVisualQa(first)).toMatchObject({ status: "pass" });
  });

  it("rejects component overflow and collisions without mutating the plan", () => {
    const visualPlan = applyPublicationVisualTokens(compiled());
    const original = JSON.stringify(visualPlan);
    visualPlan.basePlan.components[1]!.bounds = { ...visualPlan.basePlan.components[0]!.bounds };
    visualPlan.basePlan.components[0]!.bounds.x = -1;
    const beforeQa = JSON.stringify(visualPlan);

    const result = runPublicationVisualQa(visualPlan);

    expect(result.status).toBe("fail");
    expect(result.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(expect.arrayContaining(["component-bounds", "component-collision"]));
    expect(JSON.stringify(visualPlan)).toBe(beforeQa);
    expect(JSON.stringify(visualPlan)).not.toBe(original);
  });

  it("rejects detached routes and routes through unrelated components", () => {
    const visualPlan = applyPublicationVisualTokens(compiled());
    const connection = visualPlan.basePlan.connections[0]!;
    connection.route = [{ x: 0, y: 0 }, ...connection.route.slice(1)];

    const result = runPublicationVisualQa(visualPlan);

    expect(result.status).toBe("fail");
    expect(result.checks.map((check) => check.id)).toContain("connection-endpoints");
  });

  it("rejects a route that crosses an unrelated component", () => {
    const visualPlan = applyPublicationVisualTokens(compiled());
    const [source, target, unrelated] = visualPlan.basePlan.components;
    const connection = visualPlan.basePlan.connections[0]!;
    if (!source || !target || !unrelated) throw new Error("fixture must contain components");
    connection.source = { nodeId: source.id, portId: source.outputPorts[0]!.id };
    connection.target = { nodeId: target.id, portId: target.inputPorts[0]!.id };
    connection.route = [
      { x: source.bounds.x + source.bounds.width, y: source.bounds.y + source.bounds.height / 2 },
      { x: unrelated.bounds.x + unrelated.bounds.width / 2, y: unrelated.bounds.y + unrelated.bounds.height / 2 },
      { x: target.bounds.x, y: target.bounds.y + target.bounds.height / 2 },
    ];

    const result = runPublicationVisualQa(visualPlan);

    expect(result.status).toBe("fail");
    expect(result.checks.map((check) => check.id)).toContain("route-clearance");
  });

  it("rejects missing source mappings and undersized components", () => {
    const visualPlan = applyPublicationVisualTokens(compiled());
    visualPlan.basePlan.sourceMappings = visualPlan.basePlan.sourceMappings.slice(1);
    visualPlan.basePlan.components[0]!.bounds.width = 1;
    visualPlan.basePlan.components[0]!.bounds.height = 1;

    const result = runPublicationVisualQa(visualPlan);

    expect(result.status).toBe("fail");
    expect(result.checks.map((check) => check.id)).toEqual(expect.arrayContaining(["source-mapping", "component-scale"]));
  });

  it("rejects a missing style token mapping", () => {
    const visualPlan = applyPublicationVisualTokens(compiled());
    visualPlan.componentStyles = visualPlan.componentStyles.slice(1);

    const result = runPublicationVisualQa(visualPlan);

    expect(result.status).toBe("fail");
    expect(result.checks.map((check) => check.id)).toContain("style-token-contract");
  });

  it("requires distinct grayscale relation tokens", () => {
    const ir = tokenTransformerGoldIr();
    const result = compileComposableDagFigure({ architectureIr: ir, intent: { ...defaultFigureIntent(), printMode: "grayscale", stylePreset: "publication_monochrome" }, layoutSeed: "visual-qa-seed" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const visualPlan = applyPublicationVisualTokens(result.plan);
    const firstConnection = visualPlan.basePlan.connections[0]!;
    visualPlan.basePlan.connections.push({ ...firstConnection, id: "condition-edge", transport: "condition", evidenceIds: [...firstConnection.evidenceIds] });
    visualPlan.connectionStyles.push({ semanticId: "condition-edge", styleTokenId: "connection-condition" });
    const dataToken = visualPlan.styleTokens.find((token) => token.id === "connection-data")!;
    const conditionToken = visualPlan.styleTokens.find((token) => token.id === "connection-condition")!;
    conditionToken.grayscaleValue = dataToken.grayscaleValue;
    conditionToken.linePattern = dataToken.linePattern;

    const qa = runPublicationVisualQa(visualPlan);

    expect(qa.status).toBe("fail");
    expect(qa.checks.map((check) => check.id)).toContain("grayscale-distinctiveness");
  });
});
