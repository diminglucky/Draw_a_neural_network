// ONNX 直通：把编译器导出的真实计算图直接画成图，不经过 LLM、不经过自然语言描述。
//
//   node scripts/draw-onnx.mjs --input=artifacts/onnx/resnet18-lite.onnx
//
// ONNX 的每个节点、每条边、每个张量形状都是导出时写死的确定事实，因此默认走
// `full` 投影：逐算子出图，不做 Block 折叠。若 full 投影在布局阶段不通过，
// 会显式降级到 `balanced` 并在 summary 里记录原因，绝不静默改变语义。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractArchitectureEvidence, normalizeArchitectureEvidence, planArchitectureFigure } from "../agent-pipeline.mjs";
import { planFigureTypography, renderSceneSvg, SCENE_SVG_RENDERER_VERSION } from "../scene-svg-renderer.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

const inputPath = args.get("input");
if (!inputPath) {
  console.error("usage: node scripts/draw-onnx.mjs --input=<model.onnx> [--projection=full|balanced|overview] [--out=<dir>] [--title=<text>] [--journal=nature|science|cell|ieee|acs] [--target-width=<mm>] [--flat] [--legend-lang=en|zh] [--plan-only]");
  process.exit(2);
}

const projection = String(args.get("projection") || "full").toLowerCase();
if (!["overview", "balanced", "full"].includes(projection)) {
  console.error(`unsupported projection "${projection}"; expected overview, balanced, or full`);
  process.exit(2);
}

const absoluteInput = resolve(inputPath);
const bytes = readFileSync(absoluteInput);
const modelName = basename(absoluteInput, extname(absoluteInput));
// 图内标题：顶刊架构图的标题写在图注（caption）里，图内不该重复一遍。
// 因此只有显式 --title=... 才画标题；模型名照旧进 summary 供检索。
const title = args.get("title") || "";
const outputRoot = args.get("out")
  ? resolve(String(args.get("out")))
  : fileURLToPath(new URL("../artifacts/onnx", import.meta.url));
mkdirSync(outputRoot, { recursive: true });

// 1) 证据提取：ONNX 字节 → 架构证据包（grounded，零执行）
const evidence = await extractArchitectureEvidence({
  kind: "artifact",
  artifact: { format: "onnx", path: absoluteInput, data: bytes },
  sourceId: `onnx:${modelName}`,
  revision: String(args.get("revision") || "working-tree"),
  metadata: { uri: `file://${absoluteInput.replace(/\\/g, "/")}`, authority: 8 },
  projection,
});

if (evidence.status !== "grounded") {
  console.error(JSON.stringify({
    status: "failed",
    stage: "evidence",
    evidenceStatus: evidence.status,
    diagnostics: evidence.diagnostics || [],
  }, null, 2));
  process.exit(1);
}

// 2) 归一化 → Universal IR
const normalized = normalizeArchitectureEvidence(evidence);

// 3) 规划：IR → Canonical Model → Facts → Block IR → 投影 → 语义场景 → 布局
let plan = planArchitectureFigure(normalized);
let effectiveProjection = projection;
const fallbacks = [];
if (!plan.visioDiagramPlan && projection !== "balanced") {
  const retry = await extractArchitectureEvidence({
    kind: "artifact",
    artifact: { format: "onnx", path: absoluteInput, data: bytes },
    sourceId: `onnx:${modelName}`,
    revision: String(args.get("revision") || "working-tree"),
    metadata: { uri: `file://${absoluteInput.replace(/\\/g, "/")}`, authority: 8 },
    projection: "balanced",
  });
  const retryPlan = planArchitectureFigure(normalizeArchitectureEvidence(retry));
  if (retryPlan.visioDiagramPlan) {
    fallbacks.push({
      from: projection,
      to: "balanced",
      reason: "full projection failed layout validation",
      issues: (plan.sceneValidation?.issues || []).map((issue) => issue.code),
    });
    plan = retryPlan;
    effectiveProjection = "balanced";
  }
}

if (!plan.visioDiagramPlan) {
  console.error(JSON.stringify({
    status: "failed",
    stage: "plan",
    sceneValidation: plan.sceneValidation,
    diagnostics: plan.diagnostics,
  }, null, 2));
  process.exit(1);
}

const scene = plan.visioDiagramPlan.scene;
const bodies = (scene.primitives || []).filter((primitive) => primitive.role === "body");
const forms = bodies.reduce((counts, primitive) => {
  const key = String(primitive.form || "unknown");
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const svgPath = join(outputRoot, `${modelName}.svg`);
const planPath = join(outputRoot, `${modelName}.visio-plan.json`);
const summaryPath = join(outputRoot, `${modelName}.summary.json`);

if (!args.has("plan-only")) {
  // 顶刊扁平模式：--flat 时画扁平 2D 矩形而不是等距立方体（顶刊架构图的标准画法）。
  const flat = args.has("flat");
  // --journal=nature --target-width=183：按期刊成品栏宽出图，字号落在该刊 5–7 pt 区间。
  const journal = args.get("journal");
  const targetWidth = args.get("target-width");
  // 图例默认英文（顶刊图内文字一律英文）；--legend-lang=zh 只用于内部评审稿。
  const legendLang = String(args.get("legend-lang") || "en").toLowerCase();
  writeFileSync(svgPath, renderSceneSvg(scene, { title, flat, journal, targetWidth, legendLang }), "utf8");
}
writeFileSync(planPath, JSON.stringify(plan.visioDiagramPlan, null, 2));

// 排版合规报告：接了 targetWidth / journal 才有内容。flat 必须与出图一致，
// 因为扁平模式会把文字面从"三维正面"换成整盒，盒宽不同、试排结果也不同。
const typography = planFigureTypography(scene, {
  journal: args.get("journal"),
  targetWidth: args.get("target-width"),
  flat: args.has("flat"),
});

const summary = {
  version: "draw-onnx/v1",
  renderer: SCENE_SVG_RENDERER_VERSION,
  status: "rendered",
  model: modelName,
  title: title || null,
  input: absoluteInput,
  bytes: bytes.length,
  requestedProjection: projection,
  effectiveProjection,
  fallbacks,
  graph: {
    nodes: normalized.ir.nodes.length,
    edges: normalized.ir.edges.length,
    tensors: evidence.graph.tensors.length,
  },
  scene: {
    primitives: (scene.primitives || []).length,
    bodyCount: bodies.length,
    connectorCount: (scene.connectors || []).length,
    bodyForms: forms,
  },
  // 架构识别结果：判出"这是一张什么网络"，以及据此选中的布局原型。
  architectureFamily: plan.renderingProfile?.architectureFamily || null,
  // 期刊排版合规：目标栏宽、字号阶梯（pt）、跨度、诊断。
  typography,
  outputs: { svg: args.has("plan-only") ? null : svgPath, visioPlan: planPath },
  diagnostics: {
    count: (plan.diagnostics || []).length,
    warnings: (plan.diagnostics || []).filter((item) => item.severity === "warning").map((item) => item.code || item.message),
  },
};
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
