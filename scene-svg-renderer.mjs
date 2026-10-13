export const SCENE_SVG_RENDERER_VERSION = "scene-svg-renderer/v1";

const ROUTE_STYLES = Object.freeze({
  "main-flow": { color: "#3F5D78", dash: "", width: 1.8 },
  bypass: { color: "#2E8B72", dash: "7 5", width: 1.8 },
  state: { color: "#70459B", dash: "5 4", width: 1.9 },
  conditional: { color: "#B7791F", dash: "3 4", width: 1.8 },
  "cross-scale": { color: "#3E8E5A", dash: "9 4", width: 1.8 },
});

// 颜色表达"这是哪一类计算"，不是"Block 检测器把它归到了哪一桶"。
// VGG16 式的鲜明配色：conv=蓝、pool=红、linear/FFN=绿、attention=紫、residual=青。
// 同族（同属卷积特征图阶段）同色；Block 归属由角标文字承担。
// 旧版用相近粉彩（#DCEAF4/#DDF3EC/#E8DDF5…），近看才能分，VGG16 那种
// "扫一眼就知道哪层是哪层"的对比度出不来。
const BLOCK_STYLES = Object.freeze({
  "conv-block": { fill: "#BCD9F2", stroke: "#1F4E8C" },
  "residual-block": { fill: "#BFE3DA", stroke: "#138D75" },
  "attention-block": { fill: "#DCC7EC", stroke: "#6C3483" },
  "ffn-block": { fill: "#C9E8D2", stroke: "#239B56" },
  "encoder-stage": { fill: "#BCD9F2", stroke: "#1F4E8C" },
  "decoder-stage": { fill: "#DCF0E0", stroke: "#2E8B57" },
  "multi-scale-fusion": { fill: "#F8D8A8", stroke: "#B7791F" },
  "detection-head": { fill: "#FAD0BE", stroke: "#C0392B" },
  "recurrent-cell": { fill: "#DCC7EC", stroke: "#70459B" },
  "moe-block": { fill: "#EAD9B8", stroke: "#8A6A3D" },
  "repeat-block": { fill: "#E5E9EE", stroke: "#687789" },
  "graph-block": { fill: "#C4E6E8", stroke: "#2E7F8C" },
});

const PAGE_MARGIN = 26;
const CORNER_RADIUS = 8;
// 字体栈首必须是 Helvetica/Arial：Nature 明确要求无衬线且优先这两者。
// Segoe UI 只是屏幕字体，落到制版环节会被替换掉。
const FONT = "Helvetica,Arial,Helvetica Neue,Segoe UI,sans-serif";

// ── 模块绘制令牌 ────────────────────────────────────────────────
// 所有图元共用同一套线宽与圆角。旧实现里线宽散落着 0.8/0.9/1.1/1.2/1.3/1.4/1.8
// 七种取值、圆角有 0/4/6/7/8/10/12/16 八种，看起来像不同人拼出来的。
//
// 线宽和字号是同一类问题：它们都是**绝对物理量（pt）**，却写在 layout 单位里。
// 图幅一变小线就跟着变细——实测 U-Net 单栏 89 mm 时掉到 0.49 pt，低于 Cell 要求的
// 0.5 pt 下限；ViT 双栏 183 mm 时涨到 1.75 pt，超过 1.5 pt 上限。**两端都破**。
// 所以线宽必须和字号一样由 unitsPerPt 反推，见 resolvePrintType 的 stroke/hairline。
const STROKE = 1.25;
const STROKE_HAIRLINE = 1;
// 接期刊栏宽时线宽的目标 pt（Cell 0.5–1.5 pt 区间）。
const STROKE_PT = 1;
const HAIRLINE_PT = 0.5;
const CONNECTOR_PT = 1;

// ── 期刊成品尺寸与字号规范 ──────────────────────────────────────
// 顶刊的字号是**成品尺寸下的绝对 pt**（Nature 5–7、Cell 6–8…），
// 而我们内部用的是抽象 layout 单位。两者只能靠"目标栏宽"换算：
//     1 单位 = 目标栏宽(mm) / 图宽(单位)  mm
// 所以字号不能凭空定，必须由目标栏宽反推。不接 targetWidth 时，
// 图就是"任意物理尺寸"的——排版时被期刊缩放多少，字号就跟着变多少，
// 无法保证落在 5–7 pt 区间。这就是"画得出、投不出去"的根因。
const MM_PER_PT = 25.4 / 72;
const JOURNAL_PRESETS = Object.freeze({
  nature: { label: "Nature", columns: { single: 89, double: 183 }, fontPt: [5, 7], maxHeightMm: 240 },
  science: { label: "Science", columns: { single: 84, double: 174 }, fontPt: [6, 7], maxHeightMm: 240 },
  cell: { label: "Cell", columns: { single: 85, "1.5": 114, double: 174 }, fontPt: [6, 8], maxHeightMm: 225 },
  ieee: { label: "IEEE", columns: { single: 88.9, double: 182 }, fontPt: [6, 8], maxHeightMm: 240 },
  acs: { label: "ACS", columns: { single: 82.5, double: 178 }, fontPt: [5, 8], maxHeightMm: 240 },
});
// 未接 targetWidth 时的历史字号阶梯（layout 单位）。保留它是为了不破坏既有产物与测试。
const LEGACY_TYPE = Object.freeze({
  enabled: false,
  title: 17,
  group: 10,
  label: 11,
  badge: 9,
  primitive: 10,
  step: 9,
  legend: 11,
  labelMin: 8,
  chipRadius: 7.5,
  unitsPerPt: 0,
  stroke: STROKE,
  hairline: STROKE_HAIRLINE,
  // null = 沿用 ROUTE_STYLES 各自的宽度（1.8 / 1.9）。接了期刊栏宽后改由 pt 反推。
  connectorWidth: null,
  diagnostics: [],
});

// 供调用方（CLI / 报告页）在出图前先问一句：这张图按目标栏宽能不能合规。
// 返回排版方案与诊断，不产生副作用。
//
// 注意：诊断不是"只算字号阶梯"就算完。三档字号本身一定落在区间内（这是构造出来的），
// 真正会越界的是**盒内自适应**：长名字（GlobalAveragePool_14 / BatchNormalization_8）
// 在锁死的盒宽里只能靠缩字号，缩到期刊下限仍放不下时，图就悄悄不合规了。
// 所以这里必须真正走一遍标签试排，把"跌破下限"的名字捞出来——
// 判定逻辑与 renderSceneSvg 完全共用（fitLabelText），预检结果即成品结果。
export function planFigureTypography(scene = {}, options = {}) {
  const primitives = Array.isArray(scene.primitives) ? scene.primitives : [];
  const page = normalizePage(scene.page, primitives);
  const margin = Number.isFinite(options.margin) ? Math.max(0, options.margin) : PAGE_MARGIN;
  const type = resolvePrintType(options, page.width + margin * 2, page.height + margin * 2);
  const diagnostics = [...type.diagnostics];
  if (type.enabled) diagnostics.push(...belowFloorDiagnostics(primitives, type, options.flat === true));
  return {
    enabled: type.enabled,
    journal: type.journal || null,
    targetMm: type.targetMm ?? null,
    fontPtRange: type.fontPtRange || null,
    ladderPt: type.enabled ? { title: type.titlePt, label: type.labelPt, small: type.smallPt } : null,
    spanPt: type.spanPt ?? null,
    diagnostics,
  };
}

// 逐盒试排标签，找出"缩到下限仍放不下"的名字。合并算子的名字挂在圆外，
// 不受盒宽约束，跳过——否则会给 ⊕ 加一条永远为真的噪声诊断。
function belowFloorDiagnostics(primitives, type, flat) {
  const seen = new Map();
  for (const primitive of primitives) {
    if (primitive.role !== "body" || isMergeGlyph(primitive)) continue;
    const label = bodyLabel(primitive);
    if (!label) continue;
    const face = textFace(primitive, primitive.bounds, flat);
    const fit = fitLabelText(label, face.w, type);
    if (!fit.overflow) continue;
    // 同一名字可能在图上出现多次（重复模块），只报一次，附上最小可达 pt。
    const pt = type.unitsPerPt ? fit.fontSize / type.unitsPerPt : null;
    const previous = seen.get(label);
    if (previous === undefined || (pt !== null && pt < previous)) seen.set(label, pt);
  }
  if (!seen.size) return [];
  const floorPt = type.fontPtRange ? type.fontPtRange[0] : null;
  const names = [...seen.keys()];
  const minPt = Math.min(...[...seen.values()].filter((value) => value !== null));
  return [{
    code: "label-below-font-floor",
    severity: "warning",
    labels: names,
    minPt,
    message: `${names.length} 个盒内标签（${names.slice(0, 3).join(" / ")}${names.length > 3 ? " 等" : ""}）在锁定的盒宽下缩到 ${floorPt} pt 仍放不下（需要 ${minPt.toFixed(2)} pt）。渲染器已把名字外置到盒外以免越界，但这会让图看起来不整齐——应缩短名字（用 GAP / LayerNorm 这类领域缩写）或放大盒宽。`,
  }];
}

// 由目标栏宽反推整套字号：先定"正文字号"落在期刊区间内，
// 再把标题/次级标签压在 ±1 pt 内，保证「同图字号跨度 ≤ 2 pt」。
function resolvePrintType(options, widthUnits, heightUnits) {
  const journalKey = String(options.journal || "").toLowerCase();
  const preset = JOURNAL_PRESETS[journalKey] || null;
  const explicitMm = Number(options.targetWidth);
  if (!preset && !Number.isFinite(explicitMm)) return LEGACY_TYPE;

  const spec = preset || JOURNAL_PRESETS.nature;
  const [loPt, hiPt] = spec.fontPt;
  const candidates = Object.values(spec.columns).sort((left, right) => right - left);
  const aspect = heightUnits / Math.max(1, widthUnits);

  // 选栏：优先最宽且高度不超页面上限的栏位。都超时取最窄的并给出诊断
  // （图太高，期刊放不下——这时应该减列而不是缩字号）。
  let targetMm = Number.isFinite(explicitMm) ? explicitMm : candidates.find((mm) => mm * aspect <= spec.maxHeightMm);
  const diagnostics = [];
  if (!Number.isFinite(targetMm)) {
    targetMm = candidates[candidates.length - 1];
    diagnostics.push({
      code: "figure-too-tall",
      severity: "warning",
      message: `图在 ${targetMm} mm 栏宽下高 ${(targetMm * aspect).toFixed(1)} mm，超过 ${spec.maxHeightMm} mm；应减少列数或缩小图元。`,
    });
  }

  // 目标栏宽 → 每 pt 多少 layout 单位
  const targetPt = targetMm / MM_PER_PT;
  const unitsPerPt = widthUnits / targetPt;
  const toUnits = (pt) => pt * unitsPerPt;

  // 三档字号，全部落在 [lo, hi] 内且跨度 ≤ 2 pt（Genes & Dev 通用规则）。
  const labelPt = Math.max(loPt, hiPt - 1);
  const smallPt = Math.max(loPt, labelPt - 1);
  return {
    enabled: true,
    journal: spec.label,
    targetMm,
    fontPtRange: [loPt, hiPt],
    titlePt: hiPt,
    labelPt,
    smallPt,
    spanPt: hiPt - smallPt,
    unitsPerPt,
    title: toUnits(hiPt),
    group: toUnits(labelPt),
    label: toUnits(labelPt),
    badge: toUnits(smallPt),
    primitive: toUnits(smallPt),
    step: toUnits(smallPt),
    legend: toUnits(smallPt),
    labelMin: toUnits(loPt),
    chipRadius: toUnits(smallPt) * 0.68,
    // 线宽同样锁进物理 pt。取值依据：Cell 要求 0.5–1.5 pt，Nature 下限 0.25 pt。
    // 轮廓取 1.0 pt（区间中段）、发丝线取 0.5 pt（贴着 Cell 下限，仍高于 Nature 下限）、
    // 连接线取 1.0 pt。三档都在 0.5–1.5 pt 内，跨图幅一致。
    stroke: toUnits(STROKE_PT),
    hairline: toUnits(HAIRLINE_PT),
    connectorWidth: toUnits(CONNECTOR_PT),
    diagnostics,
  };
}

// ── 圆角与墨色令牌（线宽见文件顶部）──────────────────────────────
const RADIUS_2D = 8;
const RADIUS_SLAB = 5;
const TEXT_INK = "#1F2937";
const MUTED_INK = "#64748B";
// 三维盒的明暗：在 HSL 里只调亮度、保留色相与饱和度。旧实现直接向黑/白混合，
// #DCEAF4 的侧面会变成 #b4c0c8 这种脏灰，这是"丑"的主要来源。
const FACE_FRONT = -0.1;
const FACE_SIDE = -0.32;

export function renderSceneSvg(scene = {}, options = {}) {
  if (!Array.isArray(scene.primitives) || !Array.isArray(scene.connectors)) {
    throw new TypeError("Scene SVG rendering requires primitives and connectors.");
  }
  const page = normalizePage(scene.page, scene.primitives);
  const scale = Number.isFinite(options.scale) ? Math.max(1, options.scale) : 4;
  const background = options.background || "#FFFFFF";
  // flat：顶刊模式。顶刊架构图全是扁平 2D 矩形，不用等距立方体。
  const flat = options.flat === true;
  const margin = Number.isFinite(options.margin) ? Math.max(0, options.margin) : PAGE_MARGIN;
  const title = cleanText(options.title || "");
  const width = page.width + margin * 2;
  // 栏宽反推必须先于标题高度：字号定了才知道标题占多高。
  const type = resolvePrintType(options, width, page.height + margin * 2);
  const titleHeight = title ? Math.max(34, type.title * 2) : 0;
  const groups = [...(scene.groups || [])].sort((left, right) => area(right.bounds) - area(left.bounds));
  const bodies = scene.primitives.filter((primitive) => primitive.role === "body");
  const decorations = scene.primitives.filter((primitive) => primitive.role !== "body");
  const steps = assignDataFlowSteps(bodies, scene.connectors);
  const legendItems = options.legend === false ? [] : buildLegend(bodies, options.legendLang === "zh" ? "zh" : "en");
  const legendWidth = width - margin * 2;
  const legendRows = legendItems.length ? layoutLegend(legendItems, legendWidth, type) : null;
  const legendHeight = legendRows ? legendRows.height + 20 : 0;
  const height = page.height + titleHeight + margin * 2 + legendHeight;
  // 接了 targetWidth / journal 时，把成品物理尺寸直接写在根节点上，
  // 这样导出 PDF/EPS 后字号就是规范的绝对 pt，而不是"被缩放成多少算多少"。
  const sizeAttr = type.enabled
    ? ` width="${format(type.targetMm)}mm" height="${format(type.targetMm * height / width)}mm"`
    : ` width="${format(width * scale)}" height="${format(height * scale)}"`;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttr} viewBox="0 0 ${format(width)} ${format(height)}" role="img">`,
    "<defs>",
    ...Object.entries(ROUTE_STYLES).map(([routeClass, style]) => (
      `<marker id="arrow-${routeClass}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0.5 1 L 9 5 L 0.5 9 z" fill="${style.color}"/></marker>`
    )),
    `<style>${css(type)}</style>`,
    "</defs>",
    `<rect x="0" y="0" width="${format(width)}" height="${format(height)}" fill="${background}"/>`,
  ];
  if (title) lines.push(`<text class="scene-title" x="${format(width / 2)}" y="${format(margin + 20)}">${escapeXml(title)}</text>`);
  lines.push(`<g transform="translate(${format(margin)} ${format(margin + titleHeight)})">`);
  // 段带画在最底层：它表达的是"这一段整体是什么"，而不是任何一个盒子。
  const bands = computeStageBands(bodies);
  const bandedIds = new Set(bands.flatMap((band) => band.bodies.map((body) => String(body.id))));
  const stageObstacles = bands.length ? collectStageObstacles(bodies, scene.connectors) : null;
  for (const band of bands) lines.push(renderStageBand(band, type, stageObstacles));
  for (const group of groups) lines.push(renderGroup(group, type));
  for (const connector of scene.connectors) lines.push(renderConnector(connector, type));
  const mergeAnnotations = collectMergeAnnotations(bodies, decorations);
  // 盒内标签集合：装饰标注据此去重——盒子里写过的名字不在盒下再写一遍。
  const bodyNames = new Set(bodies.map((body) => bodyLabel(body)).filter(Boolean));
  // 段名 badge 必须**整图统一**：只给一部分盒子画段名，读者会以为那几个盒子有特殊含义
  // （实测 ResNet 第一列只有前 3 个带 ENCODER，看起来像标注漏了）。
  // 所以要么全画、要么全不画；段带已经表达过分段语义时也不必再画。
  const suppressBadges = bands.length > 0
    || !bodies.every((body) => bodyBadgeFits(body, body.bounds, flat, type, steps.get(String(body.id))));
  // 盒下的说明文字（形状标注、外置名字、⊕ 标注）要避开连接线，障碍取自布局结果。
  const obstacles = collectStageObstacles(bodies, scene.connectors);
  for (const primitive of [...bodies, ...decorations].sort((left, right) => (left.zIndex || 0) - (right.zIndex || 0))) {
    if (mergeAnnotations.consumed.has(String(primitive.id))) continue;
    lines.push(renderPrimitive(primitive, steps.get(String(primitive.id)), flat, type, {
      inStageBand: bandedIds.has(String(primitive.id)),
      suppressBadges,
      mergeShape: mergeAnnotations.shapes.get(String(primitive.id)) || "",
      bodyNames,
      obstacles,
      type,
    }));
  }
  lines.push("</g>");
  if (legendRows) lines.push(renderLegend(legendRows, margin, margin + titleHeight + page.height + 14, flat, type));
  lines.push("</svg>");
  return lines.join("\n");
}

// 步骤序号必须沿**数据流**递增，而不是沿**阅读顺序**。
//
// 旧实现按「先 x 后 y」给所有 body 编 1..N，注释里断言这"正好等于数据流的先后"。
// 该断言只对自上而下的列成立。U-Net 的 decoder 是上升臂：列内自下而上是
// Resize_8 → … → Conv_15（输出层），阅读顺序却自上而下，于是角标把输出层编成 9、
// 把首个上采样编成 16——读者按角标读出的执行顺序与箭头完全相反。**这不是装饰问题，
// 是错误信息。**
//
// 现在对 body 图做拓扑排序（Kahn），同层内按阅读顺序打破平局，
// 保证「角标增大 = 沿箭头前进」。环或孤岛按阅读顺序补在末尾，不会漏编号。
function assignDataFlowSteps(bodies, connectors = []) {
  const ids = new Set(bodies.map((body) => String(body.id)));
  const readingOrder = new Map(
    [...bodies]
      .sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y)
      .map((body, index) => [String(body.id), index]),
  );
  const rank = (body) => readingOrder.get(String(body.id)) ?? Number.MAX_SAFE_INTEGER;
  const byId = new Map(bodies.map((body) => [String(body.id), body]));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  const seen = new Set();
  for (const connector of connectors || []) {
    const from = String(connector.sourcePrimitiveId || "");
    const to = String(connector.targetPrimitiveId || "");
    if (from === to || !ids.has(from) || !ids.has(to)) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = bodies.filter((body) => indegree.get(String(body.id)) === 0);
  const ordered = [];
  while (queue.length) {
    queue.sort((left, right) => rank(left) - rank(right));
    const next = queue.shift();
    const id = String(next.id);
    ordered.push(next);
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(byId.get(target));
    }
  }
  if (ordered.length < bodies.length) {
    const placed = new Set(ordered.map((body) => String(body.id)));
    for (const body of [...bodies].sort((left, right) => rank(left) - rank(right))) {
      if (!placed.has(String(body.id))) ordered.push(body);
    }
  }
  return new Map(ordered.map((body, index) => [String(body.id), index + 1]));
}

// ── 段带（stage band）────────────────────────────────────────────
// 顶刊不用"每个盒子挂一个小字标签"来表达"这属于编码器段"——那是逐盒重复，
// U-Net 一张图就要写 16 次 `encoder` / `decoder`。顶刊的做法是一条浅色背景带
// 罩住整段，段标签只出现一次。
//
// 段的划分：同一列内、blockKind 相同的连续盒子算一段。
// 合并算子（没有 blockKind）在分段时天然"透明"——它不在候选列表里，
// 所以不会把一段从中间切开。
//
// 但段标签必须**能区分段**，否则就是把"逐盒噪声"换成了"逐段噪声"：
//   U-Net   → ENCODER / CONV BLOCK / DECODER，各出现一次，读者一眼知道左右两臂是什么。
//   ViT     → 三段全叫 FFN；ResNet → 三段全叫 ENCODER。这时标签不携带任何区分信息，
//             而且 ViT 那张把 Transpose / LayerNorm 也叫成 FFN，是**错误信息**。
// 所以：只要有任何一个标签重复，整张图就退回逐盒 badge，不画段带。
// （根因在上游 blockKind 粒度太粗——ONNX 直通路径把所有注意力/FFN 都归成 ffn-block。
//   修 block IR 才是正解，渲染器这一层只能拒绝画会误导人的东西。）
const STAGE_BAND_PADDING = Object.freeze({ x: 12, top: 18, bottom: 10 });

function computeStageBands(bodies) {
  const byColumn = new Map();
  for (const body of bodies) {
    if (!body.blockKind) continue;
    const key = Math.round(body.bounds.x);
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(body);
  }
  const bands = [];
  for (const members of byColumn.values()) {
    const ordered = [...members].sort((left, right) => left.bounds.y - right.bounds.y);
    let run = [];
    const flush = () => {
      const label = run.length >= 2 ? stageBandLabel(run[0]) : "";
      if (label) bands.push({ blockKind: run[0].blockKind, label, bodies: [...run] });
      run = [];
    };
    for (const body of ordered) {
      if (!run.length || run[0].blockKind === body.blockKind) run.push(body);
      else { flush(); run = [body]; }
    }
    flush();
  }
  const counts = new Map();
  for (const band of bands) counts.set(band.label, (counts.get(band.label) || 0) + 1);
  return [...counts.values()].some((count) => count > 1) ? [] : bands;
}

// 段标签用全大写 + 字距，读作"这一段叫什么"，而不是"这个盒子叫什么"。
function stageBandLabel(body) {
  const badge = cleanText(body.blockBadge || "");
  if (!badge) return "";
  const expanded = { conv: "CONV BLOCK", attention: "ATTENTION", dense: "DENSE" }[badge.toLowerCase()] || badge;
  return expanded.toUpperCase();
}

function renderStageBand(band, type = LEGACY_TYPE, obstacles = { boxes: [], segments: [] }) {
  const xs = band.bodies.map((body) => body.bounds.x);
  const ys = band.bodies.map((body) => body.bounds.y);
  const rights = band.bodies.map((body) => body.bounds.x + body.bounds.w);
  const bottoms = band.bodies.map((body) => body.bounds.y + body.bounds.h);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const bounds = {
    x: left - STAGE_BAND_PADDING.x,
    // 不让段带顶出画布上沿；标题在上方，越界会被裁掉。
    y: Math.max(4, top - STAGE_BAND_PADDING.top),
    w: Math.max(...rights) - left + STAGE_BAND_PADDING.x * 2,
    h: Math.max(...bottoms) - top + STAGE_BAND_PADDING.top + STAGE_BAND_PADDING.bottom,
  };
  // 只用浅填充、不描边：Nature 明确避免多余边框，段带是背景不是容器。
  const rect = `<rect class="stage-band-frame" x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" rx="${n(type.group * 1.2)}"/>`;
  if (!band.label) return `<g class="stage-band">${rect}</g>`;
  const anchor = placeStageBandLabel(band, bounds, type, obstacles);
  const label = `<text class="stage-band-label" x="${n(anchor.x)}" y="${n(anchor.y)}">${escapeXml(band.label)}</text>`;
  return `<g class="stage-band">${rect}${label}</g>`;
}

// 段标签放在哪儿，要看那儿有没有东西。
//
// 实测 U-Net 的 CONV BLOCK：带上方 692 与 703 各有一条水平连接线，带内又正好是
// 第一条连接线的必经之路——"固定放在左上角"必然压线。所以这里给一组候选位置，
// 挑第一个不压盒子、不压线段的；全都不行才退回原位。
// 候选顺序是「带上、带更上方、带内左上、带内左下」，让多张图的段标签观感一致。
function placeStageBandLabel(band, bounds, type, obstacles) {
  const gap = type.group * 1.05;
  // 全大写 + 0.8 字距，宽度系数比正文大。
  const width = band.label.length * (type.group * 0.62 + 0.8);
  const candidates = [
    { x: bounds.x + 10, y: bounds.y - gap },
    { x: bounds.x + 10, y: bounds.y - gap * 2.2 },
    { x: bounds.x + 10, y: bounds.y + type.group * 0.2 },
    { x: bounds.x + 10, y: bounds.y + bounds.h - type.group * 0.35 },
  ];
  const boxAt = (anchor) => ({ x: anchor.x, y: anchor.y - type.group, w: width, h: type.group });
  const clear = (anchor) => {
    const box = boxAt(anchor);
    if (box.y < 2) return false;
    if (obstacles.boxes.some((other) => overlaps(box, other, 3))) return false;
    return !obstacles.segments.some((segment) => segmentHits(box, segment, 3));
  };
  return candidates.find(clear) || candidates[0];
}

function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;
}

// 把轴对齐线段当成一个细长盒来判交——本项目的连接线全是正交折线。
function segmentHits(box, segment, pad) {
  const [a, b] = segment;
  const thin = {
    x: Math.min(a.x, b.x) - pad,
    y: Math.min(a.y, b.y) - pad,
    w: Math.abs(a.x - b.x) + pad * 2,
    h: Math.abs(a.y - b.y) + pad * 2,
  };
  return overlaps(box, thin);
}

// 段标签要避开的障碍：所有盒子，以及所有连接线的每一段。
function collectStageObstacles(bodies, connectors) {
  const segments = [];
  for (const connector of connectors || []) {
    const points = (connector.points || []).filter(validPoint);
    for (let index = 1; index < points.length; index += 1) segments.push([points[index - 1], points[index]]);
  }
  return { boxes: bodies.map((body) => body.bounds), segments };
}

// 图例：PLOS ONE 2025 指南 L 要求图能自足。只列出本图真正用到的图元形态，
// 避免出现"图例里有、图上没有"的噪声。
// 默认英文——顶刊图内文字一律英文，中文图例只留给内部评审稿（options.legendLang === "zh"）。
const LEGEND_ENTRIES_EN = Object.freeze([
  { form: "volume", label: "Feature map (width = channels)" },
  { form: "stack", label: "Matrix operator (MatMul / Linear)" },
  { form: "wedge", label: "Down / upsampling", data: { scaleChange: "reduce" } },
  { form: "strip", label: "Token sequence" },
  { form: "glyph", label: "Element-wise merge (Add / Concat)", semanticTags: ["merge"] },
  { form: "band", label: "Element-wise op (Norm / Activation)" },
  { form: "cell", label: "Recurrent / graph operator" },
  { form: "callout", label: "Unresolved module (needs review)" },
]);

const LEGEND_ENTRIES_ZH = Object.freeze([
  { form: "volume", label: "张量 / 特征图（宽=通道数，高=空间尺寸）" },
  { form: "stack", label: "矩阵算子（MatMul / Linear）" },
  { form: "wedge", label: "下采样 / 上采样", data: { scaleChange: "reduce" } },
  { form: "strip", label: "序列张量" },
  { form: "glyph", label: "逐元素合并（Add / Concat）", semanticTags: ["merge"] },
  { form: "band", label: "逐元素算子（Norm / Activation）" },
  { form: "cell", label: "循环 / 图算子" },
  { form: "callout", label: "未解析模块（需人工确认）" },
]);

function buildLegend(bodies, lang = "en") {
  const present = new Set(bodies.map((primitive) => String(primitive.form || "")));
  const entries = lang === "zh" ? LEGEND_ENTRIES_ZH : LEGEND_ENTRIES_EN;
  return entries.filter((entry) => present.has(entry.form));
}

const LEGEND_SWATCH = { w: 30, h: 18 };
const LEGEND_FONT_SIZE = 11;

function legendFontSize(type) {
  return type.enabled ? type.legend : LEGEND_FONT_SIZE;
}

function legendItemWidth(entry, type) {
  return LEGEND_SWATCH.w + 8 + entry.label.length * legendFontSize(type) * 0.98 + 26;
}

function layoutLegend(items, availableWidth, type) {
  const rows = [];
  let current = [];
  let currentWidth = 0;
  for (const entry of items) {
    const itemWidth = legendItemWidth(entry, type);
    if (current.length && currentWidth + itemWidth > availableWidth) {
      rows.push({ items: current, width: currentWidth });
      current = [];
      currentWidth = 0;
    }
    current.push(entry);
    currentWidth += itemWidth;
  }
  if (current.length) rows.push({ items: current, width: currentWidth });
  return { rows, height: rows.length * (type.enabled ? type.legend * 2.4 : 26) };
}

function renderLegend(layout, originX, originY, flat, type) {
  const parts = [`<g class="scene-legend">`];
  const rowStep = type.enabled ? type.legend * 2.4 : 26;
  layout.rows.forEach((row, rowIndex) => {
    let cursor = originX;
    const y = originY + rowIndex * rowStep;
    for (const entry of row.items) {
      const style = styleForForm(entry.form, type);
      parts.push(renderBodyShape({ form: entry.form, data: entry.data, semanticTags: entry.semanticTags }, { x: cursor, y, w: LEGEND_SWATCH.w, h: LEGEND_SWATCH.h }, style, flat));
      parts.push(`<text class="legend-label" x="${n(cursor + LEGEND_SWATCH.w + 8)}" y="${n(y + LEGEND_SWATCH.h / 2)}" dominant-baseline="central">${escapeXml(entry.label)}</text>`);
      cursor += legendItemWidth(entry, type);
    }
  });
  parts.push("</g>");
  return parts.join("");
}

function styleForForm(form, type = LEGACY_TYPE) {
  return withStroke(baseStyleForForm(form), type);
}

// 线宽是随图幅变化的物理量，所以由 type 注入样式对象。
// 所有形态函数都已经把 style 拿在手里，不必再逐个透传 type。
function withStroke(style, type) {
  return { ...style, width: type.stroke, hairline: type.hairline };
}

function baseStyleForForm(form) {
  // VGG16 配色的 form 默认值：conv 蓝、linear 绿、pool 红、sequence 橄榄、merge 棕、recurrent 紫。
  // 没有 blockKind 的算子按 form 落到这里；具体的 blockKind 会在 styleForPrimitive 里覆盖。
  if (form === "volume" || form === "plane") return { fill: "#BCD9F2", stroke: "#1F4E8C" };
  if (form === "stack") return { fill: "#C9E8D2", stroke: "#239B56" };
  if (form === "wedge") return { fill: "#F8C9B5", stroke: "#C0392B" };
  if (form === "strip") return { fill: "#EFE6C2", stroke: "#8A7A2A" };
  if (form === "glyph") return { fill: "#E8D4A8", stroke: "#8B6A32" };
  if (form === "cell") return { fill: "#DCC7EC", stroke: "#70459B" };
  return { fill: "#E5E9EE", stroke: "#5B6B7C" };
}

function renderGroup(group, type = LEGACY_TYPE) {
  if (!validBounds(group.bounds)) return "";
  const bounds = group.bounds;
  const label = cleanText(group.label || group.id);
  const tagHeight = type.group * 1.5;
  const tag = label
    ? `<rect class="scene-group-tag" x="${n(bounds.x + 10)}" y="${n(bounds.y + 8)}" width="${n(label.length * type.group * 0.58 + 12)}" height="${n(tagHeight)}" rx="${n(tagHeight / 2)}"/>`
      + `<text class="scene-group-label" x="${n(bounds.x + 16)}" y="${n(bounds.y + 8 + tagHeight / 2)}">${escapeXml(label)}</text>`
    : "";
  return [
    `<g class="scene-group">`,
    `<rect class="scene-group-frame" x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" rx="12"/>`,
    tag,
    `</g>`,
  ].filter(Boolean).join("");
}

function renderConnector(connector, type = LEGACY_TYPE) {
  const points = (connector.points || []).filter(validPoint);
  if (points.length < 2) return "";
  const routeClass = String(connector.routeClass || "main-flow");
  const style = ROUTE_STYLES[routeClass] || ROUTE_STYLES["main-flow"];
  const path = roundedPolyline(points, CORNER_RADIUS);
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  // 接了期刊栏宽时用 pt 反推的绝对宽度；否则沿用 ROUTE_STYLES 里的 layout 单位宽度。
  const width = type.connectorWidth ?? style.width;
  return `<path class="scene-connector ${escapeAttribute(routeClass)}" d="${path}" stroke="${style.color}" stroke-width="${n(width)}"${dash} marker-end="url(#arrow-${escapeAttribute(routeClass)})"/>`;
}

function renderPrimitive(primitive, step, flat, type = LEGACY_TYPE, context = {}) {
  if (!validBounds(primitive.bounds)) return "";
  if (primitive.role !== "body") return renderDecoration(primitive, context);
  const bounds = primitive.bounds;
  const style = styleForPrimitive(primitive, type);
  const shape = renderBodyShape(primitive, bounds, style, flat);
  // 合并算子的序号已经并进圆下方的说明行；名字被外置的盒子也不再重复画角标——
  // 外置块自带序号，画两次会出现两个同号圆。
  const chipRect = isMergeGlyph(primitive) ? null : stepChipRect(step, bounds, primitive, type, flat);
  const text = renderBodyText(primitive, bounds, step, flat, type, { ...context, chipRect });
  const chip = text.external || !chipRect
    ? ""
    : stepChipMarkup(step, chipRect.cx, chipRect.cy, chipRect.radius, type.hairline);
  return `<g class="scene-body ${escapeAttribute(primitive.blockKind || primitive.form || "operator")}">${shape}${text.markup}${chip}</g>`;
}

// 合并算子（⊕）的张量标注折进它自己的标签行。
//
// 旧画法把 "Concat" 当成一个独立装饰图元，放在 ⊕ 下方几乎同一个 y 上——
// 实测 U-Net 里标签占 371–383、标注占 378–388，**两行字直接压在一起**。
// 而且标注的第一行就是算子名，和 ⊕ 的标签完全重复（"Concat" 写了两遍）。
// 这里把两者合成一块：算子名一行、张量形状一行，装饰图元本身不再单独渲染。
function collectMergeAnnotations(bodies, decorations) {
  const mergeBodyByOwner = new Map();
  for (const body of bodies) {
    if (!isMergeGlyph(body)) continue;
    const owner = String((body.sourceNodeIds || [])[0] || "");
    if (owner) mergeBodyByOwner.set(owner, String(body.id));
  }
  const shapes = new Map();
  const consumed = new Set();
  for (const decoration of decorations) {
    const owner = String((decoration.sourceNodeIds || [])[0] || "");
    const bodyId = mergeBodyByOwner.get(owner);
    if (!bodyId) continue;
    // 发布名的格式是 `${算子名}\n${形状}`——**一个含换行的字符串**，不是数组。
    // 第一行是算子名（与 ⊕ 的标签重复），后面才是张量形状。
    const lines = (decoration.labels || [])
      .flatMap((value) => String(value ?? "").split("\n"))
      .map(cleanText)
      .filter(Boolean);
    const shape = normalizeShapeText(lines.slice(1).join(" "));
    if (!shape) continue;
    shapes.set(bodyId, shape);
    consumed.add(String(decoration.id));
  }
  return { shapes, consumed };
}

// 张量尺寸的规范写法：用乘号 ×，并且**不加空格**。
// 顶刊两种写法都出现过，但 "384 × 128 × 128" 在窄列里（ResNet 第二列盒宽 67）根本放不下——
// 三处竖线把 65 单位的空隙切完后只剩 61，15 个字符放不进去；紧凑写法只要 11 个字符。
function normalizeShapeText(text) {
  return cleanText(text).replace(/\s*[x×]\s*/gi, "×").trim();
}

// 挂在盒子下方 / 圆下方的说明文字，水平位置必须避开竖向连接线。
//
// 竖向连线的走线位置恰好是盒子的中线，说明文字居中就一定会被线从正中穿过去——
// 实测三张图共 32 处。顶刊的写法是把张量尺寸写在箭头**旁边**，而不是压在箭头上。
//
// 候选位**从"贴线右侧"开始**而不是从居中开始：同一列里所有标注共用同一个左边界，
// 一眼看过去是整齐的一列；若允许"能居中就居中"，同一列会出现 +0 / +25 / +40 三种偏移。
// 贴线位放不下时才依次外扩，最后才退回居中。
const CAPTION_CLEARANCE = 4;
const CAPTION_SHIFTS = [1, 2, 3, -1, -2, 4, -3, 6, -4, 8, -6, 0];

function placeCaptionAxis(rows, bounds, obstacles) {
  const cx = bounds.x + bounds.w / 2;
  if (!obstacles) return cx;
  const widest = Math.max(0, ...rows.map((row) => estimateTextWidth(row.text, row.fontSize)));
  if (!(widest > 0)) return cx;
  const height = Math.max(bounds.h, rows.length * 13);
  const y = bounds.y + bounds.h / 2 - height / 2;
  let best = null;
  for (const step of CAPTION_SHIFTS) {
    const left = step === 0
      ? cx - widest / 2
      : step > 0
        ? cx + step * CAPTION_CLEARANCE
        : cx - widest + step * CAPTION_CLEARANCE;
    const rect = { x: left, y, w: widest, h: height };
    const cost = captionCollisionCost(rect, obstacles);
    if (cost === 0) return left + widest / 2;
    if (!best || cost < best.cost) best = { cost, axis: left + widest / 2 };
  }
  return best ? best.axis : cx;
}

// 障碍 = 所有盒子 + 所有连接线段。线段按有宽度的实体算（1 pt ≈ 1.5 单位），
// 零宽线段会把"线从文字正中穿过"这种最严重的情况判成不交。
function captionCollisionCost(rect, obstacles) {
  let cost = 0;
  for (const box of obstacles.boxes || []) cost += overlapArea(rect, box);
  for (const segment of obstacles.segments || []) cost += segmentOverlapArea(rect, segment, 1);
  return cost;
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function segmentOverlapArea(rect, segment, pad = 0) {
  const [a, b] = segment;
  return overlapArea(rect, {
    x: Math.min(a.x, b.x) - pad,
    y: Math.min(a.y, b.y) - pad,
    w: Math.abs(a.x - b.x) + pad * 2,
    h: Math.abs(a.y - b.y) + pad * 2,
  });
}

// 名字放不进盒子时的退路：挂到盒子正下方，盒内保持干净。
//
// 这条退路是必需的：盒宽由张量形状决定（layout 层锁死），而算子名是外部输入。
// 只要名字够长，就一定会出现"缩到期刊字号下限仍放不下"的组合——这时缩字号已经
// 不合规、溢出盒外又会压住相邻元素。顶刊的做法是把标注挪到盒子外面。
function renderExternalLabel(primitive, bounds, step, badge, label, type, context = {}) {
  const rows = [{ text: label, fontSize: type.label }, ...(badge ? [{ text: badge, fontSize: type.badge }] : [])];
  const cy = bounds.y + bounds.h + type.label * 1.45;
  const strip = { x: bounds.x, y: cy - type.label, w: bounds.w, h: type.label * 2.8 };
  const axis = placeCaptionAxis(rows, strip, context.obstacles);
  const chip = Number.isFinite(step)
    ? stepChipMarkup(step, axis - rows[0].fontSize * label.length * 0.29 - type.chipRadius - 4, cy, type.chipRadius, type.hairline)
    : "";
  const shift = chip ? type.chipRadius + 4 : 0;
  const markup = [`<text class="body-label" x="${n(axis + shift)}" y="${n(cy)}">${escapeXml(label)}</text>`];
  if (badge) markup.push(`<text class="block-badge" x="${n(axis + shift)}" y="${n(cy + type.badge * 1.6)}">${escapeXml(badge)}</text>`);
  return `<g class="body-caption">${chip}${markup.join("")}</g>`;
}

// 标签与角标合成一个居中文本块。旧画法是"名字在中间 + 药丸浮在右上角"，
// 在 111×130 的盒子上同时挂序号圆、药丸、两个端口、名字，噪声压过了信息。
//
// 返回 { markup, external }：external 为真表示名字已被挪到盒外，调用方不应再画角标。
// context.inStageBand 为真时不再画逐盒 badge——段带已经把"这一段是什么"表达过一次了。
// context.mergeShape 是合并算子的张量形状，折进它的标签行。
function renderBodyText(primitive, bounds, step, flat, type = LEGACY_TYPE, context = {}) {
  const { inStageBand = false, suppressBadges = false, mergeShape = "" } = context;
  const label = bodyLabel(primitive);
  const badge = inStageBand || suppressBadges ? "" : badgeText(primitive);
  if (!label && !badge) return { markup: "", external: false };
  // 合并算子的圆心留给 ⊕。名字挂到圆下方，序号排在名字左边——
  // 序号圆没法塞进圆形的左上角（内接方形的角点离圆心只有 r/√2），
  // 硬塞就会压在圆周上。
  if (isMergeGlyph(primitive)) {
    if (!label) return { markup: "", external: false };
    const cy = bounds.y + bounds.h + 13;
    const shapeRows = mergeShape ? [{ text: mergeShape, fontSize: type.label }] : [];
    const axis = placeCaptionAxis([{ text: label, fontSize: type.label }, ...shapeRows], { x: bounds.x, y: cy - type.label, w: bounds.w, h: type.label * 2.8 }, context.obstacles);
    const half = label.length * type.label * 0.29;
    const chip = Number.isFinite(step)
      ? stepChipMarkup(step, axis - half - type.chipRadius - 4, cy, type.chipRadius, type.hairline)
      : "";
    const shift = Number.isFinite(step) ? type.chipRadius + 4 : 0;
    // 张量形状另起一行，字号小一档、颜色压灰——它是补充信息，不是名字。
    const shapeLine = mergeShape
      ? `<text class="body-shape" x="${n(axis + shift)}" y="${n(cy + type.label * 1.3)}">${escapeXml(mergeShape)}</text>`
      : "";
    return {
      markup: `<g class="body-caption">${chip}<text class="body-label" x="${n(axis + shift)}" y="${n(cy)}">${escapeXml(label)}</text>${shapeLine}</g>`,
      external: false,
    };
  }
  const face = textFace(primitive, bounds, flat);
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const rows = [];
  // 长名字（"GlobalAveragePool_14" / "LayerNormalization_8"）不能溢出盒子——
  // 顶刊的做法是盒内自适应：先缩字号，缩到下限还放不下就折成两行。
  // 盒子尺寸由布局层按"顶刊比例带"锁死，所以只能改字号/换行，不能改几何。
  if (label) {
    const fit = fitLabelText(label, face.w, type);
    // 缩到期刊下限仍放不下：既不能再缩（不合规），也不能溢出（压住邻盒）。
    // 外置到盒子下方，盒内只保留 badge。
    if (fit.overflow) {
      return { markup: renderExternalLabel(primitive, bounds, step, badge, label, type, context), external: true };
    }
    // .body-label / .block-badge 都用 dominant-baseline:middle —— y 是文字的**垂直中心**，
    // 不是基线。块的上/下缘必须按 ±0.5em 算。之前按基线算，下缘少算了 0.35em，
    // 实测 ResNet 的 "CONV" 因此探出盒底 2.8 单位，正好被连接线的箭头啃掉。
    const lineGap = fit.fontSize * 1.18;
    const badgeHeight = type.badge * 1.15;
    // 相对 startY 的下缘：末行中心 + 0.5em，或 badge 中心 + 0.5em。
    const bottomFor = (withBadge) => (withBadge
      ? fit.lines.length * lineGap + badgeHeight
      : fit.lines.length * lineGap - 0.68 * fit.fontSize);
    // 文字块的可用纵向区间：上要躲开左上角的序号圆，下不能贴到盒沿
    // （竖向连线的箭头落在盒底中线上，贴底会被箭头啃掉）。
    const minStart = (context.chipRect ? context.chipRect.y + context.chipRect.h + 1.5 : face.y + 1.5) + fit.fontSize * 0.5;
    const maxBottom = face.y + face.h - 1.5;
    const hasBadge = Boolean(badge) && !context.suppressBadges && badgeFitsInBlock(fit, face, context.chipRect, type);
    const bottomOffset = bottomFor(hasBadge);
    const blockHeight = fit.fontSize * 0.5 + bottomOffset;
    const blockWidth = Math.max(
      ...fit.lines.map((line) => estimateTextWidth(line, fit.fontSize)),
      hasBadge ? estimateTextWidth(badge, type.badge) : 0,
    );
    let startY = cy - blockHeight / 2 + fit.fontSize * 0.5;
    const maxStart = maxBottom - bottomOffset;
    // 区间为空（盒子比文字块还矮）时保持居中：怎么放都越界，居中至少不偏。
    if (minStart <= maxStart) startY = Math.min(Math.max(startY, minStart), maxStart);
    fit.lines.forEach((line, lineIndex) => {
      rows.push(`<text class="body-label"${fontSizeAttr(fit.fontSize, type.label)} x="${n(cx)}" y="${n(startY + lineIndex * lineGap)}">${escapeXml(line)}</text>`);
    });
    if (hasBadge) {
      rows.push(`<text class="block-badge" x="${n(cx)}" y="${n(startY + fit.lines.length * lineGap + type.badge * 0.65)}">${escapeXml(badge)}</text>`);
    }
  } else if (badge) {
    rows.push(`<text class="block-badge" x="${n(cx)}" y="${n(cy)}">${escapeXml(badge)}</text>`);
  }
  return { markup: `<g class="body-text">${rows.join("")}</g>`, external: false };
}

// Helvetica 平均字宽 ≈ 0.58×字号（取保守值，给真实排版留余量，避免名字压到盒边）；
// 用这个把"名字能否塞进盒子"估成确定性问题，而不是等 SVG 真正排版时才发现溢出去。
const LABEL_CHAR_RATIO = 0.58;
const LABEL_PAD = 7;

function estimateTextWidth(text, fontSize) {
  return String(text).length * fontSize * LABEL_CHAR_RATIO;
}

function fontSizeAttr(fontSize, base = 11) {
  return Math.abs(fontSize - base) < 0.05 ? "" : ` style="font-size:${format(fontSize)}px"`;
}

// 盒子能否在期刊字号下同时装下"名字 + 段名 + 序号圆"。
// 抽成独立函数是因为这个判定要被用两次：一次在出图前决定"整图要不要画段名"，
// 一次在逐盒排版时决定这一盒画不画。两处共用同一份几何，不会各自漂移。
function badgeFitsInBlock(fit, face, chipRect, type) {
  const minStart = (chipRect ? chipRect.y + chipRect.h + 1.5 : face.y + 1.5) + fit.fontSize * 0.5;
  return minStart + fit.lines.length * fit.fontSize * 1.18 + type.badge * 1.15 <= face.y + face.h - 1.5;
}

function bodyBadgeFits(primitive, bounds, flat, type, step) {
  if (isMergeGlyph(primitive)) return false;
  const label = bodyLabel(primitive);
  if (!label) return true;
  const face = textFace(primitive, bounds, flat);
  const fit = fitLabelText(label, face.w, type);
  if (fit.overflow) return false;
  return badgeFitsInBlock(fit, face, stepChipRect(step, bounds, primitive, type, flat), type);
}

function fitLabelText(label, faceWidth, type = LEGACY_TYPE) {
  const text = cleanText(label);
  const base = type.label;
  const minFont = type.labelMin;
  if (!text) return { fontSize: base, lines: [], overflow: false };
  const maxWidth = Math.max(8, faceWidth - LABEL_PAD * 2);
  const tooWide = (lines, fontSize) => lines.some((line) => estimateTextWidth(line, fontSize) > maxWidth);
  // 下限判定必须看"最终字号"，而不是"最终是否放得下"。
  // 循环是「先判断再减 0.5」，最后一次递减会越过下限——比如 7.7 → 7.2，
  // 而 7.2 恰好放得下。这时文本没溢出，但字号已经跌到期刊下限以下，
  // 图照样不合规。只检查"放不下"会把这种情况全部漏掉（实测 resnet 4.69 pt / vit 4.55 pt）。
  const belowFloor = (fontSize, lines) => fontSize < minFont - 1e-9 || tooWide(lines, fontSize);
  if (estimateTextWidth(text, base) <= maxWidth) return { fontSize: base, lines: [text], overflow: false };
  // 单行缩小字号直到能放下或触底。
  let font = base;
  while (font > minFont && estimateTextWidth(text, font) > maxWidth) font -= 0.5;
  if (estimateTextWidth(text, font) <= maxWidth) return { fontSize: font, lines: [text], overflow: belowFloor(font, [text]) };
  // 折两行：优先断在 camelCase / 字母-数字边界，避免出现 LayerNorm / alization
  // 这种按字符中点断开的词。
  const lines = splitLabelLines(text);
  font = base * 0.86;
  while (font > minFont && tooWide(lines, font)) font -= 0.5;
  return { fontSize: font, lines, overflow: belowFloor(font, lines) };
}

// 在 camelCase 与"字母→数字"的边界里，挑离中点最近的一处断开。
// 找不到合适边界（全小写、无数字）时才退回按字符中点断。
function splitLabelLines(text) {
  const mid = text.length / 2;
  let best = -1;
  for (let index = 1; index < text.length; index += 1) {
    const isBoundary = /[a-z0-9]/.test(text[index - 1]) && /[A-Z0-9]/.test(text[index]);
    if (!isBoundary) continue;
    if (best === -1 || Math.abs(index - mid) < Math.abs(best - mid)) best = index;
  }
  const at = best === -1 ? Math.ceil(mid) : best;
  return [text.slice(0, at), text.slice(at)];
}

// 步骤序号：PLOS ONE 2025 指南 G（便于导航）。折行之后读者需要一条明确的
// 阅读路径，靠箭头自己找容易跟丢。
// 序号本身必须是深色：Nature 明令禁止彩色文字，旧实现用 style.stroke 上色，
// 绿块的序号就是绿的。
// 位置：盒子的「真实左上角」，而不是文字面的左上角——
// 文字面是三维盒的正面，盒子被压扁之后它和文字挤在一起，把"Conv_0"的头几个字盖住。
// 放在顶面的左上角既不和文字撞，也跟顶刊常见的"角标"排版一致。
const CHIP_RADIUS = 7.5;

function stepChipMarkup(step, cx, cy, radius = CHIP_RADIUS, hairline = STROKE_HAIRLINE) {
  return [
    `<circle class="step-chip" cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="#FFFFFF" stroke="${MUTED_INK}" stroke-width="${n(hairline)}"/>`,
    `<text class="step-chip-label" x="${n(cx)}" y="${n(cy)}">${step}</text>`,
  ].join("");
}

// 角标的实际占位。既用于绘制，也用于"盒内文字必须避开角标"的排版约束——
// 两处共用同一份几何，避免"角标挪了位置、避让还按旧位置算"。
function stepChipRect(step, bounds, primitive, type = LEGACY_TYPE, flat = false) {
  if (!Number.isFinite(step)) return null;
  const radius = Math.max(6, Math.min(type.chipRadius, Math.min(bounds.w, bounds.h) * 0.14));
  // 顶刊的"角标"读法：落在盒子最外侧的左上角。三维盒就是顶面，叠板就是最后面那块板的角。
  // 用 bounds 的左上角而不是 labelFaceOrigin，这样压扁之后不会再盖到名字。
  const pad = radius * 0.5;
  const cy = bounds.y + radius + pad;
  let cx = bounds.x + radius + pad;
  // 梯形的左上角是**斜的**（三维棱柱还多一层顶面斜边）：角标必须贴着实测的左边界放，
  // 否则会有一半悬在形状外面。
  if (primitive.form === "wedge") cx = wedgeLeftAt(primitive, bounds, flat, cy) + radius + pad;
  return { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2, cx, cy, radius };
}

// 梯形（含三维棱柱）在高度 y 处的左边界。角标据此定位。
function wedgeLeftAt(primitive, bounds, flat, y) {
  const inset = wedgeInset(bounds);
  const expand = String(primitive.data?.scaleChange || "") === "expand";
  const depth = flat ? 0 : cuboidDepth(bounds);
  const frontTop = bounds.y + depth;
  const frontLeft = bounds.x + (expand ? inset : 0);
  if (y < frontTop && depth > 0) {
    // 顶面区：左边界从后顶点 (frontLeft + depth) 斜到正面左上顶点 (frontLeft)。
    const t = (y - bounds.y) / depth;
    return frontLeft + depth * (1 - t);
  }
  // 正面区：expand 越往下越宽，reduce 越往下越窄。
  const t = Math.min(1, Math.max(0, (y - frontTop) / Math.max(1, bounds.h - depth)));
  return bounds.x + (expand ? inset * (1 - t) : inset * t);
}

function renderDecoration(primitive, context = {}) {
  const type = context.type || LEGACY_TYPE;
  const bodyNames = context.bodyNames instanceof Set ? context.bodyNames : new Set();
  const rows = decorationRows(primitive.labels, bodyNames).map((row) => ({
    ...row,
    fontSize: row.shape ? type.badge : type.primitive,
  }));
  if (!rows.length) return "";
  const bounds = primitive.bounds;
  const lineHeight = 13;
  const axisX = placeCaptionAxis(rows, bounds, context.obstacles);
  const centerY = bounds.y + bounds.h / 2 - ((rows.length - 1) * lineHeight) / 2;
  const text = rows.map((row, index) => {
    const className = row.shape ? "primitive-shape" : "primitive-label";
    return `<text class="${className}" x="${n(axisX)}" y="${n(centerY + index * lineHeight + 4)}">${escapeXml(row.text)}</text>`;
  }).join("");
  return `<g class="scene-decoration">${text}</g>`;
}

// 装饰标注的原始形态是「算子名 \n 输出张量形状」（见 neural-visual-rules 的 publicationLabel）。
// 但 cleanText 会把换行压成空格，于是图上出现 "Conv 64 x 112 x 112" 这种一长串——
// 名字在盒子里已经写过一遍，形状又是读者真正要找的信息，两件事挤在一行里谁也不突出。
//
// 这里拆成「名字行 + 形状行」，并做三件事：
//   1) 名字走同一套领域缩写（Conv / BatchNorm / GAP），与盒内标签一致；
//   2) 盒内已经写过这个名字时，标注只留形状——不重复同一信息两遍；
//   3) 维度分隔符用乘号 ×，ASCII 的 x 只留作输入的容错写法。
function decorationRows(labels, bodyNames) {
  const rows = [];
  for (const value of labels || []) {
    const parts = String(value ?? "").split("\n").map(cleanText).filter(Boolean);
    if (!parts.length) continue;
    const [head, ...rest] = parts;
    if (!rest.length) {
      if (isShapeOnly(head)) rows.push({ text: normalizeShapeText(head), shape: true });
      else {
        const name = abbreviateOperatorName(head);
        if (!bodyNames.has(name)) rows.push({ text: name, shape: false });
      }
      continue;
    }
    const name = abbreviateOperatorName(head);
    if (!bodyNames.has(name)) rows.push({ text: name, shape: false });
    const shape = normalizeShapeText(rest.join(" "));
    if (shape) rows.push({ text: shape, shape: true });
  }
  return rows;
}

// "64 x 112 x 112" / "196 × 768" 这类纯尺寸串：没有任何字母（* 是 assumed-default 标记，保留）。
function isShapeOnly(text) {
  return /^[\d\s×xX*]+$/.test(text) && /\d/.test(text);
}

function renderBodyShape(primitive, bounds, style, flat) {
  const form = primitive.form;
  // 顶刊模式：压成扁平 2D（带各自的内部图标）。但默认走 3D 模式——
  // VGG16 的"特征图平面堆 / 图像板 / FC 扁条"本身就是 3D 等距投影，
  // 强行压扁反而把顶刊的视觉语言抹平了。
  if (flat && form === "volume") return renderFlatVolume(bounds, style);
  if (flat && form === "plane") return renderFlatPlane(bounds, style);
  if (flat && form === "stack") return renderFlatStack(bounds, style);
  if (flat && form === "wedge") return renderFlatWedge(primitive, bounds, style);
  // 薄片数由通道数决定：64 通道摞 3 片、512 通道摞 6 片。
  // 这是 VGG 这类"塔状"网络最要紧的一条视觉语言——否则 64 通道和 512 通道
  // 画出来一模一样，读者根本看不出"越往后越厚"。
  if (form === "volume") return renderFeatureMapStack(bounds, style, featureMapDepthOf(primitive));
  if (form === "plane") return renderImageSlab(bounds, style);
  if (form === "stack") return renderFlatBar(bounds, style);
  if (form === "wedge") return renderWedge(primitive, bounds, style);
  if (form === "strip") return renderStrip(bounds, style);
  if (form === "glyph") return renderGlyph(primitive, bounds, style);
  if (form === "cell") return renderCell(bounds, style);
  if (form === "callout") return renderCallout(bounds, style);
  return renderBand(bounds, style);
}

// 扁平 2D 矩形：顶刊架构图里"模块"的通用形态。统一圆角、统一线宽，
// 颜色由 blockKind 承担语义，文字由 renderBodyText 标注张量形状/算子名。
function renderFlatBox(bounds, style, radius = RADIUS_2D, className = "flat-body") {
  const { x, y, w, h } = bounds;
  return `<rect class="${className}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
}

// 扁平特征图 / 卷积：顶刊里就是一个干净的圆角矩形。
//
// 旧实现在盒子里又套了一个矩形框 + 2~4 条网格线。那个网格的列数是按**盒尺寸**算的
// （`gw >= 46 && gh >= 26 ? 3 : 2`），跟卷积核大小、通道数、空间尺寸全都无关——
// 它不编码任何信息，只是把读者的注意力从标签上引开。更糟的是它**暗示**了一个
// 并不存在的含义：读者会以为格数代表核尺寸或特征图分辨率。
//
// Nature / Cell 的架构图里，模块内部一律没有横线竖线：算子类型由「形状 + 标签 + 填充」
// 承担。而盒子的宽高本身已经编码了张量形状（布局层按 tensorShape 定尺寸），
// 不需要在盒子里再画一遍。
// 扁平特征图：就是一个圆角矩形。
//
// 这里**刻意**不画"一摞纸"的竖线。曾经想过用它表达通道数，但那和项目早期
// 用「盒内 3×3 网格」区分卷积是同一个错误：网格列数按盒尺寸算，跟核大小无关；
// 竖线数按 log2(通道数) 压缩，512 通道也只画 5 条——都是**虚构的刻度**，
// 会让读者以为数线就能数出通道数。Nature / Cell 的架构图模块内部一律干净，
// 算子类型由「形状 + 标签 + 填充」承担，通道数写在标签里（512×28×28）。
// 要表达"这是摞起来的特征图"，走 3D 模式的体量——那是真实的几何，不是装饰。
function renderFlatVolume(bounds, style) {
  return renderFlatBox(bounds, style);
}

// 扁平下采样 / 上采样：**梯形**。
//
// 这是顶刊（以及所有教材）里"尺度变化"的标准符号——收窄 = 池化/下采样，
// 放宽 = 上采样/转置卷积。语义由**形状**承载，一眼可读，不需要在盒子里
// 画两层网格 + 映射线（旧实现在一个 86×33 的盒子里塞了 12 个几何元素，
// 而标签还压在最上面，实际什么都看不清）。
function renderFlatWedge(primitive, bounds, style) {
  const { x, y, w, h } = bounds;
  const expand = String(primitive.data?.scaleChange || "") === "expand";
  const inset = wedgeInset(bounds);
  const points = expand
    ? `${n(x + inset)},${n(y)} ${n(x + w - inset)},${n(y)} ${n(x + w)},${n(y + h)} ${n(x)},${n(y + h)}`
    : `${n(x)},${n(y)} ${n(x + w)},${n(y)} ${n(x + w - inset)},${n(y + h)} ${n(x + inset)},${n(y + h)}`;
  return `<polygon class="wedge-body" points="${points}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}" stroke-linejoin="round"/>`;
}

// 梯形的腰内收量。上限取短边的 1/3，否则窄盒会退化成三角形，文字无处安放。
function wedgeInset(bounds) {
  return Math.max(4, Math.min(bounds.w * 0.16, bounds.h * 0.34));
}

// 扁平输入 / 图像：盒子 + 通用"图片"符号（方框 + 太阳 + 山）。
// 与卷积的"满格特征图"区分开——输入是单张图，不是一层特征，所以画占位符而不是网格。
function renderFlatPlane(bounds, style) {
  const { x, y, w, h } = bounds;
  const parts = [renderFlatBox(bounds, style)];
  const pad = Math.max(3, Math.min(w, h) * 0.16);
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  const side = Math.min(iw, ih);
  const cx = x + (w - side) / 2;
  const cy = y + (h - side) / 2;
  const opacity = 0.46;
  const stroke = style.stroke;
  parts.push(`<rect x="${n(cx)}" y="${n(cy)}" width="${n(side)}" height="${n(side)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`);
  // 太阳：左上角小圆
  const sunR = side * 0.15;
  parts.push(`<circle cx="${n(cx + side * 0.28)}" cy="${n(cy + side * 0.28)}" r="${n(sunR)}" fill="none" stroke="${stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`);
  // 山：底部折线
  const mountain = [
    `${n(cx + side * 0.16)},${n(cy + side * 0.82)}`,
    `${n(cx + side * 0.46)},${n(cy + side * 0.44)}`,
    `${n(cx + side * 0.64)},${n(cy + side * 0.62)}`,
    `${n(cx + side * 0.84)},${n(cy + side * 0.82)}`,
  ].join(" ");
  parts.push(`<polyline points="${mountain}" fill="none" stroke="${stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`);
  return parts.join("");
}

// 扁平矩阵 / FFN / 叠层线性：顶刊里就是一个圆角略小的盒子。
//
// 旧实现画了几条平行"叠层条"，条数同样是按**盒高**算的（`h >= 40 ? 4 : 3`），
// 与"这是第几层变换"无关——又一处不编码信息的装饰。层级由数据流方向表达，
// 不需要在盒子里画线。圆角取 RADIUS_SLAB（比通用模块更小），
// 让"矩阵/线性"在形状上仍与卷积盒有细微差别。
function renderFlatStack(bounds, style) {
  return renderFlatBox(bounds, style, RADIUS_SLAB, "matrix-body");
}

// 三维盒的进深按自身尺寸取，但必须服从"盒子已经变扁"这个新事实：
// 盒子高 32 时若还挤 24 单位的进深，正面只剩 8 单位，文字没地方放。
// 取 0.18×短边并夹在 4–14，进深稳定占盒高的 1/5 左右。
function cuboidDepth(bounds) {
  return Math.max(4, Math.min(14, Math.min(bounds.w, bounds.h) * 0.18));
}

// 特征图平面堆：VGG16 式的"一张特征图 = 一张等距平面"堆叠。
// 旧版用单个长方体表示 conv，结果跟 FFN/FC 几乎没区别——
// 用户说"你只是不同颜色的方块"指的就是这个。
// 现在 N 张平面在等距投影下向右上方错开：平面高度编码空间尺寸，
// 可见平面数（恒为 3）暗示通道数；正面那张承载文字。
// 张量的通道数。NCHW 取第 2 维，NHWC / 序列（[N, T, D]）取最后一维。
// 拿不到就返回 null，调用方退回默认深度——宁可画得保守，也不能编一个数。
function tensorChannels(primitive) {
  const shape = primitive?.data?.tensorShape;
  if (!Array.isArray(shape) || shape.length < 2) return null;
  const raw = shape.length === 4 ? shape[1] : shape[shape.length - 1];
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

// 薄片数：顶刊 VGG 图的标志性语言是"一摞薄片，通道越多摞得越厚"。
// 但不可能真画 512 片——按 log2 压缩到 3..8 片，既能一眼看出"越往后越厚"，
// 又不会把平面挤成一条线。64→3、128→4、256→5、512→6、1024→7。
const STACK_DEPTH_MIN = 3;
const STACK_DEPTH_MAX = 8;

function featureMapDepth(channels) {
  if (!Number.isFinite(channels) || channels <= 4) return STACK_DEPTH_MIN;
  const depth = Math.round(Math.log2(channels)) - 3;
  return Math.max(STACK_DEPTH_MIN, Math.min(STACK_DEPTH_MAX, depth));
}

// 图元 → 薄片数。渲染形状与计算文字面必须走这一个入口，否则两处会漂移。
function featureMapDepthOf(primitive) {
  return featureMapDepth(tensorChannels(primitive));
}

// 最前面那片平面（也就是文字面）不能小于这个高度，否则摞起来只剩一条缝，
// 盒子里一个字都放不下。22 单位约等于一行 6 pt 字 + 上下留白。
const STACK_PLANE_FLOOR = 22;

function featureMapStackGeometry(bounds, depth = STACK_DEPTH_MIN) {
  const { x, y, w, h } = bounds;
  const N = Math.max(1, Math.round(depth));
  const steps = Math.max(1, N - 1);
  // 偏移量同时满足两条：常规尺寸下"看得出是摞的"（1.6..5），
  // 且最前面那片平面不能矮到放不下字。矮盒子自动减小步长，
  // 步长已经到下限还不够时，宁可让平面矮一点也不要退成"一片"（那就不像 VGG 了）。
  const floorH = Math.min(STACK_PLANE_FLOOR, h * 0.62);
  const dy = Math.max(1.6, Math.min(5, (h - floorH) / steps));
  const dx = Math.max(1.6, Math.min(5, (w * 0.34) / steps));
  const planeW = w - steps * dx;
  const planeH = h - steps * dy;
  return { N, dx, dy, planeW, planeH };
}

function renderFeatureMapStack(bounds, style, depth = STACK_DEPTH_MIN) {
  const { N, dx, dy, planeW, planeH } = featureMapStackGeometry(bounds, depth);
  const { x, y } = bounds;
  const parts = [];
  // 从后往前画：最远的先画，最前面的盖在上面。
  for (let i = N - 1; i >= 0; i -= 1) {
    const px = x + i * dx;
    const py = y + (N - 1 - i) * dy;
    if (i < N - 1) {
      const backPx = x + (i + 1) * dx;
      const backPy = y + (N - 1 - (i + 1)) * dy;
      // 右侧面：从前一张的右边到后一张的右边
      parts.push(`<polygon points="${n(px + planeW)},${n(py)} ${n(backPx + planeW)},${n(backPy)} ${n(backPx + planeW)},${n(backPy + planeH)} ${n(px + planeW)},${n(py + planeH)}" fill="${tint(style.fill, FACE_SIDE)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`);
      // 顶面：从前一张的顶边到后一张的顶边
      parts.push(`<polygon points="${n(px)},${n(py)} ${n(px + planeW)},${n(py)} ${n(backPx + planeW)},${n(backPy)} ${n(backPx)},${n(backPy)}" fill="${tint(style.fill, FACE_SIDE - 0.06)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`);
    }
    const tintAmt = FACE_FRONT - 0.04 * (N - 1 - i);
    // 最前面那张平面就是文字面（见 textFace），给它一个类名，几何核验器才认得出
    // "这个盒子的文字应该落在哪"——后面几张被它挡住，标了反而会造成误判。
    const className = i === 0 ? ' class="body-rect"' : "";
    // data-plane 让"这一摞到底几片"成为可断言的事实，而不是靠数矩形个数去猜
    // （图里还有段带、组框等别的矩形）。核验器的类名正则只认紧跟在 class 后面的
    // 属性，多一个 data-* 不影响它认 body-rect。
    parts.push(`<rect${className} data-plane="${i}" x="${n(px)}" y="${n(py)}" width="${n(planeW)}" height="${n(planeH)}" fill="${tint(style.fill, tintAmt)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`);
  }
  return parts.join("");
}

// 平面（图像输入）：3D 图像板。VGG16 图里输入是一张真实照片，
// 这里没法画照片，但通用"图片"符号（方框 + 太阳 + 山）足以
// 让读者一眼认出"这是输入图像"而不是又一块 conv 特征图。
function renderImageSlab(bounds, style) {
  const { x, y, w, h } = bounds;
  const depth = Math.max(5, Math.min(10, Math.min(w, h) * 0.18));
  const fx = x;
  const fy = y + depth;
  const fw = w - depth;
  const fh = h - depth;
  const top = `${n(fx)},${n(fy)} ${n(fx + depth)},${n(y)} ${n(fx + fw + depth)},${n(y)} ${n(fx + fw)},${n(fy)}`;
  const side = `${n(fx + fw)},${n(fy)} ${n(fx + fw + depth)},${n(y)} ${n(fx + fw + depth)},${n(y + fh)} ${n(fx + fw)},${n(fy + fh)}`;
  // 通用图片符号：方框 + 太阳 + 山，国际通用的"这是一张图"标识。
  const iconSide = Math.min(fw, fh) * 0.6;
  const iconCx = fx + fw / 2;
  const iconCy = fy + fh / 2;
  const opacity = 0.55;
  const frame = `<rect x="${n(iconCx - iconSide / 2)}" y="${n(iconCy - iconSide / 2)}" width="${n(iconSide)}" height="${n(iconSide)}" rx="2" fill="none" stroke="${style.stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`;
  const sunR = iconSide * 0.13;
  const sun = `<circle cx="${n(iconCx - iconSide * 0.22)}" cy="${n(iconCy - iconSide * 0.22)}" r="${n(sunR)}" fill="none" stroke="${style.stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`;
  const mountain = `<polyline points="${n(iconCx - iconSide * 0.35)},${n(iconCy + iconSide * 0.28)} ${n(iconCx - iconSide * 0.08)},${n(iconCy - iconSide * 0.12)} ${n(iconCx + iconSide * 0.12)},${n(iconCy + iconSide * 0.12)} ${n(iconCx + iconSide * 0.35)},${n(iconCy + iconSide * 0.28)}" fill="none" stroke="${style.stroke}" stroke-width="${n(style.hairline)}" opacity="${opacity}"/>`;
  return [
    `<polygon class="face-top" points="${top}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`,
    `<polygon class="face-side" points="${side}" fill="${tint(style.fill, FACE_SIDE)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`,
    `<rect class="face-front" x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`,
    frame,
    sun,
    mountain,
  ].join("");
}

// 矩阵 / FFN / 线性层：VGG16 式细长扁条（1D 表示）。
// 旧版是错开的 3 块板——视觉上跟 conv 立方体几乎没区别，都是"方块"。
// VGG16 把 FC 画成一根细长扁条（蓝条），宽度编码特征维度，高度极小。
// 现在这就是一根扁条。
function renderFlatBar(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="bar-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_SLAB}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
}

// 下采样 / 上采样：内嵌 mini 两层网格 + 映射线。
// 旧版用梯形表示"尺度变化"，但梯形是抽象符号，读者看不出"这里在把特征图放大"。
// 转置卷积 / 插值上采样的核心机制是"每个输入单元映射到输出的一块区域"——
// 三维下采样 / 上采样：**梯形棱柱**。
//
// 这是 VGG16 那张经典图里池化层的画法，也是所有 3D 架构图的标准符号——
// 收窄 = 池化 / 下采样，放宽 = 上采样 / 转置卷积。语义由**形状**承载，一眼可读。
//
// 旧实现在一个 86×33 的盒子里塞了两层 mini 网格 + 三条映射线（12 个几何元素），
// 而标签还压在最上面，实际什么都看不清；更关键的是那两层网格的格数（2×2 / 4×4）
// 是写死的，与真实特征图分辨率无关——又是一处不编码信息的装饰。
function renderWedge(primitive, bounds, style) {
  const { x, y, w, h } = bounds;
  const expand = String(primitive.data?.scaleChange || "") === "expand";
  const inset = wedgeInset(bounds);
  const depth = cuboidDepth(bounds);
  // 正面整体下移一个进深，把顶部让给顶面（与图像板同一套等距约定）。
  const fy = y + depth;
  const fw = w - depth;
  const fh = h - depth;
  const front = expand
    ? [[x + inset, fy], [x + fw - inset, fy], [x + fw, fy + fh], [x, fy + fh]]
    : [[x, fy], [x + fw, fy], [x + fw - inset, fy + fh], [x + inset, fy + fh]];
  const [F0, F1, F2] = front;
  const up = (point) => [point[0] + depth, point[1] - depth];
  const [B0, B1] = [up(F0), up(F1)];
  const [C1, C2] = [up(F1), up(F2)];
  const quad = (points, fill, className) => {
    const attr = className ? ` class="${className}"` : "";
    const path = points.map((point) => `${n(point[0])},${n(point[1])}`).join(" ");
    return `<polygon${attr} points="${path}" fill="${fill}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
  };
  // 从后往前画：右侧面 → 顶面 → 正面。
  return [
    quad([F1, C1, C2, F2], tint(style.fill, FACE_SIDE)),
    quad([F0, F1, B1, B0], tint(style.fill, FACE_SIDE - 0.06)),
    quad(front, tint(style.fill, FACE_FRONT), "face-front"),
  ].join("");
}

// 序列张量：顶刊里就是一个圆角矩形。
//
// 旧实现按宽度画 `round(w/16)` 条分段竖线，段数与真实 token 数无关——
// 又一个不编码信息的装饰（"一串 token"由形状比例与标签表达，不需要画刻度）。
function renderStrip(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="strip-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_SLAB}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
}

// 逐元素算子（Norm / Activation）：干净的圆角条。
function renderBand(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="band-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_2D}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
}

// 合并算子：圆 + ⊕。圆形是 ResNet 之后的事实标准，一眼可读；
// 旧实现是"圆角矩形里放一个加号"，跟普通算子框几乎分不开。
// 名字不放在圆心——会和加号叠在一起，由 renderBodyText 放到圆下方。
function isMergeGlyph(primitive) {
  return primitive.form === "glyph" && (primitive.semanticTags || []).includes("merge");
}

function renderGlyph(primitive, bounds, style) {
  const { x, y, w, h } = bounds;
  if (!isMergeGlyph(primitive)) return renderBand(bounds, style);
  const radius = Math.min(w, h) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const arm = radius * 0.5;
  return [
    `<circle class="glyph-body" cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`,
    `<line class="glyph-arm" x1="${n(cx - arm)}" y1="${n(cy)}" x2="${n(cx + arm)}" y2="${n(cy)}" stroke="${style.stroke}" stroke-width="${n(style.width)}" stroke-linecap="round"/>`,
    `<line class="glyph-arm" x1="${n(cx)}" y1="${n(cy - arm)}" x2="${n(cx)}" y2="${n(cy + arm)}" stroke="${style.stroke}" stroke-width="${n(style.width)}" stroke-linecap="round"/>`,
  ].join("");
}

// 循环 / 图算子：胶囊形，与普通算子的 8 圆角拉开区分。
function renderCell(bounds, style) {
  const { x, y, w, h } = bounds;
  const radius = Math.max(RADIUS_2D, Math.min(18, h * 0.42));
  return `<rect class="cell-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${n(style.width)}"/>`;
}

// 未解析模块：虚线是"待确认"的既有约定，保留。
function renderCallout(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="callout-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_2D}" fill="#FFFFFF" stroke="${style.stroke}" stroke-width="${n(style.width)}" stroke-dasharray="5 4"/>`;
}

// 端口圆点已移除：连接线本来就落在盒子边缘，再点一排小圆点只是噪声
// （resnet18-lite 一张图上有 29 个），而且三维盒的输出锚点在 x+w，
// 恰好落在侧面那条棱上，看起来像蹭脏的斑点。
// 锚点仍然由布局层使用，只是不再单独绘制。

// 承载文字的"正面"。三维盒、薄板、叠板都要把文字放到最前面的那一面上，
// 否则文字会压在顶面或后面的板上——旧实现里 MatMul 的名字就飘在叠板外面。
function textFace(primitive, bounds, flat) {
  // 扁平模式：特征图 / 图像板 / 扁条都没有进深偏移，名字直接落在整盒中心。
  if (flat && (primitive.form === "volume" || primitive.form === "plane" || primitive.form === "stack")) {
    return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  }
  // 扁平梯形：上宽下窄（或反之），**中腰处**的宽度才是真正可用的文字宽度。
  // 若按整盒宽算，名字会从左下/右下的斜腰里伸出去。
  if (flat && primitive.form === "wedge") {
    const inset = wedgeInset(bounds);
    return { x: bounds.x + inset / 2, y: bounds.y, w: bounds.w - inset, h: bounds.h };
  }
  if (primitive.form === "volume") {
    // 特征图平面堆：文字落在最前面那张平面上（左下角那张）。
    // 深度必须与 renderFeatureMapStack 用同一份——两处各自算就会漂移，
    // 文字会落到一张不存在的平面上。
    const { N, dx, dy, planeW, planeH } = featureMapStackGeometry(bounds, featureMapDepthOf(primitive));
    return { x: bounds.x, y: bounds.y + (N - 1) * dy, w: planeW, h: planeH };
  }
  if (primitive.form === "plane") {
    // 图像板：文字落在正面（去掉顶面 / 侧面进深之后的矩形）。
    const depth = Math.max(5, Math.min(10, Math.min(bounds.w, bounds.h) * 0.18));
    return { x: bounds.x, y: bounds.y + depth, w: bounds.w - depth, h: bounds.h - depth };
  }
  if (primitive.form === "stack") {
    // FC 扁条：文字落在整条上。
    return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  }
  if (primitive.form === "wedge") {
    // 三维梯形棱柱：文字落在正面上；正面整体下移了一个进深，
    // 且中腰宽度 = 正面宽 - inset（斜腰吃掉的量）。
    const inset = wedgeInset(bounds);
    const depth = cuboidDepth(bounds);
    return {
      x: bounds.x + inset / 2,
      y: bounds.y + depth,
      w: Math.max(8, bounds.w - depth - inset),
      h: Math.max(8, bounds.h - depth),
    };
  }
  return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
}

function labelFaceOrigin(primitive, bounds) {
  const face = textFace(primitive, bounds);
  return { x: face.x, y: face.y };
}

function styleForPrimitive(primitive, type = LEGACY_TYPE) {
  return withStroke(baseStyleForPrimitive(primitive), type);
}

function baseStyleForPrimitive(primitive) {
  if (primitive.blockKind && BLOCK_STYLES[primitive.blockKind]) return BLOCK_STYLES[primitive.blockKind];
  const role = String(primitive.styleProfile || primitive.visualRole || primitive.form || "");
  if (/input/.test(role)) return { fill: "#BCD9F2", stroke: "#1F4E8C" };
  if (/output/.test(role)) return { fill: "#FAD0BE", stroke: "#C0392B" };
  if (/attention/.test(role)) return { fill: "#DCC7EC", stroke: "#6C3483" };
  if (/recurrent|state/.test(role)) return { fill: "#DCC7EC", stroke: "#70459B" };
  if (/merge/.test(role)) return { fill: "#E8D4A8", stroke: "#8B6A32" };
  // pool/reduce 红色系，与 BLOCK_STYLES 的 detection-head 同源（红色 = 输出变换类）
  if (/pool|reduce/.test(role)) return { fill: "#F8C9B5", stroke: "#C0392B" };
  // upsample/expand 绿色系，与 decoder-stage 同源（绿色 = 解码/还原类）
  if (/upsample|expand/.test(role)) return { fill: "#C9E8D2", stroke: "#239B56" };
  return { fill: "#E5E9EE", stroke: "#5B6B7C" };
}

function bodyLabel(primitive) {
  const first = (primitive.sourceNodeIds || [])[0] || "";
  const label = (primitive.labels || []).map(cleanText).find(Boolean);
  return abbreviateOperatorName(label || displayNodeName(first));
}

// 块类型标记（encoder / conv / dense …）是布局层给的分段语义，不是实现细节。
// 顶刊一律全大写写段名，小写的 "encoder" 挂在盒子底下看起来像调试输出。
function badgeText(primitive) {
  const badge = cleanText(primitive.blockBadge || "");
  return badge ? badge.toUpperCase() : "";
}

// 顶刊里写的是领域标准缩写，不是框架的算子类名。
// GlobalAveragePool 要 18 个字符宽，在 U-Net 那种窄梯形里必然溢出（实测需要 124 单位、
// 中腰只有 50，2.5× 越界）；GAP 只要 3 个字符。这既解决溢出，也是论文里的通用写法。
// 只做整词匹配，不碰 layer1.0.conv1 / Encoder Stage 1 这类结构名。
const OPERATOR_ABBREVIATIONS = Object.freeze({
  GlobalAveragePool: "GAP",
  GlobalAveragePooling: "GAP",
  AdaptiveAvgPool: "GAP",
  AdaptiveAveragePool: "GAP",
  GlobalMaxPool: "GMP",
  AveragePool: "AvgPool",
  MaxPooling: "MaxPool",
  LayerNormalization: "LayerNorm",
  BatchNormalization: "BatchNorm",
  GroupNormalization: "GroupNorm",
  InstanceNormalization: "InstanceNorm",
  LocalResponseNormalization: "LRN",
  MultiHeadAttention: "MHA",
  MultiheadAttention: "MHA",
  ScaledDotProductAttention: "SDPA",
  Convolution: "Conv",
  FullyConnected: "FC",
});

function abbreviateOperatorName(name) {
  const text = cleanText(name);
  return OPERATOR_ABBREVIATIONS[text] || text;
}

// ONNX 导出器给节点起名 "算子类型_序号"（LayerNormalization_8 / MatMul_0 / conv2d_1），
// 序号只是"同一算子的第几次出现"，不是架构信息。顶刊图里写的是 LayerNorm，
// 不是 LayerNormalization_8——后者既长到撑破盒宽，又把读者的注意力引向实现细节。
//
// 剥得保守：只有"去掉 _序号 后剩下的部分是一个干净的算子名"才动手。
// 这样 layer1.0.conv1（含点）、resnet50_conv1（前缀含下划线）、"Encoder Stage 1"（含空格）
// 都不会被误伤，而 LayerNormalization_8 → LayerNormalization 正常生效。
function displayNodeName(name) {
  const text = cleanText(name);
  const match = /^([A-Za-z][A-Za-z0-9]*)_(\d+)$/.exec(text);
  return match ? match[1] : text;
}

function roundedPolyline(points, radius) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${n(points[0].x)} ${n(points[0].y)} L ${n(points[1].x)} ${n(points[1].y)}`;
  let path = `M ${n(points[0].x)} ${n(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const r = Math.min(radius, distance(previous, current) / 2, distance(current, next) / 2);
    const entry = towards(current, previous, r);
    const exit = towards(current, next, r);
    path += ` L ${n(entry.x)} ${n(entry.y)} Q ${n(current.x)} ${n(current.y)} ${n(exit.x)} ${n(exit.y)}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${n(last.x)} ${n(last.y)}`;
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function towards(from, to, length) {
  const total = distance(from, to);
  if (total === 0) return { x: from.x, y: from.y };
  const ratio = Math.min(1, length / total);
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

/**
 * 在 HSL 空间调明度，保留色相与饱和度。
 * 旧实现直接向黑/白混合：#DCEAF4 的侧面会变成 #b4c0c8 这种脏灰——
 * 饱和度被拉低后整块看起来"发霉"，这是模块显丑的主要来源。
 */
function tint(hex, amount) {
  const rgb = parseHex(hex);
  if (!rgb || amount === 0) return hex;
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  const nextLightness = amount > 0
    ? lightness + (1 - lightness) * amount
    : lightness * (1 + amount);
  // 压暗时略微提饱和，避免中等明度下颜色发灰。
  const nextSaturation = amount < 0
    ? saturation + (1 - saturation) * 0.1
    : saturation;
  return hslToHex(hue, nextSaturation, Math.max(0.05, Math.min(0.98, nextLightness)));
}

function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / delta + 2) / 6;
  else hue = ((r - g) / delta + 4) / 6;
  return [hue, saturation, lightness];
}

function hslToHex(hue, saturation, lightness) {
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  const amplitude = s * Math.min(l, 1 - l);
  const channel = (offset) => {
    const k = (offset + hue * 12) % 12;
    const value = l - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(Math.max(0, Math.min(1, value)) * 255);
  };
  return `#${[channel(0), channel(8), channel(4)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function normalizePage(page, primitives) {
  if (page && Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0) {
    return { x: 0, y: 0, width: page.width, height: page.height };
  }
  const boxes = primitives.map((primitive) => primitive.bounds).filter(validBounds);
  const width = Math.max(1, ...boxes.map((bounds) => bounds.x + bounds.w));
  const height = Math.max(1, ...boxes.map((bounds) => bounds.y + bounds.h));
  return { x: 0, y: 0, width, height };
}

function css(type = LEGACY_TYPE) {
  return [
    `text{font-family:${FONT};fill:${TEXT_INK}}`,
    `.scene-title{text-anchor:middle;font-size:${format(type.title)}px;font-weight:600;letter-spacing:0.2px}`,
    // 组框改用实线：Nature 明确避免 pattern，虚线框缩到栏宽后会糊成灰边。
    `.scene-group-frame{fill:#FBFCFD;stroke:#D5DBE3;stroke-width:${format(type.hairline)}}`,
    // 段带：只用浅填充、不描边。它是背景，不是容器——Nature 明确避免多余边框。
    ".stage-band-frame{fill:#F1F5F9;stroke:none}",
    // 段标签位置由 renderStageBand 做碰撞检测后决定，这里只管字形。
    // （试过用 paint-order 描一圈与底色同色的光晕来压住穿过的连接线——
    //   但 cairosvg 不支持 paint-order，描边会盖掉填充，字直接消失。改用避让。）
    `.stage-band-label{font-size:${format(type.group)}px;font-weight:600;fill:#94A3B8;letter-spacing:0.8px}`,
    // 段带标签是浅灰的说明性文字，不是数据标签；Nature 只禁止"彩色文字"，
    // 灰度文字不受限，但仍要保证印出来有足够对比度（#94A3B8 ≈ 2.8:1）。
    ".scene-group-tag{fill:#E8EDF3;stroke:none}",
    `.scene-group-label{font-size:${format(type.group)}px;font-weight:600;fill:#475569;dominant-baseline:middle}`,
    `.body-label{text-anchor:middle;dominant-baseline:middle;font-size:${format(type.label)}px;font-weight:600;fill:${TEXT_INK}}`,
    // 张量形状是补充信息：小一档字号 + 压灰，避免和算子名抢注意力。
    `.body-shape{text-anchor:middle;dominant-baseline:middle;font-size:${format(type.primitive)}px;fill:#5A6472}`,
    `.primitive-label{text-anchor:middle;font-size:${format(type.primitive)}px;fill:#5A6472}`,
    // 盒下的张量形状：比算子名再压一档，让"名字 > 形状"的层级一眼可见。
    `.primitive-shape{text-anchor:middle;font-size:${format(type.badge)}px;fill:#8A94A3}`,
    // 块类型标记（ENCODER / CONV）：顶刊写全大写小号字，不写小写的实现名。
    `.block-badge{text-anchor:middle;dominant-baseline:middle;font-size:${format(type.badge)}px;fill:${MUTED_INK};letter-spacing:0.6px}`,
    // 步骤序号是过程性标注，压到最小一档并转灰——它服务于方法描述，不该抢视觉重心。
    `.step-chip-label{text-anchor:middle;dominant-baseline:central;font-size:${format(type.step)}px;font-weight:600;fill:${TEXT_INK}}`,
    `.legend-label{font-size:${format(legendFontSize(type))}px;fill:#475569}`,
    ".scene-connector{fill:none;stroke-linejoin:round;stroke-linecap:round}",
  ].join("");
}

function validBounds(bounds) {
  return bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0;
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function area(bounds) {
  return validBounds(bounds) ? bounds.w * bounds.h : 0;
}

function n(value) {
  return format(Number(value || 0));
}

function format(value) {
  return Number(value.toFixed(3)).toString();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  }[character]));
}

function escapeAttribute(value) {
  return escapeXml(value).replace(/\s+/g, "-");
}
