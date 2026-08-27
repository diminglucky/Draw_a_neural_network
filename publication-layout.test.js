const assert = require("node:assert/strict");
const test = require("node:test");

const artboard = { x: 170, y: 160, width: 2260, height: 1060 };
const layoutModule = () => require("./publication-layout.js");

const cnnIR = {
  title: "Publication CNN",
  subtitle: "Deterministic sequential CNN fixture",
  stages: [
    { id: "input", label: "Input" },
    { id: "conv1", label: "Conv Stem" },
    { id: "pool1", label: "Pooling" },
    { id: "conv2", label: "Conv Head" },
    { id: "pool2", label: "Pooling 2" },
    { id: "flat", label: "Readout" },
    { id: "fc", label: "Classifier" },
    { id: "out", label: "Prediction" },
  ],
  nodes: [
    { id: "cnn-input", type: "tensor", stage: "input", order: 10, label: "Image", subtitle: "32 x 32 x 1" },
    { id: "cnn-conv1", type: "conv", stage: "conv1", order: 10, label: "Conv 1", subtitle: "28 x 28 x 6" },
    { id: "cnn-pool1", type: "pool", stage: "pool1", order: 10, label: "Pool 1", subtitle: "14 x 14 x 6" },
    { id: "cnn-conv2", type: "conv", stage: "conv2", order: 10, label: "Conv 2", subtitle: "10 x 10 x 16" },
    { id: "cnn-pool2", type: "pool", stage: "pool2", order: 10, label: "Pool 2", subtitle: "5 x 5 x 16" },
    { id: "cnn-flat", type: "flatten", stage: "flat", order: 10, label: "Flatten", subtitle: "400-d" },
    { id: "cnn-fc", type: "dense-layer", stage: "fc", order: 10, label: "FC 120", subtitle: "dense" },
    { id: "cnn-out", type: "output", stage: "out", order: 10, label: "Softmax", subtitle: "10 classes" },
  ],
  edges: [
    { source: "cnn-input", target: "cnn-conv1", label: "pixels", type: "signal" },
    { source: "cnn-conv1", target: "cnn-pool1", label: "pool", type: "signal" },
    { source: "cnn-pool1", target: "cnn-conv2", label: "maps", type: "signal" },
    { source: "cnn-conv2", target: "cnn-pool2", label: "pool", type: "signal" },
    { source: "cnn-pool2", target: "cnn-flat", label: "flatten", type: "attention" },
    { source: "cnn-flat", target: "cnn-fc", label: "vector", type: "signal" },
    { source: "cnn-fc", target: "cnn-out", label: "logits", type: "signal" },
  ],
};

const unetIR = {
  title: "Publication U-Net",
  subtitle: "Skip-routing lane fixture",
  stages: [
    { id: "input", label: "Input" },
    { id: "enc1", label: "Encoder 1" },
    { id: "down1", label: "Downsample 1" },
    { id: "enc2", label: "Encoder 2" },
    { id: "bottleneck", label: "Bottleneck" },
    { id: "concat2", label: "Concat 2" },
    { id: "dec2", label: "Decoder 2" },
    { id: "concat1", label: "Concat 1" },
    { id: "dec1", label: "Decoder 1" },
    { id: "output", label: "Mask" },
  ],
  nodes: [
    { id: "unet-input", type: "tensor", stage: "input", order: 10, label: "Input", subtitle: "512 x 512" },
    { id: "unet-e1", type: "conv", stage: "enc1", order: 10, label: "Enc 64", subtitle: "copy" },
    { id: "unet-p1", type: "pool", stage: "down1", order: 10, label: "Pool", subtitle: "down x2" },
    { id: "unet-e2", type: "conv", stage: "enc2", order: 10, label: "Enc 128", subtitle: "copy" },
    { id: "unet-b", type: "volume-stack", stage: "bottleneck", order: 10, label: "Bottleneck", subtitle: "semantic core" },
    { id: "unet-cat2", type: "concat", stage: "concat2", order: 10, label: "Concat", subtitle: "skip e2" },
    { id: "unet-d2", type: "conv", stage: "dec2", order: 10, label: "Dec 128", subtitle: "decode" },
    { id: "unet-cat1", type: "concat", stage: "concat1", order: 10, label: "Concat", subtitle: "skip e1" },
    { id: "unet-d1", type: "conv", stage: "dec1", order: 10, label: "Dec 64", subtitle: "decode" },
    { id: "unet-mask", type: "output", stage: "output", order: 10, label: "Mask", subtitle: "H x W x C" },
  ],
  edges: [
    { source: "unet-input", target: "unet-e1", type: "signal" },
    { source: "unet-e1", target: "unet-p1", label: "down", type: "signal" },
    { source: "unet-p1", target: "unet-e2", label: "down", type: "signal" },
    { source: "unet-e2", target: "unet-b", label: "down", type: "signal" },
    { source: "unet-b", target: "unet-cat2", label: "up", type: "signal" },
    { source: "unet-e2", target: "unet-cat2", label: "copy", type: "skip" },
    { source: "unet-cat2", target: "unet-d2", label: "concat", type: "attention" },
    { source: "unet-d2", target: "unet-cat1", label: "up", type: "signal" },
    { source: "unet-e1", target: "unet-cat1", label: "copy", type: "skip" },
    { source: "unet-cat1", target: "unet-d1", label: "concat", type: "attention" },
    { source: "unet-d1", target: "unet-mask", label: "1x1", type: "signal" },
  ],
};

const transformerIR = {
  title: "Publication Transformer",
  subtitle: "Multi-node stage fixture",
  stages: [
    { id: "image", label: "Image" },
    { id: "tokenize", label: "Token Prep" },
    { id: "embed", label: "Embedding" },
    { id: "encoder", label: "Transformer" },
    { id: "head", label: "Prediction" },
  ],
  nodes: [
    { id: "vit-head", type: "dense-layer", stage: "head", order: 10, label: "MLP Head", subtitle: "1000 classes" },
    { id: "vit-pos", type: "token", stage: "tokenize", order: 30, label: "Positional", subtitle: "1 x N" },
    { id: "vit-image", type: "tensor", stage: "image", order: 10, label: "Image", subtitle: "224 x 224 x 3" },
    { id: "vit-patch", type: "patch-grid", stage: "tokenize", order: 20, label: "Patchify", subtitle: "14 x 14" },
    { id: "vit-cls", type: "token", stage: "tokenize", order: 10, label: "[CLS]", subtitle: "class token" },
    { id: "vit-embed", type: "flatten", stage: "embed", order: 10, label: "Linear Embed", subtitle: "196 x 768" },
    { id: "vit-encoder", type: "encoder", stage: "encoder", order: 10, label: "Transformer", subtitle: "MHSA + MLP" },
  ],
  edges: [
    { source: "vit-image", target: "vit-patch", label: "patches", type: "signal" },
    { source: "vit-cls", target: "vit-embed", label: "prepend", type: "skip" },
    { source: "vit-pos", target: "vit-embed", label: "add", type: "skip" },
    { source: "vit-patch", target: "vit-embed", label: "tokens", type: "attention" },
    { source: "vit-embed", target: "vit-encoder", label: "sequence", type: "attention" },
    { source: "vit-encoder", target: "vit-head", label: "CLS", type: "signal" },
  ],
};

function reverseFixture(ir) {
  return {
    ...ir,
    nodes: [...ir.nodes].reverse(),
    edges: [...ir.edges].reverse(),
  };
}

function sanitizeLayout(layout) {
  return {
    figure: layout.figure,
    paletteName: layout.paletteName,
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      stage: node.stage,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      label: node.label,
      subtitle: node.subtitle,
      color: node.color,
      bwStyle: node.bwStyle,
    })),
    edges: layout.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.label,
      color: edge.color,
      bwStyle: edge.bwStyle,
      route: edge.route,
    })),
    validation: summarizeReport(layout.validation),
  };
}

function summarizeReport(report) {
  return {
    ok: report.ok,
    summary: report.summary,
    overlapCount: report.overlaps.length,
    invalidEdgeCount: report.invalidEdges.length,
    boundaryCount: report.boundaryViolations.length,
    stageOrderCount: report.stageOrderIssues.length,
    unreadableCount: report.unreadableNodes.length,
    styleIssueCount: report.styleIssues.length,
    stageColumns: report.stageColumns.map((column) => ({
      index: column.index,
      label: column.label,
      x: column.x,
      nodeIds: column.nodeIds,
    })),
    skipLanes: report.skipLanes.map((lane) => ({
      edgeId: lane.edgeId,
      laneIndex: lane.laneIndex,
      laneY: lane.laneY,
    })),
  };
}

function assertNoOverlaps(nodes) {
  for (let left = 0; left < nodes.length; left += 1) {
    const a = nodes[left];
    for (let right = left + 1; right < nodes.length; right += 1) {
      const b = nodes[right];
      const intersects = !(
        a.x + a.w <= b.x ||
        b.x + b.w <= a.x ||
        a.y + a.h <= b.y ||
        b.y + b.h <= a.y
      );
      assert.equal(intersects, false, `${a.id} overlaps ${b.id}`);
    }
  }
}

function assertLegalEndpoints(layout) {
  const ids = new Set(layout.nodes.map((node) => node.id));
  layout.edges.forEach((edge) => {
    assert.ok(ids.has(edge.source), `${edge.id} source is missing`);
    assert.ok(ids.has(edge.target), `${edge.id} target is missing`);
  });
}

function assertReadableBounds(nodes) {
  const margin = 24;
  nodes.forEach((node) => {
    assert.ok(node.x >= artboard.x + margin, `${node.id} is too close to left edge`);
    assert.ok(node.y >= artboard.y + margin, `${node.id} is too close to top edge`);
    assert.ok(node.x + node.w <= artboard.x + artboard.width - margin, `${node.id} is too close to right edge`);
    assert.ok(node.y + node.h <= artboard.y + artboard.height - margin, `${node.id} is too close to bottom edge`);
  });
}

function byId(layout, id) {
  return layout.nodes.find((node) => node.id === id);
}

test("layoutNetworkIR keeps CNN layout deterministic for the same IR semantics", () => {
  const { layoutNetworkIR } = layoutModule();

  const baseline = layoutNetworkIR(cnnIR);
  const reversed = layoutNetworkIR(reverseFixture(cnnIR));

  assert.deepEqual(sanitizeLayout(reversed), sanitizeLayout(baseline));
  assert.deepEqual(baseline.figure.stages, cnnIR.stages.map((stage) => stage.label));
  assert.equal(baseline.paletteName, "dopamine");
});

test("validatePublicationLayout accepts a U-Net layout with non-overlapping nodes, legal endpoints, and skip lanes", () => {
  const { layoutNetworkIR, validatePublicationLayout } = layoutModule();

  const layout = layoutNetworkIR(unetIR);
  const report = validatePublicationLayout(layout);

  assert.equal(report.ok, true);
  assert.equal(layout.validation.ok, true);
  assert.deepEqual(summarizeReport(layout.validation), summarizeReport(report));
  assertNoOverlaps(layout.nodes);
  assertLegalEndpoints(layout);
  assertReadableBounds(layout.nodes);
  assert.equal(report.overlaps.length, 0);
  assert.equal(report.invalidEdges.length, 0);
  assert.equal(report.boundaryViolations.length, 0);
  assert.equal(report.stageOrderIssues.length, 0);

  const skipEdges = layout.edges.filter((edge) => edge.type === "skip");
  assert.equal(skipEdges.length, 2);
  assert.equal(new Set(skipEdges.map((edge) => edge.route?.laneIndex)).size, skipEdges.length);
  skipEdges.forEach((edge) => {
    assert.ok(Array.isArray(edge.route?.points), `${edge.id} is missing routed skip points`);
    assert.equal(edge.route.points.length, 4, `${edge.id} should have four routed points`);
  });
});

test("layoutNetworkIR keeps stage columns ordered, vertical sorting stable, and styles publication-safe for Transformer fixtures", () => {
  const { layoutNetworkIR, validatePublicationLayout } = layoutModule();

  const layout = layoutNetworkIR(transformerIR, { paletteName: "dopamine" });
  const report = validatePublicationLayout(layout);
  const tokenPrepNodes = layout.nodes
    .filter((node) => node.stage === 1)
    .sort((left, right) => left.y - right.y)
    .map((node) => node.id);

  assert.equal(report.ok, true);
  assert.deepEqual(report.stageColumns.map((column) => column.label), transformerIR.stages.map((stage) => stage.label));
  assert.ok(report.stageColumns.every((column, index, list) => index === 0 || column.x > list[index - 1].x));
  assert.deepEqual(tokenPrepNodes, ["vit-cls", "vit-patch", "vit-pos"]);
  assertNoOverlaps(layout.nodes);
  assertLegalEndpoints(layout);
  assertReadableBounds(layout.nodes);

  assert.equal(byId(layout, "vit-image").color, "#00e5ff");
  assert.equal(byId(layout, "vit-patch").color, "#c9ff2e");
  assert.equal(byId(layout, "vit-encoder").color, "#2f6bff");
  assert.equal(byId(layout, "vit-head").color, "#ff4fd8");

  assert.deepEqual(byId(layout, "vit-cls").bwStyle, {
    fillPattern: "dot",
    strokePattern: "solid",
    tone: "light",
  });
  assert.deepEqual(byId(layout, "vit-encoder").bwStyle, {
    fillPattern: "horizontal-stripe",
    strokePattern: "solid",
    tone: "dark",
  });

  const attentionEdge = layout.edges.find((edge) => edge.type === "attention");
  assert.deepEqual(attentionEdge.bwStyle, {
    linePattern: "dash",
    weight: "medium",
  });
  assert.equal(report.styleIssues.length, 0);
  assert.equal(report.unreadableNodes.length, 0);
});
