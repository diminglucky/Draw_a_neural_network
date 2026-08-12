import { ApiErrorCode, FoundationError, type Job } from "./domain.js";
import type { VisioExecutor } from "./adapters.js";
import { JobService } from "./job-service.js";
import type { FoundationStore } from "./store.js";

interface ActiveVisioJob {
  controller: AbortController;
  promise: Promise<void>;
}

export interface VisioJobRunnerOptions {
  store: FoundationStore;
  jobService: JobService;
  executor: VisioExecutor;
}

export class VisioJobRunner {
  private readonly active = new Map<string, ActiveVisioJob>();
  private closing = false;

  constructor(private readonly options: VisioJobRunnerOptions) {}

  submit(jobId: string): void {
    if (this.closing || this.active.has(jobId)) return;
    const controller = new AbortController();
    const promise = this.run(jobId, controller);
    this.active.set(jobId, { controller, promise });
    void promise.catch(() => {});
  }

  async cancel(jobId: string): Promise<Job> {
    const job = await this.requireJob(jobId);
    if (!this.isCancellable(job.status)) {
      throw new FoundationError(ApiErrorCode.JOB_NOT_CANCELLABLE, `Job cannot transition from ${job.status}`, 409);
    }

    const active = this.active.get(jobId);
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => {});
      const latest = await this.requireJob(jobId);
      if (this.isCancellable(latest.status)) return this.options.jobService.cancel(jobId);
      return latest;
    }
    return this.options.jobService.cancel(jobId);
  }

  async recoverStaleJobs(): Promise<void> {
    const jobs = await this.options.store.listJobs();
    for (const job of jobs) {
      if (job.type === "visio-export" && job.status === "running") await this.options.jobService.expire(job.id);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map((active) => active.promise.catch(() => {})));
  }

  private async run(jobId: string, controller: AbortController): Promise<void> {
    try {
      const queued = await this.requireJob(jobId);
      if (queued.status !== "queued" || controller.signal.aborted) {
        if (controller.signal.aborted && queued.status === "queued") await this.options.jobService.cancel(jobId);
        return;
      }
      const running = await this.options.jobService.start(jobId);
      if (controller.signal.aborted) {
        await this.options.jobService.cancel(jobId);
        return;
      }
      const input = running.input && typeof running.input === "object" ? running.input as Record<string, unknown> : {};
      const result = await this.options.executor.executeDiagram({ jobId, diagram: input.diagram }, { signal: controller.signal });
      if (controller.signal.aborted) {
        const latest = await this.requireJob(jobId);
        if (latest.status === "running") await this.options.jobService.cancel(jobId);
        return;
      }
      await this.options.jobService.succeed(jobId, { path: result.path, readback: result.readback });
    } catch (error) {
      const latest = await this.options.store.getJob(jobId);
      if (!latest || !this.isCancellable(latest.status)) return;
      if (controller.signal.aborted) {
        await this.options.jobService.cancel(jobId);
        return;
      }
      const code = error instanceof FoundationError && Object.values(ApiErrorCode).includes(error.code as ApiErrorCode)
        ? error.code as ApiErrorCode
        : ApiErrorCode.VISIO_EXECUTION_FAILED;
      const message = error instanceof Error ? error.message : "Visio Worker execution failed";
      if (latest.status === "queued") await this.options.jobService.start(jobId);
      await this.options.jobService.fail(jobId, code, message);
    } finally {
      this.active.delete(jobId);
    }
  }

  private async requireJob(jobId: string): Promise<Job> {
    const job = await this.options.store.getJob(jobId);
    if (!job) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    return job;
  }

  private isCancellable(status: Job["status"]): boolean {
    return status === "queued" || status === "running";
  }
}
