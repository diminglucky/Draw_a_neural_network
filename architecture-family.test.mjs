import assert from "node:assert/strict";
import test from "node:test";

import { detectArchitectureFamily } from "./architecture-family.mjs";

// 每一类网络在顶刊里有各自的**标准图形拓扑**。这里锁的是"识别"：
// 给定结构信号，必须判到正确的家族，并给出可审计的证据。
// 旧实现只有一条 encoder-decoder 判定，YOLO / ViT / ResNet / VGG 全部落到通用顺序流。

function model(nodes, edges = []) {
  return { canonicalModel: { nodes, edges } };
}

test("detects a detection network as a multi-scale pyramid", () => {
  const result = detectArchitectureFamily({
    canonicalModel: {
      nodes: [
        { id: "conv1", op: "Conv" },
        { id: "p3", op: "Conv" },
        { id: "p4", op: "Conv" },
        { id: "head", op: "Conv" },
      ],
      edges: [],
    },
    blocks: { blocks: [{ kind: "multi-scale-fusion" }, { kind: "detection-head" }] },
  });
  assert.equal(result.family, "detection");
  assert.equal(result.archetype, "detection-pyramid");
  assert.ok(result.evidence.includes("blockKind:detection-head"));
  assert.ok(result.confidence >= 0.85, `检测家族置信度应高，实际 ${result.confidence}`);
});

test("detects U-Net as encoder-decoder U", () => {
  const result = detectArchitectureFamily(model(
    [
      { id: "conv1", op: "Conv" },
      { id: "pool1", op: "MaxPool" },
      { id: "up1", op: "Upsample" },
    ],
    [{ id: "e1", source: "conv1", target: "up1", type: "skip" }],
  ));
  assert.equal(result.family, "encoder-decoder");
  assert.equal(result.archetype, "encoder-decoder-u");
  assert.deepEqual(result.evidence, ["下采样算子", "上采样算子", "跳跃连接"]);
});

test("detects a transformer as a block stack", () => {
  const result = detectArchitectureFamily(model(
    [
      { id: "qkv", op: "MatMul" },
      { id: "attn", op: "Softmax" },
      { id: "ffn", op: "Gemm" },
    ],
    [],
  ));
  assert.equal(result.family, "transformer");
  assert.equal(result.archetype, "transformer-stack");
});

test("detects a residual network as a tower", () => {
  const result = detectArchitectureFamily({
    canonicalModel: {
      nodes: [{ id: "conv1", op: "Conv" }, { id: "add", op: "Add" }],
      edges: [{ id: "e1", source: "conv1", target: "add", type: "residual" }],
    },
    blocks: { blocks: [{ kind: "residual-block" }] },
  });
  assert.equal(result.family, "residual");
  assert.equal(result.archetype, "residual-tower");
  assert.ok(result.evidence.includes("blockKind:residual-block"));
});

test("detects a plain CNN as a conv tower", () => {
  const result = detectArchitectureFamily(model(
    [
      { id: "conv1", op: "Conv" },
      { id: "pool1", op: "MaxPool" },
      { id: "fc", op: "Gemm" },
    ],
    [],
  ));
  assert.equal(result.family, "cnn");
  assert.equal(result.archetype, "cnn-tower");
});

test("falls back to sequential flow when no family signature matches", () => {
  const result = detectArchitectureFamily(model([{ id: "x", op: "Custom" }], []));
  assert.equal(result.family, "sequential");
  assert.equal(result.archetype, "sequential-flow");
  assert.equal(result.confidence, 0);
});

// 判定优先级必须成立：越特异的家族越先命中，不能被宽泛的"卷积塔"抢走。
test("more specific families win over the generic conv tower", () => {
  // 同一个图同时有 conv/pool（像 VGG）和 检测头+多尺度融合 → 必须是检测金字塔
  const yoloLike = detectArchitectureFamily({
    canonicalModel: {
      nodes: [{ id: "conv1", op: "Conv" }, { id: "pool1", op: "MaxPool" }],
      edges: [],
    },
    blocks: { blocks: [{ kind: "detection-head" }, { kind: "multi-scale-fusion" }] },
  });
  assert.equal(yoloLike.family, "detection");

  // 同时有 conv/pool 和残差块 + 跳跃 → 必须是残差塔，不是卷积塔
  const resnetLike = detectArchitectureFamily({
    canonicalModel: {
      nodes: [{ id: "conv1", op: "Conv" }, { id: "pool1", op: "MaxPool" }],
      edges: [{ id: "e1", source: "conv1", target: "pool1", type: "residual" }],
    },
    blocks: { blocks: [{ kind: "residual-block" }] },
  });
  assert.equal(resnetLike.family, "residual");
});

// canonical model 里所有边都是 "signal"，从没有 skip/residual 类型。
// 只靠 edge.type 永远检测不到跳跃连接，U-Net / ResNet 都会掉进"卷积塔"。
// 真正可用的证据是**合并节点的输入深度差**：Add <- [深层, 浅层] 就是残差分支。
test("derives skip connections from merge-node input depth spread, not edge types", () => {
  // ResNet 结构：Add 的一路输入(MaxPool)绕过了中间 4 层
  const resnet = detectArchitectureFamily(model(
    [
      { id: "conv0", op: "Conv" },
      { id: "pool0", op: "MaxPool" },
      { id: "conv1", op: "Conv" },
      { id: "bn1", op: "BatchNormalization" },
      { id: "add1", op: "Add" },
    ],
    [
      { id: "e1", source: "conv0", target: "pool0", type: "signal" },
      { id: "e2", source: "pool0", target: "conv1", type: "signal" },
      { id: "e3", source: "conv1", target: "bn1", type: "signal" },
      { id: "e4", source: "bn1", target: "add1", type: "signal" },
      { id: "e5", source: "pool0", target: "add1", type: "signal" }, // 长程跳跃
    ],
  ));
  assert.equal(resnet.signals.hasSkip, true, "应能从 Add 的输入深度差推出跳跃连接");
  assert.equal(resnet.family, "residual");

  // U-Net 结构：Concat 一路来自 Resize(深)、一路来自编码器 Relu(浅)，
  // 中间隔着瓶颈若干层，所以深度差够大；跳跃要真的"绕过"中间层才算。
  const unet = detectArchitectureFamily(model(
    [
      { id: "conv0", op: "Conv" },
      { id: "pool0", op: "MaxPool" },
      { id: "relu0", op: "Relu" },
      { id: "convA", op: "Conv" },
      { id: "reluA", op: "Relu" },
      { id: "resize0", op: "Resize" },
      { id: "concat0", op: "Concat" },
    ],
    [
      { id: "e1", source: "conv0", target: "pool0", type: "signal" },
      { id: "e2", source: "pool0", target: "relu0", type: "signal" },
      { id: "e3", source: "relu0", target: "convA", type: "signal" },
      { id: "e4", source: "convA", target: "reluA", type: "signal" },
      { id: "e5", source: "reluA", target: "resize0", type: "signal" },
      { id: "e6", source: "resize0", target: "concat0", type: "signal" },
      { id: "e7", source: "relu0", target: "concat0", type: "signal" }, // 绕过瓶颈的跳跃
    ],
  ));
  assert.equal(unet.signals.hasSkip, true);
  assert.equal(unet.family, "encoder-decoder");

  // 相邻分支合并（深度差 1）不该被当成跳跃——否则普通 concat 全成 U-Net
  const plainMerge = detectArchitectureFamily(model(
    [{ id: "a", op: "Conv" }, { id: "b", op: "Conv" }, { id: "c", op: "Add" }],
    [
      { id: "e1", source: "a", target: "c", type: "signal" },
      { id: "e2", source: "b", target: "c", type: "signal" },
    ],
  ));
  assert.equal(plainMerge.signals.hasSkip, false, "相邻两路合并不该算长程跳跃");
});

test("records the detected blockKinds for auditability", () => {
  const result = detectArchitectureFamily({
    canonicalModel: { nodes: [{ id: "a", op: "Conv" }], edges: [] },
    blocks: { blocks: [{ kind: "conv-block" }, { kind: "residual-block" }] },
  });
  assert.deepEqual(result.signals.blockKinds, ["conv-block", "residual-block"]);
  assert.equal(result.version, "architecture-family/v1");
});
