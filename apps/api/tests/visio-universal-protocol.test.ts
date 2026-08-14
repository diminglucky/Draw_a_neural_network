import { describe, expect, it } from "vitest";
import { createSealedPlan, parseUniversalVisioWorkerRequest, verifySealedPlan } from "../src/visio-universal-protocol.js";

function sealedInput(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1",
    canonicalPlanBytes: Buffer.from('{"figureSet":"safe"}', "utf8"), expiresAt: "2026-08-14T00:15:00.000Z",
    ...overrides,
  };
}

describe("Universal Visio Worker protocol", () => {
  it("seals canonical plan bytes and verifies the exact job/owner binding", () => {
    const sealedPlan = createSealedPlan(sealedInput(), "worker-secret");
    expect(verifySealedPlan(sealedPlan, { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" }, "worker-secret", new Date("2026-08-14T00:00:00.000Z"))).toEqual(Buffer.from('{"figureSet":"safe"}', "utf8"));
  });

  it("rejects universal Worker requests containing diagram, paths, URLs, or output paths", () => {
    const sealedPlan = createSealedPlan(sealedInput(), "worker-secret");
    expect(() => parseUniversalVisioWorkerRequest({ protocolVersion: 1, requestId: "request-1", jobId: "job-1", mode: "mock", sealedPlan, diagram: {} })).toThrow(/unrecognized|diagram/i);
    expect(() => parseUniversalVisioWorkerRequest({ protocolVersion: 1, requestId: "request-1", jobId: "job-1", mode: "mock", sealedPlan, outputPath: "C:\\x.vsdx" })).toThrow(/unrecognized|outputPath/i);
    expect(() => parseUniversalVisioWorkerRequest({ protocolVersion: 1, requestId: "request-1", jobId: "job-1", mode: "mock", sealedPlan, planUrl: "https://example.test/plan" })).toThrow(/unrecognized|planUrl/i);
  });

  it("rejects tampered, expired, or incorrectly bound sealed plans", () => {
    const sealedPlan = createSealedPlan(sealedInput(), "worker-secret");
    expect(() => verifySealedPlan({ ...sealedPlan, planHash: "a".repeat(64) }, { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" }, "worker-secret", new Date("2026-08-14T00:00:00.000Z"))).toThrow(/signature|hash/i);
    expect(() => verifySealedPlan(sealedPlan, { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-2", planId: "plan-1" }, "worker-secret", new Date("2026-08-14T00:00:00.000Z"))).toThrow(/binding/i);
    expect(() => verifySealedPlan(sealedPlan, { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" }, "worker-secret", new Date("2026-08-14T00:16:00.000Z"))).toThrow(/expired/i);
  });
});
