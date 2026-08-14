import { validateArchitectureIRv3, type ArchitectureIRv3, type UnresolvedQuestion } from "./network-ir-v3.js";
import {
  createPlanSnapshot,
  type CompilerManifest,
  type PlanSnapshot,
  type PreviewArtifactHash,
  type PublicationFigureSet,
  type VisualQaResult,
} from "./plan-snapshot.js";
import type { OwnerScope, PlanSnapshotStore } from "./plan-snapshot-store.js";

export interface UniversalFigureCompiler {
  compile(input: { architectureIR: ArchitectureIRv3; draftId: string; revision: number }): Promise<{
    figureSet: PublicationFigureSet;
    previewArtifactHashes: PreviewArtifactHash[];
    compilerManifest: CompilerManifest;
    visualQa: VisualQaResult;
  }>;
}
export interface UniversalPreviewServiceOptions {
  snapshotStore: PlanSnapshotStore;
  compiler: UniversalFigureCompiler;
  now?: () => string;
}
export interface CandidateStructurePreview {
  kind: "candidate_structure";
  watermark: "STRUCTURE_PENDING_CONFIRMATION";
  blockingQuestion: UnresolvedQuestion;
  confirmedNodeIds: string[];
}
export interface FullPublicationPreview {
  kind: "publication_figure_set";
  planId: string;
  planHash: string;
  previewArtifactHashes: PreviewArtifactHash[];
  figureSet: PublicationFigureSet;
}
export type UniversalPreview = CandidateStructurePreview | FullPublicationPreview;

export class UniversalPreviewService {
  private readonly now: () => string;

  constructor(private readonly options: UniversalPreviewServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async preview(input: { owner: OwnerScope; draftId: string; revision: number; architectureIR: unknown }): Promise<UniversalPreview> {
    const phaseOne = validateArchitectureIRv3(input.architectureIR);
    if (!phaseOne.valid || !phaseOne.ir) throw new Error(`Architecture IR v3 is invalid: ${phaseOne.issues.map((issue) => issue.code).join(", ")}`);
    const blockingQuestion = firstBlockingQuestion(phaseOne.ir.unresolved);
    if (blockingQuestion) {
      return {
        kind: "candidate_structure",
        watermark: "STRUCTURE_PENDING_CONFIRMATION",
        blockingQuestion,
        confirmedNodeIds: phaseOne.ir.nodes.filter((node) => node.evidenceIds.length > 0).map((node) => node.id),
      };
    }

    const renderReady = validateArchitectureIRv3(phaseOne.ir, undefined, { renderReady: true });
    if (!renderReady.valid || !renderReady.ir) throw new Error(`Architecture IR v3 is not render ready: ${renderReady.issues.map((issue) => issue.code).join(", ")}`);
    const compiled = await this.options.compiler.compile({ architectureIR: renderReady.ir, draftId: input.draftId, revision: input.revision });
    const snapshot = createPlanSnapshot({
      draftId: input.draftId,
      revision: input.revision,
      figureSet: compiled.figureSet,
      previewArtifactHashes: compiled.previewArtifactHashes,
      compilerManifest: compiled.compilerManifest,
      visualQa: compiled.visualQa,
      createdAt: this.now(),
    });
    await this.options.snapshotStore.insert(input.owner, snapshot);
    return fullPreview(snapshot);
  }
}

function firstBlockingQuestion(unresolved: UnresolvedQuestion[]): UnresolvedQuestion | null {
  return unresolved.filter((question) => question.severity === "blocking").sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

function fullPreview(snapshot: PlanSnapshot): FullPublicationPreview {
  return {
    kind: "publication_figure_set",
    planId: snapshot.planId,
    planHash: snapshot.canonicalPlanBytesSha256,
    previewArtifactHashes: snapshot.previewArtifactHashes,
    figureSet: snapshot.figureSet,
  };
}
