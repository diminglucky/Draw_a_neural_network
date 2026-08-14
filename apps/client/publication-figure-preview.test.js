import { describe, expect, it } from "vitest";
import { previewSummary, renderPublicationFigurePreview } from "../../publication-figure-preview.js";

function previewFixture() {
  return {
    draft: { id: "draft-vgg", revision: 1, status: "ready_for_preview" },
    grammar: { id: "cnn-classifier", version: 1 },
    qa: { blocking: [], warnings: [{ code: "annotation-density", message: "Reduce labels", objectIds: ["note-1"] }] },
    plan: {
      version: 2,
      target: "preview",
      renderIntent: { density: "standard", printMode: "color" },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1000, height: 600 },
      regions: [{ id: "network", label: "Classifier backbone", role: "network", bounds: { x: 20, y: 30, width: 900, height: 330 } }],
      primitives: [
        { id: "input", kind: "tensor_volume", bounds: { x: 50, y: 140, width: 100, height: 160 }, semantic: {}, sourceDisplayId: "input" },
        { id: "stage", kind: "block_frame", bounds: { x: 350, y: 160, width: 150, height: 120 }, semantic: {}, sourceDisplayId: "stage" },
        { id: "skip", kind: "residual_skip", bounds: { x: 180, y: 85, width: 300, height: 65 }, semantic: {}, sourceDisplayId: "stage" },
        { id: "merge", kind: "merge_marker", bounds: { x: 550, y: 190, width: 34, height: 34 }, semantic: {}, sourceDisplayId: "stage" },
        { id: "track", kind: "annotation_track", bounds: { x: 40, y: 390, width: 800, height: 90 }, semantic: {}, sourceDisplayId: "stage" },
      ],
      relations: [{ id: "flow", kind: "flow_arrow", sourcePrimitiveId: "input", targetPrimitiveId: "stage", route: [{ x: 150, y: 220 }, { x: 350, y: 220 }], semantic: {}, sourceDisplayId: "input", style: { stroke: "solid", tone: "dark", thickness: 1 } }],
      annotations: [{ id: "note-1", targetId: "stage", role: "detail", text: "Conv block × 3", bounds: { x: 350, y: 405, width: 160, height: 18 }, fontSizePt: 9 }],
    },
  };
}

describe("Publication Figure browser preview", () => {
  it("renders fixed Plan v2 primitives and relations into a page-fit SVG", () => {
    const svg = renderPublicationFigurePreview(previewFixture());

    expect(svg).toMatch(/<svg class="publication-figure-svg(?:\s|")/);
    expect(svg).toContain('viewBox="0 0 1000 600"');
    expect(svg).toContain('publication-figure-tensor');
    expect(svg).toContain('publication-figure-block');
    expect(svg).toContain('publication-figure-residual');
    expect(svg).toContain('publication-figure-merge');
    expect(svg).toContain('marker-end="url(#publication-figure-arrow)"');
    expect(svg).toContain('Conv block × 3');
  });

  it("escapes text and exposes only a safe grammar and QA summary", () => {
    const preview = previewFixture();
    preview.plan.annotations[0].text = '<script>alert("x")</script>';

    expect(renderPublicationFigurePreview(preview)).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(previewSummary(preview)).toEqual({ grammar: "cnn-classifier v1", status: "ready_for_preview", warnings: ["Reduce labels"], blocking: [] });
  });

  it("fails closed for unsupported or malformed Plan geometry", () => {
    const unsupported = previewFixture();
    unsupported.plan.primitives[0].kind = "shell";
    expect(() => renderPublicationFigurePreview(unsupported)).toThrow(/primitive/i);

    const invalidBounds = previewFixture();
    invalidBounds.plan.coordinateSpace.width = Infinity;
    expect(() => renderPublicationFigurePreview(invalidBounds)).toThrow(/coordinate|dimension|finite/i);
  });
});
