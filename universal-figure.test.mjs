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

test("selectFigureGrammar chooses a semantic grammar from topology, not a model label", () => {
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

test("selectFigureGrammar recognizes explicit repetition and state-transition evidence without a recurrent family label", () => {
  const grammar = selectFigureGrammar({
    nodes: [{
      id: "cell",
      family: "custom",
      attributes: {
        repetition: { axis: "time", instances: ["t-1", "t", "t+1"] },
        stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", kind: "carry" }],
      },
    }],
    edges: [],
  });

  assert.equal(grammar.id, "recurrent-flow");
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

test("layoutUniversalFigure derives recurrent instance identities from sourceNodeId", () => {
  const layout = layoutUniversalFigure({
    nodes: [{
      id: "layout-cell",
      sourceNodeId: "source-cell",
      family: "custom",
      attributes: {
        repetition: { axis: "time", instances: ["t-1", "t", "t+1"] },
        stateTransitions: [{ sourcePort: "h_prev", targetPort: "h_next", kind: "carry" }],
      },
    }],
    edges: [],
  });

  assert.deepEqual(
    layout.recurrentLayout.instances.map((instance) => instance.id),
    ["source-cell:previous", "source-cell:expanded", "source-cell:next"],
  );
  assert.equal(layout.recurrentLayout.expandedInstanceId, "source-cell:expanded");
  assert.equal(layout.recurrentLayout.stateRails.length, 0);
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

test("layoutUniversalFigure keeps recurrent instances inside the artboard", () => {
  const layout = layoutUniversalFigure({
    nodes: [{ id: "cell", family: "recurrent", op: "LSTMCell", stage: 0 }],
    edges: [],
  });
  const { x, y, width, height } = layout.artboard;
  assert.ok(layout.recurrentLayout.instances.every((instance) => (
    instance.x >= x && instance.y >= y
      && instance.x + instance.w <= x + width
      && instance.y + instance.h <= y + height
  )));
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

test("layoutUniversalFigure lays a long linear chain left-to-right on a single row", () => {
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

  assert.equal(layout.validation.ok, true);
  // A deep chain flows left-to-right on a single continuous row: the east-face
  // depth is a translucent projection that overlaps the next tensor, so the
  // figure stays compact instead of collapsing into a ribbon or wrapping.
  const ordered = [...layout.nodes].sort((left, right) => left.x - right.x);
  assert.equal(ordered.length, layout.nodes.length);
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].x - (ordered[index - 1].x + ordered[index - 1].w);
    assert.ok(gap >= 0, `consecutive nodes must not overlap, got ${gap}`);
  }
  const ys = layout.nodes.map((node) => node.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 220, "nodes should sit on one row, not wrap");
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

test("universal figure keeps pooling and merge as distinct publication symbols", () => {
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

  assert.equal(layout.nodes.find((node) => node.id === "pool").representation, "publication-block");
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
  assert.equal(layout.nodes.find((node) => node.id === "fc").representation, "publication-block");
  assert.equal(layout.nodes.find((node) => node.id === "flatten").representation, "publication-block");
  assert.equal(layout.nodes.find((node) => node.id === "output").representation, "publication-block");
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

test("universal layout restores publication hierarchy without a model-specific rule", () => {
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
  assert.equal(ordered.at(-1).representation, "publication-block");
  assert.ok(ordered.find((node) => node.visualRole === "feature-map-stage").h >= 40);
  assert.ok(ordered.find((node) => node.visualRole === "neuron-layer").w >= 100);
  assert.ok(layout.artboard.height <= 900);
});

test("universal layout renders spatial stages as uniform publication blocks", () => {
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
  const stages = layout.nodes.filter((node) => node.visualRole === "feature-map-stage");

  assert.ok(stages.length >= 1, "expected a condensed spatial stage");
  for (const stage of stages) {
    assert.equal(stage.representation, "publication-block");
    assert.ok(stage.w >= 100, `expected a wide publication block, got width ${stage.w}`);
    assert.ok(stage.w / stage.h >= 1, `expected a wide card ratio, got ${stage.w}/${stage.h}`);
  }
});

test("universal layout renders every processing layer as a uniform publication block", () => {
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
  assert.equal(pools.length, 2);
  // Every processing layer is a uniform publication block; the tensor shape
  // is carried in the subtitle, not encoded in the block geometry.
  for (const node of [featureStages[0], pools[0], dense, output]) {
    assert.equal(node.representation, "publication-block");
    assert.ok(node.w >= 100, `expected a wide publication block, got ${node.w}`);
    assert.ok(node.h >= 40, `expected a readable card height, got ${node.h}`);
  }
});

test("single-lane tensor layout follows role-specific publication stage gaps", () => {
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
  assert.equal(pool.x - (conv.x + conv.w), 40, "pool should sit close to the source tensor front face");
  assert.equal(nextConv.x - (pool.x + pool.w), 60, "next feature stage should receive the publication stage gap");
});

test("single-lane layout projects tensor depth as an overlapping east face without consuming width", () => {
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
  // The east face is a translucent perspective projection that overlaps the
  // next tensor, so it must not push the next node further right.
  assert.ok(pool.x - (conv.x + conv.w) >= 8, "pool sits past the source tensor front face");
  assert.ok(nextConv.x - (pool.x + pool.w) >= 20, "next tensor sits past the pool front face");
});

test("skip/residual edges route as a smooth upward arc, not a 3-point dogleg", () => {
  const layout = layoutUniversalFigure({
    figure: { title: "flat residual" },
    nodes: [
      { id: "input", op: "Input", family: "input", stage: 0, label: "x" },
      { id: "c1", op: "Conv2d", family: "conv", stage: 1, label: "3×3,64" },
      { id: "bn", op: "BatchNorm2d", family: "norm", stage: 2, label: "BN" },
      { id: "add", op: "Add", family: "merge", stage: 3, label: "+" },
      { id: "output", op: "Output", family: "output", stage: 4, label: "y" },
    ],
    edges: [
      { id: "e1", source: "input", target: "c1", type: "signal" },
      { id: "e2", source: "c1", target: "bn", type: "signal" },
      { id: "e3", source: "bn", target: "add", type: "signal" },
      { id: "skip", source: "input", target: "add", type: "residual" },
      { id: "e4", source: "add", target: "output", type: "signal" },
    ],
  });

  const skip = layout.edges.find((edge) => edge.id === "skip");
  assert.equal(skip.route.kind, "skip-lane");
  assert.ok(skip.route.points.length >= 12, `bezier-sampled arc should be dense, got ${skip.route.points.length}`);
  const [start, end] = [skip.route.points[0], skip.route.points.at(-1)];
  const apexY = Math.min(...skip.route.points.map((point) => point.y));
  // 弧线向上拱起：顶点 y 明显高于首尾端点的 y。
  assert.ok(apexY < start.y - 50, `arc should crest well above the source, apex=${apexY} start=${start.y}`);
  assert.ok(apexY < end.y - 50, `arc should crest well above the target, apex=${apexY} end=${end.y}`);
  // 首尾点与端点一致（起点在 source 右侧，终点在 target 左侧）。
  assert.equal(start.x, layout.nodes.find((node) => node.id === "input").x + layout.nodes.find((node) => node.id === "input").w);
  assert.equal(end.y, start.y, "arc returns to the same baseline as the main branch");
});

test("layoutUniversalFigure marks fork and merge junction roles", () => {
  const layout = layoutUniversalFigure({
    figure: { title: "flat residual" },
    nodes: [
      { id: "input", op: "Input", family: "input", stage: 0, label: "x" },
      { id: "c1", op: "Conv2d", family: "conv", stage: 1, label: "3×3" },
      { id: "add", op: "Add", family: "merge", stage: 2, label: "+" },
      { id: "output", op: "Output", family: "output", stage: 3, label: "y" },
    ],
    edges: [
      { id: "e1", source: "input", target: "c1", type: "signal" },
      { id: "e2", source: "c1", target: "add", type: "signal" },
      { id: "skip", source: "input", target: "add", type: "residual" },
      { id: "e3", source: "add", target: "output", type: "signal" },
    ],
  });

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get("input").junctionRole, "fork", "two outgoing edges should mark a fork");
  assert.equal(byId.get("add").junctionRole, "merge", "two incoming edges should mark a merge");
  assert.equal(byId.get("c1").junctionRole, undefined, "linear interior node should carry no junction role");
  assert.equal(byId.get("output").junctionRole, undefined);
});

test("layoutUniversalFigure ignores self-loops when computing junction roles", () => {
  const layout = layoutUniversalFigure({
    figure: { title: "recurrent self-loop" },
    nodes: [
      { id: "in", op: "Input", family: "input", stage: 0, label: "x" },
      { id: "rnn", op: "LSTM", family: "recurrent", stage: 1, label: "LSTM" },
      { id: "out", op: "Output", family: "output", stage: 2, label: "y" },
    ],
    edges: [
      { id: "e1", source: "in", target: "rnn", type: "signal" },
      { id: "loop", source: "rnn", target: "rnn", type: "loop" },
      { id: "e2", source: "rnn", target: "out", type: "signal" },
    ],
  });

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get("rnn").junctionRole, undefined, "a self-loop must not mark the node as fork or merge");
});

test("layoutUniversalFigure arranges an FPN detector into backbone/neck/head columns", () => {
  const mod = (id, stage, h) => ({
    id, family: "custom", op: id, label: id, compoundKind: "module", stage, order: stage,
    shape: { output: [h, h, 64] },
  });
  const nodes = [
    { id: "in", family: "input", op: "Input", label: "Input", stage: 0, order: 0, shape: { output: [640, 640, 3] } },
    mod("b1", 1, 320), mod("b2", 2, 160), mod("b3", 3, 80), mod("b4", 4, 40), mod("b5", 5, 20),
    { id: "u1", family: "upsample", op: "Upsample", label: "Upsample", stage: 6, order: 6, shape: { output: [40, 40, 64] } },
    mod("n1", 7, 40),
    { id: "u2", family: "upsample", op: "Upsample", label: "Upsample", stage: 8, order: 8, shape: { output: [80, 80, 64] } },
    mod("n2", 9, 80), mod("n3", 10, 40), mod("n4", 11, 20),
    { id: "det", family: "output", op: "Detect", label: "Detect", stage: 12, order: 12, shape: { output: [20, 20, 255] } },
  ];
  const groups = [
    { id: "bb", label: "Backbone", kind: "backbone", nodeIds: ["in", "b1", "b2", "b3", "b4", "b5"] },
    { id: "nk", label: "Neck", kind: "neck", nodeIds: ["u1", "n1", "u2", "n2", "n3", "n4"] },
    { id: "hd", label: "Head", kind: "head", nodeIds: ["det"] },
  ];
  const edges = [
    ["in", "b1"], ["b1", "b2"], ["b2", "b3"], ["b3", "b4"], ["b4", "b5"],
    ["b5", "u1"], ["u1", "n1"], ["b3", "n1", "skip"],
    ["n1", "u2"], ["u2", "n2"], ["b2", "n2", "skip"],
    ["n2", "n3"], ["n1", "n3", "skip"],
    ["n3", "n4"], ["b5", "n4", "skip"],
    ["n4", "det"],
  ].map(([s, t, type], i) => ({ id: `e${i}`, source: s, target: t, type: type || "signal" }));

  const layout = layoutUniversalFigure({ nodes, groups, edges });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  const col = (ids) => ({
    left: Math.min(...ids.map((id) => byId.get(id).x)),
    right: Math.max(...ids.map((id) => byId.get(id).x + byId.get(id).w)),
  });
  const backbone = col(["in", "b1", "b2", "b3", "b4", "b5"]);
  const neck = col(["u1", "n1", "u2", "n2", "n3", "n4"]);
  const head = col(["det"]);

  assert.ok(backbone.right <= neck.left, "backbone column must sit left of the neck");
  assert.ok(neck.right <= head.left, "neck column must sit left of the head");

  // Resolution lanes run top-to-bottom: larger H above smaller H.
  assert.ok(byId.get("in").y < byId.get("b5").y, "input (640) must sit above the final backbone stage (20)");
  assert.ok(byId.get("n2").y < byId.get("n1").y, "upsampled neck stage (80) must sit above (40)");
  // Same resolution shares a lane.
  assert.equal(byId.get("b3").y, byId.get("n2").y, "nodes at the same resolution must share a lane");

  assert.equal(layout.validation.ok, true, "pyramid layout must not overlap or violate the artboard");
});

test("layoutUniversalFigure arranges a U-Net into encoder/bottleneck/decoder columns", () => {
  const mod = (id, family, stage, h) => ({
    id, family, op: id, label: id, stage, order: stage,
    shape: { output: [h, h, 64] },
  });
  const nodes = [
    { id: "in", family: "input", op: "Input", label: "Input", stage: 0, order: 0, shape: { output: [64, 64, 3] } },
    mod("enc1", "conv", 1, 64), mod("enc2", "conv", 2, 32), mod("enc3", "conv", 3, 16),
    mod("bot", "conv", 4, 8),
    { id: "dec1", family: "upsample", op: "Upsample", label: "Upsample", stage: 5, order: 5, shape: { output: [16, 16, 64] } },
    mod("dec2", "conv", 6, 32), mod("dec3", "conv", 7, 64),
    { id: "out", family: "output", op: "Output", label: "Output", stage: 8, order: 8, shape: { output: [64, 64, 1] } },
  ];
  const groups = [
    { id: "enc", label: "Encoder", kind: "encoder", nodeIds: ["in", "enc1", "enc2", "enc3"] },
    { id: "bot", label: "Bottleneck", kind: "bottleneck", nodeIds: ["bot"] },
    { id: "dec", label: "Decoder", kind: "decoder", nodeIds: ["dec1", "dec2", "dec3", "out"] },
  ];
  const edges = [
    ["in", "enc1"], ["enc1", "enc2"], ["enc2", "enc3"], ["enc3", "bot"],
    ["bot", "dec1"], ["dec1", "dec2"], ["dec2", "dec3"], ["dec3", "out"],
    ["enc1", "dec3", "skip"], ["enc2", "dec2", "skip"], ["enc3", "dec1", "skip"],
  ].map(([s, t, type], i) => ({ id: `e${i}`, source: s, target: t, type: type || "signal" }));

  const layout = layoutUniversalFigure({ nodes, groups, edges });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  const col = (ids) => ({
    left: Math.min(...ids.map((id) => byId.get(id).x)),
    right: Math.max(...ids.map((id) => byId.get(id).x + byId.get(id).w)),
  });
  const encoder = col(["in", "enc1", "enc2", "enc3"]);
  const bottleneck = col(["bot"]);
  const decoder = col(["dec1", "dec2", "dec3", "out"]);

  assert.ok(encoder.right <= bottleneck.left, "encoder column must sit left of the bottleneck");
  assert.ok(bottleneck.right <= decoder.left, "bottleneck column must sit left of the decoder");

  assert.ok(byId.get("in").y < byId.get("bot").y, "input (64) must sit above the bottleneck (8)");
  assert.ok(byId.get("dec3").y < byId.get("bot").y, "decoder output (64) must sit above the bottleneck (8)");
  assert.equal(byId.get("enc1").y, byId.get("dec3").y, "skip-linked nodes at the same resolution share a lane");

  assert.equal(layout.validation.ok, true, "U-Net layout must not overlap or violate the artboard");
});

test("layoutUniversalFigure honors sizeOverrides for a family's default dimensions", () => {
  const layout = layoutUniversalFigure(
    { nodes: [{ id: "c", family: "custom", op: "Block", label: "Block", stage: 0 }] },
    { sizeOverrides: { custom: [200, 100] } },
  );
  const node = layout.nodes.find((n) => n.id === "c");
  assert.equal(node.w, 200);
  assert.equal(node.h, 100);
});

test("named modules render as accepted color blocks, not unresolved structure", () => {
  const layout = layoutUniversalFigure({
    figure: { title: "YOLO-style fixture" },
    nodes: [
      { id: "input", family: "input", op: "Input", label: "x", stage: 0 },
      { id: "c2f", family: "custom", compoundKind: "module", op: "C2f", label: "C2f", stage: 1 },
      { id: "sppf", family: "custom", compoundKind: "module", op: "SPPF", label: "SPPF", stage: 2 },
      { id: "output", family: "output", op: "Output", label: "y", stage: 3 },
    ],
    edges: [
      { id: "e1", source: "input", target: "c2f", type: "signal" },
      { id: "e2", source: "c2f", target: "sppf", type: "signal" },
      { id: "e3", source: "sppf", target: "output", type: "signal" },
    ],
  });

  const c2f = layout.nodes.find((node) => node.id === "c2f");
  const sppf = layout.nodes.find((node) => node.id === "sppf");
  assert.equal(c2f.visualRole, "named-module");
  assert.equal(sppf.visualRole, "named-module");
  assert.equal(c2f.inner.kind, "semantic", "named modules must not be flagged as unresolved inner topology");
  assert.equal(c2f.note, "", "named modules must not carry an unresolved-structure note");
  assert.equal(sppf.note, "");
});
