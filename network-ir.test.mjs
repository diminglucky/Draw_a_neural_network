import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";
import { normalizeUniversalIR, validateUniversalIR } from "./universal-ir.mjs";

test("network normalization delegates Universal IR normalization", () => {
  const value = { nodes: [{ id: "x", op: "MysteryOp", family: "custom" }], edges: [] };
  assert.deepEqual(normalizeNetworkIR(value), normalizeUniversalIR(value));
});

test("network validation delegates Universal IR validation", () => {
  const value = { nodes: [{ id: "x", op: "Input", family: "input" }], edges: [] };
  assert.deepEqual(validateNetworkIR(value), validateUniversalIR(value));
});
