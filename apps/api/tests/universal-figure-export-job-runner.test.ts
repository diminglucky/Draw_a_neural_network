import { describe, expect, it } from "vitest";
import { createSealedPlan } from "../src/visio-universal-protocol.js";
import { UniversalFigureExportJobRunner } from "../src/universal-figure-export-job-runner.js";
import { JobService } from "../src/job-service.js";
import { InMemoryFoundationStore } from "../src/store.js";
import type { UniversalSealedPlanExecutor } from "../src/universal-figure-export-runner.js";

describe("UniversalFigureExportJobRunner", () => {
  it("runs only a sealed universal plan through the dedicated executor and records the core Job lifecycle", async () => {
    const store = new InMemoryFoundationStore();
    const jobs = new JobService({ store, now: () => new Date("2026-08-14T00:00:00.000Z") });
    const sealedPlan = createSealedPlan({
      jobId: "job-1",
      tenantId: "tenant-user-1",
      userId: "user-1",
      deviceId: "device-1",
      planId: "plan-1",
      canonicalPlanBytes: Buffer.from('{"figureSet":{},"compilerManifest":{}}', "utf8"),
      expiresAt: "2026-08-14T01:00:00.000Z",
    }, "sealed-secret");
    await store.createJob({
      id: "job-1",
      userId: "user-1",
      deviceId: "device-1",
      type: "universal-figure-export",
      status: "queued",
      input: { planId: "plan-1", planHash: sealedPlan.planHash, sealedPlan },
      output: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-14T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
    });
    let legacyExecuteDiagramCalls = 0;
    let sealedPlanCalls = 0;
    const executor: UniversalSealedPlanExecutor = {
      executeSealedPlan: async ({ sealedPlan: received, binding }) => {
        sealedPlanCalls += 1;
        expect(binding).toEqual({ jobId: "job-1", tenantId: "tenant-user-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" });
        expect(received).toEqual(sealedPlan);
        return {
          protocolVersion: 1,
          requestId: "request-1",
          jobId: "job-1",
          status: "succeeded",
          artifacts: [
            { format: "vsdx", sha256: "a".repeat(64), bytes: 1 },
            { format: "pdf", sha256: "b".repeat(64), bytes: 1 },
            { format: "png", sha256: "c".repeat(64), bytes: 1 },
          ],
          readback: { valid: true, shapeCount: 1, connectorCount: 0, nativeShapes: [], connectorEndpoints: [] },
          rendererQa: {
            pageFit: { passed: true, detail: "ok" }, textOverflow: { passed: true, detail: "ok" }, fontFallback: { passed: true, detail: "ok" },
            connectorEndpoints: { passed: true, detail: "ok" }, ocrReadability: { passed: true, detail: "ok" }, geometryTolerance: { passed: true, detail: "ok" }, officeContentSafety: { passed: true, detail: "ok" },
          },
        };
      },
    };
    const runner = new UniversalFigureExportJobRunner({
      store,
      jobService: jobs,
      executor,
      sealedPlanSecret: "sealed-secret",
      now: () => new Date("2026-08-14T00:01:00.000Z"),
    });

    await runner.submit("job-1");

    expect(sealedPlanCalls).toBe(1);
    expect(legacyExecuteDiagramCalls).toBe(0);
    const stored = await store.getJob("job-1");
    expect(stored).toMatchObject({ status: "succeeded" });
    expect(stored?.output).toMatchObject({ artifacts: expect.arrayContaining([expect.objectContaining({ format: "vsdx" })]) });
  });

  it("expires a Universal Job stranded in running state after restart", async () => {
    const store = new InMemoryFoundationStore();
    const jobs = new JobService({ store, now: () => new Date("2026-08-14T00:05:00.000Z") });
    await store.createJob({
      id: "job-running", userId: "user-1", deviceId: "device-1", type: "universal-figure-export", status: "running",
      input: { planId: "plan-1", planHash: "a".repeat(64), sealedPlan: {} }, output: null, errorCode: null, errorMessage: null,
      createdAt: "2026-08-14T00:00:00.000Z", startedAt: "2026-08-14T00:01:00.000Z", completedAt: null,
    });
    const runner = new UniversalFigureExportJobRunner({
      store, jobService: jobs, sealedPlanSecret: "sealed-secret",
      executor: { executeSealedPlan: async () => { throw new Error("must not execute stranded job"); } },
    });

    await runner.recoverJobs();

    await expect(store.getJob("job-running")).resolves.toMatchObject({ status: "expired", errorCode: "VISIO_EXECUTION_FAILED" });
  });
});
