import { ApiErrorCode, FoundationError, type Job } from "./domain.js";
import type { UniversalFigureExportJob } from "./figure-export-service.js";
import { JobService } from "./job-service.js";
import type { FoundationStore } from "./store.js";
import { UniversalFigureExportRunner, type UniversalSealedPlanExecutor } from "./universal-figure-export-runner.js";
import { verifySealedPlan, type SealedPlanEnvelope } from "./visio-universal-protocol.js";

export interface UniversalFigureExportJobRunnerOptions {
  store: FoundationStore;
  jobService: JobService;
  executor: UniversalSealedPlanExecutor;
  sealedPlanSecret: string;
  now?: () => Date;
}

export class UniversalFigureExportJobRunner {
  private readonly now: () => Date;
  private readonly runner: UniversalFigureExportRunner;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly options: UniversalFigureExportJobRunnerOptions) {
    if (!options.sealedPlanSecret.trim()) throw new Error("Universal figure export runner requires a sealed plan secret");
    this.now = options.now ?? (() => new Date());
    this.runner = new UniversalFigureExportRunner({ executor: options.executor });
  }

  async submit(jobId: string): Promise<void> {
    const job = await this.options.store.getJob(jobId);
    if (!job || job.type !== "universal-figure-export" || job.status !== "queued" || this.controllers.has(jobId)) return;
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    try {
      const universalJob = toUniversalJob(job);
      verifySealedPlan(universalJob.input.sealedPlan, bindingFor(universalJob), this.options.sealedPlanSecret, this.now());
      await this.options.jobService.start(jobId);
      const output = await this.runner.run(universalJob, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await this.options.jobService.succeed(jobId, output);
    } catch (error) {
      if (controller.signal.aborted) {
        const current = await this.options.store.getJob(jobId);
        if (current?.status === "queued" || current?.status === "running") await this.options.jobService.cancel(jobId);
        return;
      }
      const current = await this.options.store.getJob(jobId);
      if (current?.status === "queued" || current?.status === "running") {
        const code = error instanceof FoundationError ? error.code as ApiErrorCode : ApiErrorCode.VISIO_EXECUTION_FAILED;
        const message = error instanceof Error ? error.message : "Universal figure export failed";
        await this.options.jobService.fail(jobId, code, message);
      }
    } finally {
      this.controllers.delete(jobId);
    }
  }

  async recoverJobs(): Promise<void> {
    const jobs = await this.options.store.listJobs();
    await Promise.all(jobs.filter((job) => job.type === "universal-figure-export" && job.status === "running").map((job) => this.options.jobService.expire(job.id)));
    await Promise.all(jobs.filter((job) => job.type === "universal-figure-export" && job.status === "queued").map((job) => this.submit(job.id)));
  }

  async cancel(jobId: string): Promise<Job> {
    const active = this.controllers.get(jobId);
    if (active) active.abort();
    const job = await this.options.store.getJob(jobId);
    if (!job) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    if (job.status === "queued" || job.status === "running") return this.options.jobService.cancel(jobId);
    return job;
  }

  async close(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

function toUniversalJob(job: Job): UniversalFigureExportJob {
  const input = parseUniversalInput(job.input);
  return {
    id: job.id,
    tenantId: `tenant-${job.userId}`,
    userId: job.userId,
    deviceId: job.deviceId,
    type: "universal-figure-export",
    status: "queued",
    draftId: "server-created",
    revision: 1,
    planId: input.planId,
    planHash: input.planHash,
    input,
    createdAt: job.createdAt,
  };
}

function parseUniversalInput(value: unknown): { planId: string; planHash: string; sealedPlan: SealedPlanEnvelope } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("universal export Job input is invalid");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "planHash,planId,sealedPlan") throw new Error("universal export Job input contains unsafe fields");
  if (typeof input.planId !== "string" || typeof input.planHash !== "string" || !input.sealedPlan || typeof input.sealedPlan !== "object" || Array.isArray(input.sealedPlan)) throw new Error("universal export Job input is invalid");
  return { planId: input.planId, planHash: input.planHash, sealedPlan: input.sealedPlan as SealedPlanEnvelope };
}

function bindingFor(job: UniversalFigureExportJob) {
  return { jobId: job.id, tenantId: job.tenantId, userId: job.userId, deviceId: job.deviceId, planId: job.planId };
}
