import assert from "node:assert/strict";
import test from "node:test";
import { layoutNetworkIR, validatePublicationLayout } from "./publication-layout.js";

const artboard = { x: 170, y: 160, width: 2260, height: 1060 };

function fixture(kind) {
  if (kind === "cnn") {
    return {
      title: "CNN",
      stages: ["input", "conv", "pool", "head"],
      nodes: [
        { id: "image", type: "tensor", stage: "input", order: 1, label: "Image", subtitle: "32 x 32" },
        { id: "conv", type: "conv", stage: "conv", order: 1, label: "Conv 3x3", subtitle: "32 channels" },
        { id: "pool", type: "pool", stage: "pool", order: 1, label: "MaxPool", subtitle: "stride 2" },
        { id: "head", type: "output", stage: "head", order: 1, label: "Prediction", subtitle: "10 classes" },
      ],
      edges: [
        { source: "image", target: "conv", label: "pixels" },
        { source: "conv", target: "pool", label: "feature maps" },
        { source: "pool", target: "head", label: "logits" },
      ],
    };
  }
  if (kind === "unet") {
    return {
      title: "U-Net",
      stages: ["input", "encoder", "bottleneck", "decoder", "output"],
      nodes: [
        { id: "in", type: "tensor", stage: "input", order: 1, label: "Input", subtitle: "512 x 512" },
        { id: "enc", type: "conv", stage: "encoder", order: 1, label: "Encoder", subtitle: "64 channels" },
        { id: "bottleneck", type: "volume-stack", stage: "bottleneck", order: 1, label: "Bottleneck", subtitle: "semantic core" },
        { id: "dec", type: "conv", stage: "decoder", order: 1, label: "Decoder", subtitle: "64 channels" },
        { id: "out", type: "output", stage: "output", order: 1, label: "Mask", subtitle: "H x W x C" },
      ],
      edges: [
        { source: "in", target: "enc" },
        { source: "enc", target: "bottleneck" },
        { source: "bottleneck", target: "dec" },
        { source: "dec", target: "out" },
        { source: "enc", target: "dec", type: "skip", label: "copy" },
        { source: "in", target: "dec", type: "skip", label: "shallow copy" },
      ],
    };
  }
  return {
    title: "Transformer",
    stages: ["image", "tokens", "encoder", "head"],
    nodes: [
      { id: "image", type: "tensor", stage: "image", order: 1, label: "Image", subtitle: "224 x 224" },
      { id: "patch", type: "patch-grid", stage: "tokens", order: 20, label: "Patchify", subtitle: "14 x 14" },
      { id: "cls", type: "token", stage: "tokens", order: 10, label: "[CLS]", subtitle: "class token" },
      { id: "encoder", type: "encoder", stage: "encoder", order: 1, label: "Transformer", subtitle: "MHSA + MLP" },
      { id: "head", type: "dense-layer", stage: "head", order: 1, label: "MLP Head", subtitle: "1000 classes" },
    ],
    edges: [
      { source: "image", target: "patch" },
      { source: "patch", target: "encoder", type: "attention", label: "tokens" },
      { source: "cls", target: "encoder", type: "skip", label: "prepend" },
      { source: "encoder", target: "head" },
    ],
  };
}

function assertNoOverlap(nodes) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      assert.equal(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, false);
    }
  }
}

function assertInBounds(layout) {
  layout.nodes.forEach((node) => {
    assert.ok(node.x >= artboard.x + 24 && node.y >= artboard.y + 24);
    assert.ok(node.x + node.w <= artboard.x + artboard.width - 24);
    assert.ok(node.y + node.h <= artboard.y + artboard.height - 24);
  });
}

test("layouts CNN, U-Net, and Transformer IRs as valid publication diagrams", () => {
  for (const kind of ["cnn", "unet", "transformer"]) {
    const layout = layoutNetworkIR(fixture(kind));
    assert.deepEqual(layout.figure.stages, fixture(kind).stages);
    assert.equal(layout.validation.ok, true, kind);
    assertNoOverlap(layout.nodes);
    assertInBounds(layout);
    const ids = new Set(layout.nodes.map((node) => node.id));
    layout.edges.forEach((edge) => {
      assert.ok(ids.has(edge.source));
      assert.ok(ids.has(edge.target));
      assert.ok(edge.color);
      assert.ok(edge.bwStyle);
    });
    layout.nodes.forEach((node) => {
      assert.ok(node.label.trim());
      assert.ok(node.color);
      assert.ok(node.bwStyle);
    });
  }
});

test("layout is independent of input ordering and keeps vertical order stable", () => {
  const ir = fixture("transformer");
  const baseline = layoutNetworkIR(ir);
  const reversed = layoutNetworkIR({ ...ir, nodes: [...ir.nodes].reverse(), edges: [...ir.edges].reverse() });
  assert.deepEqual(JSON.parse(JSON.stringify(reversed)), JSON.parse(JSON.stringify(baseline)));
  assert.deepEqual(Array.from(baseline.nodes.filter((node) => node.stage === 1), (node) => node.id), ["cls", "patch"]);
  assert.ok(baseline.nodes.every((node) => Number.isInteger(node.stage)));
});

test("skip edges receive distinct lanes and route endpoints on node anchors", () => {
  const layout = layoutNetworkIR(fixture("unet"));
  const skips = layout.edges.filter((edge) => edge.type === "skip");
  assert.equal(skips.length, 2);
  assert.equal(skips[0].route.kind, "skip-lane");
  assert.equal(skips[0].route.points.length, 4);
  const source = layout.nodes.find((node) => node.id === skips[0].source);
  const target = layout.nodes.find((node) => node.id === skips[0].target);
  assert.deepEqual({ ...skips[0].route.points[0] }, { x: source.x + source.w, y: source.y + Math.round(source.h / 2) });
  assert.deepEqual({ ...skips[0].route.points.at(-1) }, { x: target.x, y: target.y + Math.round(target.h / 2) });
  assert.equal(new Set(skips.map((edge) => edge.route.laneIndex)).size, skips.length);
});

test("validator reports overlaps, missing endpoints, and unreadable labels", () => {
  const layout = layoutNetworkIR(fixture("cnn"));
  layout.nodes[1].x = layout.nodes[0].x;
  layout.nodes[1].y = layout.nodes[0].y;
  layout.nodes[1].label = "";
  layout.edges.push({ id: "bad", source: "missing", target: "image", type: "signal", label: "" });
  const report = validatePublicationLayout(layout);
  assert.equal(report.ok, false);
  assert.ok(report.overlaps.length > 0);
  assert.ok(report.invalidEdges.length > 0);
  assert.ok(report.unreadableNodes.some((item) => item.nodeId === layout.nodes[1].id));
});

test("dense columns stay inside the artboard without negative spacing", () => {
  const ir = {
    stages: [{ id: "only", label: "Only" }],
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, stage: "only", type: "default", order: index, label: `Block ${index}` })),
    edges: [],
  };
  const layout = layoutNetworkIR(ir);
  assertInBounds(layout);
  assert.equal(layout.validation.ok, true);
});

test("accepts the formal NetworkIR shape returned by AgentService", () => {
  const formalNetworkIR = {
    figure: {
      id: "formal-cnn",
      title: "Agent CNN",
      description: "Formal NetworkIR fixture",
    },
    nodes: [
      { id: "input", kind: "input", stage: 0, label: "Input", tensor: { shape: "32 x 32 x 3" } },
      { id: "features", kind: "conv", stage: 1, label: "Conv 3x3", tensor: { shape: "28 x 28 x 16" } },
      { id: "classifier", kind: "classifier", stage: 2, label: "Classifier", tensor: { shape: "10" } },
      { id: "output", kind: "output", stage: 3, label: "Prediction", tensor: { shape: "10 classes" } },
    ],
    edges: [
      { source: "input", target: "features", kind: "forward", label: "features" },
      { source: "features", target: "classifier", kind: "forward", label: "flatten" },
      { source: "features", target: "output", kind: "residual", skip: true, label: "shortcut" },
      { source: "classifier", target: "output", kind: "forward", label: "logits" },
    ],
    groups: [],
    annotations: [],
    style: { palette: "dopamine" },
    layout: { direction: "left-to-right" },
  };

  const layout = layoutNetworkIR(formalNetworkIR);
  assert.equal(layout.figure.title, "Agent CNN");
  assert.deepEqual(Array.from(layout.figure.stages), ["Stage 1", "Stage 2", "Stage 3", "Stage 4"]);
  assert.deepEqual(Array.from(layout.nodes, (node) => node.type), ["tensor", "conv", "dense-layer", "output"]);
  assert.deepEqual(Array.from(layout.nodes, (node) => node.stage), [0, 1, 2, 3]);
  const skip = layout.edges.find((edge) => edge.label === "shortcut");
  assert.equal(skip.type, "skip");
  assert.equal(skip.route.kind, "skip-lane");
  assert.equal(layout.validation.ok, true);
});

test("preserves VGG16 visual metadata for the Visio worker", () => {
  const layout = layoutNetworkIR({
    figure: { id: "vgg16", title: "VGG16 Architecture", description: "publication" },
    nodes: [
      { id: "block-1", kind: "conv", stage: 0, label: "Conv + ReLU", subtitle: "224 x 224 x 64", tensor: { shape: [224, 224, 64] }, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 2, depth: 6, perspective: true, color: "#4f86c6" },
      { id: "block-3", kind: "conv", stage: 1, label: "Conv + ReLU", subtitle: "56 x 56 x 256", tensor: { shape: [56, 56, 256] }, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 3, depth: 10, perspective: true, color: "#4f86c6", visualEncoding: { visiblePlaneCount: 6, extrusionDepthFu: 24, projection: "oblique-3d", spatialShape: [56, 56] } },
      { id: "pool-1", kind: "pool", stage: 2, label: "MaxPool 2x2", subtitle: "112 x 112", visualRole: "pooling-block", layerRole: "max-pooling", repeatCount: 1, depth: 2, perspective: true, color: "#c65b5b" },
    ],
    edges: [{ source: "block-1", target: "block-3", kind: "flow" }, { source: "block-3", target: "pool-1", kind: "flow" }],
  });
  assert.equal(layout.nodes[0].visualRole, "feature-map-stack");
  assert.equal(layout.nodes[0].layerRole, "convolution-relu");
  assert.equal(layout.nodes[0].repeatCount, 2);
  assert.equal(layout.nodes[0].perspective, true);
  assert.deepEqual(layout.nodes.find((node) => node.id === "block-3").visualEncoding, {
    visiblePlaneCount: 6,
    extrusionDepthFu: 24,
    projection: "oblique-3d",
    spatialShape: [56, 56],
  });
  assert.equal(layout.nodes.find((node) => node.id === "pool-1").visualRole, "pooling-block");
});

test("attaches a validated Figure Plan V3 only for the VGG16 publication preset", () => {
  const layout = layoutNetworkIR({
    figure: { id: "vgg16", title: "VGG16 Architecture", description: "publication" },
    nodes: [
      { id: "input", kind: "input", stage: 0, label: "Input image", tensor: { shape: [224, 224, 3] }, visualRole: "feature-map-stack", layerRole: "input", channelCount: 3, visualEncoding: { visiblePlaneCount: 3, extrusionDepthFu: 10, projection: "oblique-3d", spatialShape: [224, 224] } },
      { id: "block-1", kind: "conv", stage: 1, label: "Conv + ReLU", tensor: { shape: [224, 224, 64] }, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 2, channelCount: 64, visualEncoding: { visiblePlaneCount: 6, extrusionDepthFu: 24, projection: "oblique-3d", spatialShape: [224, 224] } },
    ],
    edges: [{ source: "input", target: "block-1", kind: "forward" }],
  });
  assert.equal(layout.figurePlan.version, 1);
  assert.equal(layout.figurePlan.validation.valid, true);
  assert.equal(layout.figurePlan.styleId, "vgg-tensor-plate-v3");
  assert.equal(layout.figurePlan.primitiveGroups[1].kind, "feature-map-stack");
});
