import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { buildVisioWorkerArguments, normalizeVisioDiagram, VisioWorkerClient } from "../src/visio-worker-client.js";

const fixtureDiagram = {
  figure: { title: "CNN", stages: ["Input", "Output"] },
  nodes: [
    { id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 },
    { id: "output", type: "output", label: "Output", stage: 1, x: 700, y: 100, w: 100, h: 100 },
  ],
  edges: [{ id: "edge-1", source: "input", target: "output", type: "signal", route: { points: [{ x: 200, y: 150 }, { x: 700, y: 150 }] } }],
};

const outputRoot = path.join(process.cwd(), ".tmp-visio-client-test");
const aliasOutputRoot = path.join(process.env.TEMP ?? process.cwd(), "synapse-visio-client-alias-test");

afterEach(async () => {
  await rm(outputRoot, { recursive: true, force: true });
  await rm(aliasOutputRoot, { recursive: true, force: true });
});

describe("VisioWorkerClient", () => {
  it("passes live visibility and attach flags to the Worker process", () => {
    expect(buildVisioWorkerArguments({
      workerArgs: ["--diagnostic"],
      mode: "live",
      outputRoot: "C:\\exports",
      visible: true,
      attachToRunning: true,
    })).toEqual([
      "--diagnostic",
      "--mode", "live",
      "--output-root", "C:\\exports",
      "--visible",
      "--attach-to-running",
    ]);
  });

  it("preserves a validated Figure Plan for the Worker while retaining legacy nodes", () => {
    const diagram = {
      ...fixtureDiagram,
      figurePlan: {
        version: 1,
        coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1200, height: 800 },
        primitiveGroups: [{
          id: "block-1",
          kind: "feature-map-prism",
          primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
          bounds: { x: 35, y: 250, width: 70, height: 300 },
          extrusionDepthFu: 24,
          skewXFu: 18,
          skewYFu: -14,
          semantic: { sourceNodeId: "block-1", stage: 1, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 2, channelCount: 64, tensorShape: [224, 224, 64] },
        }],
      },
    };
    const normalized = normalizeVisioDiagram(diagram);
    expect(normalized.nodes).toHaveLength(2);
    expect(normalized.figurePlan?.primitiveGroups[0]).toMatchObject({
      id: "block-1",
      primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
    });
  });

  it("maps a successful Worker response to an export result", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });

    const result = await client.executeDiagram({ jobId: "job-client-1", diagram: fixtureDiagram });

    expect(result.path).toMatch(/job-client-1\.vsdx$/);
    expect(result.readback).toEqual({
      valid: true,
      shapeCount: 3,
      connectorCount: 2,
      expectedPrimitiveIds: ["block-1.front", "block-1.side", "block-1.top"],
      actualPrimitiveIds: ["block-1.front", "block-1.side", "block-1.top"],
      missingPrimitiveIds: [],
      expectedConnectorIds: ["edge-block-1-pool-1"],
      actualConnectorIds: ["edge-block-1-pool-1"],
      missingConnectorIds: [],
      shapeDataFailures: [],
    });
  });

  it("accepts a Worker long path when Node produced an equivalent Windows short path", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake-long-path.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot: aliasOutputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });

    await expect(client.executeDiagram({ jobId: "job-client-alias-1", diagram: fixtureDiagram })).resolves.toMatchObject({
      path: expect.stringMatching(/job-client-alias-1\.vsdx$/),
      readback: { valid: true, shapeCount: 1, connectorCount: 0 },
    });
  });

  it("aborts a running Worker when the signal is cancelled", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake-hang.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const startedAt = Date.now();
    const result = client.executeDiagram({ jobId: "job-client-abort-1", diagram: fixtureDiagram }, { signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    await expect(result).rejects.toMatchObject({
      code: ApiErrorCode.VISIO_EXECUTION_FAILED,
      details: { reason: "cancelled", jobId: "job-client-abort-1" },
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
