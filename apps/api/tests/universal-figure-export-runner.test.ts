import { describe, expect, it } from "vitest";
import type { UniversalFigureExportJob } from "../src/figure-export-service.js";
import { UniversalFigureExportRunner } from "../src/universal-figure-export-runner.js";
import { createSealedPlan } from "../src/visio-universal-protocol.js";

const secret = "runner-secret";
const binding = { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" };

function job(): UniversalFigureExportJob {
  const sealedPlan = createSealedPlan({
    ...binding,
    canonicalPlanBytes: Buffer.from('{"figureSet":"safe"}', "utf8"),
    expiresAt: "2026-08-14T01:00:00.000Z",
  }, secret);
  return {
    id: binding.jobId,
    tenantId: binding.tenantId,
    userId: binding.userId,
    deviceId: binding.deviceId,
    type: "universal-figure-export",
    status: "queued",
    draftId: "draft-1",
    revision: 1,
    planId: binding.planId,
    planHash: sealedPlan.planHash,
    input: { planId: binding.planId, planHash: sealedPlan.planHash, sealedPlan },
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("UniversalFigureExportRunner", () => {
  it("delegates a universal job to the sealed-plan executor without a legacy diagram", async () => {
    const calls: unknown[] = [];
    const runner = new UniversalFigureExportRunner({
      executor: {
        executeSealedPlan: async (input) => {
          calls.push(input);
          return {
            protocolVersion: 1,
            requestId: "request-1",
            jobId: input.binding.jobId,
            status: "succeeded",
            artifacts: [{ format: "vsdx", sha256: "a".repeat(64), bytes: 1 }, { format: "pdf", sha256: "b".repeat(64), bytes: 1 }, { format: "png", sha256: "c".repeat(64), bytes: 1 }],
            readback: { valid: true, shapeCount: 1, connectorCount: 0, nativeShapes: [{ semanticId: "node-1", nativeShapeId: "shape-1", shapeKind: "rectangle" }], connectorEndpoints: [] },
            rendererQa: {
              pageFit: { passed: true, detail: "ok" }, textOverflow: { passed: true, detail: "ok" }, fontFallback: { passed: true, detail: "ok" },
              connectorEndpoints: { passed: true, detail: "ok" }, ocrReadability: { passed: true, detail: "ok" }, geometryTolerance: { passed: true, detail: "ok" }, officeContentSafety: { passed: true, detail: "ok" },
            },
          };
        },
      },
    });
    const queued = job();

    await expect(runner.run(queued)).resolves.toMatchObject({ status: "succeeded", jobId: queued.id });
    expect(calls).toEqual([{ sealedPlan: queued.input.sealedPlan, binding }]);
    expect(JSON.stringify(calls)).not.toMatch(/diagram|outputPath|planUrl|planPath/i);
  });

  it("rejects a corrupted universal job input before it reaches the executor", async () => {
    let invoked = false;
    const runner = new UniversalFigureExportRunner({ executor: { executeSealedPlan: async () => { invoked = true; throw new Error("must not run"); } } });
    const corrupted = { ...job(), input: { ...job().input, diagram: {} } } as unknown as UniversalFigureExportJob;

    await expect(runner.run(corrupted)).rejects.toThrow(/diagram|universal job input|unsafe/i);
    expect(invoked).toBe(false);
  });
});
