import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticVisualNode,
  compileSemanticVisualNodes,
  labelSlotsForRole,
  styleProfileForRole,
  visualRoleForNode,
} from "./semantic-visual-grammar.mjs";

test("semantic grammar maps spatial operators to a feature-map visual role", () => {
  const node = {
    id: "spatial-op",
    family: "conv",
    label: "Spatial operator",
    shape: { input: [1, 224, 224, 3], output: [1, 224, 224, 64] },
    repeatCount: 2,
  };

  assert.equal(visualRoleForNode(node), "feature-map-stage");
  assert.equal(styleProfileForRole("feature-map-stage"), "feature-map");
  assert.deepEqual(labelSlotsForRole("feature-map-stage"), {
    title: "below",
    subtitle: "below",
    tensorShape: "below",
    operatorDetails: "outside",
  });

  const compiled = compileSemanticVisualNode(node);
  assert.equal(compiled.visualRole, "feature-map-stage");
  assert.equal(compiled.styleProfile, "feature-map");
  assert.equal(compiled.geometryData.repeatCount, 2);
  assert.notEqual(compiled.styleProfile, "card");
  assert.ok(
    compiled.geometryData.preferredWidth / compiled.geometryData.preferredHeight < 0.34,
    "feature-map stage should remain visibly thin rather than a wide card"
  );
});

test("semantic grammar places spatial captions below their tensor glyphs", () => {
  const [feature, pool] = compileSemanticVisualNodes([
    { id: "feature", family: "conv", label: "Conv 64", shape: { output: [1, 112, 112, 64] } },
    { id: "pool", family: "pool", label: "MaxPool", shape: { output: [1, 56, 56, 64] } },
  ], [{ id: "edge", source: "feature", target: "pool" }]);

  assert.equal(feature.labelSlots.title, "below");
  assert.equal(pool.labelSlots.title, "below");
});

test("semantic grammar uses the compact upstream caption for pooling", () => {
  const [pool] = compileSemanticVisualNodes([{
    id: "pool",
    family: "pool",
    label: "MaxPool",
    subtitle: "56 x 56 x 128 · k2 · s2",
  }]);

  assert.equal(pool.figureLabel, "MP");
  assert.equal(pool.figureSubtitle, "56×56×128");
});

test("semantic grammar gives vectorization and neuron operators distinct visual roles", () => {
  const vectorize = compileSemanticVisualNode({
    id: "vectorize",
    family: "flatten",
    label: "Vectorize",
    shape: { input: [1, 7, 7, 512], output: [1, 25088] },
  });
  const neuron = compileSemanticVisualNode({
    id: "neuron",
    family: "dense",
    label: "Dense",
    shape: { input: [1, 25088], output: [1, 4096] },
  });

  assert.equal(vectorize.visualRole, "vectorize");
  assert.equal(neuron.visualRole, "neuron-layer");
  assert.notEqual(vectorize.styleProfile, neuron.styleProfile);
  assert.equal(vectorize.labelSlots.title, "above");
  assert.equal(neuron.labelSlots.tensorShape, "below");
});

test("semantic grammar preserves compound evidence and unresolved uncertainty", () => {
  const compound = compileSemanticVisualNode({
    id: "compound",
    family: "custom",
    compoundKind: "operator",
    attributes: { internalGraph: { nodes: [{ id: "inner" }], edges: [] } },
  });
  const unresolved = compileSemanticVisualNode({
    id: "opaque",
    family: "custom",
    compoundKind: "unresolved",
  });

  assert.equal(compound.visualRole, "compound-module");
  assert.equal(compound.geometryData.hasInternalTopology, true);
  assert.equal(unresolved.visualRole, "unresolved-module");
  assert.equal(unresolved.geometryData.hasInternalTopology, false);
  assert.equal(unresolved.labelSlots.operatorDetails, "outside");
});

test("semantic grammar derives publication labels and terminal output roles from topology", () => {
  const nodes = compileSemanticVisualNodes([
    { id: "features-a", family: "conv", label: "Conv 64", shape: { output: [1, 224, 224, 64] } },
    { id: "features-b", family: "conv", label: "Conv 128", shape: { output: [1, 112, 112, 128] } },
    { id: "hidden", family: "dense", label: "Linear 4096", shape: { output: [1, 4096] } },
    { id: "tail", family: "dense", label: "Linear 10", shape: { output: [1, 10] } },
  ], [
    { source: "features-a", target: "features-b" },
    { source: "features-b", target: "hidden" },
    { source: "hidden", target: "tail" },
  ]);

  assert.deepEqual(nodes.map((node) => node.figureLabel), ["CONV 1", "CONV 2", "FC 1", "OUTPUT"]);
  assert.equal(nodes.at(-1).visualRole, "output-distribution");
  assert.equal(nodes.at(-1).styleProfile, "output");
  assert.match(nodes[0].figureSubtitle, /224[×x]224[×x]64/);
});

test("semantic grammar reuses dimension evidence kept in source subtitles", () => {
  const [compiled] = compileSemanticVisualNodes([{
    id: "subtitle-evidence",
    family: "conv",
    label: "Conv 128",
    subtitle: "112 x 112 x 128 · k3",
  }]);

  assert.equal(compiled.geometryData.spatialSize, 112);
  assert.equal(compiled.geometryData.channelCount, 128);
  assert.ok(compiled.geometryData.preferredHeight < 260);
  assert.equal(compiled.figureSubtitle, "112×112×128");

  const [pooled] = compileSemanticVisualNodes([{
    id: "pooled-evidence",
    family: "pool",
    label: "MaxPool",
    subtitle: "56 x 56 x 128 · k2 · s2",
  }]);
  assert.equal(pooled.figureSubtitle, "56×56×128");
});

test("semantic grammar carries evidenced internal operator labels for module rendering", () => {
  const compiled = compileSemanticVisualNode({
    id: "module",
    family: "conv",
    shape: { output: [1, 32, 32, 64] },
    attributes: {
      internalGraph: {
        nodes: [
          { id: "conv-a", label: "Conv 3×3" },
          { id: "norm-a", label: "BatchNorm" },
        ],
        edges: [{ source: "conv-a", target: "norm-a" }],
      },
    },
  });
  assert.deepEqual(compiled.geometryData.internalOperatorLabels, ["Conv 3×3", "BatchNorm"]);
});

test("semantic grammar preserves recurrent time-step and state-flow layout semantics", () => {
  const compiled = compileSemanticVisualNode({
    id: "recurrent-cell",
    family: "recurrent",
    op: "GRUCell",
    label: "GRU cell",
    shape: { input: [1, 16], output: [1, 32] },
  });

  assert.equal(compiled.visualRole, "recurrent-state");
  assert.equal(compiled.styleProfile, "recurrent");
  assert.equal(compiled.geometryData.timeAxis, "left-to-right");
  assert.equal(compiled.geometryData.stateFlow, "feedback-loop");
  assert.equal(compiled.geometryData.preservesStateFlow, true);
});
