import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VisioWorkerClient } from "../src/visio-worker-client.js";

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
    expect(result.readback).toEqual({ valid: true, shapeCount: 3, connectorCount: 2 });
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
});
