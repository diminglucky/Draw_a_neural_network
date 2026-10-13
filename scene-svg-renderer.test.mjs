import assert from "node:assert/strict";
import test from "node:test";

import { blockAcceptanceFixtures } from "./block-acceptance-fixtures.mjs";
import { evaluateBlockAcceptanceFixture } from "./block-acceptance-audit.mjs";
import { planFigureTypography, renderSceneSvg, SCENE_SVG_RENDERER_VERSION } from "./scene-svg-renderer.mjs";

test("renders a laid-out Scene to deterministic SVG", () => {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === "multimodal");
  const { result } = evaluateBlockAcceptanceFixture(fixture);
  const svg = renderSceneSvg(result.visioDiagramPlan.scene, { title: "Multimodal" });
  assert.equal(SCENE_SVG_RENDERER_VERSION, "scene-svg-renderer/v1");
  assert.match(svg, /^<svg /);
  assert.match(svg, /marker id="arrow-main-flow"/);
  assert.match(svg, /class="scene-connector/);
  assert.match(svg, /class="block-badge"/);
  assert.match(svg, /Multimodal/);
  assert.equal(svg, renderSceneSvg(result.visioDiagramPlan.scene, { title: "Multimodal" }));
});

test("escapes labels and rejects incomplete scenes", () => {
  const { result } = evaluateBlockAcceptanceFixture(blockAcceptanceFixtures.find((item) => item.name === "graph"));
  const scene = structuredClone(result.visioDiagramPlan.scene);
  scene.primitives.find((primitive) => primitive.role !== "body").labels = ["A < B & C"];
  const svg = renderSceneSvg(scene, { title: "Graph <Preview>" });
  assert.match(svg, /A &lt; B &amp; C/);
  assert.match(svg, /Graph &lt;Preview&gt;/);
  assert.throws(() => renderSceneSvg({ primitives: [], connectors: null }), /requires primitives and connectors/);
});

// 一份覆盖全部图元形态的场景，用来锁定模块绘制层的不变量。
// 这里的尺寸必须等于 neural-scene-layout.mjs 实际会产出的尺寸，
// 否则不变量是在"已经不存在的大盒子"上被验证的。
const MODULE_SCENE = {
  page: { width: 560, height: 240 },
  primitives: [
    { id: "m-volume", role: "body", form: "volume", blockKind: "conv-block", blockBadge: "encoder", labels: ["Conv_0"], sourceNodeIds: ["m-volume"], bounds: { x: 24, y: 28, w: 78, h: 32 } },
    { id: "m-plane", role: "body", form: "plane", labels: ["input"], sourceNodeIds: ["m-plane"], bounds: { x: 130, y: 28, w: 62, h: 34 } },
    { id: "m-stack", role: "body", form: "stack", blockBadge: "dense", labels: ["MatMul"], sourceNodeIds: ["m-stack"], bounds: { x: 220, y: 28, w: 84, h: 34 } },
    { id: "m-merge", role: "body", form: "glyph", semanticTags: ["merge"], labels: ["Add"], sourceNodeIds: ["m-merge"], bounds: { x: 340, y: 28, w: 34, h: 34 } },
    { id: "m-wedge", role: "body", form: "wedge", data: { scaleChange: "expand" }, labels: ["Resize"], sourceNodeIds: ["m-wedge"], bounds: { x: 24, y: 150, w: 62, h: 32 } },
    { id: "m-strip", role: "body", form: "strip", labels: ["tokens"], sourceNodeIds: ["m-strip"], bounds: { x: 110, y: 150, w: 72, h: 26 } },
    { id: "m-band", role: "body", form: "band", labels: ["LayerNorm"], sourceNodeIds: ["m-band"], bounds: { x: 205, y: 150, w: 96, h: 34 } },
    { id: "m-cell", role: "body", form: "cell", labels: ["LSTM"], sourceNodeIds: ["m-cell"], bounds: { x: 330, y: 150, w: 68, h: 34 } },
    { id: "m-callout", role: "body", form: "callout", labels: ["custom"], sourceNodeIds: ["m-callout"], bounds: { x: 420, y: 150, w: 92, h: 34 } },
  ],
  connectors: [],
  groups: [],
};

function channels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturationOf(hex) {
  const [r, g, b] = channels(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const lightness = (max + min) / 2;
  return lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
}

test("module shapes share one stroke width and never render coloured text", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  const widths = new Set([...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((match) => match[1]));
  assert.deepEqual(
    [...widths].sort(),
    ["1", "1.25"],
    "图元只允许两种线宽：轮廓 1.25 与发丝线 1；散落的 0.8/0.9/1.1/1.2/1.3/1.4 会让一张图看起来像多人拼的",
  );
  // Nature 明文禁止彩色文字：颜色只能出现在图形上。
  for (const match of svg.matchAll(/<text[^>]*fill="(#[0-9a-fA-F]{6})"/g)) {
    const hex = match[1];
    const spread = Math.max(...channels(hex)) - Math.min(...channels(hex));
    assert.ok(spread <= 44, `${hex} 是彩色文字，Nature 明确禁止`);
    assert.ok(luminance(hex) < 0.55, `${hex} 不够深，印出来会糊`);
  }
});

test("merge operators render as a circle glyph with the label outside", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  assert.match(svg, /<circle class="glyph-body"/);
  assert.match(svg, /class="body-caption"/);
  // 名字不能再落在圆心里——那会和加号叠在一起。
  const caption = /<text class="body-label" x="([0-9.]+)" y="([0-9.]+)">Add<\/text>/.exec(svg);
  assert.ok(caption, "合并算子的名字应渲染成普通文本");
  assert.ok(Number(caption[2]) > 28 + 34, "名字必须挂在圆的下面");
});

test("only the unresolved-module callout may use a pattern", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  for (const body of svg.matchAll(/<g class="scene-body[^>]*>[\s\S]*?<\/g>/g)) {
    if (/callout-body/.test(body[0])) continue;
    assert.doesNotMatch(body[0], /stroke-dasharray/, "Nature 明令避免 pattern，图元内部不允许虚线");
  }
});

test("a cuboid keeps its hue on the side face instead of fading to grey", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  const front = /class="face-front"[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)[1];
  const side = /class="face-side"[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)[1];
  // 旧实现直接向黑混合，#DCEAF4 的侧面会变成 #b4c0c8 这种脏灰（饱和度掉到 0.13）。
  assert.ok(
    saturationOf(side) > saturationOf(front) * 0.75,
    `侧面 ${side} 相对正面 ${front} 褪色过多，会看起来"发霉"`,
  );
  assert.ok(luminance(side) < luminance(front), "侧面必须比正面暗，否则读不出进深");
});

// 锁的是用户最新的投诉："你只是不同颜色的方块，看看真正的 VGG16"。
// 卷积/特征图必须画成 N 张等距平面堆（VGG16 的标志性表示），
// 而不是单一长方体。FC/线性层画成细长扁条（VGG16 蓝条），输入画成带图片的 3D 板。
test("feature map stack renders N isometric planes with side faces for 3D depth", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  const volume = bodyGroup(svg, "conv-block");
  assert.ok(volume, "应能取到卷积图元");
  // N=3 张平面：3 个 <rect> 正面 + 至少 2 个 <polygon> 侧面/顶面
  const rectCount = (volume.match(/<rect/g) || []).length;
  const polygonCount = (volume.match(/<polygon/g) || []).length;
  assert.ok(rectCount >= 3, `特征图平面堆应有 3 张平面，得到 ${rectCount} 个 rect`);
  assert.ok(polygonCount >= 2, `特征图应有侧面/顶面多边形，得到 ${polygonCount} 个 polygon`);
  // 不能再出现旧的"单立方体"表示
  assert.doesNotMatch(volume, /class="face-top"/, "特征图不应再画成单一长方体顶面");
  assert.doesNotMatch(volume, /class="face-front"/, "特征图不应再画成单一长方体正面");
});

test("FC/linear stack renders as a flat bar, not a 3D slab stack", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  const stack = bodyGroup(svg, "stack");
  assert.ok(stack, "应能取到矩阵/FFN 图元");
  // FC 扁条：单 rect，不应该有 3 块错开的 slab 或长方体面
  assert.doesNotMatch(stack, /class="face-top"/, "FC 扁条不应有 3D 顶面");
  assert.doesNotMatch(stack, /class="face-side"/, "FC 扁条不应有 3D 侧面");
  assert.doesNotMatch(stack, /class="stack-slab"/, "FC 扁条不应再有错开的叠板");
  assert.match(stack, /class="bar-body"/, "FC 应使用 bar-body");
});

test("input plane renders as a 3D image slab with a picture icon", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false });
  const plane = bodyGroup(svg, "plane");
  assert.ok(plane, "应能取到输入图元");
  // 3D 图像板：有顶面/侧面/正面，且正面带图片符号（polyline 山 + circle 太阳）
  assert.match(plane, /class="face-top"/, "图像板应有 3D 顶面");
  assert.match(plane, /class="face-front"/, "图像板应有 3D 正面");
  assert.match(plane, /<polyline/, "图像板应画山的折线");
  assert.match(plane, /<circle/, "图像板应画太阳圆");
});

// 锁的是"模块内部不许有横线竖线"这条顶刊规则。
//
// 背景：项目曾用"盒内画 3×3 网格"来区分卷积与纯色矩形。但那个网格的列数是按
// **盒尺寸**算的（`gw >= 46 && gh >= 26 ? 3 : 2`），跟卷积核大小、通道数、空间尺寸
// 全都无关——它不编码任何信息，反而**暗示**了一个并不存在的含义（读者会以为格数
// 代表核尺寸或分辨率）。叠层条的条数（`h >= 40 ? 4 : 3`）同理。
//
// Nature / Cell 的架构图里，模块内部一律没有横线竖线：算子类型由「形状 + 标签 + 填充」
// 承担。所以这一条锁两件事：(1) 内部无装饰线；(2) 该由形状承担的区别真的画出来了。
test("flat mode draws no decorative lines inside a module — type is carried by silhouette", () => {
  const svg = renderSceneSvg(MODULE_SCENE, { legend: false, flat: true });
  // 扁平模式必须是真 2D：不能出现三维盒的顶面 / 侧面 / 正面多边形。
  assert.doesNotMatch(svg, /class="face-top"/, "flat 模式不允许三维盒的顶面");
  assert.doesNotMatch(svg, /class="face-side"/, "flat 模式不允许三维盒的侧面");
  assert.doesNotMatch(svg, /class="face-front"/, "flat 模式不允许三维盒的正面");

  // (1) 唯一的内部线是合并算子的 ⊕——那两条臂就是符号本身，不是装饰。
  const merge = bodyGroup(svg, "glyph");
  assert.ok(merge, "应能取到合并算子");
  const arms = (merge.match(/<line/g) || []).length;
  assert.equal(arms, 2, "⊕ 应由两条臂组成");
  assert.equal(
    (svg.match(/<line/g) || []).length,
    arms,
    "扁平模式下除合并算子的 ⊕ 外，任何模块内部都不得出现横线或竖线",
  );

  // (2) 形状词汇：下采样/上采样 = 梯形，合并 = 圆，输入 = 图片符号。
  const wedge = bodyGroup(svg, "wedge");
  const plane = bodyGroup(svg, "plane");
  assert.match(wedge, /<polygon/, "池化 / 上采样应是梯形，而不是又一个矩形");
  assert.match(merge, /<circle/, "合并算子应是圆");
  assert.match(plane, /<polyline/, "输入应画通用图片符号（山）");
  assert.match(plane, /<circle/, "输入应画通用图片符号（太阳）");

  // (3) 梯形必须真的收窄 / 放宽，不能退化成矩形——否则"形状承载语义"就是空话。
  const quad = /points="([^"]+)"/.exec(wedge)[1].split(" ").map((pair) => pair.split(",").map(Number));
  const topWidth = Math.abs(quad[1][0] - quad[0][0]);
  const bottomWidth = Math.abs(quad[2][0] - quad[3][0]);
  assert.ok(bottomWidth > topWidth + 2, `expand 梯形应上窄下宽，实得 上 ${topWidth} / 下 ${bottomWidth}`);

  // (4) 梯形的左上角是**斜的**：步骤角标必须落在斜腰以内，否则会有一半悬在形状外面。
  // 角标画在 body-text 之后，bodyGroup 的非贪婪匹配取不到，所以按梯形顶点推出的盒范围去找。
  const wx = quad[3][0];
  const wy = quad[0][1];
  const ww = quad[2][0] - quad[3][0];
  const wh = quad[3][1] - quad[0][1];
  const chip = [...svg.matchAll(/<circle class="step-chip" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
    .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }))
    .find((c) => c.cx > wx && c.cx < wx + ww && c.cy > wy && c.cy < wy + wh);
  assert.ok(chip, "梯形也应有步骤角标");
  // 左腰：从左上顶点 quad[0] 到左下顶点 quad[3] 的连线。
  const leftEdgeAt = (yy) => quad[0][0] + ((quad[3][0] - quad[0][0]) * (yy - quad[0][1])) / (quad[3][1] - quad[0][1]);
  // 角标是**圆**，最左点只在圆心高度处；按圆的真实轮廓逐高度采样，不能用包围盒角点。
  let worstSlack = Infinity;
  for (let i = 0; i <= 40; i += 1) {
    const yy = chip.cy - chip.r + (2 * chip.r * i) / 40;
    const dx = Math.sqrt(Math.max(0, chip.r * chip.r - (yy - chip.cy) ** 2));
    worstSlack = Math.min(worstSlack, chip.cx - dx - leftEdgeAt(yy));
  }
  assert.ok(worstSlack >= -0.01, `角标最紧处仍悬在梯形斜腰外 ${(-worstSlack).toFixed(2)} 单位`);

  // reduce 方向必须反过来，否则池化与上采样看起来一模一样。
  const reduceScene = {
    page: { width: 200, height: 120 },
    primitives: [
      { id: "r", role: "body", form: "wedge", data: { scaleChange: "reduce" }, labels: ["MaxPool"], sourceNodeIds: ["r"], bounds: { x: 20, y: 20, w: 80, h: 40 } },
    ],
    connectors: [],
  };
  const reduceSvg = renderSceneSvg(reduceScene, { legend: false, flat: true });
  const reduceQuad = /points="([^"]+)"/.exec(reduceSvg)[1].split(" ").map((pair) => pair.split(",").map(Number));
  assert.ok(
    Math.abs(reduceQuad[2][0] - reduceQuad[3][0]) < Math.abs(reduceQuad[1][0] - reduceQuad[0][0]),
    "reduce 梯形应上宽下窄（池化），与 expand 方向相反",
  );

  // (4) 三种形态仍必须是三张不同的图元——这是"全是矩形没区别"的回归防线。
  // 现在靠轮廓与类名区分，而不是靠盒内的装饰线。
  assert.notEqual(bodyGroup(svg, "conv-block"), bodyGroup(svg, "plane"), "卷积与输入不能是同一张图元");
  assert.notEqual(bodyGroup(svg, "conv-block"), bodyGroup(svg, "stack"), "卷积与矩阵不能是同一张图元");
  assert.match(bodyGroup(svg, "conv-block"), /class="flat-body"/, "卷积应是通用模块矩形");
  assert.match(bodyGroup(svg, "stack"), /class="matrix-body"/, "矩阵/线性应使用自己的形态类名");
});

// 同样的规则必须对两种渲染模式都成立：3D 模式是"教材 VGG"画法，
// 但"模块内部不画装饰线"与维度无关——三维里池化/上采样改用梯形棱柱，
// 一样不需要网格和映射线。
test("neither render mode draws decorative lines inside a module", () => {
  for (const flat of [false, true]) {
    const label = flat ? "flat" : "3D";
    const svg = renderSceneSvg(MODULE_SCENE, { legend: false, flat });
    const glyphs = (svg.match(/<circle class="glyph-body"/g) || []).length;
    assert.ok(glyphs > 0, "应能取到合并算子");
    assert.equal(
      (svg.match(/<line/g) || []).length,
      glyphs * 2,
      `${label} 模式下除合并算子的 ⊕ 外，模块内部不得出现任何横线或竖线`,
    );

    // 梯形的正面是斜的（三维棱柱还多一层顶面斜边）：角标在两种模式下都不能悬空。
    const front = /<polygon class="face-front" points="([^"]+)"/.exec(svg)
      || /<polygon class="wedge-body" points="([^"]+)"/.exec(svg);
    assert.ok(front, `${label} 模式下应能取到梯形正面`);
    const quad = front[1].split(" ").map((pair) => pair.split(",").map(Number));
    const leftEdgeAt = (yy) => quad[0][0] + ((quad[3][0] - quad[0][0]) * (yy - quad[0][1])) / (quad[3][1] - quad[0][1]);
    const chip = [...svg.matchAll(/<circle class="step-chip" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
      .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }))
      .find((c) => c.cy > quad[0][1] && c.cy < quad[3][1]);
    assert.ok(chip, `${label} 模式下梯形应有步骤角标`);
    let worst = Infinity;
    for (let i = 0; i <= 40; i += 1) {
      const yy = chip.cy - chip.r + (2 * chip.r * i) / 40;
      const dx = Math.sqrt(Math.max(0, chip.r * chip.r - (yy - chip.cy) ** 2));
      worst = Math.min(worst, chip.cx - dx - leftEdgeAt(yy));
    }
    assert.ok(worst >= -0.01, `${label} 模式下角标最紧处仍悬在梯形斜腰外 ${(-worst).toFixed(2)} 单位`);
  }
});

// 形状（含图元内部图标）先于文字绘制，所以取到第一个 </g> 为止已经包含全部图标。
function bodyGroup(svg, className) {
  const match = new RegExp(`<g class="scene-body ${className}">[\\s\\S]*?</g>`).exec(svg);
  return match ? match[0] : null;
}

// ── 期刊成品尺寸驱动的排版 ────────────────────────────────────────
// 顶刊的字号是**成品尺寸下的绝对 pt**（Nature 5–7）。我们内部是抽象 layout 单位，
// 两者只能靠"目标栏宽 ÷ 图宽"换算。没有 targetWidth 时图是"任意物理尺寸"的，
// 排版时被缩放多少、字号就变多少——这正是"画得出但投不出去"的根因。
const MM_PER_PT = 25.4 / 72;

function sceneOf(fixtureName) {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === fixtureName);
  return evaluateBlockAcceptanceFixture(fixture).result.visioDiagramPlan.scene;
}

test("without a target width the renderer keeps the legacy unit font ladder", () => {
  const svg = renderSceneSvg(sceneOf("transformer"), { title: "Transformer" });
  // 没有 targetWidth 时不该声明物理尺寸，也不该出现 mm 单位。
  assert.doesNotMatch(/<svg[^>]*>/.exec(svg)[0], /\d+mm/);
  assert.match(svg, /\.scene-title\{text-anchor:middle;font-size:17px/);
  assert.equal(planFigureTypography(sceneOf("transformer"), {}).enabled, false);
});

test("a journal preset resolves the whole font ladder into that journal's pt range", () => {
  for (const [journal, [loPt, hiPt]] of [["nature", [5, 7]], ["science", [6, 7]], ["cell", [6, 8]]]) {
    const scene = sceneOf("transformer");
    const plan = planFigureTypography(scene, { journal });
    assert.equal(plan.enabled, true, `${journal} 应启用印刷排版`);
    assert.deepEqual(plan.fontPtRange, [loPt, hiPt]);
    const { title, label, small } = plan.ladderPt;
    for (const [name, pt] of Object.entries({ title, label, small })) {
      assert.ok(pt >= loPt && pt <= hiPt, `${journal} 的 ${name}=${pt}pt 越出 [${loPt}, ${hiPt}]`);
    }
    // Genes & Development 通用规则：同图字号跨度 ≤ 2 pt。
    assert.ok(plan.spanPt <= 2, `${journal} 字号跨度 ${plan.spanPt}pt 超过 2pt 上限`);

    // 渲染出的实际字号换算回 pt 后必须仍落在区间内。
    const svg = renderSceneSvg(scene, { title: "Transformer", journal });
    const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const widthUnits = Number(viewBox[1]);
    const scale = (plan.targetMm / MM_PER_PT) / widthUnits; // pt per unit
    const sizes = [...svg.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]) * scale);
    for (const pt of sizes) {
      assert.ok(pt >= loPt - 0.05 && pt <= hiPt + 0.05, `${journal} 实际渲染字号 ${pt.toFixed(2)}pt 越界`);
    }
    // 根节点必须声明成品物理宽度，否则导出 PDF/EPS 后尺寸不受控。
    assert.match(/<svg[^>]*>/.exec(svg)[0], new RegExp(`width="${plan.targetMm}mm"`));
  }
});

test("an explicit target width is honoured and reported in millimetres", () => {
  const scene = sceneOf("transformer");
  const plan = planFigureTypography(scene, { targetWidth: 114 });
  assert.equal(plan.targetMm, 114);
  const svg = renderSceneSvg(scene, { title: "Transformer", targetWidth: 114 });
  const root = /<svg[^>]*>/.exec(svg)[0];
  assert.match(root, /width="114mm"/);
  // 高度必须按 viewBox 宽高比等比推出，不能变形。
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const expectedHeight = 114 * Number(viewBox[2]) / Number(viewBox[1]);
  const actualHeight = Number(/height="([\d.]+)mm"/.exec(root)[1]);
  assert.ok(Math.abs(actualHeight - expectedHeight) < 0.05, `高度 ${actualHeight} 与宽高比推出的 ${expectedHeight} 不符`);
});

test("a figure too tall for the journal page is reported instead of silently emitted", () => {
  // 人为造一张极窄极高的场景，逼出 figure-too-tall。
  const scene = {
    page: { x: 0, y: 0, width: 120, height: 4000 },
    primitives: [
      { id: "b", role: "body", form: "band", bounds: { x: 10, y: 10, w: 100, h: 30 } },
    ],
    connectors: [],
  };
  const plan = planFigureTypography(scene, { journal: "cell" });
  assert.ok(plan.diagnostics.some((item) => item.code === "figure-too-tall"), "超高图必须给出诊断");
});

test("a label that cannot fit is reported and moved outside the box, never drawn below the floor", () => {
  // 盒宽由布局层锁死，长名字只能靠缩字号塞进去。缩到期刊下限仍放不下时，
  // 旧行为是继续缩到 4.86 pt 静默越界——这正是"画得出、投不出去"的最后一环。
  // 现在的契约是：报出诊断 + 把名字外置到盒外，成品里不得出现低于下限的字号。
  const longName = "LayerNormalization_8";
  const scene = {
    page: { x: 0, y: 0, width: 800, height: 300 },
    primitives: [
      { id: "b", role: "body", form: "band", bounds: { x: 10, y: 10, w: 60, h: 40 }, labels: [longName] },
    ],
    connectors: [],
  };
  const plan = planFigureTypography(scene, { journal: "nature" });
  const diagnostic = plan.diagnostics.find((item) => item.code === "label-below-font-floor");
  assert.ok(diagnostic, "放不下的标签必须给出诊断");
  assert.deepEqual(diagnostic.labels, [longName]);
  assert.ok(diagnostic.minPt < 5, `诊断里的所需字号 ${diagnostic.minPt}pt 应低于下限 5pt`);

  const svg = renderSceneSvg(scene, { journal: "nature" });
  const widthUnits = Number(/viewBox="0 0 ([\d.]+) /.exec(svg)[1]);
  const ptPerUnit = (plan.targetMm / MM_PER_PT) / widthUnits;
  const renderedPt = Math.min(...[...svg.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]) * ptPerUnit));
  // 容差 0.01 pt：SVG 里的 px 值只保留三位小数，反算回来会有末位误差。
  assert.ok(renderedPt >= 5 - 0.01, `成品里不得出现低于下限的字号，实得 ${renderedPt.toFixed(2)}pt`);
  // 名字被挪到盒外：正文块（body-text）里不再有它，说明块（body-caption）里有。
  assert.ok(svg.includes(`>${longName}<`), "外置的名字仍要出现在图上");
  const caption = /<g class="body-caption">[\s\S]*?<\/g>/.exec(svg);
  assert.ok(caption && caption[0].includes(longName), "放不下的名字应挂到盒外");

  // 对照组：短名字塞得下时不能报诊断，否则诊断就成了永远为真的噪声。
  const shortScene = {
    page: { x: 0, y: 0, width: 800, height: 300 },
    primitives: [
      { id: "b", role: "body", form: "band", bounds: { x: 10, y: 10, w: 60, h: 40 }, labels: ["Conv_0"] },
    ],
    connectors: [],
  };
  assert.equal(
    planFigureTypography(shortScene, { journal: "nature" }).diagnostics.some((item) => item.code === "label-below-font-floor"),
    false,
    "短标签不该触发字号下限诊断",
  );
});

// ── P0 硬伤回归：角标方向、线宽 pt、算子名缩写 ────────────────────

// 步骤角标必须沿**数据流**递增，而不是沿**阅读顺序**。
// 旧实现按「先 x 后 y」编号，并注释断言这"正好等于数据流的先后"——该断言对自上而下的列
// 成立，对 U-Net 那种上升臂不成立：输出层被编成 9、首个上采样被编成 16，与箭头相反。
test("step numbers follow the data flow, not the reading order", () => {
  // 三个盒子自上而下摆放，但数据流自下而上——阅读顺序与数据流正好相反。
  const box = (id, y) => ({ id, role: "body", form: "band", labels: [id.toUpperCase()], sourceNodeIds: [id], bounds: { x: 20, y, w: 90, h: 30 } });
  const edge = (id, from, to) => ({ id, sourcePrimitiveId: from, targetPrimitiveId: to, routeClass: "main-flow", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  const scene = {
    page: { x: 0, y: 0, width: 220, height: 300 },
    primitives: [box("a", 220), box("b", 140), box("c", 60)],
    connectors: [edge("e1", "a", "b"), edge("e2", "b", "c")],
  };
  const svg = renderSceneSvg(scene, { legend: false });
  const chips = [...svg.matchAll(/<circle class="step-chip" cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+"[^>]*\/><text class="step-chip-label"[^>]*>(\d+)</g)]
    .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), step: Number(m[3]) }));
  const stepAt = (y) => chips.find((chip) => Math.abs(chip.cy - (y + 9)) < 6)?.step;
  const [a, b, c] = [220, 140, 60].map(stepAt);
  assert.ok([a, b, c].every(Number.isFinite), `三个盒子都应有角标，实得 ${a}/${b}/${c}`);
  assert.ok(a < b && b < c, `角标必须沿箭头递增（a→b→c），实得 ${a}/${b}/${c}；按阅读顺序会得到 ${c}/${b}/${a}`);
  assert.equal(a, 1, "数据流的起点应是 1 号，而不是阅读顺序最上面那个");
});

// 线宽和字号是同一类问题：都是绝对物理量，却写在 layout 单位里。
// 图幅一变小线就跟着变细——实测 U-Net 单栏 89 mm 时掉到 0.49 pt（低于 Cell 下限），
// ViT 双栏 183 mm 时涨到 1.75 pt（高于上限）。两端都破。
test("line widths are normalised into the journal pt range, not left in layout units", () => {
  const scene = sceneOf("transformer");
  for (const journal of ["nature", "cell"]) {
    const plan = planFigureTypography(scene, { journal });
    const svg = renderSceneSvg(scene, { journal, legend: false });
    const widthUnits = Number(/viewBox="0 0 ([\d.]+) /.exec(svg)[1]);
    const ptPerUnit = (plan.targetMm / MM_PER_PT) / widthUnits;
    const pt = [...new Set([...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]) * ptPerUnit))];
    assert.ok(pt.length > 0, "应能取到线宽");
    for (const value of pt) {
      assert.ok(value >= 0.5 - 0.01, `${journal} 下线宽 ${value.toFixed(2)}pt 低于 Cell 的 0.5pt 下限`);
      assert.ok(value <= 1.5 + 0.01, `${journal} 下线宽 ${value.toFixed(2)}pt 高于 Cell 的 1.5pt 上限`);
    }
  }
});

// 长算子名先换成领域标准缩写再试排——这是"名字塞不进盒子"的正解，
// 比缩字号（会跌破下限）和溢出盒外（会压住邻盒）都好。
test("long operator names are abbreviated to the field's standard short form", () => {
  const scene = {
    page: { x: 0, y: 0, width: 800, height: 300 },
    primitives: [
      { id: "gap", role: "body", form: "wedge", data: { scaleChange: "reduce" }, sourceNodeIds: ["GlobalAveragePool_14"], bounds: { x: 10, y: 10, w: 60, h: 34 } },
      { id: "ln", role: "body", form: "band", sourceNodeIds: ["LayerNormalization_8"], bounds: { x: 90, y: 10, w: 60, h: 34 } },
      { id: "bn", role: "body", form: "band", sourceNodeIds: ["BatchNormalization_2"], bounds: { x: 170, y: 10, w: 60, h: 34 } },
    ],
    connectors: [],
  };
  const svg = renderSceneSvg(scene, { journal: "nature", legend: false });
  for (const short of ["GAP", "LayerNorm", "BatchNorm"]) {
    assert.ok(svg.includes(`>${short}<`), `${short} 应出现在图上`);
  }
  for (const long of ["GlobalAveragePool", "LayerNormalization", "BatchNormalization"]) {
    assert.ok(!svg.includes(`>${long}<`), `${long} 不该原样画出去`);
  }
  assert.equal(
    planFigureTypography(scene, { journal: "nature" }).diagnostics.length,
    0,
    "缩写之后应当没有任何排版诊断",
  );
});
