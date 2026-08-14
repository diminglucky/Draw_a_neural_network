import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicationFigurePlan, validatePublicationFigurePlan } from "./publication-figure-plan.js";

function node(id, stage, tensor, visualRole, repeatCount = 1, channelCount = tensor[2] ?? tensor.at(-1)) {
  return {
    id,
    kind: visualRole === "pooling-block" ? "pool" : visualRole === "fully-connected" ? "dense" : visualRole === "softmax-block" ? "classifier" : "conv",
    label: id,
    stage,
    tensor: { shape: tensor, dtype: "float32" },
    visualRole,
    layerRole: visualRole,
    repeatCount,
    channelCount,
    visualEncoding: {
      visiblePlaneCount: visualRole === "feature-map-stack" ? 6 : 2,
      extrusionDepthFu: visualRole === "feature-map-stack" ? 24 : 10,
      projection: "oblique-3d",
      spatialShape: tensor.slice(0, 2),
    },
  };
}

function vgg16Ir() {
  const nodes = [
    node("input", 0, [224, 224, 3], "feature-map-stack", 1, 3),
    node("block-1", 1, [224, 224, 64], "feature-map-stack", 2),
    node("pool-1", 2, [112, 112, 64], "pooling-block"),
    node("block-2", 3, [112, 112, 128], "feature-map-stack", 2),
    node("pool-2", 4, [56, 56, 128], "pooling-block"),
    node("block-3", 5, [56, 56, 256], "feature-map-stack", 3),
    node("pool-3", 6, [28, 28, 256], "pooling-block"),
    node("block-4", 7, [28, 28, 512], "feature-map-stack", 3),
    node("pool-4", 8, [14, 14, 512], "pooling-block"),
    node("block-5", 9, [14, 14, 512], "feature-map-stack", 3),
    node("pool-5", 10, [7, 7, 512], "pooling-block"),
    node("fc-1", 11, [1, 1, 4096], "fully-connected", 1, 4096),
    node("fc-2", 12, [1, 1, 4096], "fully-connected", 1, 4096),
    node("softmax", 13, [1, 1, 1000], "softmax-block", 1, 1000),
  ];
  return {
    figure: { id: "vgg16", title: "VGG16 Architecture", description: "VGG Paper Style V1" },
    nodes,
    edges: nodes.slice(1).map((item, index) => ({ source: nodes[index].id, target: item.id, kind: "forward" })),
  };
}

test("builds a canonical top-left VGG16 Figure Plan with native multi-plane groups", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  assert.deepEqual(plan.coordinateSpace, {
    unit: "figure-unit",
    figureUnitInches: 0.01,
    origin: "top-left",
    width: 1600,
    height: 540,
  });
  const block3 = plan.primitiveGroups.find((group) => group.id === "block-3");
  assert.equal(block3.kind, "feature-map-stack");
  assert.deepEqual(block3.primitiveIds.slice(-3), ["block-3.plane-3.front", "block-3.plane-3.top", "block-3.plane-3.side"]);
  assert.equal(block3.semantic.channelCount, 256);
  assert.equal(validatePublicationFigurePlan(plan).valid, true);
});

test("uses strictly decreasing feature-map front heights after VGG pooling stages", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const heights = ["block-1", "block-2", "block-3", "block-4", "block-5"]
    .map((id) => plan.primitiveGroups.find((group) => group.id === id).bounds.height);
  assert.deepEqual(heights, [...heights].sort((left, right) => right - left));
  assert.equal(new Set(heights).size, heights.length);
});

test("rejects a Figure Plan with a missing native feature-map stack face", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const broken = structuredClone(plan);
  broken.primitiveGroups.find((group) => group.id === "block-3").primitiveIds.pop();
  const validation = validatePublicationFigurePlan(broken);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.violations, ["missing-stack-face:block-3.plane-3.side", "invalid-stack-plane-count:block-3"]);
});

test("builds VGG blocks as multi-plane feature-map stacks with local stage headings", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const groups = plan.primitiveGroups;
  const occupiedRight = Math.max(...groups.map((group) => group.bounds.x + group.bounds.width));
  const labels = new Map(plan.labels.map((label) => [label.id, label]));
  const block1 = groups.find((group) => group.id === "block-1");

  assert.equal(plan.styleId, "vgg-tensor-plate-v3");
  assert.equal(plan.rendererFamily, "cnn-tensor-plate");
  assert.deepEqual(plan.coordinateSpace, {
    unit: "figure-unit",
    figureUnitInches: 0.01,
    origin: "top-left",
    width: 1600,
    height: 540,
  });
  assert.equal(block1.kind, "feature-map-stack");
  assert.equal(block1.primitiveIds.length, 6);
  assert.deepEqual(block1.primitiveIds.slice(0, 3), ["block-1.plane-1.front", "block-1.plane-1.top", "block-1.plane-1.side"]);
  assert.equal(groups.find((group) => group.id === "input").kind, "input-rgb-tile");
  assert.equal(groups.find((group) => group.id === "pool-1").kind, "downsample-transition");
  assert.ok(occupiedRight >= 1510, "the VGG main stem should use the publication page width");
  assert.equal(labels.get("block-1.heading").text, "CONV 1");
  assert.match(labels.get("block-1.detail").text, /^3×3 · 64 ×2\n224×224×64$/);
  assert.equal(labels.get("pool-1.detail").text, "MaxPool 2×2");
  assert.equal(labels.get("fc-1.detail").text, "4096 units");
  assert.equal(plan.figure.title, "VGG-16");
});

test("uses concise local annotations with publication-scale heading and detail type", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const labels = new Map(plan.labels.map((label) => [label.id, label]));
  const blockHeading = labels.get("block-1.heading");
  const blockDetail = labels.get("block-1.detail");
  const poolDetail = labels.get("pool-1.detail");
  const softmaxDetail = labels.get("softmax.detail");

  assert.equal(blockHeading.text, "CONV 1");
  assert.ok(blockHeading.fontSizePt >= 10, "stage labels must remain readable at page-fit zoom");
  assert.ok(blockDetail.fontSizePt >= 8.5, "tensor labels must remain readable at page-fit zoom");
  assert.equal(poolDetail.text, "MaxPool 2×2");
  assert.equal(softmaxDetail.text, "1000 classes");
});

test("encodes VGG16 repetitions and classifier grammar as a compact tensor plate", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const groups = new Map(plan.primitiveGroups.map((group) => [group.id, group]));

  assert.equal(plan.styleId, "vgg-tensor-plate-v3");
  assert.equal(plan.coordinateSpace.height, 540);
  assert.equal(groups.get("block-1").primitiveIds.length, 6);
  assert.equal(groups.get("block-2").primitiveIds.length, 6);
  assert.equal(groups.get("block-3").primitiveIds.length, 9);
  assert.equal(groups.get("pool-1").kind, "downsample-transition");
  assert.equal(groups.get("pool-1").semantic.inputSpatialSize, 224);
  assert.equal(groups.get("pool-1").semantic.outputSpatialSize, 112);
  assert.equal(groups.get("flatten").kind, "flatten-ribbon");
  assert.deepEqual(groups.get("flatten").primitiveIds, ["flatten.ribbon"]);
  assert.equal(groups.get("fc-1").kind, "dense-vector-layer");
  assert.equal(groups.get("fc-2").kind, "dense-vector-layer");
  assert.equal(groups.get("softmax").kind, "score-vector-layer");
  assert.equal(groups.get("fc-1").primitiveIds.length, 8);
  assert.equal(groups.get("softmax").primitiveIds.length, 7);
  assert.ok(plan.primitiveGroups.every((group) => Number.isInteger(group.semantic.stage)));
  assert.equal(plan.validation.valid, true);
});
