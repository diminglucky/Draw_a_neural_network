import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FigureAnalysisBlockingQuestion, FigureAnalysisRecord } from "./figure-analysis.js";
import {
  buildComposableDagPublicationPlan,
  type ComposableDagPublicationBuildResult,
  type ComposableDagPublicationPlan,
  type ComposableDagVisualSpec,
} from "./composable-dag-publication-plan.js";
import type { ComposableFigureComponent, ComposableFigureConnection, FigureBounds } from "./composable-dag-figure-compiler.js";
import { runComposableDagVisualQa } from "./composable-dag-visual-qa.js";
import type { VisualQaResult } from "./plan-snapshot.js";
import { defaultFigureIntent, type FigureIntent } from "./figure-intent.js";
import { validateArchitectureIRv3 } from "./network-ir-v3.js";
import type { FoundationStore } from "./store.js";

export interface PublicComposableDagPublicationPlan {
  version: 1;
  graphId: string;
  compilerVersion: string;
  layoutVersion: string;
  intent: FigureIntent;
  pageBounds: FigureBounds;
  components: Array<Omit<ComposableFigureComponent, "evidenceIds">>;
  connections: Array<Omit<ComposableFigureConnection, "evidenceIds">>;
  visualSpec: ComposableDagVisualSpec;
  qaVersion: string;
}

export interface FigureAnalysisPreviewServiceOptions {
  store: Pick<FoundationStore, "getFigureAnalysis">;
  compilePublicationPlan?: (input: Parameters<typeof buildComposableDagPublicationPlan>[0]) => ComposableDagPublicationBuildResult;
  runVisualQa?: typeof runComposableDagVisualQa;
}

export type FigureAnalysisPreviewResponse =
  | {
      version: 3;
      kind: "candidate_structure";
      analysis: { id: string; status: "candidate_structure"; capabilityVersion: string };
      watermark: "STRUCTURE_PENDING_CONFIRMATION";
      blockingQuestion: FigureAnalysisBlockingQuestion;
      confirmedNodeIds: string[];
    }
  | {
      version: 3;
      kind: "publication_plan";
      analysis: { id: string; status: "ready_for_preview"; capabilityVersion: string };
      publicationPlan: PublicComposableDagPublicationPlan;
      visualQa: VisualQaResult;
    };

export class FigureAnalysisPreviewServiceImpl {
  private readonly compilePublicationPlan: NonNullable<FigureAnalysisPreviewServiceOptions["compilePublicationPlan"]>;
  private readonly runVisualQa: NonNullable<FigureAnalysisPreviewServiceOptions["runVisualQa"]>;

  constructor(private readonly options: FigureAnalysisPreviewServiceOptions) {
    this.compilePublicationPlan = options.compilePublicationPlan ?? buildComposableDagPublicationPlan;
    this.runVisualQa = options.runVisualQa ?? runComposableDagVisualQa;
  }

  async preview(userId: string, analysisId: string): Promise<FigureAnalysisPreviewResponse> {
    const record = await this.options.store.getFigureAnalysis(userId, analysisId);
    if (!record) throw notFoundPreviewError();
    if (record.status === "candidate_structure") return candidatePreview(record);
    if (record.status !== "ready_for_preview" || !record.architectureIR || !safeIdentifier(record.id)) {
      throw invalidPreviewError();
    }

    const validated = validateArchitectureIRv3(record.architectureIR, undefined, { renderReady: true });
    if (!validated.valid || !validated.ir) throw invalidPreviewError();

    const compiled = this.compilePublicationPlan({
      architectureIr: validated.ir,
      intent: defaultFigureIntent(),
      layoutSeed: `m2-4-${record.id}`,
    });
    if (compiled.status !== "ready") throw invalidPreviewError();

    const visualQa = this.runVisualQa(compiled.publicationPlan);
    if (visualQa.status !== "pass") throw invalidPreviewError();

    return {
      version: 3,
      kind: "publication_plan",
      analysis: {
        id: record.id,
        status: "ready_for_preview",
        capabilityVersion: record.capabilityVersion,
      },
      publicationPlan: publicPublicationPlan(compiled.publicationPlan),
      visualQa: structuredClone(visualQa),
    };
  }
}

function candidatePreview(record: FigureAnalysisRecord): FigureAnalysisPreviewResponse {
  if (!record.blockingQuestion) throw invalidPreviewError();
  return {
    version: 3,
    kind: "candidate_structure",
    analysis: {
      id: record.id,
      status: "candidate_structure",
      capabilityVersion: record.capabilityVersion,
    },
    watermark: "STRUCTURE_PENDING_CONFIRMATION",
    blockingQuestion: structuredClone(record.blockingQuestion),
    confirmedNodeIds: record.architectureIR?.nodes.filter((node) => node.evidenceIds.length > 0).map((node) => node.id) ?? [],
  };
}

function publicPublicationPlan(plan: ComposableDagPublicationPlan): PublicComposableDagPublicationPlan {
  return {
    version: 1,
    graphId: plan.dagPlan.graphId,
    compilerVersion: plan.dagPlan.compilerVersion,
    layoutVersion: plan.dagPlan.layoutVersion,
    intent: structuredClone(plan.dagPlan.intent),
    pageBounds: structuredClone(plan.dagPlan.pageBounds),
    components: plan.dagPlan.components.map(({ evidenceIds: _evidenceIds, ...component }) => structuredClone(component)),
    connections: plan.dagPlan.connections.map(({ evidenceIds: _evidenceIds, ...connection }) => structuredClone(connection)),
    visualSpec: structuredClone(plan.visualSpec),
    qaVersion: plan.qaVersion,
  };
}

function notFoundPreviewError(): FoundationError {
  return new FoundationError(ApiErrorCode.NOT_FOUND, "Figure analysis was not found", 404);
}

function invalidPreviewError(): FoundationError {
  return new FoundationError("FIGURE_ANALYSIS_PREVIEW_INVALID", "Figure analysis cannot produce a safe preview", 409);
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}
