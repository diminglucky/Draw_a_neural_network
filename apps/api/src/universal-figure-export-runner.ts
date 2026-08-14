import type { UniversalFigureExportJob } from "./figure-export-service.js";
import type { SealedPlanBinding, SealedPlanEnvelope, UniversalVisioWorkerSuccessResponse } from "./visio-universal-protocol.js";

export interface UniversalSealedPlanExecutor {
  executeSealedPlan(input: { sealedPlan: SealedPlanEnvelope; binding: SealedPlanBinding }, options?: { signal?: AbortSignal }): Promise<UniversalVisioWorkerSuccessResponse>;
}
export interface UniversalFigureExportRunnerOptions {
  executor: UniversalSealedPlanExecutor;
}

export class UniversalFigureExportRunner {
  constructor(private readonly options: UniversalFigureExportRunnerOptions) {}

  async run(job: UniversalFigureExportJob, options: { signal?: AbortSignal } = {}): Promise<UniversalVisioWorkerSuccessResponse> {
    assertUniversalExportJob(job);
    return this.options.executor.executeSealedPlan({
      sealedPlan: job.input.sealedPlan,
      binding: {
        jobId: job.id,
        tenantId: job.tenantId,
        userId: job.userId,
        deviceId: job.deviceId,
        planId: job.planId,
      },
    }, options);
  }
}

function assertUniversalExportJob(job: UniversalFigureExportJob): void {
  if (job.type !== "universal-figure-export" || job.status !== "queued") throw new Error("universal job must be queued with type universal-figure-export");
  const input = job.input as unknown;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("universal job input is invalid");
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "planHash,planId,sealedPlan") throw new Error("universal job input contains unsafe fields");
  if (job.input.planId !== job.planId || job.input.planHash !== job.planHash) throw new Error("universal job input does not match job plan identity");
  const sealedPlan = job.input.sealedPlan;
  if (sealedPlan.jobId !== job.id || sealedPlan.tenantId !== job.tenantId || sealedPlan.userId !== job.userId || sealedPlan.deviceId !== job.deviceId || sealedPlan.planId !== job.planId || sealedPlan.planHash !== job.planHash) {
    throw new Error("universal job sealed plan does not match job identity");
  }
}
