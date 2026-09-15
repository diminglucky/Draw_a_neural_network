import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArchitectureInput } from "./input-adapters.mjs";

test("normalizes source input without importing model registries", () => {
  const result = normalizeArchitectureInput({ kind: "source", source: "model.py", framework: "pytorch", sourceId: "model-1" });
  assert.deepEqual(result, { kind: "source", source: "model.py", framework: "pytorch", sourceId: "model-1" });
});

test("normalizes IR, image, and prompt inputs", () => {
  assert.equal(normalizeArchitectureInput({ kind: "ir", ir: { nodes: [] } }).kind, "ir");
  assert.deepEqual(normalizeArchitectureInput({ kind: "image", images: ["diagram.png"] }).images, ["diagram.png"]);
  assert.equal(normalizeArchitectureInput({ kind: "prompt", prompt: "draw a CNN" }).prompt, "draw a CNN");
});

test("preserves acquisition diagnostics attached to grounded IR", () => {
  const diagnostics = [{ kind: "ir-corrected", round: 1 }];
  assert.deepEqual(normalizeArchitectureInput({ kind: "ir", ir: { nodes: [] }, diagnostics }), {
    kind: "ir",
    ir: { nodes: [] },
    diagnostics,
  });
});

test("normalizes repository, config, and artifact inputs without resolving them", () => {
  assert.deepEqual(normalizeArchitectureInput({
    kind: "repository", repository: "https://github.com/example/model", revision: "abc123", entryPoint: "model.py",
  }), {
    kind: "repository", repository: "https://github.com/example/model", revision: "abc123", entryPoint: "model.py",
  });
  assert.deepEqual(normalizeArchitectureInput({ kind: "config", config: "layers: []", framework: "generic" }), {
    kind: "config", config: "layers: []", framework: "generic",
  });
  assert.deepEqual(normalizeArchitectureInput({
    kind: "artifact", artifact: { format: "onnx", path: "C:\\models\\network.onnx" },
  }), { kind: "artifact", artifact: { format: "onnx", path: "C:\\models\\network.onnx" } });
});

test("rejects unknown input fields and incomplete acquisition inputs", () => {
  assert.throws(() => normalizeArchitectureInput({ kind: "prompt", prompt: "model", coordinates: [] }), /unknown field coordinates/);
  assert.throws(() => normalizeArchitectureInput({ kind: "repository", repository: "" }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "config", config: null }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "artifact", artifact: { path: "model.onnx" } }), (error) => error.kind === "invalid-input");
});

test("strips supported agent execution context from architecture input", () => {
  assert.deepEqual(normalizeArchitectureInput({
    kind: "prompt",
    prompt: "draw a detector",
    documentPath: "C:\\output\\detector.vsdx",
    pageName: "Architecture",
    renderId: "render-1",
    unitScale: 1.25,
    previewPath: "C:\\output\\detector.png",
  }), {
    kind: "prompt",
    prompt: "draw a detector",
  });
});

test("rejects malformed architecture input with a structured error", () => {
  assert.throws(() => normalizeArchitectureInput({ kind: "source" }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "source", source: "  " }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "source", source: 42 }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "ir", ir: null }), (error) => error.kind === "invalid-input");
  assert.throws(() => normalizeArchitectureInput({ kind: "ir", ir: [] }), (error) => error.kind === "invalid-input");
});

test("explicitly rejects null, empty, and blank payloads at the input boundary", () => {
  const invalidInputs = [
    { kind: "source", source: null },
    { kind: "ir", ir: null },
    { kind: "image", images: [] },
    { kind: "prompt", prompt: "" },
    { kind: "prompt", prompt: "   " },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => normalizeArchitectureInput(input),
      (error) => error.kind === "invalid-input",
      `expected ${input.kind} payload to be rejected`,
    );
  }
});
