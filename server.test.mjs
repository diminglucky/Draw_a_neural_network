import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { createAgentService } from "./server.js";

const agentInput = { kind: "source", source: "class Net: pass", framework: "pytorch" };

function agentDependencies(overrides = {}) {
  return {
    inspect: async (input) => ({ source: input.source, evidence: [{ status: "confirmed" }] }),
    extract: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    normalize: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    plan: (value) => ({
      ir: value,
      figurePlan: {
        version: "figure-plan/v1",
        nodes: [{ id: "figure-input", sourceNodeId: "input" }],
        edges: [],
      },
    }),
    render: async (figurePlan) => ({ renderId: "render-1", figurePlan }),
    readback: async (_figurePlan, renderResult) => ({
      renderId: renderResult.renderId,
      nodes: [{ sourceNodeId: "input" }],
      connectors: [],
    }),
    ...overrides,
  };
}

async function requestAgent(service, path, body) {
  const request = new Request(`http://agent.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await service(request);
  return { response, payload: await response.json() };
}

test("agent service returns stage snapshots and preserves Figure Plan identity", async () => {
  const service = createAgentService({ dependencies: agentDependencies() });
  const { response, payload } = await requestAgent(service, "/api/agent-run", agentInput);
  assert.equal(response.status, 200);
  assert.equal(payload.status, "completed");
  assert.deepEqual(payload.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan", "render", "readback"]);
  assert.equal(payload.figurePlan.nodes[0].sourceNodeId, "input");
  assert.equal(payload.renderResult.figurePlan.nodes[0].sourceNodeId, "input");
});

test("default agent service extracts source topology before producing a Figure Plan", async () => {
  const service = createAgentService();
  const { response, payload } = await requestAgent(service, "/api/agent-run", {
    kind: "source",
    framework: "pytorch",
    source: `class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 8, 3)
        self.head = nn.Linear(8, 2)
    def forward(self, x):
        x = self.conv(x)
        return self.head(x)`,
  });
  assert.equal(response.status, 200);
  assert.ok(payload.ir.nodes.some((node) => node.op === "conv" || node.op === "Conv2d"));
  assert.ok(payload.figurePlan.nodes.some((node) => node.sourceNodeId));
  assert.equal(payload.figurePlan.validation.ok, true);
});

test("default agent service stops prompt-only input for confirmation without planning fabricated topology", async () => {
  const service = createAgentService();
  const { response, payload } = await requestAgent(service, "/api/agent-run", {
    kind: "prompt",
    prompt: "draw an LSTM with attention",
  });
  assert.equal(response.status, 200);
  assert.equal(payload.status, "needs-confirmation");
  assert.equal(payload.stage, "extract");
  assert.equal(payload.figurePlan, undefined);
  assert.ok(payload.diagnostics.some((item) => item.kind === "needs-confirmation"));
});

test("agent service exposes needs-confirmation and resumes confirmation into planning", async () => {
  const service = createAgentService({ dependencies: agentDependencies({
    extract: () => ({ nodes: [{ id: "opaque", family: "custom" }] }),
  }) });
  const created = await requestAgent(service, "/api/agent-run", agentInput);
  assert.equal(created.response.status, 200);
  assert.equal(created.payload.status, "needs-confirmation");
  assert.equal(created.payload.stage, "extract");

  const resumed = await requestAgent(service, `/api/agent-run/${created.payload.id}/resume`, {
    type: "confirm",
    value: { accepted: true },
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.status, "completed");
  assert.equal(resumed.payload.stage, "readback");
  assert.ok(resumed.payload.figurePlan);
  assert.equal(resumed.payload.id, created.payload.id);
});

test("agent service returns structured render-failed and readback-mismatch results", async () => {
  const renderService = createAgentService({ dependencies: agentDependencies({
    render: () => { throw new Error("renderer down"); },
  }) });
  const renderFailed = await requestAgent(renderService, "/api/agent-run", agentInput);
  assert.equal(renderFailed.response.status, 200);
  assert.equal(renderFailed.payload.status, "render-failed");
  assert.equal(renderFailed.payload.diagnostics[0].kind, "render-failed");

  const readbackService = createAgentService({ dependencies: agentDependencies({
    readback: () => ({ renderId: "wrong", nodes: [], connectors: [] }),
  }) });
  const mismatch = await requestAgent(readbackService, "/api/agent-run", agentInput);
  assert.equal(mismatch.response.status, 200);
  assert.equal(mismatch.payload.status, "readback-mismatch");
  assert.ok(mismatch.payload.diagnostics.every((item) => item.kind === "readback-mismatch"));
});

test("agent service bounds repair requests and rejects invalid run events", async () => {
  const service = createAgentService({ dependencies: agentDependencies() });
  const created = await requestAgent(service, "/api/agent-run", agentInput);
  const path = `/api/agent-run/${created.payload.id}/resume`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const repaired = await requestAgent(service, path, { type: "repair", value: { attempt } });
    assert.equal(repaired.response.status, 200);
    assert.equal(repaired.payload.status, "completed");
    assert.equal(repaired.payload.attempts.repair, attempt);
  }
  const exhausted = await requestAgent(service, path, { type: "repair", value: { attempt: 3 } });
  assert.equal(exhausted.response.status, 409);
  assert.equal(exhausted.payload.status, "repair-failed");
  assert.equal(exhausted.payload.code, "repair-limit-exceeded");

  const invalidEvent = await requestAgent(service, path, { type: "unknown" });
  assert.equal(invalidEvent.response.status, 400);
  assert.equal(invalidEvent.payload.code, "invalid-event");
});

test("agent service returns structured boundary errors", async () => {
  const service = createAgentService({ dependencies: agentDependencies() });
  const unknown = await requestAgent(service, "/api/agent-run/missing/resume", { type: "confirm" });
  assert.equal(unknown.response.status, 404);
  assert.deepEqual(unknown.payload, {
    status: "not_found",
    code: "run-not-found",
    message: "Agent run missing was not found.",
  });

  const invalidInput = await requestAgent(service, "/api/agent-run", { kind: "source" });
  assert.equal(invalidInput.response.status, 422);
  assert.equal(invalidInput.payload.code, "invalid-input");
});

test("static server serves browser ES modules with a JavaScript MIME type", async (t) => {
  const port = 4181;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/compound-module.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /javascript/);
});

test("/api/analyze-code routes arbitrary source through the Universal IR agent pipeline", async (t) => {
  const port = 4182;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/analyze-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "source",
      framework: "pytorch",
      source: `
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.custom = CustomCrossModalBlock(64)
    def forward(self, x):
        return self.custom(x)
`,
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "needs_confirmation");
  assert.ok(payload.ir.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.ok(payload.diagnostics.some((item) => item.kind === "unresolved-operator"));
  assert.ok(payload.figurePlan);
});

test("/api/analyze-code returns structured validation failures for invalid IR", async (t) => {
  const port = 4183;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/analyze-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "ir",
      ir: {
        nodes: [{ id: "only", op: "CustomOperator", family: "custom", confidence: 1.4 }],
        edges: [{ source: "only", target: "missing" }],
      },
    }),
  });

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.status, "invalid_input");
  assert.ok(payload.diagnostics.some((item) => item.kind === "missing-edge-endpoint"));
  assert.ok(payload.diagnostics.some((item) => item.kind === "invalid-confidence"));
});

test("/api/analyze-diagram does not return a fixed fallback without a vision provider", async (t) => {
  const port = 4184;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/analyze-diagram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: [{ name: "paper.png", dataUrl: "data:image/png;base64,AA==" }] }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "needs_external_vision");
  assert.equal(payload.readyForPreview, false);
  assert.equal(payload.nodes, undefined);
});

test("/api/render-visio produces an existing-document plan without creating a canvas", async (t) => {
  const port = 4185;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VISIO_DRY_RUN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/render-visio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentPath: "C:\\project\\existing.vsdx",
      pageName: "Page-1",
      previewPath: "C:\\project\\existing-preview.png",
      ir: {
        nodes: [
          { id: "input", op: "Input", family: "input", stage: 0 },
          { id: "custom", op: "CustomBlock", family: "custom", stage: 1, confidence: 0.5 },
        ],
        edges: [{ id: "flow", source: "input", target: "custom", type: "signal" }],
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "dry_run");
  assert.equal(payload.plan.createDocument, false);
  assert.equal(payload.plan.preserveExisting, true);
  assert.equal(payload.plan.documentPath, "C:\\project\\existing.vsdx");
  assert.equal(payload.plan.previewPath, "C:\\project\\existing-preview.png");
  assert.ok(payload.plan.shapes.some((shape) => shape.shapeData.sourceNodeId === "custom"));
  assert.deepEqual(
    payload.plan.shapes.filter((shape) => shape.parentNodeId === "").map((shape) => shape.shapeData.sourceNodeId).sort(),
    payload.plan.connectors.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]).filter(Boolean).filter((id, index, list) => list.indexOf(id) === index).sort(),
  );
});

test("/api/render-visio executes render and readback through one Agent Run", async () => {
  const calls = [];
  const service = createAgentService({
    dependencies: {
      inspect: async (input) => { calls.push("inspect"); return input; },
      extract: (input) => { calls.push("extract"); return { ...input, nodes: [{ id: "input", family: "input" }] }; },
      normalize: (value) => { calls.push("normalize"); return { ir: { ...value, nodes: [{ id: "input", family: "input" }] } }; },
      plan: (value) => {
        calls.push("plan");
        return { ir: value.ir, figurePlan: { version: "figure-plan/v1", renderId: "shared", nodes: [{ id: "f-input", sourceNodeId: "input" }], edges: [] } };
      },
      render: async (figurePlan) => { calls.push(["render", figurePlan.renderId]); return { renderId: "shared", figurePlan }; },
      readback: async (figurePlan, renderResult) => { calls.push(["readback", figurePlan.renderId, renderResult.figurePlan.renderId]); return { renderId: "shared", nodes: [{ sourceNodeId: "input" }], connectors: [] }; },
    },
  });

  const response = await service(new Request("http://agent.test/api/render-visio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentPath: "C:\\project\\existing.vsdx", ir: { nodes: [{ id: "input", family: "input" }] }, pageName: "Page-1" }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "rendered");
  assert.deepEqual(calls, ["inspect", "extract", "normalize", "plan", ["render", "shared"], ["readback", "shared", "shared"]]);
  assert.equal(payload.plan.shapes[0].shapeData.sourceNodeId, "input");
});

async function waitForServer(child, port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start within 3 seconds");
}
