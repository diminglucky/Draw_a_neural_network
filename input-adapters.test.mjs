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
});
