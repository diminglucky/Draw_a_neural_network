import assert from "node:assert/strict";
import test from "node:test";
import {
  layoutUniversalFigure,
  selectFigureGrammar,
} from "./universal-figure.mjs";

function residualIR() {
  return {
    figure: { title: "Residual fixture" },
    nodes: [
      { id: "input", op: "Input", family: "input", stage: 0, label: "x" },
      { id: "block", op: "Bottleneck", family: "custom", stage: 1, label: "Bottleneck", attributes: {
        internalGraph: {
          nodes: [
            { id: "norm", op: "LayerNorm", family: "norm", label: "Norm" },
            { id: "main", op: "Conv3x3", family: "conv", label: "3×3" },
            { id: "add", op: "Add", family: "merge", label: "+" },
          ],
          edges: [
            { id: "inner-main", source: "norm", target: "main", type: "signal" },
            { id: "inner-add", source: "main", target: "add", type: "residual" },
            { id: "inner-skip", source: "norm", target: "add", type: "residual" },
          ],
        },
      } },
      { id: "output", op: "Output", family: "output", stage: 2, label: "y" },
    ],
    edges: [
      { id: "forward", source: "input", target: "block", type: "signal" },
      { id: "skip", source: "input", target: "output", type: "skip" },
      { id: "tail", source: "block", target: "output", type: "signal" },
    ],
  };
}

test("selectFigureGrammar chooses a semantic grammar from topology, not a template name", () => {
  const grammar = selectFigureGrammar(residualIR());
  assert.equal(grammar.id, "residual-graph");
  assert.match(grammar.reason, /residual|skip/i);
});

test("selectFigureGrammar chooses recurrent-flow for recurrent evidence before generic grammars", () => {
  const recurrentNode = selectFigureGrammar({
    nodes: [{ id: "cell", family: "recurrent", op: "GRUCell" }],
    edges: [],
  });
  const stateEdge = selectFigureGrammar({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ source: "a", target: "b", type: "state" }],
  });
  const recurrentStateEdge = selectFigureGrammar({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ source: "a", target: "b", type: "recurrent-state" }],
  });
  const loopEdge = selectFigureGrammar({
    nodes: [{ id: "cell", family: "custom" }],
    edges: [{ source: "cell", target: "cell", type: "loop" }],
  });

  for (const grammar of [recurrentNode, stateEdge, recurrentStateEdge, loopEdge]) {
    assert.equal(grammar.id, "recurrent-flow");
    assert.match(grammar.reason, /recurrent|state|loop/i);
  }
});

test("selectFigureGrammar exposes control-flow grammar for conditional topology", () => {
  const layout = layoutUniversalFigure({
    nodes: [
      { id: "input", family: "input", stage: 0 },
      { id: "condition", family: "custom", compoundKind: "unresolved", stage: 1, attributes: { controlKind: "conditional" } },
      { id: "output", family: "output", stage: 2 },
    ],
    edges: [
      { id: "in", source: "input", target: "condition", type: "signal" },
      { id: "yes", source: "condition", target: "output", type: "alternative" },
    ],
  });

  assert.equal(layout.grammar.id, "control-flow");
  assert.equal(layout.edges.find((edge) => edge.id === "yes").route.kind, "skip-lane");
});

test("layoutUniversalFigure keeps recurrent flow grammar, metadata, and loop routing", () => {
  const layout = layoutUniversalFigure({
    nodes: [
      { id: "input", family: "input", stage: 0, label: "Sequence" },
      { id: "cell", family: "recurrent", stage: 1, label: "GRU cell", op: "GRUCell" },
    ],
    edges: [
      { id: "input-state", source: "input", target: "cell", type: "state" },
      { id: "cell-loop", source: "cell", target: "cell", type: "loop" },
    ],
  });
  const cell = layout.nodes.find((node) => node.id === "cell");

  assert.equal(layout.grammar.id, "recurrent-flow");
  assert.equal(cell.visualRole, "recurrent-state");
  assert.equal(cell.geometryData.timeAxis, "left-to-right");
  assert.equal(cell.geometryData.stateFlow, "feedback-loop");
  assert.equal(cell.geometryData.preservesStateFlow, true);
  assert.equal(layout.edges.find((edge) => edge.id === "cell-loop").route.kind, "loop");
  assert.equal(layout.recurrentLayout.stateRails.find((rail) => rail.sourceEdgeId === "cell-loop").kind, "carry");
});

test("layoutUniversalFigure unrolls recurrent evidence into three stable instances and one expanded current step", () => {
  const layout = layoutUniversalFigure({
    nodes: [{
      id: "cell",
      family: "recurrent",
      op: "LSTMCell",
      label: "Opaque recurrent cell",
      stage: 0,
      attributes: {
        repetition: { axis: "time", instances: ["t-1", "t", "t+1"], sharedParameters: true },
        stateTransitions: [{
          id: "carry-transition",
          sourcePort: "h_prev",
          targetPort: "h_next",
          kind: "carry",
          sourceEdgeId: "carry-edge",
        }],
        internalGraph: {
          nodes: [{ id: "actual-linear", op: "Linear", label: "Evidence-only operation" }],
          edges: [],
          ports: { inputs: ["x"], states: ["h_prev"], outputs: ["h_next"] },
        },
      },
    }],
    edges: [{
      id: "carry-edge",
      source: "cell",
      target: "cell",
      type: "state",
      ports: { source: "h_prev", target: "h_next" },
    }],
  });

  assert.equal(layout.grammar.id, "recurrent-flow");
  assert.deepEqual(layout.recurrentLayout.timeAxis, {
    axis: "time",
    direction: "left-to-right",
    labels: ["previous", "current", "next"],
  });
  assert.deepEqual(layout.recurrentLayout.instances.map((instance) => instance.role), ["previous", "expanded", "next"]);
  assert.equal(layout.recurrentLayout.instances.length, 3);
  assert.equal(layout.recurrentLayout.instances.filter((instance) => instance.expanded).length, 1);
  assert.equal(layout.recurrentLayout.expandedInstanceId, "cell:expanded");
  assert.deepEqual(layout.recurrentLayout.instances.map((instance) => instance.sourceNodeId), ["cell", "cell", "cell"]);
  assert.ok(layout.recurrentLayout.instances[0].x < layout.recurrentLayout.instances[1].x);
  assert.ok(layout.recurrentLayout.instances[1].w > layout.recurrentLayout.instances[0].w);
  assert.equal(layout.recurrentLayout.stateRails[0].sourceEdgeId, "carry-edge");
  assert.equal(layout.recurrentLayout.stateRails[0].kind, "carry");
  assert.ok(layout.recurrentLayout.stateRails[0].points.length >= 3);
  assert.deepEqual(layout.recurrentLayout.expandedInternalGraph.nodes.map((node) => node.id), ["actual-linear"]);
  assert.equal(layout.recurrentLayout.expandedInternalGraph.status, "resolved");
  assert.equal(layout.edges.find((edge) => edge.id === "carry-edge").route.kind, "loop");
});

test("layoutUniversalFigure marks recurrent expansion unresolved without internal evidence", () => {
  const layout = layoutUniversalFigure({
    nodes: [{ id: "opaque-cell", family: "recurrent", op: "GRU", stage: 0 }],
    edges: [],
  });

  assert.equal(layout.recurrentLayout.expandedInternalGraph.status, "unresolved");
  assert.equal(layout.recurrentLayout.uncertainty.unresolved, true);
  assert.match(layout.recurrentLayout.uncertainty.reason, /internal topology/i);
  assert.equal(layout.nodes[0].inner.kind, "unresolved");
});

test("layoutUniversalFigure preserves arbitrary internal topology inside a compound node", () => {
  const layout = layoutUniversalFigure(residualIR());
  const block = layout.nodes.find((node) => node.id === "block");
  assert.equal(block.representation, "compound");
  assert.deepEqual(block.inner.nodes.map((node) => node.id), ["norm", "main", "add"]);
  assert.equal(block.inner.edges.length, 3);
  assert.ok(block.inner.edges.some((edge) => edge.type === "residual"));
  assert.equal(layout.validation.ok, true);
});

test("layoutUniversalFigure packs a long single-lane graph with a readable width-aware gap", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, order: 0, label: "Input", w: 122, h: 188 },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `conv-${index + 1}`,
      family: "conv",
      stage: index + 1,
      order: index + 1,
      label: `Conv ${index + 1}`,
      w: 150,
      h: 220,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `pool-${index + 1}`,
      family: "pool",
      stage: index + 6,
      order: index + 6,
      label: "MaxPool",
      w: 92,
      h: 92,
    })),
    { id: "flatten", family: "flatten", stage: 11, order: 11, label: "Flatten", w: 150, h: 138 },
    { id: "fc1", family: "dense", stage: 12, order: 12, label: "Linear 4096", w: 132, h: 210 },
    { id: "fc2", family: "dense", stage: 13, order: 13, label: "Linear 4096", w: 132, h: 210 },
    { id: "output", family: "output", stage: 14, order: 14, label: "Linear 1000", w: 110, h: 148 },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: index === 10 ? "attention" : "signal",
  }));
  const layout = layoutUniversalFigure({ nodes, edges });
  const ordered = [...layout.nodes].sort((left, right) => left.order - right.order);
  const gaps = ordered.slice(1).map((node, index) => (
    node.x - (ordered[index].x + ordered[index].w + ordered[index].geometryData.visualRightOutset)
  ));

  assert.equal(layout.validation.ok, true);
  assert.ok(Math.min(...gaps) >= 12, `expected publication gaps to preserve readable clearance, got ${gaps.join(", ")}`);
  assert.ok(gaps.includes(12), `expected the compact source-to-pool gap, got ${gaps.join(", ")}`);
  assert.ok(layout.artboard.height <= 700, `expected a compact single-lane page, got height ${layout.artboard.height}`);
});

test("layoutUniversalFigure marks an opaque custom node unresolved instead of inventing children", () => {
  const ir = { nodes: [{ id: "custom", op: "OpaqueBlock", family: "custom", stage: 0, label: "OpaqueBlock" }], edges: [] };
  const layout = layoutUniversalFigure(ir);
  const custom = layout.nodes[0];
  assert.equal(custom.representation, "compound");
  assert.equal(custom.inner.kind, "unresolved");
  assert.equal(custom.inner.nodes.length, 0);
  assert.match(custom.note, /unresolved|review/i);
});

test("universal figure keeps pooling geometry distinct from merge symbols", () => {
  const layout = layoutUniversalFigure({
    nodes: [
      { id: "conv", family: "conv", stage: 0, label: "Conv" },
      { id: "pool", family: "pool", stage: 1, label: "MaxPool" },
      { id: "merge", family: "merge", stage: 2, label: "Add" },
    ],
    edges: [
      { id: "e1", source: "conv", target: "pool" },
      { id: "e2", source: "pool", target: "merge" },
    ],
  });

  assert.equal(layout.nodes.find((node) => node.id === "pool").representation, "pool-prism");
  assert.equal(layout.nodes.find((node) => node.id === "merge").representation, "operator-symbol");
});

test("universal figure maps each input visual role to a distinct representation and geometry", () => {
  const nodes = [
    {
      id: "image",
      family: "input",
      stage: 0,
      label: "Image",
      shape: { output: [1, 3, 224, 224] },
    },
    {
      id: "sequence",
      family: "input",
      stage: 1,
      label: "tokens",
      ports: { outputs: ["tokens", "time"] },
    },
    {
      id: "state",
      family: "input",
      stage: 2,
      label: "hidden state",
      ports: { outputs: ["h_prev", "c_prev"] },
    },
    {
      id: "vector",
      family: "input",
      stage: 3,
      shape: { output: [1, 128] },
    },
    {
      id: "volume",
      family: "input",
      stage: 4,
      label: "voxel volume",
      shape: { output: [1, 1, 96, 128, 128] },
    },
    {
      id: "unknown",
      family: "input",
      stage: 5,
      shape: { output: [1, 7, 11] },
    },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `input-edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: "signal",
  }));

  const layout = layoutUniversalFigure({ nodes, edges });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  assert.deepEqual(
    [...byId.values()].map((node) => [node.visualRole, node.representation]),
    [
      ["image-input", "image-plane"],
      ["sequence-input", "sequence-strip"],
      ["state-input", "state-vector"],
      ["vector-input", "vector-column"],
      ["volume-input", "volume"],
      ["unknown-input", "unknown-outline"],
    ],
  );
  assert.equal(byId.get("image").geometryData.inputGrammar, "image-input");
  assert.equal(byId.get("image").geometryData.tensorRank, 3);
  assert.equal(byId.get("image").geometryData.channelCount, 3);
  assert.equal(byId.get("image").geometryData.spatialSize, 224);
  assert.equal(byId.get("state").geometryData.modalityReason, "state port or hidden/cell evidence");
  assert.equal(byId.get("volume").geometryData.tensorRank, 4);
  assert.equal(byId.get("unknown").geometryData.inputGrammar, "unknown-input");
  assert.equal(layout.validation.ok, true);
});

test("universal figure groups linear convolution runs into evidence-backed stages", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, label: "Input" },
    { id: "conv1", family: "conv", stage: 1, order: 1, label: "Conv 64", shape: { output: [224, 224, 64] } },
    { id: "conv2", family: "conv", stage: 2, order: 2, label: "Conv 64", shape: { output: [224, 224, 64] } },
    { id: "pool1", family: "pool", stage: 3, order: 3, label: "MaxPool", shape: { output: [112, 112, 64] } },
    { id: "conv3", family: "conv", stage: 4, order: 4, label: "Conv 128", shape: { output: [112, 112, 128] } },
    { id: "conv4", family: "conv", stage: 5, order: 5, label: "Conv 128", shape: { output: [112, 112, 128] } },
    { id: "flatten", family: "flatten", stage: 6, order: 6, label: "Flatten" },
    { id: "fc", family: "dense", stage: 7, order: 7, label: "Linear 4096" },
    { id: "output", family: "output", stage: 8, order: 8, label: "Softmax" },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: "signal",
  }));
  const layout = layoutUniversalFigure({ nodes, edges });
  const blocks = layout.nodes.filter((node) => node.family === "conv");

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((node) => node.repeatCount), [2, 2]);
  assert.deepEqual(blocks.map((node) => node.inner.nodes.map((child) => child.id)), [
    ["conv1", "conv2"],
    ["conv3", "conv4"],
  ]);
  assert.equal(layout.nodes.find((node) => node.id === "fc").representation, "classifier-prism");
  assert.equal(layout.nodes.find((node) => node.id === "flatten").representation, "flatten-ribbon");
  assert.equal(layout.nodes.find((node) => node.id === "output").representation, "softmax-prism");
  assert.equal(layout.validation.ok, true);
});

test("universal layout carries topology-derived semantic visual metadata", () => {
  const layout = layoutUniversalFigure({
    nodes: [
      {
        id: "spatial",
        family: "conv",
        label: "Spatial operator",
        shape: { output: [1, 32, 32, 64] },
        repeatCount: 2,
      },
      {
        id: "vector",
        family: "flatten",
        label: "Vectorize",
        shape: { output: [1, 2048] },
      },
    ],
    edges: [{ id: "flow", source: "spatial", target: "vector", type: "signal" }],
  });

  const spatial = layout.nodes.find((node) => node.id === "spatial");
  const vector = layout.nodes.find((node) => node.id === "vector");
  assert.equal(spatial.visualRole, "feature-map-stage");
  assert.equal(spatial.styleProfile, "feature-map");
  assert.equal(spatial.labelSlots.tensorShape, "below");
  assert.equal(spatial.geometryData.repeatCount, 2);
  assert.equal(vector.visualRole, "vectorize");
  assert.equal(vector.styleProfile, "vectorize");
});

test("universal layout restores publication hierarchy without a model-specific template", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, label: "Input", shape: { output: [1, 224, 224, 3] } },
    { id: "conv-a", family: "conv", stage: 1, label: "Conv 64", shape: { output: [1, 224, 224, 64] } },
    { id: "conv-b", family: "conv", stage: 2, label: "Conv 64", shape: { output: [1, 224, 224, 64] } },
    { id: "pool", family: "pool", stage: 3, label: "MaxPool", subtitle: "112 x 112 x 64 · k2 · s2", shape: { output: [1, 112, 112, 64] } },
    { id: "flatten", family: "flatten", stage: 4, label: "Flatten", shape: { output: [1, 802816] } },
    { id: "hidden", family: "dense", stage: 5, label: "Linear 4096", shape: { output: [1, 4096] } },
    { id: "output", family: "dense", stage: 6, label: "Linear 1000", shape: { output: [1, 1000] } },
  ];
  const layout = layoutUniversalFigure({
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      source: node.id,
      target: nodes[index + 1].id,
      type: "signal",
    })),
  });

  const ordered = [...layout.nodes].sort((left, right) => left.order - right.order);
  assert.deepEqual(ordered.map((node) => node.figureLabel), ["Input", "CONV 1", "MP", "Flatten", "FC 1", "OUTPUT"]);
  assert.equal(ordered.at(-1).visualRole, "output-distribution");
  assert.equal(ordered.at(-1).representation, "softmax-prism");
  assert.ok(ordered.find((node) => node.visualRole === "feature-map-stage").h >= 220);
  assert.ok(ordered.find((node) => node.visualRole === "neuron-layer").w <= 96);
  assert.ok(layout.artboard.height <= 900);
});

test("universal layout keeps repeated spatial stages narrow relative to their vertical feature-map extent", () => {
  const nodes = [
    { id: "a", family: "conv", stage: 0, order: 0, label: "Conv 32", shape: { output: [1, 64, 64, 32] } },
    { id: "b", family: "conv", stage: 1, order: 1, label: "Conv 64", shape: { output: [1, 64, 64, 64] } },
    { id: "c", family: "conv", stage: 2, order: 2, label: "Conv 128", shape: { output: [1, 32, 32, 128] } },
  ];
  const layout = layoutUniversalFigure({
    nodes,
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ],
  });
  const stage = layout.nodes.find((node) => node.visualRole === "feature-map-stage");

  assert.ok(stage, "expected a condensed spatial stage");
  assert.ok(stage.w <= 150, `expected a narrow stage, got width ${stage.w}`);
  assert.ok(stage.w / stage.h <= 0.65, `expected a thin stage ratio, got ${stage.w}/${stage.h}`);
});

test("universal layout scales tensor modules by evidenced spatial resolution instead of equal card sizes", () => {
  const nodes = [
    { id: "input", family: "input", stage: 0, order: 0, label: "Input", shape: { output: [1, 224, 224, 3] } },
    { id: "conv-a", family: "conv", stage: 1, order: 1, label: "Conv 64", shape: { output: [1, 224, 224, 64] } },
    { id: "pool-a", family: "pool", stage: 2, order: 2, label: "MaxPool", shape: { output: [1, 112, 112, 64] } },
    { id: "conv-b", family: "conv", stage: 3, order: 3, label: "Conv 128", shape: { output: [1, 112, 112, 128] } },
    { id: "pool-b", family: "pool", stage: 4, order: 4, label: "MaxPool", shape: { output: [1, 56, 56, 128] } },
    { id: "conv-c", family: "conv", stage: 5, order: 5, label: "Conv 256", shape: { output: [1, 56, 56, 256] } },
    { id: "flatten", family: "flatten", stage: 6, order: 6, label: "Flatten", shape: { input: [1, 56, 56, 256], output: [1, 802816] } },
    { id: "hidden", family: "dense", stage: 7, order: 7, label: "Linear 4096", shape: { output: [1, 4096] } },
    { id: "output", family: "dense", stage: 8, order: 8, label: "Linear 10", shape: { output: [1, 10] } },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
    type: "signal",
  }));
  const layout = layoutUniversalFigure({ nodes, edges });
  const ordered = [...layout.nodes].sort((left, right) => left.order - right.order);
  const featureStages = ordered.filter((node) => node.visualRole === "feature-map-stage");
  const pools = ordered.filter((node) => node.visualRole === "pool-downsample");
  const dense = ordered.find((node) => node.visualRole === "neuron-layer");
  const output = ordered.find((node) => node.visualRole === "output-distribution");

  assert.equal(featureStages.length, 3);
  assert.ok(featureStages[0].h > featureStages[1].h, "later spatial stages should be visibly shorter");
  assert.ok(featureStages[1].h > featureStages[2].h, "later spatial stages should continue to contract");
  assert.equal(pools[0].h, featureStages[1].h, "pool should use its downsampled tensor height");
  assert.equal(pools[1].h, featureStages[2].h, "later pool should use its downsampled tensor height");
  assert.ok(pools.every((pool) => pool.w <= 60), "pool should stay a narrow Box between spatial stages");
  assert.ok(dense.w <= 72, `dense column should remain thin, got ${dense.w}`);
  assert.ok(output.w <= 72, `output distribution should remain thin, got ${output.w}`);
  assert.ok(output.h < dense.h, "output distribution should be shorter than a hidden neuron layer");
});

test("single-lane tensor layout follows role-specific PlotNeuralNet stage gaps", () => {
  const nodes = [
    { id: "conv-a", family: "conv", stage: 0, order: 0, label: "Conv 64", shape: { output: [1, 112, 112, 64] } },
    { id: "pool-a", family: "pool", stage: 1, order: 1, label: "MaxPool", shape: { output: [1, 56, 56, 64] } },
    { id: "conv-b", family: "conv", stage: 2, order: 2, label: "Conv 128", shape: { output: [1, 56, 56, 128] } },
  ];
  const layout = layoutUniversalFigure({
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index}`, source: node.id, target: nodes[index + 1].id })),
  });
  const ordered = [...layout.nodes].sort((left, right) => left.order - right.order);

  const [conv, pool, nextConv] = ordered;
  assert.equal(pool.x - (conv.x + conv.w + conv.geometryData.visualRightOutset), 12, "pool should sit close to the projected source tensor");
  assert.equal(nextConv.x - (pool.x + pool.w + pool.geometryData.visualRightOutset), 96, "next feature stage should receive the publication stage gap");
});

test("single-lane layout reserves the projected tensor depth before placing the next stage", () => {
  const nodes = [
    { id: "conv-a", family: "conv", stage: 0, order: 0, label: "Conv 64", shape: { output: [1, 112, 112, 64] } },
    { id: "pool-a", family: "pool", stage: 1, order: 1, label: "MaxPool", shape: { output: [1, 56, 56, 64] } },
    { id: "conv-b", family: "conv", stage: 2, order: 2, label: "Conv 128", shape: { output: [1, 56, 56, 128] } },
  ];
  const layout = layoutUniversalFigure({
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index}`, source: node.id, target: nodes[index + 1].id })),
  });
  const [conv, pool, nextConv] = [...layout.nodes].sort((left, right) => left.order - right.order);

  assert.ok(conv.geometryData.visualRightOutset >= Math.round(conv.h * 0.3), "feature-map depth must derive from tensor height");
  assert.ok(pool.geometryData.visualRightOutset >= Math.round(pool.h * 0.3), "pool depth must derive from tensor height");
  assert.ok(pool.x - (conv.x + conv.w + conv.geometryData.visualRightOutset) >= 12, "pool must clear the preceding tensor projection");
  assert.ok(nextConv.x - (pool.x + pool.w + pool.geometryData.visualRightOutset) >= 96, "the next tensor must clear the pool projection");
});
