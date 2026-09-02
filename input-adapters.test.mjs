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
