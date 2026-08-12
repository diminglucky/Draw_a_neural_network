import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError, type Job, type JobStatus, type VisioJobCreationResult } from "./domain.js";
import type { FoundationStore } from "./store.js";

interface JobServiceOptions {
  store: FoundationStore;
  now?: () => Date;
}

export class JobService {
  private readonly now: () => Date;

  constructor(private readonly options: JobServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async create(input: { userId: string; deviceId: string; type: Job["type"]; input: unknown }): Promise<Job> {
    const job = this.newJob(input);
    await this.options.store.createJob(job);
    await this.audit(job, "job.created", {});
    return job;
  }

  async createVisioIdempotent(input: { userId: string; deviceId: string; input: unknown; idempotencyKey: string; requestHash: string }): Promise<VisioJobCreationResult> {
    const job = this.newJob({ userId: input.userId, deviceId: input.deviceId, type: "visio-export", input: input.input });
    const result = await this.options.store.createVisioJobIdempotent({ job, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash });
    if (!result.duplicate) await this.audit(job, "job.created", {});
    return result;
  }

  async get(id: string): Promise<Job | null> {
    return this.options.store.getJob(id);
  }

  async start(id: string): Promise<Job> {
    const job = await this.requireJob(id);
    this.assertStatus(job, ["queued"]);
    job.status = "running";
    job.startedAt = this.now().toISOString();
    await this.options.store.updateJob(job);
    await this.audit(job, "job.started", {});
    return job;
  }

  async succeed(id: string, output: unknown): Promise<Job> {
    const job = await this.requireJob(id);
    this.assertStatus(job, ["running"]);
    job.status = "succeeded";
    job.output = output;
    job.completedAt = this.now().toISOString();
    await this.options.store.updateJob(job);
    await this.audit(job, "job.succeeded", {});
    return job;
  }

  async fail(id: string, errorCode: Job["errorCode"], errorMessage: string): Promise<Job> {
    const job = await this.requireJob(id);
    this.assertStatus(job, ["queued", "running"]);
    job.status = "failed";
    job.errorCode = errorCode;
    job.errorMessage = errorMessage;
    job.completedAt = this.now().toISOString();
    await this.options.store.updateJob(job);
    await this.audit(job, "job.failed", { errorCode, errorMessage });
    return job;
  }

  async expire(id: string): Promise<Job> {
    const job = await this.requireJob(id);
    this.assertStatus(job, ["running"]);
    job.status = "expired";
    job.errorCode = ApiErrorCode.VISIO_EXECUTION_FAILED;
    job.errorMessage = "Visio Job expired because its Worker was not recoverable after API restart";
    job.completedAt = this.now().toISOString();
    await this.options.store.updateJob(job);
    await this.audit(job, "job.expired", { errorCode: job.errorCode });
    return job;
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.requireJob(id);
    this.assertStatus(job, ["queued", "running"]);
    job.status = "cancelled";
    job.completedAt = this.now().toISOString();
    await this.options.store.updateJob(job);
    await this.audit(job, "job.cancelled", {});
    return job;
  }

  private async requireJob(id: string): Promise<Job> {
    const job = await this.options.store.getJob(id);
    if (!job) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    return job;
  }

  private newJob(input: { userId: string; deviceId: string; type: Job["type"]; input: unknown }): Job {
    return {
      id: randomUUID(),
      userId: input.userId,
      deviceId: input.deviceId,
      type: input.type,
      status: "queued",
      input: input.input,
      output: null,
      errorCode: null,
      errorMessage: null,
      createdAt: this.now().toISOString(),
      startedAt: null,
      completedAt: null,
    };
  }

  private assertStatus(job: Job, allowed: JobStatus[]): void {
    if (!allowed.includes(job.status)) {
      throw new FoundationError(ApiErrorCode.JOB_NOT_CANCELLABLE, `Job cannot transition from ${job.status}`, 409);
    }
  }

  private async audit(job: Job, action: string, metadata: Record<string, unknown>): Promise<void> {
    await this.options.store.createAuditRecord({
      id: randomUUID(),
      actorType: "system",
      actorId: null,
      action,
      targetType: "job",
      targetId: job.id,
      reason: null,
      metadata: { userId: job.userId, deviceId: job.deviceId, ...metadata },
      createdAt: this.now().toISOString(),
    });
  }
}
