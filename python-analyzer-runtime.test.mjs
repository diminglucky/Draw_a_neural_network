import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { resolvePythonToolPath } from "./python-analyzer-runtime.mjs";

test("resolves bundled Python analyzer scripts from the development tree", () => {
  const torchPath = resolvePythonToolPath("torch_source_analyzer.py");
  const kerasPath = resolvePythonToolPath("keras_source_analyzer.py");
  assert.equal(existsSync(torchPath), true);
  assert.equal(existsSync(kerasPath), true);
  assert.match(torchPath.replaceAll("\\", "/"), /\/tools\/torch_source_analyzer\.py$/);
  assert.match(kerasPath.replaceAll("\\", "/"), /\/tools\/keras_source_analyzer\.py$/);
});
