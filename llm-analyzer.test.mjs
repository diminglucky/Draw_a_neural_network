import assert from "node:assert/strict";
import test from "node:test";
import { createLLMAnalyzer } from "./llm-analyzer.mjs";

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

const sampleIR = {
  figure: { title: "Net", subtitle: "", stages: ["Input", "Conv", "Output"] },
  nodes: [
    { id: "in", op: "Input", family: "input", label: "Input", stage: 0, confidence: 1 },
    { id: "conv", op: "Conv2d", family: "conv", label: "Conv", stage: 1, confidence: 1, attributes: { constructorArgs: "3, 64, kernel_size=3, padding=1" } },
    { id: "out", op: "Output", family: "output", label: "Output", stage: 2, confidence: 1 },
  ],
  edges: [
    { id: "e1", source: "in", target: "conv", type: "signal", confidence: 1 },
    { id: "e2", source: "conv", target: "out", type: "output", confidence: 1 },
  ],
};

test("analyze returns unavailable without an API key", async () => {
  const analyzer = createLLMAnalyzer({ apiKey: "" });
  const result = await analyzer.analyze({ kind: "source", source: "class Net: pass" });
  assert.equal(result.status, "unavailable");
  assert.equal(analyzer.available, false);
});

test("analyze sends a Chat Completions request and returns the IR for source", async () => {
  let captured;
  const restore = stubFetch(async (url, init) => {
    captured = { url, init };
    return chatResponse(JSON.stringify({ ir: sampleIR }));
  });
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "test-key", baseUrl: "https://llm.example.com/v1/", model: "custom-model" });
    const result = await analyzer.analyze({ kind: "source", source: "class Net: pass", framework: "pytorch" });
    assert.ok(result.ir, "result should carry an IR");
    assert.equal(result.ir.nodes.length, 3);
    assert.equal(result.ir.nodes[1].op, "Conv2d");
    assert.equal(captured.url, "https://llm.example.com/v1/chat/completions");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, "custom-model");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[1].content, /class Net: pass/);
  } finally {
    restore();
  }
});

test("analyze returns the IR for prompt input", async () => {
  const restore = stubFetch(async () => chatResponse(JSON.stringify({ ir: sampleIR })));
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "k" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "a small CNN with a residual skip" });
    assert.ok(result.ir);
  } finally {
    restore();
  }
});

test("analyze returns unavailable for image without images", async () => {
  const analyzer = createLLMAnalyzer({ apiKey: "k" });
  const result = await analyzer.analyze({ kind: "image", images: [] });
  assert.equal(result.status, "unavailable");
});

test("analyze sends image content for image input", async () => {
  let captured;
  const restore = stubFetch(async (url, init) => {
    captured = { init };
    return chatResponse(JSON.stringify({ ir: sampleIR }));
  });
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "k" });
    const result = await analyzer.analyze({ kind: "image", images: [{ dataUrl: "data:image/png;base64,AAA" }] });
    assert.ok(result.ir);
    const body = JSON.parse(captured.init.body);
    const userContent = body.messages[1].content;
    assert.ok(Array.isArray(userContent));
    assert.equal(userContent[1].type, "image_url");
    assert.equal(userContent[1].image_url.url, "data:image/png;base64,AAA");
  } finally {
    restore();
  }
});

test("analyze returns error on a non-200 response", async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
  }));
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "k" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "x" });
    assert.equal(result.status, "error");
    assert.equal(result.message, "401: unauthorized");
  } finally {
    restore();
  }
});

test("analyze returns error on invalid JSON content", async () => {
  const restore = stubFetch(async () => chatResponse("not json at all"));
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "k" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "x" });
    assert.equal(result.status, "error");
  } finally {
    restore();
  }
});

test("analyze tolerates a code-fenced JSON response", async () => {
  const restore = stubFetch(async () => chatResponse("```json\n" + JSON.stringify({ ir: sampleIR }) + "\n```"));
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "k" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "x" });
    assert.ok(result.ir, "code-fenced JSON should still parse");
  } finally {
    restore();
  }
});

test("analyze retries without response_format when json_object is rejected (400)", async () => {
  const bodies = [];
  let calls = 0;
  const restore = stubFetch(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 400, text: async () => "Response input messages must contain the word json" };
    }
    return chatResponse(JSON.stringify({ ir: sampleIR }));
  });
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "test-key", baseUrl: "https://llm.example.com/v1", model: "m" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "x" });
    assert.ok(result.ir, "should recover after dropping response_format");
    assert.equal(calls, 2);
    assert.deepEqual(bodies[0].response_format, { type: "json_object" });
    assert.equal(bodies[1].response_format, undefined);
  } finally {
    restore();
  }
});

test("analyze retries on transient gateway errors (502/503/524)", async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 502, text: async () => "不支持这个模型" };
    return chatResponse(JSON.stringify({ ir: sampleIR }));
  });
  try {
    const analyzer = createLLMAnalyzer({ apiKey: "test-key", baseUrl: "https://llm.example.com/v1", model: "m" });
    const result = await analyzer.analyze({ kind: "prompt", prompt: "x" });
    assert.ok(result.ir, "should recover after a transient gateway error");
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});
