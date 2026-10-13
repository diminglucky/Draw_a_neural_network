// 图形几何核验器（独立于渲染器）。
//
//   node scripts/check-figure-geometry.mjs --dir=artifacts/onnx/journal
//
// 为什么需要它：渲染器可以"自报无冲突"，但那只证明它相信自己。真正的排版事故
// （标注压在别的盒子上、连接线穿过文字、文字跑出画布）只有量成品 SVG 才能发现。
// 这里直接解析成品 SVG 的 <text> / <rect> / <path>，用与渲染器同一套字宽估算把
// 文字还原成矩形，再做求交。它不读渲染器的诊断，只读像素级的事实。
//
// 估算必然有误差，所以只报超过 1.5 单位的实质重叠，边界擦碰不算事故。
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

const dir = resolve(String(args.get("dir") || "artifacts/onnx/journal"));
// Helvetica 平均字宽。必须与 scene-svg-renderer 的 LABEL_CHAR_RATIO 一致——
// 两边用不同字宽模型的话，"渲染器算得下、核验器说压住了"就全是假警报。
const CHAR_RATIO = 0.58;
const MIN_OVERLAP = 1.5;
// 数据标签：参与碰撞核验。段带标签 / 组标签是背景说明文字，本就压在色块上，不纳入。
const DATA_TEXT = new Set(["body-label", "block-badge", "primitive-label", "primitive-shape", "body-shape", "step-chip-label"]);
// 各图元形态的"文字面"类名。渲染器在 3D 模式下的盒子由多张平面叠成，
// 只有最前面那张（`body-rect`）是文字面——把被遮挡的平面也算成盒子会产生大量假警报。
const BODY_RECT = new Set([
  "flat-body", "matrix-body", "body-rect", "face-front",
  "band-body", "bar-body", "strip-body", "cell-body", "callout-body",
]);
const BODY_POLYGON = new Set(["wedge-body", "face-front"]);

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > MIN_OVERLAP && h > MIN_OVERLAP ? w * h : 0;
}

// 连接线是有宽度的实体（1 pt ≈ 1.5 单位），不能当零宽线段判交——
// 零宽盒的交面积恒为 0，会把"线正好从文字正中穿过"这种最严重的情况漏掉。
const SEGMENT_HALF_WIDTH = 1;

function segmentHits(box, segment) {
  const [p, q] = segment;
  return overlapArea(box, {
    x: Math.min(p.x, q.x) - SEGMENT_HALF_WIDTH,
    y: Math.min(p.y, q.y) - SEGMENT_HALF_WIDTH,
    w: Math.abs(p.x - q.x) + SEGMENT_HALF_WIDTH * 2,
    h: Math.abs(p.y - q.y) + SEGMENT_HALF_WIDTH * 2,
  }) > 0;
}

function parseCss(svg) {
  const rules = new Map();
  const block = /<style>([\s\S]*?)<\/style>/.exec(svg);
  if (!block) return rules;
  for (const match of block[1].matchAll(/\.([\w-]+)\{([^}]*)\}/g)) {
    const [, name, body] = match;
    const size = /font-size:\s*([\d.]+)px/.exec(body);
    const anchor = /text-anchor:\s*(\w+)/.exec(body);
    rules.set(name, { fontSize: size ? Number(size[1]) : null, anchor: anchor ? anchor[1] : "start" });
  }
  return rules;
}

function parseTranslate(svg) {
  const match = /<g transform="translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)"/.exec(svg);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

function attr(attributes, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes || "");
  return match ? match[1] : null;
}

function num(attributes, name) {
  const value = attr(attributes, name);
  return value === null ? NaN : Number(value);
}

function parseTexts(svg, css) {
  const texts = [];
  // 只取图形区：图例/标题在另一个坐标系里，不参与碰撞核验。
  const body = svg.slice(svg.indexOf("</defs>") + 7);
  for (const match of body.matchAll(/<text class="([\w-]+)"([^>]*)>([^<]*)<\/text>/g)) {
    const [, className, attributes, raw] = match;
    const rule = css.get(className);
    const inline = /font-size:\s*([\d.]+)px/.exec(attributes);
    const fontSize = inline ? Number(inline[1]) : rule?.fontSize;
    if (!Number.isFinite(fontSize)) continue;
    const x = num(attributes, "x");
    const y = num(attributes, "y");
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const text = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const width = [...text].length * fontSize * CHAR_RATIO;
    const anchor = rule?.anchor || "start";
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    // 字面高度按 cap-height 算（Helvetica ≈ 0.72 em）：基线是大写字母的底边，
    // 不是字框的底边。只有真带降部的字母（g j p q y）才往下多留 0.21 em——
    // 否则 "CONV" 会被算成比盒子底沿还低 2 单位，和箭头尖"相撞"，全是假警报。
    const descender = /[gjpqy]/.test(text) ? 0.21 : 0;
    texts.push({
      className,
      text,
      box: { x: left, y: y - fontSize * 0.72, w: width, h: fontSize * (0.72 + descender) },
    });
  }
  return texts;
}

function parseBoxes(svg) {
  const shapes = [];
  for (const match of svg.matchAll(/<rect class="([\w-]+)"([^>]*)\/>/g)) {
    if (!BODY_RECT.has(match[1])) continue;
    const box = { x: num(match[2], "x"), y: num(match[2], "y"), w: num(match[2], "width"), h: num(match[2], "height") };
    if (Object.values(box).every(Number.isFinite) && box.w > 2 && box.h > 2) shapes.push({ kind: "rect", box, points: null });
  }
  // 梯形是 <polygon points="...">。**不能只取外接矩形**——梯形的斜腰正是最容易
  // 挤出文字的地方，用外接矩形判定会把"文字从斜腰伸出去"整个漏掉。
  for (const match of svg.matchAll(/<polygon class="([\w-]+)" points="([^"]+)"/g)) {
    if (!BODY_POLYGON.has(match[1])) continue;
    const points = [...match[2].matchAll(/([-\d.]+)[\s,]+([-\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
    if (points.length < 3) continue;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    shapes.push({
      kind: "poly",
      points,
      box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    });
  }
  return shapes;
}

function pointInPolygon(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function corners(box) {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w, y: box.y + box.h },
  ];
}

function center(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// 连接线是带圆角的折线：M / L / Q。Q 是圆角，控制点一定落在两端点构成的矩形内，
// 所以按"起点→终点"的直线近似就够——不会漏判，最多把圆角算得略窄。
function parseSegments(svg) {
  const segments = [];
  for (const match of svg.matchAll(/<path class="scene-connector[^"]*"[^>]*\bd="([^"]+)"/g)) {
    const tokens = match[1].match(/[MLQ]|-?[\d.]+/g) || [];
    let cursor = null;
    let index = 0;
    while (index < tokens.length) {
      const command = tokens[index];
      if (command === "M" || command === "L") {
        const point = { x: Number(tokens[index + 1]), y: Number(tokens[index + 2]) };
        index += 3;
        if (command === "L" && cursor) segments.push([cursor, point]);
        cursor = point;
      } else if (command === "Q") {
        const point = { x: Number(tokens[index + 3]), y: Number(tokens[index + 4]) };
        index += 5;
        if (cursor) segments.push([cursor, point]);
        cursor = point;
      } else {
        index += 1;
      }
    }
  }
  return segments;
}

function contains(box, point) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

// 连接线画在盒子之前（z 序更低），落在盒子内部的线段被遮住，看不见。
// 不排掉它们，"折回盒心的圆角段"会被当成压住盒内文字，全是假警报。
//
// 做法是把每段正交线按盒子切成可见片段（线段减法）。斜段是折线的圆角（≤8 单位、
// 永远贴着盒子角），且圆角整体落在两端点矩形内，切不干净反而制造噪声，直接丢弃。
function visibleParts(segment, boxes) {
  const [p, q] = segment;
  const vertical = Math.abs(p.x - q.x) < 0.01;
  const horizontal = Math.abs(p.y - q.y) < 0.01;
  if (!vertical && !horizontal) return [];
  const axis = vertical ? "y" : "x";
  const cross = vertical ? "x" : "y";
  const lo = Math.min(p[axis], q[axis]);
  const hi = Math.max(p[axis], q[axis]);
  const at = p[cross];
  const spans = [];
  for (const box of boxes) {
    const spanLo = box[cross];
    const spanHi = box[cross] + (vertical ? box.w : box.h);
    if (at < spanLo || at > spanHi) continue;
    const from = Math.max(lo, box[axis]);
    const to = Math.min(hi, box[axis] + (vertical ? box.h : box.w));
    if (to > from) spans.push([from, to]);
  }
  spans.sort((left, right) => left[0] - right[0]);
  const point = (value) => (vertical ? { x: at, y: value } : { x: value, y: at });
  const parts = [];
  let cursor = lo;
  for (const [from, to] of spans) {
    if (from > cursor) parts.push([point(cursor), point(from)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < hi) parts.push([point(cursor), point(hi)]);
  return parts;
}

function audit(name, svg) {
  const offset = parseTranslate(svg);
  const shift = (box) => ({ ...box, x: box.x + offset.x, y: box.y + offset.y });
  const css = parseCss(svg);
  const texts = parseTexts(svg, css).map((item) => ({ ...item, box: shift(item.box) }));
  const shapes = parseBoxes(svg).map((shape) => ({
    ...shape,
    box: shift(shape.box),
    points: shape.points ? shape.points.map(shift) : null,
  }));
  // 扁平模式才有完整的盒形信息。3D 模式下一个盒子由多张平面叠成，SVG 里只有最前面
  // 那张带类名，被它遮住的平面和连接线都取不到——这类文件只能做"包围盒级"核验，
  // 结果只作参考，不计入失败（见文件末尾的说明）。
  const flatMode = svg.includes('class="flat-body"') || svg.includes('class="matrix-body"');
  const boxes = shapes.map((shape) => shape.box);
  const segments = parseSegments(svg)
    .map(([p, q]) => [shift(p), shift(q)])
    .flatMap((segment) => visibleParts(segment, boxes));
  const page = {
    w: Number((/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) || [])[1]),
    h: Number((/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) || [])[2]),
  };

  const candidates = texts.filter((item) => DATA_TEXT.has(item.className));
  // 归属：文字中心落在哪个形状内，那个形状就是"它自己的盒子"，不算冲突。
  // 取面积最小的那个——U-Net 的段带是个大矩形，会把整列都包进去。
  const owner = new Map();
  for (const item of candidates) {
    const middle = center(item.box);
    const hits = shapes
      .filter((shape) => (shape.kind === "poly" ? pointInPolygon(shape.points, middle) : contains(shape.box, middle)))
      .sort((left, right) => left.box.w * left.box.h - right.box.w * right.box.h);
    owner.set(item, hits[0] || null);
  }

  const issues = [];
  const at = (item) => `${item.box.x.toFixed(0)},${item.box.y.toFixed(0)} ${item.box.w.toFixed(0)}×${item.box.h.toFixed(0)}`;
  for (const item of candidates) {
    const mine = owner.get(item);
    if (item.box.x < -0.5 || item.box.y < -0.5 || item.box.x + item.box.w > page.w + 0.5 || item.box.y + item.box.h > page.h + 0.5) {
      issues.push({ code: "text-out-of-canvas", text: item.text, detail: `文字框 ${at(item)} 越出画布 ${page.w}×${page.h}` });
    }
    // 文字在自己的形状里，但不能从斜腰伸出去——梯形是唯一有斜边的形状。
    // 判定前把文字框收 1 单位：字宽和 cap-height 都是估的，贴边 1 单位以内
    // 属于估算误差，不是排版事故。
    if (mine?.kind === "poly") {
      const inside = { x: item.box.x + 1, y: item.box.y + 1, w: item.box.w - 2, h: item.box.h - 2 };
      const outside = corners(inside).filter((corner) => !pointInPolygon(mine.points, corner));
      if (outside.length) {
        issues.push({ code: "text-outside-shape", text: item.text, detail: `文字框 ${at(item)} 有 ${outside.length} 个角伸到梯形斜腰外面（${outside.map((corner) => `${corner.x.toFixed(0)},${corner.y.toFixed(0)}`).join(" ")}）` });
      }
    }
    for (const shape of shapes) {
      if (shape === mine) continue;
      const hit = shape.kind === "poly"
        ? corners(item.box).some((corner) => pointInPolygon(shape.points, corner))
        : overlapArea(item.box, shape.box) > 0;
      if (hit) {
        issues.push({ code: "text-over-foreign-box", text: item.text, detail: `文字框 ${at(item)} 压住别的盒子 ${shape.box.x.toFixed(0)},${shape.box.y.toFixed(0)} ${shape.box.w.toFixed(0)}×${shape.box.h.toFixed(0)}` });
        break;
      }
    }
    for (const segment of segments) {
      if (segmentHits(item.box, segment)) {
        issues.push({ code: "text-over-connector", text: item.text, detail: `文字框 ${at(item)} 被连接线 ${segment[0].x.toFixed(0)},${segment[0].y.toFixed(0)} → ${segment[1].x.toFixed(0)},${segment[1].y.toFixed(0)} 穿过` });
        break;
      }
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (overlapArea(candidates[i].box, candidates[j].box) > 0) {
        issues.push({ code: "text-over-text", text: `${candidates[i].text} ↔ ${candidates[j].text}`, detail: "两处文字互相压住" });
      }
    }
  }
  return { name, page, flatMode, textCount: candidates.length, boxCount: boxes.length, segmentCount: segments.length, issues };
}

const files = readdirSync(dir).filter((file) => file.endsWith(".svg")).sort();
let failed = 0;
let advisory = 0;
const tally = new Map();
for (const file of files) {
  const result = audit(basename(file, ".svg"), readFileSync(join(dir, file), "utf8"));
  const counts = result.issues.reduce((acc, issue) => acc.set(issue.code, (acc.get(issue.code) || 0) + 1), new Map());
  if (result.flatMode) {
    for (const [code, count] of counts) tally.set(code, (tally.get(code) || 0) + count);
    if (result.issues.length) failed += 1;
  } else {
    advisory += 1;
  }
  const summary = [...counts].map(([code, count]) => `${code}×${count}`).join(" ") || "无冲突";
  console.log(`${result.name.padEnd(20)} ${result.textCount} 处文字 / ${result.boxCount} 个盒子 / ${result.segmentCount} 段线  → ${summary}${result.flatMode ? "" : "   (3D·仅供参考)"}`);
  const shown = result.flatMode ? 8 : 3;
  for (const issue of result.issues.slice(0, shown)) console.log(`    · ${issue.code}  "${issue.text}"  ${issue.detail}`);
  if (result.issues.length > shown) console.log(`    · …另有 ${result.issues.length - shown} 条`);
}
console.log(`\n合计 ${files.length} 张：${files.length - advisory} 张扁平图核验，${failed} 张存在几何冲突，${advisory} 张 3D 图仅供参考。`);
console.log("（3D 模式下盒子由多张平面叠成，被遮挡的平面与连接线无法从成品 SVG 还原，因此不做判定。）");
if (tally.size) console.log([...tally].map(([code, count]) => `${code} ${count}`).join("  "));
process.exit(failed ? 1 : 0);
