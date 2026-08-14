import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSealedPlan } from "../src/visio-universal-protocol.js";
import { UniversalVisioWorkerClient } from "../src/visio-universal-worker-client.js";

const secret = "worker-secret";
const binding = { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", planId: "plan-1" };

function sealedPlan() {
  return createSealedPlan({
    ...binding,
    canonicalPlanBytes: Buffer.from('{"figureSet":"safe"}', "utf8"),
    expiresAt: "2026-08-14T01:00:00.000Z",
  }, secret);
}

describe("UniversalVisioWorkerClient", () => {
  it("passes only a verified sealed plan to the Worker and returns native/readback and renderer QA evidence", async () => {
    const client = new UniversalVisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [path.join(process.cwd(), "apps/api/tests/fixtures/universal-visio-worker-fake.mjs")],
      mode: "mock",
      sealedPlanSecret: secret,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    const result = await client.executeSealedPlan({ sealedPlan: sealedPlan(), binding });

    expect(result.artifacts.map((artifact) => artifact.format)).toEqual(["vsdx", "pdf", "png"]);
    expect(result.readback).toMatchObject({
      valid: true,
      nativeShapes: [{ semanticId: "node-input", nativeShapeId: "shape-1" }],
      connectorEndpoints: [{ semanticId: "edge-output", sourceNativeShapeId: "shape-1", targetNativeShapeId: "shape-2" }],
    });
    expect(result.rendererQa).toMatchObject({
      pageFit: { passed: true },
      textOverflow: { passed: true },
      fontFallback: { passed: true },
      connectorEndpoints: { passed: true },
      ocrReadability: { passed: true },
      geometryTolerance: { passed: true },
      officeContentSafety: { passed: true },
    });
  });

  it("rejects a tampered sealed plan before it attempts to start a Worker process", async () => {
    const client = new UniversalVisioWorkerClient({
      workerPath: "C:\\missing-worker.exe",
      mode: "mock",
      sealedPlanSecret: secret,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    await expect(client.executeSealedPlan({ sealedPlan: { ...sealedPlan(), signature: "tampered" }, binding })).rejects.toThrow(/signature/i);
  });

  it("does not expose a Worker-provided failure message to the caller", async () => {
    const client = new UniversalVisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [path.join(process.cwd(), "apps/api/tests/fixtures/universal-visio-worker-fake.mjs"), "--fail-with-path"],
      mode: "mock",
      sealedPlanSecret: secret,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    await expect(client.executeSealedPlan({ sealedPlan: sealedPlan(), binding })).rejects.toThrow("Universal Visio Worker rejected the sealed plan");
    await expect(client.executeSealedPlan({ sealedPlan: sealedPlan(), binding })).rejects.not.toThrow(/secret|C:\\internal/i);
  });
});
