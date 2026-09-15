import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticVisualNode,
  compileSemanticVisualNodes,
  inputVisualGrammarForNode,
  inferModulePattern,
  recurrentEvidenceForNode,
  labelSlotsForRole,
  styleProfileForRole,
  visualRoleForNode,
} from "./semantic-visual-grammar.mjs";

test("module patterns are inferred from evidenced topology rather than display names", () => {
  assert.equal(inferModulePattern({ family: "custom", label: "Anything" }, {
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ source: "a", target: "b", type: "residual" }],
  }), "residual");
  assert.equal(inferModulePattern({ family: "custom" }, {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    edges: [{ source: "a", target: "b" }, { source: "a", target: "c" }, { source: "b", target: "d" }, { source: "c", target: "d" }],
  }), "parallel");
  assert.equal(inferModulePattern({ family: "custom" }, {
    nodes: [{ id: "q", family: "attention" }], edges: [],
  }), "attention");
  assert.equal(inferModulePattern({ family: "custom" }, {
    nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }],
  }), "sequential");
  assert.equal(inferModulePattern({ family: "custom", label: "Residual Attention" }, { nodes: [], edges: [] }), "opaque");
});

test("evidenced compound size grows from topology while opaque modules stay compact", () => {
  const expanded = compileSemanticVisualNode({
    family: "custom", compoundKind: "unresolved", w: 120, h: 80,
    attributes: { internalGraph: {
      nodes: Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, stage: index })),
      edges: [],
    } },
  });
  const opaque = compileSemanticVisualNode({ family: "custom", compoundKind: "unresolved", w: 120, h: 80 });
  assert.ok(expanded.geometryData.preferredWidth > opaque.geometryData.preferredWidth);
  assert.ok(expanded.geometryData.preferredHeight > opaque.geometryData.preferredHeight);
});

test("semantic grammar exposes normalized recurrent evidence and preserves uncertainty", () => {
  const compiled = compileSemanticVisualNode({
    id: "recurrent",
    family: "recurrent",
    op: "NamedButOpaqueCell",
    attributes: {
      repetition: { axis: "iteration", instances: ["previous", "current", "next"] },
      stateTransitions: [{ sourcePort: "s", targetPort: "s2", kind: "update", sourceEdgeId: "e1" }],
    },
  });

  assert.deepEqual(compiled.recurrentEvidence.repetition.instances, ["previous", "current", "next"]);
  assert.equal(compiled.recurrentEvidence.stateTransitions[0].sourceEdgeId, "e1");
  assert.equal(compiled.recurrentEvidence.internalGraph.status, "unresolved");
  assert.equal(recurrentEvidenceForNode(compiled).internalGraph.status, "unresolved");
});

test("semantic grammar fails closed for recurrent modules with invalid internal edges", () => {
  const compiled = compileSemanticVisualNode({
    id: "broken-cell",
    family: "recurrent",
    attributes: { internalGraph: { nodes: [{ id: "known" }], edges: [{ source: "known", target: "ghost" }] } },
  });
  assert.equal(compiled.visualRole, "unresolved-module");
  assert.equal(compiled.geometryData.hasInternalTopology, false);
  assert.equal(compiled.recurrentEvidence.internalGraph.status, "unresolved");
});

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
    compiled.geometryData.preferredWidth >= compiled.geometryData.preferredHeight,
    "publication feature-map blocks are wide, uniform cards, not thin 3D slabs"
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

test("semantic grammar derives an image plane for an RGB tensor input", () => {
  const grammar = inputVisualGrammarForNode({
    family: "input",
    op: "Input",
    label: "Input",
    subtitle: "224 x 224 x 3",
    shape: { output: [1, 3, 224, 224] },
  });

  assert.equal(grammar.kind, "image-input");
  assert.equal(grammar.channelCount, 3);
  assert.equal(grammar.spatialSize, 224);
  assert.equal(grammar.tensorRank, 3);
  assert.match(grammar.reason, /RGB|channel|image/i);
});

test("semantic grammar distinguishes sequence, state, vector, volume, and unknown inputs", () => {
  assert.equal(inputVisualGrammarForNode({ family: "input", label: "tokens", ports: { outputs: ["tokens", "time"] } }).kind, "sequence-input");
  assert.equal(inputVisualGrammarForNode({ family: "input", label: "hidden state", ports: { outputs: ["h_prev", "c_prev"] } }).kind, "state-input");
  assert.equal(inputVisualGrammarForNode({ family: "input", shape: { output: [1, 128] } }).kind, "vector-input");
  assert.equal(inputVisualGrammarForNode({ family: "input", label: "voxel volume", shape: { output: [1, 1, 96, 128, 128] } }).kind, "volume-input");
  assert.equal(inputVisualGrammarForNode({ family: "input", shape: { output: [1, 7, 11] } }).kind, "unknown-input");
});

test("compiled input nodes expose their input grammar and role-specific geometry", () => {
  const compiled = compileSemanticVisualNode({
    id: "image",
    family: "input",
    label: "RGB",
    subtitle: "224 x 224 x 3",
    shape: { output: [1, 3, 224, 224] },
  });

  assert.equal(compiled.visualRole, "image-input");
  assert.equal(compiled.inputGrammar.kind, "image-input");
  assert.equal(compiled.geometryData.inputGrammar, "image-input");
  assert.equal(compiled.geometryData.channelCount, 3);
});

test("explicit evidence modality outranks ambiguous shape and port hints", () => {
  const grammar = inputVisualGrammarForNode({
    family: "input",
    label: "x",
    shape: { output: [1, 3, 224, 224] },
    ports: { outputs: ["tokens"] },
    evidence: [{ modality: "sequence", kind: "source-annotation" }],
  });

  assert.equal(grammar.kind, "sequence-input");
  assert.match(grammar.reason, /explicit.*sequence/i);
});

test("symbolic H x W x 3 source evidence remains an image input", () => {
  const grammar = inputVisualGrammarForNode({
    family: "input",
    op: "tensor",
    label: "Input",
    subtitle: "H x W x 3",
  });

  assert.equal(grammar.kind, "image-input");
  assert.equal(grammar.tensorRank, 3);
  assert.equal(grammar.channelCount, 3);
});

test("recurrent topology distinguishes sequence input from state inputs", () => {
  const nodes = [
    { id: "x", family: "input", label: "x", ports: { outputs: ["x"] } },
    { id: "state", family: "input", label: "state", ports: { outputs: ["state"] } },
    { id: "cell", family: "recurrent", op: "RecurrentCell", ports: { inputs: ["x", "state"] } },
  ];
  const compiled = compileSemanticVisualNodes(nodes, [
    { source: "x", target: "cell", label: "x", type: "signal" },
    { source: "state", target: "cell", label: "state", type: "state" },
  ]);

  assert.equal(compiled.find((node) => node.id === "x").visualRole, "sequence-input");
  assert.equal(compiled.find((node) => node.id === "state").visualRole, "state-input");
});

test("named composite modules (C2f/SPPF) are labeled blocks, not expanded internals", () => {
  // Top-journal YOLO style: a named module is ONE colored block, never expanded.
  const node = { id: "c2f", family: "custom", op: "C2f", label: "C2f", compoundKind: "module" };
  assert.equal(visualRoleForNode(node), "named-module");
  assert.equal(compileSemanticVisualNode(node).visualRole, "named-module");
  assert.equal(styleProfileForRole("named-module"), "named-module");
});

test("custom modules stay unresolved (fail closed) without an explicit module kind", () => {
  assert.equal(visualRoleForNode({ id: "opaque", family: "custom", op: "MysteryOp" }), "unresolved-module");
  assert.equal(visualRoleForNode({ id: "u", family: "custom", compoundKind: "unresolved" }), "unresolved-module");
});

test("semantic grammar maps explicit control evidence to a decision glyph", () => {
  assert.equal(visualRoleForNode({ family: "custom", semanticRole: "control", attributes: { controlKind: "decision" } }), "decision");
  assert.equal(visualRoleForNode({ family: "custom", attributes: { controlKind: "if" } }), "decision");
});

test("semantic grammar does not treat arbitrary control metadata as a decision", () => {
  const node = compileSemanticVisualNode({
    id: "control",
    family: "custom",
    attributes: { controlKind: "synchronization" },
  });

  assert.equal(node.visualRole, "unresolved-module");
});

test("semantic grammar distinguishes additive and concatenating merges", () => {
  assert.equal(visualRoleForNode({ family: "merge", op: "add" }), "merge-add");
  assert.equal(visualRoleForNode({ family: "custom", attributes: { merge: { type: "concat" } } }), "merge-concat");
  assert.equal(visualRoleForNode({ family: "custom", semanticRole: "merge", attributes: { mergeType: "sum" } }), "merge-add");
});

test("semantic grammar maps explicit split and junction evidence", () => {
  assert.equal(visualRoleForNode({ family: "custom", semanticRole: "split" }), "split");
  assert.equal(visualRoleForNode({ family: "custom", attributes: { junctionRole: "fork" } }), "split");
  assert.equal(visualRoleForNode({ family: "custom", attributes: { junctionRole: "join" } }), "junction");
});

test("semantic grammar exposes evidenced repeat markers without inventing internals", () => {
  const compiled = compileSemanticVisualNode({ family: "custom", repeatCount: 6, semanticRole: "repeat" });
  assert.equal(compiled.visualRole, "repeat-marker");
  assert.equal(compiled.geometryData.repeatCount, 6);
  assert.equal(compiled.geometryData.hasInternalTopology, false);
});

test("semantic grammar maps explicit annotations and leaves unknown nodes compatible", () => {
  assert.equal(visualRoleForNode({ family: "custom", semanticRole: "annotation", annotation: "skip" }), "annotation");
  assert.equal(visualRoleForNode({ family: "custom", label: "unclassified" }), "unresolved-module");
});
