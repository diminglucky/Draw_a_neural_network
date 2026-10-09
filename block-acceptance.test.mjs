import assert from "node:assert/strict";
import test from "node:test";

import { analyzeArchitectureInput } from "./agent-pipeline.mjs";
import { blockAcceptanceFixtures } from "./block-acceptance-fixtures.mjs";
import { NEURAL_BLOCK_IR_VERSION, validateNeuralBlocks } from "./neural-block-ir.mjs";

function analyze(ir) {
  return analyzeArchitectureInput({ kind: "ir", ir });
}

test("block acceptance matrix covers core neural architecture families", () => {
  for (const fixture of blockAcceptanceFixtures) {
    const result = analyze(fixture.ir);
    assert.ok(result.visioDiagramPlan, fixture.name);
    assert.equal(result.visioDiagramPlanValidation.ok, true, fixture.name);
    assert.equal(validateNeuralBlocks(result.blockIr, result.ir).ok, true, fixture.name);
    assert.deepEqual(result.blockIr.diagnostics || [], [], fixture.name);
    for (const kind of fixture.expectedKinds) {
      assert.ok(result.blockSummary.byKind[kind]?.count >= 1, `${fixture.name} missing ${kind}`);
    }
    assert.equal(result.blockIr.version, NEURAL_BLOCK_IR_VERSION, fixture.name);
  }
});

test("dual-head architectures preserve both terminal heads", () => {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === "dual-head");
  const result = analyze(fixture.ir);
  assert.equal(result.blockSummary.byKind["detection-head"].count, 2);
});

test("generic fan-in is not mislabeled as MoE without routing evidence", () => {
  const result = analyze({
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "a", family: "conv", op: "Conv2d" },
      { id: "b", family: "conv", op: "Conv2d" },
      { id: "c", family: "conv", op: "Conv2d" },
      { id: "merge", family: "merge", op: "Concat" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "a" },
      { id: "e2", source: "input", target: "b" },
      { id: "e3", source: "input", target: "c" },
      { id: "e4", source: "a", target: "merge" },
      { id: "e5", source: "b", target: "merge" },
      { id: "e6", source: "c", target: "merge" },
      { id: "e7", source: "merge", target: "output" },
    ],
  });
  assert.equal(result.blockSummary.byKind["moe-block"], undefined);
});
