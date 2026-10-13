// 排版合规核验：直接量成品 SVG，而不是相信渲染器自己的诊断。
//
//   node scripts/check-typography.mjs --dir=artifacts/onnx/journal
//
// 为什么需要它：渲染器里的 label-below-font-floor 诊断是"它自己算的"。
// 期刊编辑看到的只有成品，所以必须有一条独立路径——把 SVG 里真正写进去的
// font-size 换算成成品 pt，再对照该刊下限。两边不一致就说明诊断有洞。
//
// 换算依据：SVG 根节点声明了成品物理宽度（width="183mm"），
// 所以 1 layout 单位 = (宽mm × 72/25.4) / viewBox宽  pt。
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

const dir = resolve(String(args.get("dir") || "artifacts/onnx/journal"));
const PT_PER_MM = 72 / 25.4;
// 各刊正文字号下限（pt）。与 scene-svg-renderer.mjs 的 JOURNAL_PRESETS 同源。
const FLOOR_PT = { Nature: 5, Science: 6, Cell: 6, IEEE: 6, ACS: 5 };
const CEILING_PT = { Nature: 7, Science: 7, Cell: 8, IEEE: 8, ACS: 8 };

const svgFiles = readdirSync(dir).filter((name) => name.endsWith(".svg")).sort();
if (!svgFiles.length) {
  console.error(`no .svg files in ${dir}`);
  process.exit(2);
}

let failed = 0;
let unchecked = 0;
for (const file of svgFiles) {
  const svg = readFileSync(join(dir, file), "utf8");
  const root = /<svg[^>]*>/.exec(svg)?.[0] || "";
  const widthMatch = /width="([\d.]+)mm"/.exec(root);
  if (!widthMatch) {
    console.log(`${file.padEnd(24)} 未声明物理尺寸（无 --journal / --target-width），无法核验`);
    unchecked += 1;
    continue;
  }
  const mmW = Number(widthMatch[1]);
  const mmH = Number(/height="([\d.]+)mm"/.exec(root)?.[1] || "0");
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const widthUnits = Number(viewBox[1]);
  const ptPerUnit = (mmW * PT_PER_MM) / widthUnits;

  let journal = null;
  let diagnostics = [];
  try {
    const summary = JSON.parse(readFileSync(join(dir, file.replace(/\.svg$/, ".summary.json")), "utf8"));
    journal = summary.typography?.journal || null;
    diagnostics = summary.typography?.diagnostics || [];
  } catch { /* 没有 summary 也能量，只是不知道是哪家刊 */ }

  const floor = FLOOR_PT[journal] ?? null;
  const ceiling = CEILING_PT[journal] ?? null;
  const sizes = [...new Set([...svg.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const pts = sizes.map((value) => value * ptPerUnit);
  const below = floor === null ? [] : pts.filter((pt) => pt < floor - 0.05);
  const above = ceiling === null ? [] : pts.filter((pt) => pt > ceiling + 0.05);
  const span = pts.length ? Math.max(...pts) - Math.min(...pts) : 0;

  const reportedBelow = diagnostics.some((item) => item.code === "label-below-font-floor");
  // 核验的核心不变量：渲染器报的"越界"必须与成品里真实存在的越界一致。
  const agrees = below.length > 0 === reportedBelow;
  if (!agrees) failed += 1;

  const verdict = below.length || above.length ? "越界" : "合规";
  console.log(
    `${file.padEnd(24)} ${journal || "?"}  ${mmW}×${mmH.toFixed(0)}mm  `
    + `字号 ${pts.map((pt) => pt.toFixed(2)).join("/")} pt  `
    + `跨度 ${span.toFixed(2)}pt  → ${verdict}`
    + (below.length ? `  低于下限: ${below.map((pt) => pt.toFixed(2)).join(",")}` : "")
    + (above.length ? `  高于上限: ${above.map((pt) => pt.toFixed(2)).join(",")}` : "")
    + `  [诊断${reportedBelow ? "已报" : "未报"} ${agrees ? "一致" : "★不一致"}]`,
  );
}

console.log(
  `\n合计 ${svgFiles.length} 张：${svgFiles.length - unchecked} 张可核验，${unchecked} 张无物理尺寸，`
  + `${failed} 张"诊断与成品不一致"。`,
);
process.exit(failed ? 1 : 0);
