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
  maxConcurrentJobs?: number;
}

export class VisioJobRunner {
  private readonly active = new Map<string, ActiveVisioJob>();
  private readonly pending: string[] = [];
  private readonly pendingIds = new Set<string>();
  private readonly maxConcurrentJobs: number;
  private draining = false;
  private closing = false;

  constructor(private readonly options: VisioJobRunnerOptions) {
    this.maxConcurrentJobs = Math.max(1, Math.floor(options.maxConcurrentJobs ?? 1));
  }

  submit(jobId: string): void {
    if (this.closing || this.active.has(jobId) || this.pendingIds.has(jobId)) return;
    this.pending.push(jobId);
    this.pendingIds.add(jobId);
    this.scheduleDrain();
  }

  async cancel(jobId: string): Promise<Job> {
    const job = await this.requireJob(jobId);
    if (!this.isCancellable(job.status)) {
      throw new FoundationError(ApiErrorCode.JOB_NOT_CANCELLABLE, `Job cannot transition from ${job.status}`, 409);
    }

    const pendingIndex = this.pending.indexOf(jobId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
      this.pendingIds.delete(jobId);
      return this.options.jobService.cancel(jobId);
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

  async recoverJobs(): Promise<void> {
    const jobs = await this.options.store.listJobs();
    for (const job of jobs) {
      if (job.type !== "visio-export") continue;
      if (job.status === "running") await this.options.jobService.expire(job.id);
      if (job.status === "queued") this.submit(job.id);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.pending.length = 0;
    this.pendingIds.clear();
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map((active) => active.promise.catch(() => {})));
  }

  private scheduleDrain(): void {
    if (this.draining || this.closing) return;
    this.draining = true;
    void this.drain().finally(() => {
      this.draining = false;
      if (!this.closing && this.pending.length > 0 && this.active.size < this.maxConcurrentJobs) this.scheduleDrain();
    }).catch(() => {});
  }

  private async drain(): Promise<void> {
    while (!this.closing && this.active.size < this.maxConcurrentJobs && this.pending.length > 0) {
      const jobId = this.pending.shift();
      if (!jobId) continue;
      this.pendingIds.delete(jobId);
      const job = await this.options.store.getJob(jobId);
      if (!job || job.type !== "visio-export" || job.status !== "queued") continue;

      const controller = new AbortController();
      const promise = this.run(jobId, controller);
      this.active.set(jobId, { controller, promise });
      void promise.finally(() => {
        this.active.delete(jobId);
        this.scheduleDrain();
      }).catch(() => {});
    }
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
      const result = await this.executeTrustedDiagram(running, input, controller.signal);
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

  private async executeTrustedDiagram(job: Job, input: Record<string, unknown>, signal: AbortSignal): Promise<{ path: string; readback: Awaited<ReturnType<VisioExecutor["readback"]>> }> {
    return this.options.executor.executeDiagram({ jobId: job.id, diagram: input.diagram }, { signal });
  }

  private isCancellable(status: Job["status"]): boolean {
    return status === "queued" || status === "running";
  }
}
