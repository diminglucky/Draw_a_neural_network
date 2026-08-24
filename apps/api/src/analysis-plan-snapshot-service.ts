import { FoundationError } from "./domain.js";
import type { AnalysisPlanSnapshot, AnalysisPlanSnapshotOwner } from "./analysis-plan-snapshot.js";
import type { AnalysisPlanSnapshotStore } from "./analysis-plan-snapshot-store.js";
import type { FigureAnalysisRecord } from "./figure-analysis.js";
import type { PublicComposableDagPublicationPlan } from "./figure-analysis-preview-service.js";
import type { FigureIntent } from "./figure-intent.js";
import type { CompilerManifest, PreviewArtifactHash, VisualQaResult } from "./plan-snapshot.js";

export type { AnalysisPlanSnapshotStore } from "./analysis-plan-snapshot-store.js";

export const AnalysisPlanSnapshotErrorCode = {
  OWNER_MISMATCH: "ANALYSIS_PLAN_SNAPSHOT_OWNER_MISMATCH",
  NOT_READY: "ANALYSIS_PLAN_SNAPSHOT_NOT_READY",
  INVALID: "ANALYSIS_PLAN_SNAPSHOT_INVALID",
  CONFLICT: "ANALYSIS_PLAN_SNAPSHOT_CONFLICT",
  STORE_FAILURE: "ANALYSIS_PLAN_SNAPSHOT_STORE_FAILURE",
  LEGACY_WRITE_RETIRED: "ANALYSIS_PLAN_SNAPSHOT_LEGACY_WRITE_RETIRED",
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

  async create(_input: CreateAnalysisPlanSnapshotRequest): Promise<AnalysisPlanSnapshot> {
    throw new AnalysisPlanSnapshotError(
      AnalysisPlanSnapshotErrorCode.LEGACY_WRITE_RETIRED,
      "Composable-DAG analysis snapshots are legacy read-only artifacts",
      409,
    );
  }

  get(owner: AnalysisPlanSnapshotOwner, analysisId: string, snapshotId: string): Promise<AnalysisPlanSnapshot | null> {
    return this.options.store.get(owner, analysisId, snapshotId);
  }
}
