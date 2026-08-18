import { createHash } from "node:crypto";
import { FoundationError } from "./domain.js";
import {
  canonicalJson,
  createAnalysisPlanSnapshot,
  type AnalysisPlanSnapshot,
  type AnalysisPlanSnapshotOwner,
  projectSafePublicationPlan,
} from "./analysis-plan-snapshot.js";
import type { AnalysisPlanSnapshotStore } from "./analysis-plan-snapshot-store.js";
import type { FigureAnalysisRecord } from "./figure-analysis.js";
import { projectPublicComposableDagPublicationPlan, type PublicComposableDagPublicationPlan } from "./figure-analysis-preview-service.js";
import type { FigureIntent } from "./figure-intent.js";
import { validateArchitectureIRv3 } from "./network-ir-v3.js";
import type { CompilerManifest, PreviewArtifactHash, VisualQaResult } from "./plan-snapshot.js";
import { buildComposableDagPublicationPlan } from "./composable-dag-publication-plan.js";
import { runComposableDagVisualQa } from "./composable-dag-visual-qa.js";

export type { AnalysisPlanSnapshotStore } from "./analysis-plan-snapshot-store.js";

export const AnalysisPlanSnapshotErrorCode = {
  OWNER_MISMATCH: "ANALYSIS_PLAN_SNAPSHOT_OWNER_MISMATCH",
  NOT_READY: "ANALYSIS_PLAN_SNAPSHOT_NOT_READY",
  INVALID: "ANALYSIS_PLAN_SNAPSHOT_INVALID",
} as const;

export class AnalysisPlanSnapshotError extends FoundationError {
  constructor(
    code: (typeof AnalysisPlanSnapshotErrorCode)[keyof typeof AnalysisPlanSnapshotErrorCode],
    message: string,
    statusCode: number,
  ) {
    super(code, message, statusCode);
    this.name = "AnalysisPlanSnapshotError";
  }
}

export interface CreateAnalysisPlanSnapshotRequest {
  owner: AnalysisPlanSnapshotOwner;
  analysis: FigureAnalysisRecord;
  figureIntent: FigureIntent;
  publicationPlan: PublicComposableDagPublicationPlan;
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  previewArtifactHashes: PreviewArtifactHash[];
  createdAt: string;
}

export interface AnalysisPlanSnapshotServiceOptions {
  store: AnalysisPlanSnapshotStore;
}

export class AnalysisPlanSnapshotService {
  constructor(private readonly options: AnalysisPlanSnapshotServiceOptions) {}

  async create(input: CreateAnalysisPlanSnapshotRequest): Promise<AnalysisPlanSnapshot> {
    if (input.analysis.userId !== input.owner.userId) throw new AnalysisPlanSnapshotError(AnalysisPlanSnapshotErrorCode.OWNER_MISMATCH, "AnalysisPlanSnapshot owner does not match the analysis owner", 403);
    if (input.analysis.status !== "ready_for_preview") throw new AnalysisPlanSnapshotError(AnalysisPlanSnapshotErrorCode.NOT_READY, "AnalysisPlanSnapshot requires a ready analysis", 409);
    if (!input.analysis.architectureIR) throw new AnalysisPlanSnapshotError(AnalysisPlanSnapshotErrorCode.INVALID, "AnalysisPlanSnapshot requires a validated architecture IR", 409);
    const validated = validateArchitectureIRv3(input.analysis.architectureIR, undefined, { renderReady: true });
    if (!validated.valid || !validated.ir) throw new AnalysisPlanSnapshotError(AnalysisPlanSnapshotErrorCode.INVALID, "AnalysisPlanSnapshot requires a render-ready architecture IR", 409);

    try {
      const compiled = buildComposableDagPublicationPlan({
        architectureIr: validated.ir,
        intent: input.figureIntent,
        layoutSeed: input.compilerManifest.layoutSeed,
      });
      if (compiled.status !== "ready") throw new Error("AnalysisPlanSnapshot cannot compile a publication plan from the validated analysis");
      const expectedPlan = projectSafePublicationPlan(projectPublicComposableDagPublicationPlan(compiled.publicationPlan));
      const submittedPlan = projectSafePublicationPlan(input.publicationPlan);
      if (
        input.compilerManifest.componentCompilerVersion !== expectedPlan.compilerVersion ||
        input.compilerManifest.layoutCompilerVersion !== expectedPlan.layoutVersion ||
        input.compilerManifest.styleTokenVersion !== expectedPlan.qaVersion
      ) {
        throw new Error("AnalysisPlanSnapshot compiler manifest versions are not bound to the compiled publication plan");
      }
      if (canonicalJson(submittedPlan) !== canonicalJson(expectedPlan)) {
        throw new Error("AnalysisPlanSnapshot publication plan is not bound to the validated analysis, intent, and layout seed");
      }
      const expectedVisualQa = runComposableDagVisualQa(compiled.publicationPlan);
      if (canonicalJson(input.visualQa) !== canonicalJson(expectedVisualQa)) {
        throw new Error("AnalysisPlanSnapshot visual QA is not bound to the compiled publication plan");
      }
      const snapshot = createAnalysisPlanSnapshot({
        tenantId: input.owner.tenantId,
        userId: input.owner.userId,
        analysisId: input.analysis.id,
        analysisStatus: input.analysis.status,
        architectureIrHash: digest(validated.ir),
        figureIntentHash: digest(input.figureIntent),
        publicationPlan: input.publicationPlan,
        compilerManifest: input.compilerManifest,
        visualQa: input.visualQa,
        previewArtifactHashes: input.previewArtifactHashes,
        createdAt: input.createdAt,
      });
      return await this.options.store.insert(input.owner, snapshot);
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      throw new AnalysisPlanSnapshotError(AnalysisPlanSnapshotErrorCode.INVALID, "AnalysisPlanSnapshot input is invalid", 400);
    }
  }

  get(owner: AnalysisPlanSnapshotOwner, analysisId: string, snapshotId: string): Promise<AnalysisPlanSnapshot | null> {
    return this.options.store.get(owner, analysisId, snapshotId);
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
