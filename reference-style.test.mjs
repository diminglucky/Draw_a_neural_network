import assert from "node:assert/strict";
import test from "node:test";
import { createPlotNeuralNetStyleSpec, validateReferenceFigureSpec } from "./reference-figure-spec.mjs";
import { compileReferenceStyle } from "./reference-style-compiler.mjs";
import { compareFigureMetrics, compareShapeProgression } from "./figure-comparator.mjs";
import { buildCanonicalModelGraph } from "./canonical-model-graph.mjs";

test("compiles a top-journal tensor-flow reference style into layout constraints", () => {
  const style = createPlotNeuralNetStyleSpec();
  assert.equal(validateReferenceFigureSpec(style).ok, true);
  const canonicalModel = buildCanonicalModelGraph({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "input", op: "Input", family: "input", shape: { output: [224, 224, 3] } },
      { id: "conv", op: "Conv2d", family: "conv", shape: { output: [112, 112, 64] } },
    ],
    edges: [{ id: "flow", source: "input", target: "conv", type: "signal" }],
  });
  const compiled = compileReferenceStyle({ style, canonicalModel });
  assert.equal(compiled.version, "reference-style-compilation/v1");
  assert.ok(compiled.constraints.some((constraint) => constraint.kind === "align-scale-centerlines"));
  assert.ok(compiled.constraints.some((constraint) => constraint.kind === "limit-label-density"));
  assert.equal(compiled.styleTokens.tensorGrammar.drawEastFace, true);
});

test("compares figure metrics and tensor shape progression", () => {
  const metrics = compareFigureMetrics(
    { whitespaceRatio: 0.8, labelOverlapCount: 0, connectorBodyIntersectionCount: 0 },
    { whitespaceRatio: 0.74, labelOverlapCount: 0, connectorBodyIntersectionCount: 0 },
  );
  assert.equal(metrics.ok, true);
  const mismatch = compareFigureMetrics(
    { whitespaceRatio: 0.8, labelOverlapCount: 0 },
    { whitespaceRatio: 0.4, labelOverlapCount: 1 },
  );
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.issues.some((issue) => issue.metric === "whitespaceRatio"));

  assert.equal(compareShapeProgression([3, 64, 128], [3, 64, 128]).ok, true);
  assert.equal(compareShapeProgression([3, 64, 128], [3, 128, 64]).ok, false);
});
