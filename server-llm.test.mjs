import assert from "node:assert/strict";
import test from "node:test";

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function chatResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => "",
  };
}

const llmIR = {
  figure: { title: "TestNet", subtitle: "", stages: ["Input", "Conv", "Pool", "Output"] },
  nodes: [
    { id: "in", op: "Input", family: "input", label: "Input", stage: 0, confidence: 1 },
    { id: "c1", op: "Conv2d", family: "conv", label: "Conv1", stage: 1, confidence: 1, attributes: { constructorArgs: "3, 64, kernel_size=3, padding=1" } },
    { id: "p1", op: "MaxPool2d", family: "pool", label: "Pool1", stage: 2, confidence: 1, attributes: { constructorArgs: "2, 2" } },
    { id: "out", op: "Output", family: "output", label: "Output", stage: 3, confidence: 1 },
  ],
  edges: [
    { id: "e1", source: "in", target: "c1", type: "signal", confidence: 1 },
    { id: "e2", source: "c1", target: "p1", type: "signal", confidence: 1 },
    { id: "e3", source: "p1", target: "out", type: "output", confidence: 1 },
  ],
};

async function importServerWithKey() {
  const previous = {
    key: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL,
  };
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  const { createAgentService } = await import("./server.js");
  return { createAgentService, restore: () => {
    if (previous.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = previous.baseUrl;
  } };
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

test("source input routes through the LLM and gets exact feature-map shapes", async () => {
  const { createAgentService, restore } = await importServerWithKey();
  const restoreFetch = stubFetch(async () => chatResponse(JSON.stringify({ ir: llmIR })));
  try {
    const service = createAgentService();
    const { response, payload } = await requestAgent(service, "/api/agent-run", {
      kind: "source",
      framework: "pytorch",
      source: "class Net(nn.Module):\n    def forward(self, x):\n        return x",
    });
    assert.equal(response.status, 200);
    const conv = payload.ir.nodes.find((node) => /conv/i.test(node.op));
    const pool = payload.ir.nodes.find((node) => /pool/i.test(node.op));
    assert.ok(conv, "conv node should be present");
    assert.deepEqual(conv.shape?.output, [224, 224, 64], "shape inference should compute Conv2d output");
    assert.deepEqual(pool.shape?.output, [112, 112, 64], "shape inference should compute MaxPool2d output");
  } finally {
    restoreFetch();
    restore();
  }
});

test("prompt input routes through the LLM", async () => {
  const { createAgentService, restore } = await importServerWithKey();
  const restoreFetch = stubFetch(async () => chatResponse(JSON.stringify({ ir: llmIR })));
  try {
    const service = createAgentService();
    const { response, payload } = await requestAgent(service, "/api/agent-run", {
      kind: "prompt",
      prompt: "a small CNN with a conv and a pool",
    });
    assert.equal(response.status, 200);
    assert.ok(payload.ir.nodes.some((node) => /conv/i.test(node.op)));
  } finally {
    restoreFetch();
    restore();
  }
});

test("image input routes through the LLM and produces grounded IR", async () => {
  const { createAgentService, restore } = await importServerWithKey();
  const restoreFetch = stubFetch(async () => chatResponse(JSON.stringify({ ir: llmIR })));
  try {
    const service = createAgentService();
    const { response, payload } = await requestAgent(service, "/api/agent-run", {
      kind: "image",
      images: [{ dataUrl: "data:image/png;base64,AAA" }],
    });
    assert.equal(response.status, 200);
    assert.ok(payload.ir.nodes.length > 0, "vision analysis should yield grounded nodes");
  } finally {
    restoreFetch();
    restore();
  }
});

test("source input falls back to rule-based extraction when the LLM is not configured", async () => {
  delete process.env.LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const { createAgentService } = await import("./server.js");
  const { response, payload } = await requestAgent(createAgentService(), "/api/agent-run", {
    kind: "source",
    framework: "pytorch",
    source: `class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 8, 3)
    def forward(self, x):
        return self.conv(x)`,
  });
  assert.equal(response.status, 200);
  assert.ok(payload.ir.nodes.some((node) => node.op === "conv" || node.op === "Conv2d"), "rule-based extraction should still work without an LLM");
});

test("shape self-correction loop refines a mismatched residual via a second LLM round", async () => {
  const badIR = {
    figure: { title: "ResidualNet", stages: ["Input", "Pool", "Add", "Output"] },
    nodes: [
      { id: "in", op: "Input", family: "input", label: "Input", stage: 0, confidence: 1 },
      { id: "pool", op: "MaxPool2d", family: "pool", label: "Pool", stage: 1, confidence: 1, attributes: { constructorArgs: "2, 2" } },
      { id: "add", op: "Add", family: "merge", label: "Add", stage: 2, confidence: 1 },
      { id: "out", op: "Output", family: "output", label: "Output", stage: 3, confidence: 1 },
    ],
    edges: [
      { id: "e1", source: "in", target: "pool", type: "signal", confidence: 1 },
      { id: "e2", source: "pool", target: "add", type: "signal", confidence: 1 },
      { id: "e3", source: "in", target: "add", type: "residual", confidence: 1 },
      { id: "e4", source: "add", target: "out", type: "output", confidence: 1 },
    ],
  };
  // 修正：残差边改为同尺寸的 conv 分支，让 add 两侧一致。
  const fixedIR = {
    figure: { title: "ResidualNet", stages: ["Input", "Conv", "Add", "Output"] },
    nodes: [
      { id: "in", op: "Input", family: "input", label: "Input", stage: 0, confidence: 1 },
      { id: "conv", op: "Conv2d", family: "conv", label: "Conv", stage: 1, confidence: 1, attributes: { constructorArgs: "3, 3, kernel_size=3, padding=1" } },
      { id: "add", op: "Add", family: "merge", label: "Add", stage: 2, confidence: 1 },
      { id: "out", op: "Output", family: "output", label: "Output", stage: 3, confidence: 1 },
    ],
    edges: [
      { id: "e1", source: "in", target: "conv", type: "signal", confidence: 1 },
      { id: "e2", source: "conv", target: "add", type: "signal", confidence: 1 },
      { id: "e3", source: "in", target: "add", type: "residual", confidence: 1 },
      { id: "e4", source: "add", target: "out", type: "output", confidence: 1 },
    ],
  };

  const { createAgentService, restore } = await importServerWithKey();
  let calls = 0;
  const restoreFetch = stubFetch(async (url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    const isRefine = (body.messages || []).some((message) => message.role === "assistant");
    return chatResponse(JSON.stringify({ ir: isRefine ? fixedIR : badIR }));
  });
  try {
    const service = createAgentService();
    const { response, payload } = await requestAgent(service, "/api/agent-run", {
      kind: "source",
      framework: "pytorch",
      source: "class ResNet(nn.Module):\n    def forward(self, x):\n        return x + self.pool(x)",
    });
    assert.equal(response.status, 200);
    assert.ok(calls >= 2, "the mismatched residual should trigger a correction round");
    const add = payload.ir.nodes.find((node) => node.family === "merge");
    assert.ok(add, "merge node should be present in the corrected IR");
    assert.deepEqual(add.shape?.output, [224, 224, 3], "corrected residual add should resolve to matching branch shape");
  } finally {
    restoreFetch();
    restore();
  }
});
