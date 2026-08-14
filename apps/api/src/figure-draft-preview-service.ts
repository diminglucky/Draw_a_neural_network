import { ApiErrorCode, FoundationError, type FigureDraft } from "./domain.js";
import { type FigureIntent, parseFigureIntent } from "./figure-intent.js";
import { FigureDraftService } from "./figure-draft-service.js";
import { createPublicationGrammarRegistry, type FigureGrammar, type GrammarRegistry } from "./grammar-registry.js";
import type { FigureSemanticModel } from "./figure-semantic-model.js";
import type { PublicationFigurePlanV2 } from "./publication-figure-plan-v2.js";
import type { FigureDraftRevisionPayload } from "./figure-draft-payload.js";
import type { CanonicalNetworkIR } from "./network-ir-v2.js";
import { runVisualQa, type VisualQaResult } from "./visual-qa.js";

interface CompilableFigureGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

export interface FigureDraftPreviewServiceOptions {
  figureDraftService: FigureDraftService;
  grammarRegistry?: GrammarRegistry;
}

export interface FigureDraftPreview {
  draft: { id: string; revision: number; status: "ready_for_preview" };
  intent: FigureIntent;
  grammar: { id: string; version: number };
  semanticModel: FigureSemanticModel;
  plan: PublicationFigurePlanV2;
  qa: VisualQaResult;
}

export class FigureDraftPreviewService {
  private readonly registry: GrammarRegistry;

  constructor(private readonly options: FigureDraftPreviewServiceOptions) {
    this.registry = options.grammarRegistry ?? createPublicationGrammarRegistry();
  }

  async compile(userId: string, draftId: string): Promise<FigureDraftPreview> {
    const snapshot = await this.options.figureDraftService.get(userId, draftId);
    if (!snapshot) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft was not found", 404);
    if (snapshot.draft.status !== "ready_for_preview" || snapshot.revision.status !== "ready_for_preview") {
      throw new FoundationError("FIGURE_PREVIEW_NOT_READY", "Figure draft requires confirmation before a preview can be compiled", 409);
    }

    const payload = snapshot.revision.payload as FigureDraftRevisionPayload;
    const intent = intentFromPayload(payload);
    const selection = this.registry.select(payload.canonicalNetworkIR, intent);
    if (selection.status !== "selected" || !selection.selected) {
      throw new FoundationError(
        "FIGURE_PREVIEW_SELECTION_REQUIRED",
        "Figure structure requires clarification before a publication preview can be compiled",
        409,
        {
          candidates: selection.candidates.map((candidate) => ({ grammarId: candidate.grammarId, score: candidate.score, reasons: candidate.reasons, blockers: candidate.blockers })),
          blockers: selection.blockers,
        },
      );
    }
    if (!isCompilableGrammar(selection.selected)) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Selected figure grammar cannot compile a preview", 500);
    }

    const semanticModel = selection.selected.compileSemanticModel(payload.canonicalNetworkIR, intent);
    const plan = selection.selected.compilePlan(semanticModel, intent);
    const qa = runVisualQa(plan);
    return {
      draft: publicDraft(snapshot.draft),
      intent,
      grammar: { id: selection.selected.id, version: selection.selected.version },
      semanticModel,
      plan,
      qa,
    };
  }
}

function intentFromPayload(payload: FigureDraftRevisionPayload): FigureIntent {
  const constraints = payload.taskIntent.userConstraints;
  return parseFigureIntent({
    purpose: purposeForArtifact(payload.taskIntent.requestedArtifact),
    density: constraints.density,
    orientation: constraints.orientation,
    ...(constraints.printMode === "auto" ? {} : { printMode: constraints.printMode }),
  });
}

function purposeForArtifact(artifact: FigureDraftRevisionPayload["taskIntent"]["requestedArtifact"]): FigureIntent["purpose"] {
  if (artifact === "architecture_detail") return "architecture_detail";
  if (artifact === "module_detail") return "module_detail";
  return "paper_overview";
}

function isCompilableGrammar(value: FigureGrammar): value is CompilableFigureGrammar {
  return "compileSemanticModel" in value
    && typeof (value as { compileSemanticModel?: unknown }).compileSemanticModel === "function"
    && "compilePlan" in value
    && typeof (value as { compilePlan?: unknown }).compilePlan === "function";
}

function publicDraft(draft: FigureDraft): FigureDraftPreview["draft"] {
  return { id: draft.id, revision: draft.currentRevision, status: "ready_for_preview" };
}
