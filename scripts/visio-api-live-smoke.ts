import path from "node:path";
import { VisioWorkerClient } from "../apps/api/src/visio-worker-client.js";

const outputRoot = path.join(process.env.TEMP ?? path.join(process.cwd(), ".tmp"), "synapse-visio-api-live-smoke");
const workerPath = path.resolve("workers/visio-worker/src/VisioWorker.Host/bin/Debug/net8.0-windows/VisioWorker.Host.exe");
const client = new VisioWorkerClient({
  workerPath,
  outputRoot,
  mode: "live",
  timeoutMs: 120_000,
});

const result = await client.executeDiagram({
  jobId: "api-live-smoke",
  diagram: {
    figure: { title: "API live smoke", stages: ["Input", "Output"] },
    nodes: [
      { id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 },
      { id: "output", type: "output", label: "Output", stage: 1, x: 700, y: 100, w: 100, h: 100 },
    ],
    edges: [{
      id: "edge-1",
      source: "input",
      target: "output",
      type: "signal",
      route: { points: [{ x: 200, y: 150 }, { x: 700, y: 150 }] },
    }],
  },
});

console.log(JSON.stringify({ workerPath, outputRoot, result }, null, 2));
