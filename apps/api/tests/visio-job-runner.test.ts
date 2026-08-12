import { afterEach, describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { NotConnectedVisioExecutor, type VisioExecutor } from "../src/adapters.js";
import { JobService } from "../src/job-service.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { VisioJobRunner } from "../src/visio-job-runner.js";

const activeRunners: VisioJobRunner[] = [];

afterEach(async () => {
  await Promise.all(activeRunners.splice(0).map((runner) => runner.close()));
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met before timeout");
}

function createRunner(executor: VisioExecutor) {
  const store = new InMemoryFoundationStore();
  const jobService = new JobService({ store });
  const runner = new VisioJobRunner({ store, jobService, executor });
  activeRunners.push(runner);
  return { store, jobService, runner };
}

async function createQueuedJob(jobService: JobService) {
  return jobService.create({
    userId: "user-1",
    deviceId: "device-1",
    type: "visio-export",
    input: { diagram: { nodes: [], edges: [] } },
  });
}

function successfulExecutor(delayMs = 0): VisioExecutor {
  return {
    healthCheck: async () => ({ connected: true }),
    executeDiagram: async ({ jobId }) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { path: `C:\\exports\\${jobId}.vsdx`, readback: { valid: true, shapeCount: 1, connectorCount: 0 } };
    },
    readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
  };
}

function abortAwareExecutor(): VisioExecutor {
  return {
    healthCheck: async () => ({ connected: true }),
    executeDiagram: async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: ApiErrorCode.VISIO_EXECUTION_FAILED })), { once: true });
    }),
    readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
  };
}

describe("VisioJobRunner", () => {
  it("runs a submitted Job asynchronously and persists succeeded output", async () => {
    const { jobService, runner } = createRunner(successfulExecutor(10));
    const job = await createQueuedJob(jobService);

    runner.submit(job.id);

    await waitFor(async () => (await jobService.get(job.id))?.status === "succeeded");
    await expect(jobService.get(job.id)).resolves.toMatchObject({
      status: "succeeded",
      output: { readback: { valid: true, shapeCount: 1, connectorCount: 0 } },
    });
  });

  it("marks running Jobs expired during startup recovery", async () => {
    const { jobService, runner } = createRunner(new NotConnectedVisioExecutor());
    const job = await createQueuedJob(jobService);
    await jobService.start(job.id);

    await runner.recoverStaleJobs();

    await expect(jobService.get(job.id)).resolves.toMatchObject({ status: "expired" });
  });

  it("cancels a running Job without converting it into a Worker failure", async () => {
    const { jobService, runner } = createRunner(abortAwareExecutor());
    const job = await createQueuedJob(jobService);

    runner.submit(job.id);
    await waitFor(async () => (await jobService.get(job.id))?.status === "running");
    await runner.cancel(job.id);

    await expect(jobService.get(job.id)).resolves.toMatchObject({ status: "cancelled", errorCode: null });
  });
});
