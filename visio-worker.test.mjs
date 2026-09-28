import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVisioWorkerClient } from "./visio-worker-client.mjs";

function minimalPlan() {
  return {
    version: "visio-diagram-plan/v1",
    nodes: [{
      id: "node-input",
      sourceNodeId: "input",
      sourceNodeIds: ["input"],
      label: "Input",
      x: 20,
      y: 20,
      w: 80,
      h: 60,
    }],
    edges: [],
    scene: {
      version: "laid-out-neural-scene/v1",
      units: "layout-unit",
      primitives: [{
        id: "primitive:input",
        role: "body",
        form: "band",
        sourceNodeIds: ["input"],
        sourceEdgeIds: [],
        bounds: { x: 20, y: 20, w: 80, h: 60 },
        anchors: { inputs: [], outputs: [] },
      }],
      connectors: [],
      groups: [],
      page: { x: 0, y: 0, width: 140, height: 110 },
    },
  };
}

test("long-lived Visio worker serializes render requests over one process", async () => {
  const worker = createVisioWorkerClient({ env: { VISIO_DRY_RUN: "1" }, timeoutMs: 5000 });
  try {
    assert.deepEqual(await worker.ping(), { status: "pong" });
    const first = await worker.render(minimalPlan(), { documentPath: "C:\\tmp\\worker.vsdx" });
    const second = await worker.render(minimalPlan(), { documentPath: "C:\\tmp\\worker.vsdx" });
    assert.equal(first.status, "dry_run");
    assert.equal(second.status, "dry_run");
    assert.equal(first.plan.createDocument, false);
    assert.equal(second.plan.documentPath, "C:\\tmp\\worker.vsdx");
  } finally {
    await worker.close();
  }
});

test("worker shutdown drains the persistent Visio session and kills the process tree", () => {
  const client = readFileSync("visio-worker-client.mjs", "utf8");
  const host = readFileSync("visio-worker-host.mjs", "utf8");
  const powershell = readFileSync("visio-bridge.ps1", "utf8");
  assert.match(client, /taskkill/);
  assert.match(client, /\/T/);
  assert.match(host, /shutdownPersistentSession/);
  assert.match(host, /SIGTERM/);
  assert.match(powershell, /SynapsePersistentVisio\.Quit\(\)/);
});
