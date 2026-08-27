import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

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
  assert.ok(payload.plan.shapes.some((shape) => shape.shapeData.sourceNodeId === "custom"));
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
