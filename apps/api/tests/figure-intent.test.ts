import { describe, expect, it } from "vitest";
import { defaultFigureIntent, parseFigureIntent } from "../src/figure-intent.js";

describe("FigureIntent", () => {
  it("normalizes an omitted request to the preview-safe publication default", () => {
    expect(defaultFigureIntent()).toEqual({
      version: 1,
      purpose: "paper_overview",
      density: "standard",
      orientation: "auto",
      printMode: "color",
      emphasis: [],
      target: "preview",
      stylePreset: "publication_neutral",
    });
    expect(parseFigureIntent({})).toEqual(defaultFigureIntent());
  });

  it("normalizes the controlled style preset from the selected print mode", () => {
    expect(parseFigureIntent({ purpose: "architecture_detail", printMode: "grayscale" })).toEqual({
      ...defaultFigureIntent(),
      purpose: "architecture_detail",
      printMode: "grayscale",
      stylePreset: "publication_monochrome",
    });
    expect(parseFigureIntent({ printMode: "color", stylePreset: "publication_neutral" })).toMatchObject({
      stylePreset: "publication_neutral",
      target: "preview",
    });
  });

  it.each(["paper_overview", "architecture_detail", "module_detail", "presentation"] as const)("accepts the %s presentation purpose", (purpose) => {
    expect(parseFigureIntent({ purpose }).purpose).toBe(purpose);
  });

  it.each([
    ["unknown renderer", { purpose: "paper_overview", renderer: "visio-com" }],
    ["coordinates", { coordinates: { x: 1, y: 2 } }],
    ["output path", { outputPath: "C:\\temp\\figure.vsdx" }],
    ["primitive id", { primitiveId: "shape-1" }],
    ["non-preview target", { target: "new_visio_document" }],
    ["conflicting preset", { printMode: "grayscale", stylePreset: "publication_neutral" }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseFigureIntent(value)).toThrow();
  });
});
