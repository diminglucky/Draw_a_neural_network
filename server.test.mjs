import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { createAgentService } from "./server.js";
import { createAgentRun, runAgentPipeline } from "./agent-orchestrator.mjs";
import { createMemoryRunStore } from "./run-store.mjs";
import { createModelWorkspace } from "./model-workspace.mjs";

const agentInput = { kind: "source", source: "class Net: pass", framework: "pytorch" };

function minimalScene(sourceNodeId = "input") {
  return {
    version: "laid-out-neural-scene/v1",
    units: "layout-unit",
    primitives: [{
      id: `primitive:${sourceNodeId}`,
      role: "body",
      form: "band",
      category: "input",
      sourceNodeIds: [sourceNodeId],
      sourceEdgeIds: [],
      bounds: { x: 20, y: 20, w: 90, h: 54 },
      anchors: { inputs: [], outputs: [] },
    }],
    connectors: [],
    groups: [],
    page: { x: 0, y: 0, width: 160, height: 110 },
  };
}

function agentDependencies(overrides = {}) {
  return {
    inspect: async (input) => ({ source: input.source, evidence: [{ status: "confirmed" }] }),
    extract: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    normalize: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    plan: (value) => ({
      ir: value,
      visioDiagramPlan: {
        version: "visio-diagram-plan/v1",
        scene: minimalScene(),
        nodes: [{ id: "figure-input", sourceNodeId: "input" }],
        edges: [],
      },
    }),
    render: async (visioDiagramPlan) => ({ renderId: "render-1", visioDiagramPlan }),
    readback: async (_visioDiagramPlan, renderResult) => ({
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

test("agent service returns stage snapshots and preserves Visio Diagram Plan identity", async () => {
  const service = createAgentService({ dependencies: agentDependencies() });
  const { response, payload } = await requestAgent(service, "/api/agent-run", agentInput);
  assert.equal(response.status, 200);
  assert.equal(payload.status, "completed");
  assert.deepEqual(payload.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan", "render", "readback"]);
  assert.equal(payload.visioDiagramPlan.nodes[0].sourceNodeId, "input");
  assert.equal(payload.renderResult.visioDiagramPlan.nodes[0].sourceNodeId, "input");
});

test("agent service applies model workspace edit operations", async () => {
  const service = createAgentService();
  const workspace = createModelWorkspace({
    ir: {
      nodes: [{ id: "input", op: "Input", family: "input", label: "Input" }],
      edges: [],
    },
  });
  const { response, payload } = await requestAgent(service, "/api/model-workspace/apply", {
    workspace,
    operation: { type: "rename-node", nodeId: "input", label: "Image" },
  });

  assert.equal(response.status, 200);
  assert.equal(payload.status, "applied");
  assert.equal(payload.workspace.nodes[0].label, "Image");
  assert.equal(payload.ir.nodes[0].label, "Image");
});

test("agent service replans a model workspace after edits", async () => {
  const service = createAgentService();
  const workspace = createModelWorkspace({
    ir: {
      nodes: [
        { id: "input", op: "Input", family: "input", label: "Input" },
        { id: "conv", op: "Conv2d", family: "conv", label: "Conv", shape: { output: [32, 32, 16] } },
        { id: "output", op: "Output", family: "output", label: "Output" },
      ],
      edges: [
        { id: "e1", source: "input", target: "conv" },
        { id: "e2", source: "conv", target: "output" },
      ],
    },
  });
  const { response, payload } = await requestAgent(service, "/api/model-workspace/plan", { workspace });

  assert.equal(response.status, 200);
  assert.equal(payload.status, "planned");
  assert.equal(payload.workspace.version, "model-workspace/v1");
  assert.equal(payload.visioDiagramPlan.scene.version, "laid-out-neural-scene/v1");
});

test("workspace block edit replans and preserves Block IR", async () => {
  const service = createAgentService();
  const workspace = createModelWorkspace({
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input" },
        { id: "b1", family: "conv", op: "Conv2d" },
        { id: "b2", family: "conv", op: "Conv2d" },
        { id: "b3", family: "conv", op: "Conv2d" },
        { id: "output", family: "output", op: "Output" },
      ],
      edges: [
        { id: "e1", source: "input", target: "b1" },
        { id: "e2", source: "b1", target: "b2" },
        { id: "e3", source: "b2", target: "b3" },
        { id: "e4", source: "b3", target: "output" },
      ],
    },
    blockIr: {
      blocks: [{ id: "block:repeat-block:b1+b2+b3", kind: "repeat-block", nodeIds: ["b1", "b2", "b3"] }],
    },
  });
  const edited = await requestAgent(service, "/api/model-workspace/apply", {
    workspace,
    operation: {
      type: "set-block-expanded",
      blockId: "block:repeat-block:b1+b2+b3",
      expanded: true,
    },
  });
  assert.equal(edited.response.status, 200);

  const planned = await requestAgent(service, "/api/model-workspace/plan", {
    workspace: edited.payload.workspace,
  });
  assert.equal(planned.response.status, 200);
  assert.equal(planned.payload.status, "planned");
  assert.ok(planned.payload.blockIr.blocks.some((block) => block.kind === "repeat-block"));
  assert.equal(
    planned.payload.visioDiagramPlan.scene.primitives.some((primitive) => primitive.sourceNodeIds.length > 1 && primitive.blockKind === "repeat-block"),
    false,
  );
});

test("render-visio accepts an edited model workspace", async () => {
  const service = createAgentService({ dependencies: agentDependencies({ render: undefined, readback: undefined }) });
  const workspace = createModelWorkspace({
    ir: {
      nodes: [{ id: "input", op: "Input", family: "input", label: "Input" }],
      edges: [],
    },
  });
  const { response, payload } = await requestAgent(service, "/api/render-visio", {
    documentPath: "C:\\tmp\\model.vsdx",
    workspace,
  });

  assert.equal(response.status, 200);
  assert.equal(payload.plan.version, "visio-native-bridge/v1");
  assert.ok(payload.plan.shapes.some((shape) => shape.sourceNodeId === "input"));
});

test("render-visio applies editable workspace coordinates to the Scene plan", async () => {
  const service = createAgentService({
    dependencies: {
      render: async (visioDiagramPlan) => ({ status: "dry_run", plan: visioDiagramPlan }),
      readback: undefined,
    },
  });
  const workspace = createModelWorkspace({
    ir: {
      nodes: [
        { id: "input", op: "Input", family: "input", label: "Input" },
        { id: "output", op: "Output", family: "output", label: "Output" },
      ],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
  });
  workspace.nodes.find((node) => node.id === "output").ui = { x: 640, y: 240, w: 144, h: 72 };

  const { response, payload } = await requestAgent(service, "/api/render-visio", {
    documentPath: "C:\\tmp\\workspace-layout.vsdx",
    workspace,
  });

  assert.equal(response.status, 200);
  const output = payload.visioDiagramPlan.scene.primitives.find((primitive) => primitive.sourceNodeIds.includes("output"));
  assert.deepEqual(
    { x: output.bounds.x, y: output.bounds.y, w: output.bounds.w, h: output.bounds.h },
    { x: 640, y: 240, w: 144, h: 72 },
  );
});

test("render-visio restores repeat-block expanded state from workspace overrides", async () => {
  const service = createAgentService({
    dependencies: {
      render: async (visioDiagramPlan) => ({ status: "dry_run", plan: visioDiagramPlan }),
      readback: undefined,
    },
  });
  const workspace = createModelWorkspace({
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input" },
        { id: "b1", family: "conv", op: "Conv2d" },
        { id: "b2", family: "conv", op: "Conv2d" },
        { id: "b3", family: "conv", op: "Conv2d" },
        { id: "output", family: "output", op: "Output" },
      ],
      edges: [
        { id: "e1", source: "input", target: "b1" },
        { id: "e2", source: "b1", target: "b2" },
        { id: "e3", source: "b2", target: "b3" },
        { id: "e4", source: "b3", target: "output" },
      ],
    },
    blockIr: {
      blocks: [{ id: "block:repeat-block:b1+b2+b3", kind: "repeat-block", nodeIds: ["b1", "b2", "b3"] }],
    },
    blockOverrides: {
      "block:repeat-block:b1+b2+b3": { expanded: true, locked: false },
    },
  });

  const { response, payload } = await requestAgent(service, "/api/render-visio", {
    documentPath: "C:\\tmp\\repeat-expanded.vsdx",
    workspace,
  });
  assert.equal(response.status, 200);
  assert.equal(payload.visioDiagramPlan.scene.primitives.some((primitive) => primitive.sourceNodeIds.length > 1 && primitive.blockKind === "repeat-block"), false);
  assert.ok(payload.visioDiagramPlan.scene.primitives.some((primitive) => primitive.sourceNodeIds.includes("b1")));
  assert.ok(payload.visioDiagramPlan.scene.primitives.some((primitive) => primitive.sourceNodeIds.includes("b2")));
  assert.ok(payload.visioDiagramPlan.scene.primitives.some((primitive) => primitive.sourceNodeIds.includes("b3")));
});

test("default agent service extracts source topology before producing a Visio Diagram Plan", async () => {
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
  assert.ok(payload.visioDiagramPlan.nodes.some((node) => node.sourceNodeId));
  assert.equal(payload.visioDiagramPlan.validation.ok, true);
});

test("default Agent Run reports plan_ready until Visio execution is configured", async () => {
  const service = createAgentService();
  const { response, payload } = await requestAgent(service, "/api/agent-run", {
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", op: "Input", family: "input", confidence: 1, evidence: [{ kind: "fixture" }] },
        { id: "output", op: "Output", family: "output", confidence: 1, evidence: [{ kind: "fixture" }] },
      ],
      edges: [{ id: "flow", source: "input", target: "output", confidence: 1, evidence: [{ kind: "fixture" }] }],
    },
  });

  assert.equal(response.status, 200);
  assert.equal(payload.status, "plan_ready");
  assert.equal(payload.stage, "plan");
  assert.equal(payload.renderResult, undefined);
  assert.deepEqual(payload.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan"]);
});

test("Agent Run stops ambiguous architecture names at grounded resolver candidates", async () => {
  const service = createAgentService({ dependencies: { resolver: { registry: [
    { id: "one", names: ["Detector One", "detector"], repository: "https://example.test/model", revision: "a".repeat(40) },
    { id: "two", names: ["Detector Two", "detector"], repository: "https://example.test/model", revision: "b".repeat(40) },
  ] } } });
  const { response, payload } = await requestAgent(service, "/api/agent-run", { kind: "prompt", prompt: "draw detector" });
  assert.equal(response.status, 200);
  assert.equal(payload.status, "needs-confirmation");
  assert.equal(payload.extract.version, "architecture-evidence-package/v1");
  assert.equal(payload.extract.graph.nodes.length, 0);
  assert.equal(payload.visioDiagramPlan, undefined);
});

test("Agent Run imports pinned generic configuration before planning", async () => {
  const service = createAgentService();
  const { response, payload } = await requestAgent(service, "/api/agent-run", {
    kind: "config",
    config: { pipeline: [[-1, 1, "InputAdapter", {}], [-1, 1, "NovelOperator", {}]] },
    revision: "abc1234",
    sourceId: "config-fixture",
    metadata: { uri: "file:///model.yaml", authority: 4 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(payload.ir.nodes.map((node) => node.op), ["InputAdapter", "NovelOperator"]);
  assert.equal(payload.extract.version, "architecture-evidence-package/v1");
});

test("Agent Run injects an existing Visio document into render and readback", async () => {
  const calls = [];
  const service = createAgentService({ dependencies: agentDependencies({
    render: async (visioDiagramPlan, run) => {
      calls.push(["render", run.visioOptions?.documentPath]);
      return { renderId: "visio-render", visioDiagramPlan };
    },
    readback: async (_visioDiagramPlan, renderResult, run) => {
      calls.push(["readback", run.visioOptions?.documentPath]);
      return { renderId: renderResult.renderId, nodes: [{ sourceNodeId: "input" }], connectors: [] };
    },
  }) });

  const { response, payload } = await requestAgent(service, "/api/agent-run", {
    ...agentInput,
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.status, "completed");
  assert.deepEqual(calls, [
    ["render", "C:\\project\\existing.vsdx"],
    ["readback", "C:\\project\\existing.vsdx"],
  ]);
});

test("Agent Run injects Visio execution when an existing document path is supplied", async () => {
  const previousDryRun = process.env.VISIO_DRY_RUN;
  process.env.VISIO_DRY_RUN = "1";
  try {
    const service = createAgentService({ dependencies: agentDependencies({ render: undefined, readback: undefined }) });
    const { response, payload } = await requestAgent(service, "/api/agent-run", {
      ...agentInput,
      documentPath: "C:\\project\\existing.vsdx",
      pageName: "Page-1",
    });

    assert.equal(response.status, 200);
    assert.equal(payload.status, "dry_run");
    assert.equal(payload.stage, "render");
    assert.equal(payload.renderResult.status, "dry_run");
    assert.equal(payload.renderResult.plan.documentPath, "C:\\project\\existing.vsdx");
  } finally {
    if (previousDryRun === undefined) delete process.env.VISIO_DRY_RUN;
    else process.env.VISIO_DRY_RUN = previousDryRun;
  }
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
  assert.equal(payload.visioDiagramPlan, undefined);
  assert.ok(payload.diagnostics.some((item) => item.kind === "needs-confirmation"));
});

test("agent service exposes needs-confirmation and resumes confirmation into planning", async () => {
  const service = createAgentService({ dependencies: agentDependencies({
    extract: () => ({
      status: "needs_resolution",
      unresolvedQuestions: [{ code: "select-architecture-candidate" }],
      nodes: [{ id: "opaque", family: "custom" }],
    }),
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
  assert.ok(resumed.payload.visioDiagramPlan);
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

test("agent service persists every externally supplied resume event", async () => {
  const runStore = createMemoryRunStore();
  const service = createAgentService({ dependencies: agentDependencies(), runStore });
  const created = await requestAgent(service, "/api/agent-run", agentInput);

  const rendered = await requestAgent(service, `/api/agent-run/${created.payload.id}/resume`, {
    type: "render-result",
    value: { renderId: "external-render" },
  });
  assert.equal(rendered.payload.status, "rendered");
  const storedRender = await runStore.get(created.payload.id);
  assert.equal(storedRender.status, "rendered");
  assert.equal(storedRender.stage, "render");
  assert.equal(storedRender.renderResult.renderId, "external-render");
  assert.deepEqual(storedRender.snapshots.at(-1), { stage: "render", value: { renderId: "external-render" } });

  const completed = await requestAgent(service, `/api/agent-run/${created.payload.id}/resume`, {
    type: "readback-result",
    value: { renderId: "external-render", nodes: [], connectors: [] },
  });
  assert.equal(completed.payload.status, "readback-mismatch");
  const storedReadback = await runStore.get(created.payload.id);
  assert.equal(storedReadback.status, "readback-mismatch");
  assert.equal(storedReadback.stage, "readback");
  assert.deepEqual(storedReadback.snapshots.at(-1), { stage: "readback", value: { renderId: "external-render", nodes: [], connectors: [] } });
});

test("HTTP resume restores a run from the Run Store when the in-memory map is empty", async () => {
  const runStore = createMemoryRunStore();
  const pausedRun = createAgentRun(agentInput, agentDependencies({
    extract: () => ({
      status: "needs_resolution",
      unresolvedQuestions: [{ code: "select-architecture-candidate" }],
      nodes: [{ id: "opaque", family: "custom" }],
    }),
    render: undefined,
    readback: undefined,
  }), { runStore });
  const paused = await runAgentPipeline(pausedRun);
  assert.equal(paused.status, "needs-confirmation");

  const service = createAgentService({ dependencies: agentDependencies({ render: undefined, readback: undefined }), runStore });
  const resumed = await requestAgent(service, `/api/agent-run/${paused.id}/resume`, {
    type: "confirm",
    value: { accepted: true },
  });

  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.status, "completed");
  assert.equal(resumed.payload.id, paused.id);
  assert.equal(resumed.payload.visioDiagramPlan.nodes[0].sourceNodeId, "input");
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

test("static server serves JavaScript modules with a JavaScript MIME type", async (t) => {
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

test("local API rejects cross-origin POST requests", async (t) => {
  const port = 4186;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VISIO_DRY_RUN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/render-visio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
    body: JSON.stringify({ documentPath: "C:\\project\\existing.vsdx", ir: { nodes: [] } }),
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "cross-origin-request");
});

test("local API requires JSON content type for POST requests", async (t) => {
  const port = 4187;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VISIO_DRY_RUN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/render-visio`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ documentPath: "C:\\project\\existing.vsdx", ir: { nodes: [] } }),
  });

  assert.equal(response.status, 415);
  assert.equal((await response.json()).code, "unsupported-content-type");
});

test("model-list endpoint refuses to reuse a saved key for a different base URL", async (t) => {
  const port = 4188;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SYNAPSE_NO_SAVED_CONFIG: "1",
      LLM_API_KEY: "saved-key",
      LLM_BASE_URL: "https://llm.test/v1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  await waitForServer(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/api/llm-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: "http://127.0.0.1:9" }),
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "api-key-required-for-new-base-url");
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
  assert.equal(payload.status, "ready_for_visio");
  assert.ok(payload.ir.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.ok(payload.diagnostics.some((item) => item.kind === "unresolved-operator"));
  assert.ok(payload.visioDiagramPlan);
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

test("legacy /api/analyze-diagram is removed; image analysis enters Agent Run", async (t) => {
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

  assert.equal(response.status, 404);
});

test("/api/render-visio produces an existing-document plan without creating a new document", async (t) => {
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
          { id: "custom", op: "ConfirmedBlock", family: "operator", stage: 1, confidence: 0.5 },
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
  assert.ok(payload.plan.shapes.some((shape) => shape.sceneForm === "text" && shape.label === "ConfirmedBlock"));
  assert.deepEqual(
    [...new Set(payload.plan.shapes.flatMap((shape) => shape.shapeData.sourceNodeIds || []))].sort(),
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
        return { ir: value.ir, visioDiagramPlan: { version: "visio-diagram-plan/v1", renderId: "shared", scene: minimalScene(), nodes: [{ id: "f-input", sourceNodeId: "input" }], edges: [] } };
      },
      render: async (visioDiagramPlan) => { calls.push(["render", visioDiagramPlan.renderId]); return { renderId: "shared", visioDiagramPlan }; },
      readback: async (visioDiagramPlan, renderResult) => { calls.push(["readback", visioDiagramPlan.renderId, renderResult.visioDiagramPlan.renderId]); return { renderId: "shared", nodes: [{ sourceNodeId: "input" }], connectors: [] }; },
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

test("/api/render-visio rejects a client-supplied Figure Plan instead of bypassing Agent Run", async () => {
  const calls = [];
  const legacyFigurePlan = {
    version: "figure-plan/v1",
    figure: { title: "Direct plan" },
    nodes: [{ id: "figure-input", sourceNodeId: "source-input", sourceNodeIds: ["source-input"], label: "Input" }],
    edges: [],
  };
  const service = createAgentService({ dependencies: {
    render: async (plan) => { calls.push(["render", plan]); return { status: "dry_run", renderId: "direct", plan: { shapes: [], connectors: [] } }; },
    readback: async (plan) => { calls.push(["readback", plan]); return { renderId: "direct", sourceNodeIds: ["source-input"], edgeIds: [] }; },
  } });
  const { response, payload } = await requestAgent(service, "/api/render-visio", {
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    figurePlan: legacyFigurePlan,
  });

  assert.equal(response.status, 422);
  assert.equal(payload.status, "invalid_input");
  assert.equal(payload.code, "figure-plan-not-accepted");
  assert.deepEqual(calls, []);
});

test("/api/render-visio reports malformed source and IR input as 422 invalid_input", async () => {
  const service = createAgentService();
  for (const input of [
    { source: { not: "a string" } },
    { ir: [] },
    { ir: null },
  ]) {
    const response = await service(new Request("http://agent.test/api/render-visio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentPath: "C:\\project\\existing.vsdx", ...input }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.equal(payload.status, "invalid_input");
  }
});

test("/api/render-visio preserves a real Visio readback failure status", async () => {
  const service = createAgentService({ dependencies: {
    render: async (visioDiagramPlan) => ({ status: "readback_failed", renderId: "r1", visioDiagramPlan, plan: { shapes: [], connectors: [] } }),
    readback: async () => ({ renderId: "r1", nodes: [{ sourceNodeId: "input" }], connectors: [] }),
  } });
  const response = await service(new Request("http://agent.test/api/render-visio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentPath: "C:\\project\\existing.vsdx", ir: { nodes: [{ id: "input", family: "input" }] } }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "readback_failed");
  assert.notEqual(payload.status, "rendered");
});

test("/api/render-visio sends image evidence through Agent Run and stops without a vision provider", async () => {
  const service = createAgentService({ dependencies: {
    extract: () => ({ status: "needs_external_vision", diagnostics: [{ kind: "vision-analyzer-required" }] }),
    render: () => { throw new Error("render must not run while vision is pending"); },
  } });
  const { response, payload } = await requestAgent(service, "/api/render-visio", {
    documentPath: "C:\\project\\existing.vsdx",
    images: [{ name: "reference.png", dataUrl: "data:image/png;base64,AA==" }],
  });

  assert.equal(response.status, 409);
  assert.equal(payload.status, "needs_external_vision");
  assert.equal(payload.visioDiagramPlan, undefined);
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
