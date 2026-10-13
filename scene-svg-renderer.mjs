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
  return [{
    code: "label-below-font-floor",
    severity: "warning",
    labels: names,
    minPt: Math.min(...[...seen.values()].filter((value) => value !== null)),
    message: `${names.length} 个盒内标签（${names.slice(0, 3).join(" / ")}${names.length > 3 ? " 等" : ""}）在锁定的盒宽下缩到 ${floorPt} pt 仍放不下，实际会掉到 ${Math.min(...[...seen.values()].filter((value) => value !== null)).toFixed(2)} pt，低于期刊下限；应缩短名字或放大盒宽。`,
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
    diagnostics,
  };
}

// ── 模块绘制令牌 ────────────────────────────────────────────────
// 所有图元共用同一套线宽与圆角。旧实现里线宽散落着 0.8/0.9/1.1/1.2/1.3/1.4/1.8
// 七种取值、圆角有 0/4/6/7/8/10/12/16 八种，看起来像不同人拼出来的。
const STROKE = 1.25;
const STROKE_HAIRLINE = 1;
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
  // 阅读顺序：折行布局是列优先的，所以先按 x 再按 y 排序，正好等于数据流的先后。
  const steps = new Map(
    [...bodies]
      .sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y)
      .map((primitive, index) => [String(primitive.id), index + 1]),
  );
  const legendItems = options.legend === false ? [] : buildLegend(bodies);
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
  for (const group of groups) lines.push(renderGroup(group, type));
  for (const connector of scene.connectors) lines.push(renderConnector(connector));
  for (const primitive of [...bodies, ...decorations].sort((left, right) => (left.zIndex || 0) - (right.zIndex || 0))) {
    lines.push(renderPrimitive(primitive, steps.get(String(primitive.id)), flat, type));
  }
  lines.push("</g>");
  if (legendRows) lines.push(renderLegend(legendRows, margin, margin + titleHeight + page.height + 14, flat, type));
  lines.push("</svg>");
  return lines.join("\n");
}

// 图例：PLOS ONE 2025 指南 L 要求图能自足。只列出本图真正用到的图元形态，
// 避免出现"图例里有、图上没有"的噪声。
const LEGEND_ENTRIES = Object.freeze([
  { form: "volume", label: "张量 / 特征图（宽=通道数，高=空间尺寸）" },
  { form: "stack", label: "矩阵算子（MatMul / Linear）" },
  { form: "wedge", label: "下采样 / 上采样", data: { scaleChange: "reduce" } },
  { form: "strip", label: "序列张量" },
  { form: "glyph", label: "逐元素合并（Add / Concat）", semanticTags: ["merge"] },
  { form: "band", label: "逐元素算子（Norm / Activation）" },
  { form: "cell", label: "循环 / 图算子" },
  { form: "callout", label: "未解析模块（需人工确认）" },
]);

function buildLegend(bodies) {
  const present = new Set(bodies.map((primitive) => String(primitive.form || "")));
  return LEGEND_ENTRIES.filter((entry) => present.has(entry.form));
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
      const style = styleForForm(entry.form);
      parts.push(renderBodyShape({ form: entry.form, data: entry.data, semanticTags: entry.semanticTags }, { x: cursor, y, w: LEGEND_SWATCH.w, h: LEGEND_SWATCH.h }, style, flat));
      parts.push(`<text class="legend-label" x="${n(cursor + LEGEND_SWATCH.w + 8)}" y="${n(y + LEGEND_SWATCH.h / 2)}" dominant-baseline="central">${escapeXml(entry.label)}</text>`);
      cursor += legendItemWidth(entry, type);
    }
  });
  parts.push("</g>");
  return parts.join("");
}

function styleForForm(form) {
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

function renderConnector(connector) {
  const points = (connector.points || []).filter(validPoint);
  if (points.length < 2) return "";
  const routeClass = String(connector.routeClass || "main-flow");
  const style = ROUTE_STYLES[routeClass] || ROUTE_STYLES["main-flow"];
  const path = roundedPolyline(points, CORNER_RADIUS);
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  return `<path class="scene-connector ${escapeAttribute(routeClass)}" d="${path}" stroke="${style.color}" stroke-width="${style.width}"${dash} marker-end="url(#arrow-${escapeAttribute(routeClass)})"/>`;
}

function renderPrimitive(primitive, step, flat, type = LEGACY_TYPE) {
  if (!validBounds(primitive.bounds)) return "";
  if (primitive.role !== "body") return renderDecoration(primitive);
  const bounds = primitive.bounds;
  const style = styleForPrimitive(primitive);
  const shape = renderBodyShape(primitive, bounds, style, flat);
  const text = renderBodyText(primitive, bounds, step, flat, type);
  // 合并算子的序号已经并进圆下方的说明行，不能再在角上画一个。
  const chip = isMergeGlyph(primitive) ? "" : renderStepChip(step, bounds, primitive, type, flat);
  return `<g class="scene-body ${escapeAttribute(primitive.blockKind || primitive.form || "operator")}">${shape}${text}${chip}</g>`;
}

// 标签与角标合成一个居中文本块。旧画法是"名字在中间 + 药丸浮在右上角"，
// 在 111×130 的盒子上同时挂序号圆、药丸、两个端口、名字，噪声压过了信息。
function renderBodyText(primitive, bounds, step, flat, type = LEGACY_TYPE) {
  const label = bodyLabel(primitive);
  const badge = cleanText(primitive.blockBadge || "");
  if (!label && !badge) return "";
  // 合并算子的圆心留给 ⊕。名字挂到圆下方，序号排在名字左边——
  // 序号圆没法塞进圆形的左上角（内接方形的角点离圆心只有 r/√2），
  // 硬塞就会压在圆周上。
  if (isMergeGlyph(primitive)) {
    if (!label) return "";
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h + 13;
    const half = label.length * type.label * 0.29;
    const chip = Number.isFinite(step)
      ? stepChipMarkup(step, cx - half - type.chipRadius - 4, cy, type.chipRadius)
      : "";
    const shift = Number.isFinite(step) ? type.chipRadius + 4 : 0;
    return `<g class="body-caption">${chip}<text class="body-label" x="${n(cx + shift)}" y="${n(cy)}">${escapeXml(label)}</text></g>`;
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
    const lineGap = fit.fontSize * 1.18;
    const hasBadge = Boolean(badge);
    const blockHeight = fit.lines.length * lineGap + (hasBadge ? type.badge * 1.3 : 0);
    const startY = cy - blockHeight / 2 + lineGap / 2;
    fit.lines.forEach((line, lineIndex) => {
      rows.push(`<text class="body-label"${fontSizeAttr(fit.fontSize, type.label)} x="${n(cx)}" y="${n(startY + lineIndex * lineGap)}">${escapeXml(line)}</text>`);
    });
    if (hasBadge) {
      rows.push(`<text class="block-badge" x="${n(cx)}" y="${n(startY + fit.lines.length * lineGap + type.badge * 0.65)}">${escapeXml(badge)}</text>`);
    }
  } else if (badge) {
    rows.push(`<text class="block-badge" x="${n(cx)}" y="${n(cy)}">${escapeXml(badge)}</text>`);
  }
  return `<g class="body-text">${rows.join("")}</g>`;
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
  // 折两行：从中间断开，尽量让两行长度接近。
  const mid = Math.ceil(text.length / 2);
  const lines = [text.slice(0, mid), text.slice(mid)];
  font = base * 0.86;
  while (font > minFont && tooWide(lines, font)) font -= 0.5;
  return { fontSize: font, lines, overflow: belowFloor(font, lines) };
}

// 步骤序号：PLOS ONE 2025 指南 G（便于导航）。折行之后读者需要一条明确的
// 阅读路径，靠箭头自己找容易跟丢。
// 序号本身必须是深色：Nature 明令禁止彩色文字，旧实现用 style.stroke 上色，
// 绿块的序号就是绿的。
// 位置：盒子的「真实左上角」，而不是文字面的左上角——
// 文字面是三维盒的正面，盒子被压扁之后它和文字挤在一起，把"Conv_0"的头几个字盖住。
// 放在顶面的左上角既不和文字撞，也跟顶刊常见的"角标"排版一致。
const CHIP_RADIUS = 7.5;

function stepChipMarkup(step, cx, cy, radius = CHIP_RADIUS) {
  return [
    `<circle class="step-chip" cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="#FFFFFF" stroke="${MUTED_INK}" stroke-width="${STROKE_HAIRLINE}"/>`,
    `<text class="step-chip-label" x="${n(cx)}" y="${n(cy)}">${step}</text>`,
  ].join("");
}

function renderStepChip(step, bounds, primitive, type = LEGACY_TYPE, flat = false) {
  if (!Number.isFinite(step)) return "";
  const radius = Math.max(6, Math.min(type.chipRadius, Math.min(bounds.w, bounds.h) * 0.14));
  // 顶刊的"角标"读法：落在盒子最外侧的左上角。三维盒就是顶面，叠板就是最后面那块板的角。
  // 用 bounds 的左上角而不是 labelFaceOrigin，这样压扁之后不会再盖到名字。
  const pad = radius * 0.5;
  const y = bounds.y + radius + pad;
  let x = bounds.x + radius + pad;
  // 梯形的左上角是**斜的**（三维棱柱还多一层顶面斜边）：角标必须贴着实测的左边界放，
  // 否则会有一半悬在形状外面。
  if (primitive.form === "wedge") x = wedgeLeftAt(primitive, bounds, flat, y) + radius + pad;
  return stepChipMarkup(step, x, y, radius);
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

function renderDecoration(primitive) {
  const labels = (primitive.labels || []).map(cleanText).filter(Boolean);
  if (!labels.length) return "";
  const bounds = primitive.bounds;
  const lineHeight = 13;
  const centerY = bounds.y + bounds.h / 2 - ((labels.length - 1) * lineHeight) / 2;
  const text = labels.map((label, index) =>
    `<text class="primitive-label" x="${n(bounds.x + bounds.w / 2)}" y="${n(centerY + index * lineHeight + 4)}">${escapeXml(label)}</text>`
  ).join("");
  return `<g class="scene-decoration">${text}</g>`;
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
  if (form === "volume") return renderFeatureMapStack(bounds, style);
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
  return `<rect class="${className}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
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
  return `<polygon class="wedge-body" points="${points}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
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
  parts.push(`<rect x="${n(cx)}" y="${n(cy)}" width="${n(side)}" height="${n(side)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`);
  // 太阳：左上角小圆
  const sunR = side * 0.15;
  parts.push(`<circle cx="${n(cx + side * 0.28)}" cy="${n(cy + side * 0.28)}" r="${n(sunR)}" fill="none" stroke="${stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`);
  // 山：底部折线
  const mountain = [
    `${n(cx + side * 0.16)},${n(cy + side * 0.82)}`,
    `${n(cx + side * 0.46)},${n(cy + side * 0.44)}`,
    `${n(cx + side * 0.64)},${n(cy + side * 0.62)}`,
    `${n(cx + side * 0.84)},${n(cy + side * 0.82)}`,
  ].join(" ");
  parts.push(`<polyline points="${mountain}" fill="none" stroke="${stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`);
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
function featureMapStackGeometry(bounds) {
  const { x, y, w, h } = bounds;
  const N = 3;
  const dx = Math.max(3, Math.min(5, w * 0.05));
  const dy = Math.max(3, Math.min(5, h * 0.06));
  const planeW = w - (N - 1) * dx;
  const planeH = h - (N - 1) * dy;
  return { N, dx, dy, planeW, planeH };
}

function renderFeatureMapStack(bounds, style) {
  const { N, dx, dy, planeW, planeH } = featureMapStackGeometry(bounds);
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
      parts.push(`<polygon points="${n(px + planeW)},${n(py)} ${n(backPx + planeW)},${n(backPy)} ${n(backPx + planeW)},${n(backPy + planeH)} ${n(px + planeW)},${n(py + planeH)}" fill="${tint(style.fill, FACE_SIDE)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`);
      // 顶面：从前一张的顶边到后一张的顶边
      parts.push(`<polygon points="${n(px)},${n(py)} ${n(px + planeW)},${n(py)} ${n(backPx + planeW)},${n(backPy)} ${n(backPx)},${n(backPy)}" fill="${tint(style.fill, FACE_SIDE - 0.06)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`);
    }
    const tintAmt = FACE_FRONT - 0.04 * (N - 1 - i);
    parts.push(`<rect x="${n(px)}" y="${n(py)}" width="${n(planeW)}" height="${n(planeH)}" fill="${tint(style.fill, tintAmt)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`);
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
  const frame = `<rect x="${n(iconCx - iconSide / 2)}" y="${n(iconCy - iconSide / 2)}" width="${n(iconSide)}" height="${n(iconSide)}" rx="2" fill="none" stroke="${style.stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`;
  const sunR = iconSide * 0.13;
  const sun = `<circle cx="${n(iconCx - iconSide * 0.22)}" cy="${n(iconCy - iconSide * 0.22)}" r="${n(sunR)}" fill="none" stroke="${style.stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`;
  const mountain = `<polyline points="${n(iconCx - iconSide * 0.35)},${n(iconCy + iconSide * 0.28)} ${n(iconCx - iconSide * 0.08)},${n(iconCy - iconSide * 0.12)} ${n(iconCx + iconSide * 0.12)},${n(iconCy + iconSide * 0.12)} ${n(iconCx + iconSide * 0.35)},${n(iconCy + iconSide * 0.28)}" fill="none" stroke="${style.stroke}" stroke-width="${STROKE_HAIRLINE}" opacity="${opacity}"/>`;
  return [
    `<polygon class="face-top" points="${top}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`,
    `<polygon class="face-side" points="${side}" fill="${tint(style.fill, FACE_SIDE)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`,
    `<rect class="face-front" x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`,
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
  return `<rect class="bar-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_SLAB}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
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
    return `<polygon${attr} points="${path}" fill="${fill}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
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
  return `<rect class="strip-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_SLAB}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
}

// 逐元素算子（Norm / Activation）：干净的圆角条。
function renderBand(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="band-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_2D}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
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
    `<circle class="glyph-body" cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`,
    `<line class="glyph-arm" x1="${n(cx - arm)}" y1="${n(cy)}" x2="${n(cx + arm)}" y2="${n(cy)}" stroke="${style.stroke}" stroke-width="${STROKE}" stroke-linecap="round"/>`,
    `<line class="glyph-arm" x1="${n(cx)}" y1="${n(cy - arm)}" x2="${n(cx)}" y2="${n(cy + arm)}" stroke="${style.stroke}" stroke-width="${STROKE}" stroke-linecap="round"/>`,
  ].join("");
}

// 循环 / 图算子：胶囊形，与普通算子的 8 圆角拉开区分。
function renderCell(bounds, style) {
  const { x, y, w, h } = bounds;
  const radius = Math.max(RADIUS_2D, Math.min(18, h * 0.42));
  return `<rect class="cell-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${tint(style.fill, FACE_FRONT)}" stroke="${style.stroke}" stroke-width="${STROKE}"/>`;
}

// 未解析模块：虚线是"待确认"的既有约定，保留。
function renderCallout(bounds, style) {
  const { x, y, w, h } = bounds;
  return `<rect class="callout-body" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS_2D}" fill="#FFFFFF" stroke="${style.stroke}" stroke-width="${STROKE}" stroke-dasharray="5 4"/>`;
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
    const { N, dx, dy, planeW, planeH } = featureMapStackGeometry(bounds);
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

function styleForPrimitive(primitive) {
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
  return label || displayNodeName(first);
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
    ".scene-group-frame{fill:#FBFCFD;stroke:#D5DBE3;stroke-width:1}",
    ".scene-group-tag{fill:#E8EDF3;stroke:none}",
    `.scene-group-label{font-size:${format(type.group)}px;font-weight:600;fill:#475569;dominant-baseline:middle}`,
    `.body-label{text-anchor:middle;dominant-baseline:middle;font-size:${format(type.label)}px;font-weight:600;fill:${TEXT_INK}}`,
    `.block-badge{text-anchor:middle;dominant-baseline:middle;font-size:${format(type.badge)}px;fill:${MUTED_INK}}`,
    `.primitive-label{text-anchor:middle;font-size:${format(type.primitive)}px;fill:#5A6472}`,
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
