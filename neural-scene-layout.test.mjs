import assert from "node:assert/strict";
import test from "node:test";
import { layoutNeuralScene, scoreLayout, validateLaidOutScene } from "./neural-scene-layout.mjs";

function scene() {
  return {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceNodeIds: ["input"], projectionId: "p-input", semanticTags: ["input"], data: { scale: "s1" } },
      { id: "branch", role: "body", category: "operator", form: "band", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["branch"], data: { scale: "s1" } },
      { id: "left", role: "body", category: "operator", form: "volume", sourceNodeIds: ["left"], projectionId: "p-left", semanticTags: ["spatial"], data: { scale: "s1" } },
      { id: "right", role: "body", category: "operator", form: "volume", sourceNodeIds: ["right"], projectionId: "p-right", semanticTags: ["spatial"], data: { scale: "s2" } },
      { id: "merge", role: "body", category: "structure", form: "glyph", sourceNodeIds: ["merge"], projectionId: "p-merge", semanticTags: ["merge"], data: { scale: "s1" } },
      { id: "label", role: "decoration", category: "annotation", form: "text", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["label"], labels: ["branch"] },
    ],
    relations: [
      { id: "e0", sourcePrimitiveId: "input", targetPrimitiveId: "branch", relationTags: ["data"], sourceEdgeIds: ["e0"] },
      { id: "e1", sourcePrimitiveId: "branch", targetPrimitiveId: "left", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "branch", targetPrimitiveId: "right", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "left", targetPrimitiveId: "merge", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "right", targetPrimitiveId: "merge", relationTags: ["crossScale"], sourceEdgeIds: ["e4"] },
      { id: "skip", sourcePrimitiveId: "branch", targetPrimitiveId: "merge", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    constraints: [],
  };
}

test("lays out primitives in abstract units with stable bounds, anchors, and page", () => {
  const result = layoutNeuralScene(scene());
  assert.equal(result.version, "laid-out-neural-scene/v1");
  assert.equal(result.units, "layout-unit");
  assert.ok(result.page.width > 0 && result.page.height > 0);
  assert.ok(result.primitives.every((primitive) => primitive.bounds.w > 0 && primitive.bounds.h > 0 && Number.isInteger(primitive.zIndex)));
  assert.ok(result.primitives.find((primitive) => primitive.id === "input").anchors.outputs.length > 0);
  assert.ok(result.connectors.find((connector) => connector.id === "skip").routeClass === "bypass");
  assert.equal(result.connectors.find((connector) => connector.id === "e4").routeClass, "cross-scale");
  assert.equal(result.visualQuality.connectorBodyIntersectionCount, 0);
  assert.ok(result.visualQuality.whitespaceRatio >= 0 && result.visualQuality.whitespaceRatio <= 1);
});

test("preserves production-style body and decoration primitives", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "primitive:projection:direct:a:body",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "projection:direct:a",
        sourceNodeIds: ["a"],
        semanticTags: ["operator"],
      },
      {
        id: "primitive:projection:direct:a:decoration:1",
        role: "decoration",
        category: "annotation",
        form: "text",
        projectionId: "projection:direct:a",
        sourceNodeIds: ["a"],
        semanticTags: ["label"],
        labels: ["Conv"],
      },
      {
        id: "primitive:projection:direct:b:body",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "projection:direct:b",
        sourceNodeIds: ["b"],
        semanticTags: ["operator"],
      },
    ],
    relations: [{
      id: "relation:ab",
      sourcePrimitiveId: "primitive:projection:direct:a:body",
      targetPrimitiveId: "primitive:projection:direct:b:body",
      relationTags: ["data"],
      sourceEdgeIds: ["ab"],
    }],
    groups: [],
  };

  const result = layoutNeuralScene(input);
  const decoration = result.primitives.find((primitive) => primitive.id === input.primitives[1].id);
  const owner = result.primitives.find((primitive) => primitive.id === input.primitives[0].id);

  assert.ok(decoration);
  assert.equal(decoration.bounds.x, owner.bounds.x);
  assert.equal(decoration.bounds.y, owner.bounds.y + owner.bounds.h + 12);
  assert.equal(validateLaidOutScene(result, input).ok, true);
});

test("uses blockKind-specific dimensions for block-aware projections", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "residual", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-residual", sourceNodeIds: ["a", "b", "add"] },
      { id: "attention", role: "body", category: "operator", form: "stack", blockKind: "attention-block", projectionId: "p-attention", sourceNodeIds: ["attn", "norm"] },
    ],
    relations: [],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const residual = result.primitives.find((primitive) => primitive.id === "residual");
  const attention = result.primitives.find((primitive) => primitive.id === "attention");
  assert.deepEqual({ w: residual.bounds.w, h: residual.bounds.h }, { w: 96, h: 34 });
  assert.deepEqual({ w: attention.bounds.w, h: attention.bounds.h }, { w: 88, h: 34 });
});

// 两条约定是分开的，不能再用同一把尺子量：
//   (1) Transformer/ViT 注意力图、U-Net 图——扁平 2D 矩形（band/stack/strip），
//       又宽又扁的横条：盒高÷字号 1.6–3.2、中位宽高比 2.2+。
//   (2) CNN/VGG16 特征图塔——volume 盒子的高度编码空间尺寸，可以高到 VOLUME_MAX_H(96)，
//       不能用"宽高比"去卡它，否则 VGG 那种塔形就出不来。
// 用户后一条投诉"全是方框没区别"恰恰说明要允许 CNN 出塔，所以两者分别断言。

// 锁的是用户最早的观感投诉："模块绘制得过大，看看顶刊怎么设计的"——
// 针对 (1) 扁平注意力图这一支。
test("flat transformer-style boxes stay in the top-journal band of height-over-font and aspect", () => {
  const BODY_FONT = 11;
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "c", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-c", sourceNodeIds: ["c"] },
      { id: "d", role: "body", category: "structure", form: "band", blockKind: "encoder-stage", projectionId: "p-d", sourceNodeIds: ["d"] },
      { id: "e", role: "body", category: "operator", form: "glyph", semanticTags: ["merge"], projectionId: "p-e", sourceNodeIds: ["e"] },
      { id: "f", role: "body", category: "operator", form: "stack", blockKind: "ffn-block", projectionId: "p-f", sourceNodeIds: ["f"] },
      { id: "g", role: "body", category: "operator", form: "strip", projectionId: "p-g", sourceNodeIds: ["g"] },
    ],
    relations: [],
    groups: [],
    constraints: [],
  };
  const bodies = layoutNeuralScene(input).primitives.filter((primitive) => primitive.role === "body");
  assert.ok(bodies.length >= 5, "样本要覆盖多种 flat 形态");
  for (const body of bodies) {
    if (body.form === "glyph") continue; // 圆形单独校验正方形，不参与扁度比较
    const ratio = body.bounds.h / BODY_FONT;
    assert.ok(ratio <= 3.4, `${body.id} 的盒高是字号的 ${ratio.toFixed(2)}×，超出顶刊 3.2× 上限`);
    assert.ok(ratio >= 1.4, `${body.id} 的盒高只有字号的 ${ratio.toFixed(2)}×，盒子会紧到贴边`);
  }
  // 宽度色散是"同一张图里有的块过大"的直接来源，压到 1.8× 以内。
  // 圆形合并算子（glyph）天生是小正方形，不参与横向比较。
  const boxes = bodies.filter((body) => body.form !== "glyph");
  const widths = boxes.map((body) => body.bounds.w).sort((left, right) => left - right);
  assert.ok(widths[widths.length - 1] / widths[0] <= 1.8, `宽度色散 ${(widths[widths.length - 1] / widths[0]).toFixed(2)}× 过大`);
  // 算子块应该是横条，不是方块。
  const ratios = boxes.map((body) => body.bounds.w / body.bounds.h).sort((left, right) => left - right);
  assert.ok(ratios[Math.floor(ratios.length / 2)] >= 1.9, "盒子中位宽高比要接近顶刊的 2.2+");
  // 圆形算子必须是正方形，否则画出来是椭圆或者"大盒子里一颗小圆"。
  for (const glyph of bodies.filter((body) => body.form === "glyph")) {
    assert.equal(glyph.bounds.w, glyph.bounds.h, `${glyph.id} 的圆形算子被拉成了椭圆`);
  }
});

// 锁的是用户后一条投诉："全是方框没有区别，看看 vgg16 怎么绘制的"——
// 针对 (2) CNN 特征图塔这一支。volume 盒子必须随空间尺寸长高，且不超过 VOLUME_MAX_H。
test("cnn volume boxes form a feature-map tower: taller for larger spatial size, capped at VOLUME_MAX_H", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "small", role: "body", category: "operator", form: "volume", blockKind: "conv-block", projectionId: "p-small", sourceNodeIds: ["s"], data: { tensorShape: [1, 64, 28, 28] } },
      { id: "large", role: "body", category: "operator", form: "volume", blockKind: "conv-block", projectionId: "p-large", sourceNodeIds: ["l"], data: { tensorShape: [1, 64, 224, 224] } },
    ],
    relations: [],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const small = result.primitives.find((primitive) => primitive.id === "small");
  const large = result.primitives.find((primitive) => primitive.id === "large");
  // 大空间尺寸的盒子要明显高于小空间尺寸——这是 VGG16 塔形能"读出来"的前提。
  assert.ok(large.bounds.h > small.bounds.h + 10, `大空间盒子(${large.bounds.h})应明显高于小空间盒子(${small.bounds.h})`);
  // 但再高也不能突破硬上限，否则又回到"盒子淹字"。
  assert.ok(large.bounds.h <= 96, `大空间盒子高度 ${large.bounds.h} 不应超过 VOLUME_MAX_H=96`);
  assert.ok(small.bounds.h >= 24, "小空间盒子高度不应低于下限 24");
});

test("arranges encoder and decoder block stages into a U-shaped layout", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "encoder", role: "body", category: "structure", form: "band", blockKind: "encoder-stage", projectionId: "p-encoder", sourceNodeIds: ["enc1", "pool1"] },
      { id: "bottleneck", role: "body", category: "operator", form: "band", blockKind: "attention-block", projectionId: "p-bottleneck", sourceNodeIds: ["attn"] },
      { id: "decoder", role: "body", category: "structure", form: "band", blockKind: "decoder-stage", projectionId: "p-decoder", sourceNodeIds: ["up1", "dec1"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "encoder", targetPrimitiveId: "bottleneck", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "bottleneck", targetPrimitiveId: "decoder", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "skip", sourcePrimitiveId: "encoder", targetPrimitiveId: "decoder", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.ok(byId.get("bottleneck").bounds.y > byId.get("encoder").bounds.y);
  assert.ok(byId.get("bottleneck").bounds.x > byId.get("encoder").bounds.x);
  assert.ok(byId.get("decoder").bounds.x > byId.get("bottleneck").bounds.x);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("stacks attention and FFN blocks vertically for transformer-style layout", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceFamilies: ["input"], projectionId: "p-input", sourceNodeIds: ["input"] },
      { id: "attn", role: "body", category: "operator", form: "stack", blockKind: "attention-block", projectionId: "p-attn", sourceNodeIds: ["attn", "norm"] },
      { id: "ffn", role: "body", category: "operator", form: "stack", blockKind: "ffn-block", projectionId: "p-ffn", sourceNodeIds: ["ffn1", "ffn2"] },
      { id: "output", role: "body", category: "data", form: "band", sourceFamilies: ["output"], projectionId: "p-output", sourceNodeIds: ["output"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "input", targetPrimitiveId: "attn", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "attn", targetPrimitiveId: "ffn", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "ffn", targetPrimitiveId: "output", relationTags: ["data"], sourceEdgeIds: ["e3"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.equal(byId.get("attn").bounds.x, byId.get("ffn").bounds.x);
  assert.ok(byId.get("ffn").bounds.y > byId.get("attn").bounds.y);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("aligns multi-scale fusion and MoE source branches around the target block", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "p3", role: "body", category: "operator", form: "band", projectionId: "p-p3", sourceNodeIds: ["p3"] },
      { id: "p4", role: "body", category: "operator", form: "band", projectionId: "p-p4", sourceNodeIds: ["p4"] },
      { id: "fusion", role: "body", category: "structure", form: "glyph", blockKind: "multi-scale-fusion", projectionId: "p-fusion", sourceNodeIds: ["p3", "p4", "cat"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "p3", targetPrimitiveId: "fusion", relationTags: ["data", "crossScale"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "p4", targetPrimitiveId: "fusion", relationTags: ["data", "crossScale"], sourceEdgeIds: ["e2"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  const p3Center = byId.get("p3").bounds.y + byId.get("p3").bounds.h / 2;
  const p4Center = byId.get("p4").bounds.y + byId.get("p4").bounds.h / 2;
  const fusionCenter = byId.get("fusion").bounds.y + byId.get("fusion").bounds.h / 2;
  assert.notEqual(p3Center, p4Center);
  assert.ok(Math.abs((p3Center + p4Center) / 2 - fusionCenter) < 0.001);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("uses declared ports when routing vertical container flow", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "source",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "p-source",
        sourceNodeIds: ["source"],
        ports: { inputs: [{ portId: "top" }], outputs: [{ portId: "bottom" }] },
      },
      {
        id: "target",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "p-target",
        sourceNodeIds: ["target"],
        ports: { inputs: [{ portId: "top" }], outputs: [{ portId: "bottom" }] },
      },
    ],
    relations: [{
      id: "relation:flow",
      sourcePrimitiveId: "source",
      targetPrimitiveId: "target",
      sourcePortId: "bottom",
      targetPortId: "top",
      relationTags: ["data"],
      sourceEdgeIds: ["flow"],
    }],
    groups: [{ id: "stack", primitiveIds: ["source", "target"], direction: "vertical" }],
  };

  const result = layoutNeuralScene(input);
  const source = result.primitives.find((primitive) => primitive.id === "source");
  const target = result.primitives.find((primitive) => primitive.id === "target");
  const connector = result.connectors.find((item) => item.id === "relation:flow");
  const sourceAnchor = source.anchors.outputs.find((anchor) => anchor.id === "bottom");
  const targetAnchor = target.anchors.inputs.find((anchor) => anchor.id === "top");

  assert.deepEqual(connector.points[0], { x: sourceAnchor.x, y: sourceAnchor.y });
  assert.deepEqual(connector.points.at(-1), { x: targetAnchor.x, y: targetAnchor.y });
});

test("aligns same-scale branch centers within one layer", () => {
  const input = scene();
  input.primitives.find((primitive) => primitive.id === "right").data.scale = "s1";
  const result = layoutNeuralScene(input);
  const left = result.primitives.find((primitive) => primitive.id === "left");
  const right = result.primitives.find((primitive) => primitive.id === "right");
  assert.equal(left.bounds.y + left.bounds.h / 2, right.bounds.y + right.bounds.h / 2);
});

test("rendering profile controls reserved route corridors", () => {
  const input = scene();
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "route:e1", kind: "reserve-route-corridor", edgeId: "e1", routeClass: "conditional" }],
    },
  });
  assert.equal(result.connectors.find((connector) => connector.id === "e1").routeClass, "conditional");
});

test("rendering profile owns scale centerline alignment", () => {
  const input = scene();
  const withoutAlignment = layoutNeuralScene(input, {
    renderingProfile: { version: "neural-rendering-profile/v1", constraints: [] },
  });
  const inputNode = withoutAlignment.primitives.find((primitive) => primitive.id === "input");
  const left = withoutAlignment.primitives.find((primitive) => primitive.id === "left");
  assert.notEqual(inputNode.bounds.y + inputNode.bounds.h / 2, left.bounds.y + left.bounds.h / 2);
});

test("encoder-decoder-u layout archetype separates encoder, bottleneck, and decoder columns", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceNodeIds: ["input"], projectionId: "p-input", semanticTags: ["input"], data: { scale: "s1" } },
      { id: "down", role: "body", category: "operator", form: "wedge", sourceNodeIds: ["down"], projectionId: "p-down", semanticTags: ["reduce"], data: { scale: "s2" } },
      { id: "core", role: "body", category: "operator", form: "volume", sourceNodeIds: ["core"], projectionId: "p-core", semanticTags: ["spatial"], data: { scale: "s3" } },
      { id: "up", role: "body", category: "operator", form: "wedge", sourceNodeIds: ["up"], projectionId: "p-up", semanticTags: ["expand"], data: { scale: "s2" } },
      { id: "output", role: "body", category: "data", form: "plane", sourceNodeIds: ["output"], projectionId: "p-output", semanticTags: ["output"], data: { scale: "s1" } },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "input", targetPrimitiveId: "down", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "down", targetPrimitiveId: "core", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "core", targetPrimitiveId: "up", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "up", targetPrimitiveId: "output", relationTags: ["data"], sourceEdgeIds: ["e4"] },
      { id: "skip", sourcePrimitiveId: "input", targetPrimitiveId: "output", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "u", kind: "layout-archetype", archetype: "encoder-decoder-u" }],
    },
  });
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.ok(byId.get("down").bounds.y > byId.get("input").bounds.y);
  assert.ok(byId.get("core").bounds.x > byId.get("down").bounds.x);
  assert.ok(byId.get("output").bounds.x > byId.get("core").bounds.x);
  assert.ok(byId.get("output").bounds.y < byId.get("up").bounds.y);
});

test("cnn-tower archetype builds a VGG-style feature-map tower that narrows to the right", () => {
  const body = (id, spatial, channels, extra = {}) => ({
    id,
    role: "body",
    category: "operator",
    form: "volume",
    blockKind: "conv-block",
    projectionId: `p-${id}`,
    sourceNodeIds: [id],
    data: { tensorShape: [1, channels, spatial, spatial], ...extra },
    ...extra,
  });
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      body("conv1", 224, 64),
      body("conv2", 224, 64),
      body("pool1", 112, 64, { semanticTags: ["reduce"], data: { tensorShape: [1, 64, 112, 112], scaleChange: "reduce" } }),
      body("conv3", 112, 128),
      body("conv4", 112, 128),
      body("pool2", 56, 128, { semanticTags: ["reduce"], data: { tensorShape: [1, 128, 56, 56], scaleChange: "reduce" } }),
      body("conv5", 56, 256),
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "conv1", targetPrimitiveId: "conv2", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "conv2", targetPrimitiveId: "pool1", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "pool1", targetPrimitiveId: "conv3", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "conv3", targetPrimitiveId: "conv4", relationTags: ["data"], sourceEdgeIds: ["e4"] },
      { id: "e5", sourcePrimitiveId: "conv4", targetPrimitiveId: "pool2", relationTags: ["data"], sourceEdgeIds: ["e5"] },
      { id: "e6", sourcePrimitiveId: "pool2", targetPrimitiveId: "conv5", relationTags: ["data"], sourceEdgeIds: ["e6"] },
    ],
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "tower", kind: "layout-archetype", archetype: "cnn-tower" }],
    },
  });
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  const columns = groupIntoColumns(bodies);
  assert.ok(columns.length >= 3, `应按池化切出多个阶段列，实际 ${columns.length}`);
  // 基线对齐：所有阶段共用同一条底边，盒子越往后越矮，顶边逐级下沉 → 收窄的塔
  const bottoms = columns.map((column) => Math.round(Math.max(...column.map((b) => b.bounds.y + b.bounds.h))));
  const spread = Math.max(...bottoms) - Math.min(...bottoms);
  assert.ok(spread <= 1, `所有阶段列必须共用一条基线，实际底边差 ${spread}`);
  // 塔形：靠后的阶段（空间尺寸更小）盒子更矮
  const firstHeight = Math.max(...columns[0].map((b) => b.bounds.h));
  const lastHeight = Math.max(...columns[columns.length - 1].map((b) => b.bounds.h));
  assert.ok(lastHeight < firstHeight, `末阶段盒子应比首阶段矮（塔形收窄），实际 ${lastHeight} vs ${firstHeight}`);
});

test("residual-tower archetype splits stages at downsampling and top-aligns them", () => {
  const body = (id, extra = {}) => ({
    id,
    role: "body",
    category: "operator",
    form: "volume",
    blockKind: "residual-block",
    projectionId: `p-${id}`,
    sourceNodeIds: [id],
    data: { tensorShape: [1, 64, 56, 56] },
    ...extra,
  });
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      body("conv1"),
      body("conv2"),
      body("down1", { semanticTags: ["reduce"], data: { tensorShape: [1, 128, 28, 28], scaleChange: "reduce" } }),
      body("conv3"),
      body("conv4"),
      body("add1", { form: "glyph", semanticTags: ["merge"] }),
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "conv1", targetPrimitiveId: "conv2", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "conv2", targetPrimitiveId: "down1", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "down1", targetPrimitiveId: "conv3", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "conv3", targetPrimitiveId: "conv4", relationTags: ["data"], sourceEdgeIds: ["e4"] },
      { id: "e5", sourcePrimitiveId: "conv4", targetPrimitiveId: "add1", relationTags: ["data"], sourceEdgeIds: ["e5"] },
    ],
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "res", kind: "layout-archetype", archetype: "residual-tower" }],
    },
  });
  const columns = groupIntoColumns(result.primitives.filter((primitive) => primitive.role === "body"));
  assert.ok(columns.length >= 2, `应按降采样切出多个阶段列，实际 ${columns.length}`);
  // 顶端对齐：每个阶段从同一条顶边往下堆
  const tops = columns.map((column) => Math.round(Math.min(...column.map((b) => b.bounds.y))));
  const spread = Math.max(...tops) - Math.min(...tops);
  assert.ok(spread <= 1, `所有阶段列必须顶端对齐，实际顶边差 ${spread}`);
});

test("transformer-stack archetype stacks homogeneous blocks vertically", () => {
  const block = (id, kind) => ({
    id,
    role: "body",
    category: "operator",
    form: "stack",
    blockKind: kind,
    projectionId: `p-${id}`,
    sourceNodeIds: [id],
    data: { tensorShape: [1, 197, 768] },
  });
  const ids = ["attn1", "ffn1", "attn2", "ffn2"];
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: ids.map((id, index) => block(id, index % 2 ? "ffn-block" : "attention-block")),
    relations: ids.slice(1).map((id, index) => ({
      id: `e${index}`,
      sourcePrimitiveId: ids[index],
      targetPrimitiveId: id,
      relationTags: ["data"],
      sourceEdgeIds: [`e${index}`],
    })),
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "stack", kind: "layout-archetype", archetype: "transformer-stack" }],
    },
  });
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  const columns = groupIntoColumns(bodies);
  assert.equal(columns.length, 1, "同构块必须堆成一列，而不是横向铺开");
  const ys = columns[0].map((body) => body.bounds.y);
  assert.deepEqual(ys, [...ys].sort((left, right) => left - right), "块顺序必须自上而下");
  assert.ok(ys[ys.length - 1] > ys[0], "竖直堆叠要有实际高度差");
});

test("detection-pyramid archetype puts multi-scale heads in the last column ordered as a pyramid", () => {
  const body = (id, extra = {}) => ({
    id,
    role: "body",
    category: "operator",
    form: "volume",
    projectionId: `p-${id}`,
    sourceNodeIds: [id],
    data: { tensorShape: [1, 256, 20, 20] },
    ...extra,
  });
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      body("stem"),
      body("c2", { semanticTags: ["reduce"], data: { tensorShape: [1, 128, 40, 40], scaleChange: "reduce" } }),
      body("c3"),
      body("neck", { blockKind: "multi-scale-fusion" }),
      body("head-small", { blockKind: "detection-head", data: { tensorShape: [1, 256, 10, 10] } }),
      body("head-large", { blockKind: "detection-head", data: { tensorShape: [1, 256, 80, 80] } }),
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "stem", targetPrimitiveId: "c2", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "c2", targetPrimitiveId: "c3", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "c3", targetPrimitiveId: "neck", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "stem", targetPrimitiveId: "neck", relationTags: ["data"], sourceEdgeIds: ["e4"] },
      { id: "e5", sourcePrimitiveId: "neck", targetPrimitiveId: "head-small", relationTags: ["data"], sourceEdgeIds: ["e5"] },
      { id: "e6", sourcePrimitiveId: "neck", targetPrimitiveId: "head-large", relationTags: ["data"], sourceEdgeIds: ["e6"] },
    ],
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "det", kind: "layout-archetype", archetype: "detection-pyramid" }],
    },
  });
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  const columns = groupIntoColumns(bodies);
  const lastColumn = columns[columns.length - 1];
  const headIds = new Set(["head-small", "head-large"]);
  assert.ok(
    lastColumn.every((body) => headIds.has(body.id)),
    `检测头必须落在最后一列，实际是 ${lastColumn.map((b) => b.id).join(",")}`,
  );
  assert.equal(lastColumn.length, 2, "两个尺度的检测头都要在最后一列");
  // 金字塔：空间尺寸小的（P5 粗粒度）在上，大的（P3 细粒度）在下
  const byId = new Map(bodies.map((primitive) => [primitive.id, primitive]));
  assert.ok(
    byId.get("head-small").bounds.y < byId.get("head-large").bounds.y,
    "小尺度检测头应排在大尺度之上，形成金字塔",
  );
  // 数据只能从左到右：颈里的节点在拓扑上晚于骨干，按角色分组时极易被排到骨干左边，
  // 直接触发 dag-direction-violation。这里锁住「任何边的目标列不小于源列」。
  for (const relation of input.relations) {
    const source = byId.get(relation.sourcePrimitiveId);
    const target = byId.get(relation.targetPrimitiveId);
    assert.ok(
      target.bounds.x >= source.bounds.x,
      `${relation.id}: ${relation.sourcePrimitiveId}→${relation.targetPrimitiveId} 逆流了（${source.bounds.x}→${target.bounds.x}）`,
    );
  }
});

// 把图元按 x 聚成列（容差 2 单位，吸收浮点与对齐误差）。
function groupIntoColumns(bodies) {
  const sorted = [...bodies].sort((left, right) => left.bounds.x - right.bounds.x);
  const columns = [];
  for (const body of sorted) {
    const column = columns[columns.length - 1];
    if (column && Math.abs(column[0].bounds.x - body.bounds.x) <= 2) column.push(body);
    else columns.push([body]);
  }
  for (const column of columns) column.sort((left, right) => left.bounds.y - right.bounds.y);
  return columns;
}

test("applies motif center-y constraints without introducing overlaps", () => {
  const constrained = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "source-a", role: "body", category: "data", form: "plane", projectionId: "p-a", sourceNodeIds: ["a"], data: { scale: "s1" } },
      { id: "source-b", role: "body", category: "data", form: "plane", projectionId: "p-b", sourceNodeIds: ["b"], data: { scale: "s2" } },
      { id: "target", role: "body", category: "structure", form: "glyph", projectionId: "p-target", sourceNodeIds: ["target"], data: { scale: "s1" } },
    ],
    relations: [
      { id: "a-target", sourcePrimitiveId: "source-a", targetPrimitiveId: "target", relationTags: ["data"], sourceEdgeIds: ["a-target"] },
      { id: "b-target", sourcePrimitiveId: "source-b", targetPrimitiveId: "target", relationTags: ["data"], sourceEdgeIds: ["b-target"] },
    ],
    constraints: [{ id: "center", kind: "center-y-between", targetPrimitiveId: "target", memberPrimitiveIds: ["source-a", "source-b"] }],
    groups: [],
  };
  const result = layoutNeuralScene(constrained);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  const centers = [byId.get("source-a"), byId.get("source-b")].map((primitive) => primitive.bounds.y + primitive.bounds.h / 2);
  const targetCenter = byId.get("target").bounds.y + byId.get("target").bounds.h / 2;

  assert.ok(Math.abs(targetCenter - (Math.min(...centers) + Math.max(...centers)) / 2) < 1e-9);
  assert.equal(validateLaidOutScene(result, constrained).ok, true);
});

test("enforces non-overlap, left-to-right DAG direction, and bypass obstacle avoidance", () => {
  const result = layoutNeuralScene(scene());
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) assert.equal(overlaps(bodies[i].bounds, bodies[j].bounds), false);
  const branch = result.primitives.find((primitive) => primitive.id === "branch");
  const merge = result.primitives.find((primitive) => primitive.id === "merge");
  assert.ok(merge.bounds.x > branch.bounds.x);
  assert.ok(result.connectors.every((connector) => connector.points.length >= 2));
  for (const connector of result.connectors) {
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      assert.equal(pathIntersects(connector.points, body.bounds), false, `${connector.id} crosses ${body.id}`);
    }
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("lays out declared scene groups as containing bounds", () => {
  const grouped = { ...scene(), groups: [{ id: "branch-group", role: "module", primitiveIds: ["branch", "left", "right"] }] };
  const result = layoutNeuralScene(grouped);
  const group = result.groups.find((item) => item.id === "branch-group");
  assert.ok(group);
  for (const id of group.primitiveIds) {
    const primitive = result.primitives.find((item) => item.id === id);
    assert.ok(contains(group.bounds, primitive.bounds));
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("aligns equal scales and reports cross-scale transfers as soft diagnostics", () => {
  const result = layoutNeuralScene(scene());
  const left = result.primitives.find((primitive) => primitive.id === "left");
  const input = result.primitives.find((primitive) => primitive.id === "input");
  assert.equal(left.bounds.y + left.bounds.h / 2, input.bounds.y + input.bounds.h / 2);
  assert.ok(result.diagnostics.some((item) => item.code === "cross-scale-transfer"));
  assert.equal(result.softScore.crossScaleAlignment >= 0, true);
});

test("layout is deterministic and budget overflow is explicit", () => {
  const first = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  const second = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.some((item) => item.code === "layout-budget-exceeded"));
});

test("validation reports containment, anchor, page, and route hard violations", () => {
  const result = layoutNeuralScene(scene());
  result.primitives.find((primitive) => primitive.id === "branch").bounds.x = -1;
  result.connectors[0].points = [];
  const validation = validateLaidOutScene(result);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "primitive-out-of-page"));
  assert.ok(validation.issues.some((issue) => issue.code === "invalid-connector-route"));
});

test("validation reports relations that were not laid out", () => {
  const input = scene();
  const result = layoutNeuralScene(input);
  result.connectors = result.connectors.filter((connector) => connector.id !== "e0");

  const validation = validateLaidOutScene(result, input);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-laid-out-connector" && issue.relationId === "e0"));
});

test("validation rejects connectors that reference missing block port anchors", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "block",
        role: "body",
        category: "structure",
        form: "band",
        blockKind: "residual-block",
        projectionId: "p-block",
        sourceNodeIds: ["a", "b"],
        ports: { inputs: [{ portId: "image" }], outputs: [{ portId: "features" }] },
      },
    ],
    relations: [],
    groups: [],
    constraints: [],
  });
  result.connectors.push({
    id: "bad-port",
    sourcePrimitiveId: "block",
    targetPrimitiveId: "block",
    sourcePortId: "missing-output",
    targetPortId: "image",
    relationTags: ["data"],
    points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
  });
  const validation = validateLaidOutScene(result);
  assert.ok(validation.issues.some((issue) =>
    issue.code === "missing-block-port-anchor"
    && issue.relationId === "bad-port"
    && issue.side === "source"
    && issue.portId === "missing-output"));
});

test("reports block badge and port QA metrics", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "block", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-block", sourceNodeIds: ["a", "b"], ports: { inputs: [], outputs: [] } },
    ],
    relations: [],
    groups: [],
    constraints: [],
  });
  assert.equal(result.visualQuality.blockPrimitiveCount, 1);
  assert.equal(result.visualQuality.blockBadgeMissingCount, 1);
  assert.equal(result.visualQuality.blockPortMissingCount, 1);
  assert.ok(result.diagnostics.some((issue) => issue.code === "block-badge-missing"));
  assert.ok(result.diagnostics.some((issue) => issue.code === "block-port-missing"));
});

test("block QA thresholds are configurable", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "block", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-block", sourceNodeIds: ["a", "b"], ports: { inputs: [], outputs: [] } },
    ],
    relations: [],
    groups: [],
    constraints: [],
  }, {
    visualQualityThresholds: {
      maxBlockBadgeMissingCount: 1,
      maxBlockPortMissingCount: 1,
    },
  });
  assert.equal(result.diagnostics.some((issue) => issue.code === "block-badge-missing"), false);
  assert.equal(result.diagnostics.some((issue) => issue.code === "block-port-missing"), false);
  assert.equal(result.visualQuality.thresholds.maxBlockPortMissingCount, 1);
});

test("residual bypass chooses a bottom corridor when the top edge is too close", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "source", role: "body", category: "operator", form: "band", blockKind: "residual-block", projectionId: "p-source", sourceNodeIds: ["source"], ports: { inputs: [], outputs: [{ portId: "out" }] } },
      { id: "target", role: "body", category: "operator", form: "band", blockKind: "residual-block", projectionId: "p-target", sourceNodeIds: ["target"], ports: { inputs: [{ portId: "in" }], outputs: [] } },
    ],
    relations: [
      { id: "skip", sourcePrimitiveId: "source", targetPrimitiveId: "target", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    groups: [],
    constraints: [],
  });
  const connector = result.connectors.find((item) => item.id === "skip");
  assert.ok(connector.points.some((point) => point.y > 100));
});

test("scores segment crossings between connectors without shared endpoints", () => {
  const connectors = [
    { id: "down", sourcePrimitiveId: "a", targetPrimitiveId: "d", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { id: "up", sourcePrimitiveId: "b", targetPrimitiveId: "c", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
    { id: "shared", sourcePrimitiveId: "a", targetPrimitiveId: "e", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
  ];

  assert.equal(scoreLayout([], connectors).crossings, 1);
});

test("validation rejects a connector that passes through an unrelated body", () => {
  const layout = {
    version: "laid-out-neural-scene/v1",
    units: "layout-unit",
    page: { x: 0, y: 0, width: 300, height: 120 },
    primitives: [
      body("source", 10, 40, 40, 40),
      body("obstacle", 120, 30, 60, 60),
      body("target", 240, 40, 40, 40),
    ],
    connectors: [
      { id: "through", sourcePrimitiveId: "source", targetPrimitiveId: "target", relationTags: ["data"], points: [{ x: 50, y: 60 }, { x: 240, y: 60 }] },
    ],
    groups: [],
  };

  const validation = validateLaidOutScene(layout);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.find((issue) => issue.code === "connector-body-intersection"), {
    code: "connector-body-intersection",
    relationId: "through",
    primitiveId: "obstacle",
  });
});

test("routes through one corridor around consecutive obstacles", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: false }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(connector.points.length >= 4);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
});

test("uses the bottom corridor when the top corridor is blocked", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: true }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const source = result.primitives.find((item) => item.id === "z-source");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(connector.points.length >= 4);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
  assert.equal(validateLaidOutScene(result).issues.some((issue) => issue.relationId === "long-route"), false);
});

test("multi-corridor obstacle routing is deterministic", () => {
  const input = corridorScene({ blockTop: true });
  const routes = Array.from({ length: 5 }, () => layoutNeuralScene(input).connectors.find((item) => item.id === "long-route").points);

  for (const route of routes.slice(1)) assert.deepEqual(route, routes[0]);
});

test("nested groups participate in placement without sibling overlap or non-finite bounds", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("left-a", "band", "flow"),
      sceneBody("left-b", "band", "flow"),
      sceneBody("right-a", "band", "flow"),
    ],
    relations: [
      relation("left-flow", "left-a", "left-b"),
      relation("cross", "left-b", "right-a"),
    ],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["left-a", "left-b", "right-a"] },
      { id: "left", parentId: "root", primitiveIds: ["left-a", "left-b"] },
      { id: "right", parentId: "root", primitiveIds: ["right-a"] },
      { id: "empty", parentId: "root", primitiveIds: [] },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const byGroup = new Map(result.groups.map((group) => [group.id, group]));
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("left").bounds), true);
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("right").bounds), true);
  assert.equal(overlaps(byGroup.get("left").bounds, byGroup.get("right").bounds), false);
  assert.ok(Object.values(byGroup.get("empty").bounds).every(Number.isFinite));
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places nested container children according to declared direction, padding, and gap", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("a", "band", "flow"),
      sceneBody("b", "band", "flow"),
      sceneBody("c", "band", "flow"),
      sceneBody("d", "band", "flow"),
    ],
    relations: [],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["a", "b", "c", "d"], direction: "horizontal", padding: 30, gap: 70 },
      { id: "left", parentId: "root", primitiveIds: ["a", "b"], direction: "vertical", padding: 20, gap: 35 },
      { id: "right", parentId: "root", primitiveIds: ["c", "d"], direction: "vertical", padding: 20, gap: 35 },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const bodyById = new Map(result.primitives.filter((item) => item.role === "body").map((item) => [item.id, item]));
  const groupById = new Map(result.groups.map((item) => [item.id, item]));
  assert.equal(bodyById.get("a").bounds.x, bodyById.get("b").bounds.x);
  assert.ok(bodyById.get("b").bounds.y >= bodyById.get("a").bounds.y + bodyById.get("a").bounds.h + 35);
  assert.ok(groupById.get("right").bounds.x >= groupById.get("left").bounds.x + groupById.get("left").bounds.w + 70);
  assert.equal(groupById.get("left").bounds.x - groupById.get("root").bounds.x, 30);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("sizes the page to include container padding and bounds", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [sceneBody("only", "band", "flow")],
    relations: [],
    groups: [{ id: "frame", primitiveIds: ["only"], direction: "horizontal", padding: 120, gap: 32 }],
  });
  const frame = result.groups[0].bounds;

  assert.ok(frame.x + frame.w <= result.page.width);
  assert.ok(frame.y + frame.h <= result.page.height);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places grouped and ungrouped top-level bodies without overlap in data-flow order", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("input", "band", "flow"),
      sceneBody("inside-a", "band", "flow"),
      sceneBody("inside-b", "band", "flow"),
      sceneBody("output", "band", "flow"),
    ],
    relations: [
      relation("enter", "input", "inside-a"),
      relation("internal", "inside-a", "inside-b"),
      relation("leave", "inside-b", "output"),
    ],
    groups: [{ id: "module", primitiveIds: ["inside-a", "inside-b"], direction: "vertical", padding: 24, gap: 30 }],
  });
  const bodies = result.primitives.filter((item) => item.role === "body");
  const byId = new Map(bodies.map((item) => [item.id, item.bounds]));

  assert.ok(byId.get("input").x + byId.get("input").w <= result.groups[0].bounds.x);
  assert.ok(result.groups[0].bounds.x + result.groups[0].bounds.w <= byId.get("output").x);
  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) assert.equal(overlaps(bodies[left].bounds, bodies[right].bounds), false);
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

function corridorScene({ blockTop }) {
  const primitives = [
    sceneBody("a-top-seed", "plane", "top"),
    sceneBody("z-source", "band", "flow"),
    sceneBody("mid-1", "band", "flow"),
    sceneBody("mid-2", "band", "flow"),
    sceneBody("target", "band", "flow"),
  ];
  const relations = [
    relation("flow-1", "z-source", "mid-1"),
    relation("flow-2", "mid-1", "mid-2"),
    relation("flow-3", "mid-2", "target"),
    relation("long-route", "z-source", "target"),
  ];
  if (blockTop) {
    primitives.push(sceneBody("top-1", "plane", "top"), sceneBody("top-2", "plane", "top"));
    relations.push(relation("top-link-1", "a-top-seed", "top-1"), relation("top-link-2", "top-1", "top-2"));
  }
  return { version: "semantic-neural-scene/v1", primitives, relations, constraints: [] };
}

function sceneBody(id, form, scale) {
  return { id, role: "body", category: "operator", form, sourceNodeIds: [id], projectionId: `p-${id}`, semanticTags: [], data: { scale } };
}

function relation(id, sourcePrimitiveId, targetPrimitiveId) {
  return { id, sourcePrimitiveId, targetPrimitiveId, relationTags: ["data"], sourceEdgeIds: [id] };
}

function body(id, x, y, w, h) {
  return { id, role: "body", bounds: { x, y, w, h }, anchors: { inputs: [], outputs: [] } };
}

function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function contains(outer, inner) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h; }
function pathIntersects(points, rect) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a.x === b.x && a.x > rect.x && a.x < rect.x + rect.w && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.h) return true;
    if (a.y === b.y && a.y > rect.y && a.y < rect.y + rect.h && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.w) return true;
  }
  return false;
}
