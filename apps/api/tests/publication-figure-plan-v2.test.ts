import { describe, expect, it } from "vitest";
import { parsePublicationFigurePlanV2, validatePublicationFigurePlanV2 } from "../src/publication-figure-plan-v2.js";
import { createPlanFixture } from "./fixtures/publication-figure-plan-v2.js";

describe("PublicationFigurePlan v2", () => {
  it("parses a bounded preview-only plan with mapped semantic primitives", () => {
    expect(parsePublicationFigurePlanV2(createPlanFixture())).toMatchObject({ version: 2, target: "preview", renderIntent: { density: "standard", printMode: "color" }, grammar: { id: "cnn-classifier" } });
  });

  it.each([
    ["unsupported primitive", (value: any) => { value.primitives[0].kind = "shell"; }],
    ["source-less primitive", (value: any) => { value.primitives[0].sourceDisplayId = null; }],
    ["non-finite geometry", (value: any) => { value.primitives[0].bounds.width = Infinity; }],
    ["duplicate primitive IDs", (value: any) => { value.primitives[1].id = "input"; }],
    ["disconnected relation endpoint", (value: any) => { value.relations[0].targetPrimitiveId = "missing"; }],
    ["excessive primitive count", (value: any) => { value.primitives = Array.from({ length: 601 }, (_, index) => ({ ...value.primitives[0], id: `shape-${index}` })); }],
    ["more primitives than its QA contract permits", (value: any) => { value.qaContract.maxPrimitiveCount = 1; }],
  ])("rejects %s", (_label, mutate) => {
    const value = createPlanFixture();
    mutate(value);
    expect(validatePublicationFigurePlanV2(value)).toMatchObject({ valid: false });
  });
});
