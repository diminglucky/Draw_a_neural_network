// 模块画廊：把每种图元形态按真实尺寸单独渲染出来，用于肉眼判断"单个模块好不好看"。
// 排版/连线的问题不在这里暴露——这里只看形状本身。
//
//   node tools/module-gallery.mjs [--out=artifacts/module-gallery]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderSceneSvg } from "../scene-svg-renderer.mjs";

const CELL = 132;
const COLUMNS = 4;

// 尺寸取自 neural-scene-layout.mjs 的 baseSizeForForm / blockKindSize，
// 所以这里的观感等同于论文插图里的真实观感。
const MODULES = [
  { form: "volume", w: 100, h: 38, label: "Conv_0", badge: "64×112×112", blockKind: "encoder-stage" },
  { form: "volume", w: 78, h: 32, label: "Conv_11", badge: "128×28×28", blockKind: "conv-block" },
  { form: "plane", w: 62, h: 34, label: "input", badge: "3×224×224", blockKind: null },
  { form: "stack", w: 84, h: 34, label: "MatMul", badge: "dense", blockKind: "ffn-block" },
  { form: "wedge", w: 78, h: 32, label: "MaxPool", badge: "reduce", data: { scaleChange: "reduce" }, blockKind: "conv-block" },
  { form: "wedge", w: 100, h: 38, label: "Resize", badge: "expand", data: { scaleChange: "expand" }, blockKind: "decoder-stage" },
  { form: "strip", w: 72, h: 26, label: "tokens", badge: "197×768", blockKind: null },
  { form: "band", w: 96, h: 34, label: "LayerNorm", badge: "norm", blockKind: "residual-block" },
  { form: "glyph", w: 34, h: 34, label: "Add", semanticTags: ["merge"], blockKind: "residual-block" },
  { form: "glyph", w: 34, h: 34, label: "Concat", semanticTags: ["merge"], blockKind: "multi-scale-fusion" },
  { form: "cell", w: 68, h: 34, label: "LSTM", badge: "recurrent", blockKind: "recurrent-cell" },
  { form: "callout", w: 92, h: 34, label: "custom", badge: "未解析", blockKind: null },
];

function buildScene() {
  const rows = Math.ceil(MODULES.length / COLUMNS);
  const primitives = MODULES.map((module, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const cellX = column * CELL;
    const cellY = row * CELL;
    return {
      id: `module-${index}`,
      role: "body",
      form: module.form,
      blockKind: module.blockKind || undefined,
      blockBadge: module.badge,
      semanticTags: module.semanticTags,
      data: module.data,
      labels: [module.label],
      sourceNodeIds: [`module-${index}`],
      bounds: {
        x: cellX + (CELL - module.w) / 2,
        y: cellY + (CELL - module.h) / 2,
        w: module.w,
        h: module.h,
      },
    };
  });
  return {
    page: { width: COLUMNS * CELL, height: rows * CELL },
    primitives,
    connectors: [],
    groups: [],
  };
}

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const outputRoot = readOption("out", "artifacts/module-gallery");
// --flat：顶刊扁平模式。每种形态走各自的扁平专属图标（网格 / 图片 / 叠层条），
// 而不是三维盒。两种模式并排看，才能确认"形态区分"在扁平化之后没有丢。
const flat = process.argv.slice(2).includes("--flat");
const scene = buildScene();
// 图例与序号在这里是噪声：画廊要看的只有形状本身。
const svg = renderSceneSvg(scene, { scale: 3, legend: false, margin: 20, flat });

await mkdir(outputRoot, { recursive: true });
const target = join(outputRoot, flat ? "modules-flat.svg" : "modules.svg");
await writeFile(target, svg, "utf8");
console.log(`wrote ${target} (${MODULES.length} modules, ${COLUMNS} columns)`);
