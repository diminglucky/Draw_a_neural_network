import { describe, expect, it } from "vitest";
import { FigureDraftPreviewService } from "../src/figure-draft-preview-service.js";
import { FigureDraftService } from "../src/figure-draft-service.js";
import { GrammarRegistry } from "../src/grammar-registry.js";
import { cnnClassifierGrammar } from "../src/grammars/cnn-classifier.js";
import { parsePublicationFigurePlanV2 } from "../src/publication-figure-plan-v2.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { readyStructuralCnnFigureAnalysis, structuralCnnAnalysisNeedsConfirmation } from "./fixtures/structural-cnn-figure-analysis.js";

function services() {
  const store = new InMemoryFoundationStore();
  const drafts = new FigureDraftService({ store, createDraftId: () => "draft-structural", now: () => "2026-08-14T09:00:00.000Z" });
  return { store, drafts, preview: new FigureDraftPreviewService({ figureDraftService: drafts }) };
}

describe("FigureDraftPreviewService", () => {
  it("compiles a ready owner Draft into a non-persisted preview-only CNN plan", async () => {
    const { store, drafts, preview } = services();
    await drafts.createFromAnalysis("user-1", "conversation-1", readyStructuralCnnFigureAnalysis());

    const result = await preview.compile("user-1", "draft-structural");
    const persisted = await store.getFigureDraftRevision("user-1", "draft-structural", 1);

    expect(result).toMatchObject({
      draft: { id: "draft-structural", status: "ready_for_preview", revision: 1 },
      intent: { target: "preview", purpose: "paper_overview", orientation: "landscape" },
      grammar: { id: "cnn-classifier", version: 1 },
      plan: { version: 2, target: "preview", renderIntent: { density: "standard", printMode: "color" } },
    });
    expect(result.qa.blocking).toEqual([]);
    expect(JSON.stringify(persisted?.payload)).not.toContain("tensor_volume");
    expect(JSON.stringify(persisted?.payload)).not.toContain("publicationFigurePlan");
  });

  it("fails closed when the Draft still needs confirmation", async () => {
    const { drafts, preview } = services();
    await drafts.createFromAnalysis("user-1", "conversation-1", structuralCnnAnalysisNeedsConfirmation());

    await expect(preview.compile("user-1", "draft-structural")).rejects.toMatchObject({
      code: "FIGURE_PREVIEW_NOT_READY",
      statusCode: 409,
    });
  });

  it("does not reveal whether a Draft belongs to another user", async () => {
    const { drafts, preview } = services();
    await drafts.createFromAnalysis("owner", "conversation-1", readyStructuralCnnFigureAnalysis());

    await expect(preview.compile("other", "draft-structural")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  it("fails closed with safe selection evidence when no grammar reaches the threshold", async () => {
    const store = new InMemoryFoundationStore();
    const drafts = new FigureDraftService({ store, createDraftId: () => "draft-structural", now: () => "2026-08-14T09:00:00.000Z" });
    const preview = new FigureDraftPreviewService({
      figureDraftService: drafts,
      grammarRegistry: new GrammarRegistry([{
        id: "cnn-classifier",
        version: 1,
        evaluate: () => ({ grammarId: "cnn-classifier", score: 0.69, reasons: ["CNN topology is below the automatic-selection threshold"], blockers: [] }),
      }]),
    });
    await drafts.createFromAnalysis("user-1", "conversation-1", readyStructuralCnnFigureAnalysis());

    await expect(preview.compile("user-1", "draft-structural")).rejects.toMatchObject({
      code: "FIGURE_PREVIEW_SELECTION_REQUIRED",
      statusCode: 409,
      details: {
        candidates: [{ grammarId: "cnn-classifier", score: 0.69, reasons: ["CNN topology is below the automatic-selection threshold"], blockers: [] }],
        blockers: [],
      },
    });
    await preview.compile("user-1", "draft-structural").catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toMatch(/plan|semanticModel|sourceMappings|provider|locator|excerpt/i);
    });
  });

  it("returns non-blocking visual QA warnings produced by the selected grammar plan", async () => {
    const store = new InMemoryFoundationStore();
    const drafts = new FigureDraftService({ store, createDraftId: () => "draft-structural", now: () => "2026-08-14T09:00:00.000Z" });
    const warningGrammar = {
      ...cnnClassifierGrammar,
      compilePlan(model: Parameters<typeof cnnClassifierGrammar.compilePlan>[0], intent: Parameters<typeof cnnClassifierGrammar.compilePlan>[1]) {
        const plan = cnnClassifierGrammar.compilePlan(model, intent);
        return parsePublicationFigurePlanV2({
          ...plan,
          annotations: [
            ...plan.annotations,
            ...Array.from({ length: 120 }, (_, index) => ({
              id: `density-note-${index}`,
              targetId: plan.primitives[0]!.id,
              role: "detail",
              text: "n",
              bounds: { x: 1 + (index % 40) * 2, y: 1 + Math.floor(index / 40) * 2, width: 1, height: 1 },
              fontSizePt: 7,
            })),
          ],
        });
      },
    };
    const preview = new FigureDraftPreviewService({
      figureDraftService: drafts,
      grammarRegistry: new GrammarRegistry([warningGrammar]),
    });
    await drafts.createFromAnalysis("user-1", "conversation-1", readyStructuralCnnFigureAnalysis());

    const result = await preview.compile("user-1", "draft-structural");

    expect(result.qa.blocking).toEqual([]);
    expect(result.qa.warnings).toContainEqual(expect.objectContaining({ code: "annotation-density" }));
  });
});
