import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("generates a validated VGG16 Worker diagram from the canonical Figure Plan", async () => {
  const command = process.platform === "win32" ? "cmd.exe" : "./node_modules/.bin/tsx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", ".\\node_modules\\.bin\\tsx.cmd scripts\\generate-vgg16-figure-plan.mts"]
    : ["scripts/generate-vgg16-figure-plan.mts"];
  const { stdout } = await execFileAsync(command, args, { cwd: process.cwd() });
  const diagram = JSON.parse(stdout);

  assert.equal(diagram.figure.title, "VGG-16");
  assert.equal(diagram.figurePlan.validation.valid, true);
  assert.equal(diagram.figurePlan.styleId, "vgg-tensor-plate-v3");
  assert.deepEqual(diagram.figurePlan.primitiveGroups.find((group) => group.id === "block-1").primitiveIds, [
    "block-1.plane-1.front", "block-1.plane-1.top", "block-1.plane-1.side",
    "block-1.plane-2.front", "block-1.plane-2.top", "block-1.plane-2.side",
  ]);
  assert.equal(diagram.figurePlan.primitiveGroups.find((group) => group.id === "flatten").kind, "flatten-ribbon");
  assert.equal(diagram.figurePlan.connectors.length, 14);
});
