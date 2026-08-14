import { describe, expect, it } from "vitest";
import { parsePublicationFigurePlanV2 } from "../src/publication-figure-plan-v2.js";
import { runVisualQa } from "../src/visual-qa.js";
import { createPlanFixture } from "./fixtures/publication-figure-plan-v2.js";

describe("Visual QA", () => {
  it("returns blocking diagnostics for overlapping labels and plan overflow without mutating the plan", () => {
    const value = createPlanFixture();
    value.annotations.push({ id: "overlap", targetId: "classifier", role: "detail", text: "Classifier", bounds: { x: 60, y: 325, width: 120, height: 20 }, fontSizePt: 9 });
    value.primitives[1].bounds.x = 960;
    const parsed = parsePublicationFigurePlanV2(value);
    const snapshot = JSON.stringify(parsed);

    const result = runVisualQa(parsed);

    expect(result.blocking.map((issue) => issue.code)).toEqual(expect.arrayContaining(["label-overlap", "page-overflow"]));
    expect(JSON.stringify(parsed)).toBe(snapshot);
  });

  it("requires visually distinguishable relation styles in grayscale mode", () => {
    const value = createPlanFixture();
    value.qaContract.printMode = "grayscale";
    value.relations.push({
      id: "residual", kind: "residual_skip", sourcePrimitiveId: "input", targetPrimitiveId: "classifier", route: [{ x: 100, y: 100 }, { x: 800, y: 100 }], semantic: {}, sourceDisplayId: "classifier-head", style: { stroke: "solid", tone: "dark", thickness: 1 },
    });

    const result = runVisualQa(parsePublicationFigurePlanV2(value));

    expect(result.blocking.map((issue) => issue.code)).toContain("grayscale-relation-style-collision");
  });

  it("rejects a relation route whose endpoints are detached from their declared primitives", () => {
    const value = createPlanFixture();
    value.relations[0].route = [{ x: 0, y: 0 }, { x: 1000, y: 600 }];

    const result = runVisualQa(parsePublicationFigurePlanV2(value));

    expect(result.blocking.map((issue) => issue.code)).toContain("relation-endpoint-detached");
  });
});
