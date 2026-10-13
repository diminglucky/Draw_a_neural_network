import assert from "node:assert/strict";
import test from "node:test";

import { createSampleOnnx } from "./tools/make-sample-onnx.mjs";
import { extractArchitectureEvidence, normalizeArchitectureEvidence, planArchitectureFigure } from "./agent-pipeline.mjs";

function onnxArtifact(modelName, projection) {
  const sample = createSampleOnnx(modelName);
  return {
    kind: "artifact",
    artifact: { format: "onnx", path: `${modelName}.onnx`, data: sample.buffer },
    sourceId: `onnx:${modelName}`,
    revision: "test-revision",
    metadata: { uri: `file:///${modelName}.onnx`, authority: 8 },
    ...(projection ? { projection } : {}),
  };
}

async function planFor(modelName, projection) {
  const evidence = await extractArchitectureEvidence(onnxArtifact(modelName, projection));
  const normalized = normalizeArchitectureEvidence(evidence);
  const plan = planArchitectureFigure(normalized);
  const bodies = (plan.visioDiagramPlan?.scene?.primitives || []).filter((primitive) => primitive.role === "body");
  return { evidence, normalized, plan, bodies };
}

test("ONNX artifacts default to the full projection so every operator is drawn", async () => {
  const { evidence, normalized, bodies } = await planFor("resnet18-lite");

  assert.equal(evidence.status, "grounded");
  assert.equal(evidence.projection, "full");
  assert.equal(normalized.ir.projection, "full");
  // 17 ONNX 节点 → 17 个 body，逐算子出图，不做 Block 折叠。
  assert.equal(evidence.graph.nodes.length, 17);
  assert.equal(bodies.length, 17);
});

test("full projection keeps the declared tensor shapes on the scene labels", async () => {
  const { bodies } = await planFor("resnet18-lite");
  const forms = bodies.map((body) => body.form);
  // 卷积/特征图走 volume，下采样走 wedge，加法合并走 glyph——不再是清一色 band。
  assert.ok(forms.includes("volume"), `expected volume bodies, got ${JSON.stringify(forms)}`);
  assert.ok(forms.includes("wedge"), `expected wedge bodies, got ${JSON.stringify(forms)}`);
  assert.ok(!forms.every((form) => form === "band"), "full projection must not collapse every operator into a plain band");
});

test("an explicit balanced projection still folds blocks for readers who want the overview", async () => {
  const full = await planFor("resnet18-lite", "full");
  const balanced = await planFor("resnet18-lite", "balanced");

  assert.equal(balanced.normalized.ir.projection, "balanced");
  assert.ok(
    balanced.bodies.length < full.bodies.length,
    `balanced (${balanced.bodies.length}) must be coarser than full (${full.bodies.length})`,
  );
});

test("overview and balanced remain selectable and are never silently upgraded", async () => {
  const overview = await planFor("unet-lite", "overview");
  assert.equal(overview.normalized.ir.projection, "overview");
  assert.equal(overview.evidence.projection, "overview");
});

test("the projection field is an accepted input field rather than an unknown-field error", async () => {
  await assert.doesNotReject(async () => extractArchitectureEvidence(onnxArtifact("vit-lite", "full")));
});

test("ONNX operator names resolve to real neural families instead of `custom`", async () => {
  const { normalized } = await planFor("vit-lite");
  const familyByOp = new Map(normalized.ir.nodes.map((node) => [String(node.op), String(node.family)]));

  // 这些算子过去全部落到 custom / unresolved_operator，整张注意力与 FFN 被画成"未知模块"。
  assert.equal(familyByOp.get("MatMul"), "dense");
  assert.equal(familyByOp.get("Transpose"), "flatten");
  assert.equal(familyByOp.get("LayerNormalization"), "norm");
  assert.equal(familyByOp.get("Gelu"), "activation");
  assert.equal(familyByOp.get("Add"), "merge");
  // 锚定后的 output 规则不再吞掉注意力里的 Softmax。
  assert.equal(familyByOp.get("Softmax"), "activation");
  assert.ok(
    !normalized.ir.nodes.some((node) => node.family === "custom"),
    "no ONNX operator in this graph should remain unresolved",
  );
});

test("scene forms follow the operator family rather than collapsing into one repeated shape", async () => {
  const { bodies } = await planFor("vit-lite");
  const forms = bodies.map((body) => body.form);
  const distinct = new Set(forms);

  // MatMul 走 stack，Add 走 merge glyph，LayerNorm / GELU 走紧凑的 band。
  assert.ok(distinct.has("stack"), `expected stack bodies for MatMul, got ${JSON.stringify([...distinct])}`);
  assert.ok(distinct.has("glyph"), `expected merge glyphs for Add, got ${JSON.stringify([...distinct])}`);
  assert.ok(distinct.size >= 3, `expected at least three distinct forms, got ${JSON.stringify([...distinct])}`);
});

test("body geometry follows the declared tensor shape", async () => {
  const { bodies } = await planFor("resnet18-lite");
  const sizeOf = (nodeName) => {
    const body = bodies.find((candidate) => (candidate.sourceNodeIds || []).includes(nodeName));
    return body ? { w: body.bounds.w, h: body.bounds.h } : null;
  };

  const shallow = sizeOf("Conv_0");   // [1, 64, 112, 112]
  const deep = sizeOf("Conv_11");     // [1, 128, 28, 28]
  assert.ok(shallow && deep, "expected both convolution bodies in the scene");
  // 空间边长缩小 -> 盒子变矮；通道数增加 -> 盒子变宽。这正是 CNN 金字塔的可读信号。
  assert.ok(shallow.h > deep.h, `expected 112x112 taller than 28x28 (${shallow.h} vs ${deep.h})`);
  assert.ok(deep.w > shallow.w, `expected 128 channels wider than 64 (${deep.w} vs ${shallow.w})`);
});

test("long chains are wrapped into near-square figures instead of one very wide row", async () => {
  for (const model of ["resnet18-lite", "unet-lite", "vit-lite"]) {
    const { bodies } = await planFor(model);
    const xs = bodies.map((body) => body.bounds.x);
    const ys = bodies.map((body) => body.bounds.y);
    const width = Math.max(...bodies.map((body) => body.bounds.x + body.bounds.w)) - Math.min(...xs);
    const height = Math.max(...bodies.map((body) => body.bounds.y + body.bounds.h)) - Math.min(...ys);
    const ratio = width / height;

    // 折行前 resnet 是 19.7:1、unet 是 18.7:1，缩到论文栏宽后字号必然不可读。
    assert.ok(ratio < 3, `${model} should wrap into a readable figure, got ${ratio.toFixed(2)}:1`);
    assert.ok(ratio > 0.3, `${model} should not collapse into a single tall column, got ${ratio.toFixed(2)}:1`);
    // 折行是列优先：同一列内的图元共享 x，数据在列内向下、列间向右。
    const columns = new Set(xs);
    assert.ok(columns.size >= 2 && columns.size <= 6, `${model} expected 2-6 columns, got ${columns.size}`);
  }
});

test("bodies stacked in one column share an identical left edge", async () => {
  const { bodies } = await planFor("unet-lite");
  const byColumn = new Map();
  for (const body of bodies) {
    const key = body.bounds.x;
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(body);
  }
  // 同列内 x 完全一致，是「数据只能从左到右」校验成立的前提；
  // 早先按列宽居中会让同列内错开几个像素，把合法布局误判成方向违规。
  for (const column of byColumn.values()) {
    assert.equal(new Set(column.map((body) => body.bounds.x)).size, 1);
  }
  assert.ok(byColumn.size >= 2, "expected a multi-column layout");
});
