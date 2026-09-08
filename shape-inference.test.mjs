import assert from "node:assert/strict";
import test from "node:test";
import { inferShapes, diagnoseShapes, buildShapeFeedback } from "./generic-source-topology.mjs";

function run(nodes, edges) {
  inferShapes(nodes, edges);
  return nodes.reduce((acc, node) => {
    acc[node.id] = node.shape?.output;
    return acc;
  }, {});
}

test("inferShapes propagates through a residual add with matching branch shapes", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
    { id: "c1", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 64, 3, 1, 1" }, stage: 1, order: 0 },
    { id: "c2", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 64, 3, 1, 1" }, stage: 1, order: 1 },
    { id: "add", family: "merge", op: "Add", attributes: {}, stage: 2, order: 0 },
    { id: "out", family: "output", op: "Output", attributes: {}, stage: 3, order: 0 },
  ];
  const edges = [
    { source: "in", target: "c1" },
    { source: "c1", target: "c2" },
    { source: "c2", target: "add" },
    { source: "in", target: "add" },
    { source: "add", target: "out" },
  ];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.in, [56, 56, 64]);
  assert.deepEqual(shapes.c1, [56, 56, 64]);
  assert.deepEqual(shapes.c2, [56, 56, 64]);
  assert.deepEqual(shapes.add, [56, 56, 64]);
  assert.deepEqual(shapes.out, [56, 56, 64]);
});

test("inferShapes leaves a mismatched residual add unresolved instead of guessing", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
    { id: "pool", family: "pool", op: "MaxPool2d", attributes: { constructorArgs: "2, 2" }, stage: 1, order: 0 },
    { id: "add", family: "merge", op: "Add", attributes: {}, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "pool" },
    { source: "pool", target: "add" },
    { source: "in", target: "add" },
  ];
  const shapes = run(nodes, edges);
  // pool 把 56 -> 28，而残差边仍是 56，形状不一致，merge 必须保持未解决。
  assert.deepEqual(shapes.pool, [28, 28, 64]);
  assert.equal(shapes.add, undefined);
});

test("inferShapes concatenates along the channel dimension", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [28, 28, 64] } },
    { id: "a", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 128, 3, 1, 1" }, stage: 1, order: 0 },
    { id: "b", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 192, 3, 1, 1" }, stage: 1, order: 1 },
    { id: "cat", family: "merge", op: "Concat", attributes: {}, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "a" },
    { source: "in", target: "b" },
    { source: "a", target: "cat" },
    { source: "b", target: "cat" },
  ];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.a, [28, 28, 128]);
  assert.deepEqual(shapes.b, [28, 28, 192]);
  assert.deepEqual(shapes.cat, [28, 28, 320]);
});

test("inferShapes passes attention through unchanged", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [197, 768] } },
    { id: "attn", family: "attention", op: "MultiheadAttention", attributes: {}, stage: 1, order: 0 },
    { id: "out", family: "output", op: "Output", attributes: {}, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "attn" },
    { source: "attn", target: "out" },
  ];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.attn, [197, 768]);
  assert.deepEqual(shapes.out, [197, 768]);
});

test("inferShapes applies dilated convolution via effective kernel", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [28, 28, 3] } },
    { id: "d", family: "conv", op: "Conv2d", attributes: { constructorArgs: "3, 64, 3, dilation=2" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "d" }];
  const shapes = run(nodes, edges);
  // effective kernel = 3 + (3-1)*(2-1) = 5; floor((28 - 5)/1) + 1 = 24
  assert.deepEqual(shapes.d, [24, 24, 64]);
});

test("inferShapes upsamples with a transposed convolution", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [7, 7, 64] } },
    { id: "up", family: "conv", op: "ConvTranspose2d", attributes: { constructorArgs: "64, 32, 4, 2, 1" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "up" }];
  const shapes = run(nodes, edges);
  // (7-1)*2 - 2*1 + (4-1)*1 + 1 = 14
  assert.deepEqual(shapes.up, [14, 14, 32]);
});

test("inferShapes upsamples via scale_factor", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [14, 14, 64] } },
    { id: "up", family: "pool", op: "Upsample", attributes: { constructorArgs: "scale_factor=2" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "up" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.up, [28, 28, 64]);
});

test("inferShapes resolves an explicit reshape with an inferred -1 dimension", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [3, 3, 64] } },
    { id: "flat", family: "flatten", op: "view", attributes: { constructorArgs: "-1, 64" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "flat" }];
  const shapes = run(nodes, edges);
  // total = 576; -1 -> 576 / 64 = 9
  assert.deepEqual(shapes.flat, [9, 64]);
});

test("diagnoseShapes reports a mismatched residual merge", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
    { id: "pool", family: "pool", op: "MaxPool2d", attributes: { constructorArgs: "2, 2" }, stage: 1, order: 0 },
    { id: "add", family: "merge", op: "Add", attributes: {}, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "pool" },
    { source: "pool", target: "add" },
    { source: "in", target: "add" },
  ];
  const diagnosis = diagnoseShapes(nodes, edges);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.issues.some((issue) => issue.reason === "mismatched-merge"));
});

test("diagnoseShapes reports a missing parameter on a conv", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [28, 28, 3] } },
    { id: "conv", family: "conv", op: "Conv2d", attributes: { constructorArgs: "3" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "conv" }];
  const diagnosis = diagnoseShapes(nodes, edges);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.issues.some((issue) => issue.reason === "missing-parameter"));
});

test("diagnoseShapes reports an unsupported operator", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [28, 28, 3] } },
    { id: "mystery", family: "custom", op: "MysteryLayer", attributes: {}, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "mystery" }];
  const diagnosis = diagnoseShapes(nodes, edges);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.issues.some((issue) => issue.reason === "unsupported-operator"));
});

test("diagnoseShapes passes a fully resolvable graph", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [224, 224, 3] } },
    { id: "conv", family: "conv", op: "Conv2d", attributes: { constructorArgs: "3, 64, kernel_size=3, padding=1" }, stage: 1, order: 0 },
    { id: "out", family: "output", op: "Output", attributes: {}, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "conv" },
    { source: "conv", target: "out" },
  ];
  const diagnosis = diagnoseShapes(nodes, edges);
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.issues.length, 0);
});

test("buildShapeFeedback names the failing node and reason", () => {
  const feedback = buildShapeFeedback([
    { kind: "shape-gap", nodeId: "add", op: "Add", family: "merge", reason: "mismatched-merge" },
  ]);
  assert.match(feedback, /"add"/);
  assert.match(feedback, /mismatched|identical dimensions/i);
});

test("inferShapes honors MaxPool2d padding instead of discarding it", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [224, 224, 64] } },
    { id: "p", family: "pool", op: "MaxPool2d", attributes: { constructorArgs: "3, 2, 1" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "p" }];
  const shapes = run(nodes, edges);
  // floor((224 + 2*1 - 3)/2) + 1 = 112 (padding must not be silently dropped)
  assert.deepEqual(shapes.p, [112, 112, 64]);
});

test("inferShapes reads Keras Dense(units) single positional argument", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [7, 7, 512] } },
    { id: "flat", family: "flatten", op: "Flatten", attributes: {}, stage: 1, order: 0 },
    { id: "d", family: "dense", op: "Dense", attributes: { constructorArgs: "1000" }, stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "flat" },
    { source: "flat", target: "d" },
  ];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.d, [1000]);
});

test("inferShapes strips an explicit batch dimension from the input seed", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [1, 224, 224, 3] } },
    { id: "c", family: "conv", op: "Conv2d", attributes: { constructorArgs: "3, 64, kernel_size=3, padding=1" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "c" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.in, [224, 224, 3]);
  assert.deepEqual(shapes.c, [224, 224, 64]);
});

test("inferShapes resolves Keras SAME padding to an equal-size output", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [224, 224, 3] } },
    { id: "c", family: "conv", op: "Conv2d", attributes: { constructorArgs: "3, 64, kernel_size=3, padding=same" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "c" }];
  const shapes = run(nodes, edges);
  // same padding => (3-1)/2 = 1 => output stays 224
  assert.deepEqual(shapes.c, [224, 224, 64]);
});

test("inferShapes shapes a PyTorch LSTM to [seq_len, hidden]", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [10, 64] } },
    { id: "r", family: "recurrent", op: "LSTM", attributes: { constructorArgs: "64, 128" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "r" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.r, [10, 128]);
});

test("inferShapes honors return_sequences=false for a Keras-style LSTM", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [10, 64] } },
    { id: "r", family: "recurrent", op: "LSTM", attributes: { constructorArgs: "units=128, return_sequences=False" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "r" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.r, [128]);
});

test("inferShapes doubles hidden size for a bidirectional LSTM", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [10, 64] } },
    { id: "r", family: "recurrent", op: "LSTM", attributes: { constructorArgs: "64, 128, bidirectional=True" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "r" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.r, [10, 256]);
});

test("inferShapes shapes a GCNConv to [num_nodes, out_features]", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [100, 16] } },
    { id: "g", family: "graph", op: "GCNConv", attributes: { constructorArgs: "16, 32" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "g" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.g, [100, 32]);
});

test("inferShapes fails closed on a recurrent node fed a 3D tensor", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [224, 224, 3] } },
    { id: "r", family: "recurrent", op: "LSTM", attributes: { constructorArgs: "64, 128" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "r" }];
  const shapes = run(nodes, edges);
  assert.equal(shapes.r, undefined);
});

test("inferShapes fails closed on a graph node fed a 3D tensor", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [224, 224, 3] } },
    { id: "g", family: "graph", op: "GCNConv", attributes: { constructorArgs: "16, 32" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "g" }];
  const shapes = run(nodes, edges);
  assert.equal(shapes.g, undefined);
});

test("diagnoseShapes reports missing-parameter (not unsupported) for an LSTM without hidden size", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [10, 64] } },
    { id: "r", family: "recurrent", op: "LSTM", attributes: {}, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "r" }];
  const diag = diagnoseShapes(nodes, edges);
  const issue = diag.issues.find((entry) => entry.nodeId === "r");
  assert.ok(issue, "LSTM without hidden_size should surface a shape issue");
  assert.equal(issue.reason, "missing-parameter");
});

test("inferShapes applies the 3D conv formula over [D,H,W,C]", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [32, 64, 64, 3] } },
    { id: "c", family: "conv", op: "Conv3d", attributes: { constructorArgs: "3, 64, 3, 1, 1" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "c" }];
  const shapes = run(nodes, edges);
  // padding=1 keeps each spatial dim: floor((size+2-3)/1)+1 = size
  assert.deepEqual(shapes.c, [32, 64, 64, 64]);
});

test("inferShapes applies 3D pooling over [D,H,W,C]", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [16, 32, 32, 64] } },
    { id: "p", family: "pool", op: "MaxPool3d", attributes: { constructorArgs: "2" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "p" }];
  const shapes = run(nodes, edges);
  // stride defaults to kernel=2: floor(size/2) => 8, 16, 16
  assert.deepEqual(shapes.p, [8, 16, 16, 64]);
});

test("inferShapes honors a per-dimension 3D kernel tuple", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [16, 32, 32, 3] } },
    { id: "c", family: "conv", op: "Conv3d", attributes: { constructorArgs: "3, 64, (3,3,3)" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "c" }];
  const shapes = run(nodes, edges);
  // no padding: floor((size-3)/1)+1 => 14, 30, 30
  assert.deepEqual(shapes.c, [14, 30, 30, 64]);
});

test("inferShapes upsampling increases spatial resolution via scale_factor", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
    { id: "up", family: "upsample", op: "Upsample", attributes: { constructorArgs: "scale_factor=2" }, stage: 1, order: 0 },
  ];
  const edges = [{ source: "in", target: "up" }];
  const shapes = run(nodes, edges);
  assert.deepEqual(shapes.up, [112, 112, 64]);
});

test("inferShapes propagates through a compound module's internal graph", () => {
  const nodes = [
    { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
    {
      id: "c2f", family: "custom", op: "C2f", compoundKind: "module",
      attributes: {
        internalGraph: {
          nodes: [
            { id: "cv1", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 64, 1, 1, 0" } },
            { id: "cv2", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 64, 3, 1, 1" } },
            { id: "cat", family: "merge", op: "Concat" },
          ],
          edges: [
            { source: "cv1", target: "cv2" },
            { source: "cv2", target: "cat" },
            { source: "cv1", target: "cat" },
          ],
        },
      },
      stage: 1, order: 0,
    },
    { id: "out", family: "output", op: "Output", stage: 2, order: 0 },
  ];
  const edges = [
    { source: "in", target: "c2f" },
    { source: "c2f", target: "out" },
  ];
  const shapes = run(nodes, edges);
  // cv1 (1x1, pad 0) and cv2 (3x3, pad 1) both keep [56,56,64];
  // concat doubles channels -> [56,56,128].
  assert.deepEqual(shapes.c2f, [56, 56, 128]);
  assert.deepEqual(shapes.out, [56, 56, 128]);
});
