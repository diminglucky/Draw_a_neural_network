export const SCENE_SVG_RENDERER_VERSION = "scene-svg-renderer/v1";

const ROUTE_STYLES = Object.freeze({
  "main-flow": { color: "#3F5D78", dash: "", width: 1.8 },
  bypass: { color: "#2E8B72", dash: "7 5", width: 1.8 },
  state: { color: "#70459B", dash: "5 4", width: 1.9 },
  conditional: { color: "#B7791F", dash: "3 4", width: 1.8 },
  "cross-scale": { color: "#3E8E5A", dash: "9 4", width: 1.8 },
});

const BLOCK_STYLES = Object.freeze({
  "conv-block": { fill: "#FFE7BF", stroke: "#B87835" },
  "residual-block": { fill: "#DDF3EC", stroke: "#2E8B72" },
  "attention-block": { fill: "#E8DDF5", stroke: "#7A4BA0" },
  "ffn-block": { fill: "#E8EEF8", stroke: "#52709E" },
  "encoder-stage": { fill: "#DCEAF4", stroke: "#467EA6" },
  "decoder-stage": { fill: "#E2F3E7", stroke: "#3E8E5A" },
  "multi-scale-fusion": { fill: "#F4D7A8", stroke: "#8B6A32" },
  "detection-head": { fill: "#FAD9D2", stroke: "#C0432E" },
  "recurrent-cell": { fill: "#E8DDF5", stroke: "#70459B" },
  "moe-block": { fill: "#F0E7D8", stroke: "#8A6A3D" },
  "repeat-block": { fill: "#EDF0F3", stroke: "#687789" },
  "graph-block": { fill: "#DDF2F4", stroke: "#2E7F8C" },
});

export function renderSceneSvg(scene = {}, options = {}) {
  if (!Array.isArray(scene.primitives) || !Array.isArray(scene.connectors)) {
    throw new TypeError("Scene SVG rendering requires primitives and connectors.");
  }
  const page = normalizePage(scene.page, scene.primitives);
  const scale = Number.isFinite(options.scale) ? Math.max(1, options.scale) : 4;
  const background = options.background || "#FFFFFF";
  const title = cleanText(options.title || "");
  const titleHeight = title ? 28 : 0;
  const groups = [...(scene.groups || [])].sort((left, right) => area(right.bounds) - area(left.bounds));
  const bodies = scene.primitives.filter((primitive) => primitive.role === "body");
  const decorations = scene.primitives.filter((primitive) => primitive.role !== "body");
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${format(page.width * scale)}" height="${format((page.height + titleHeight) * scale)}" viewBox="0 0 ${format(page.width)} ${format(page.height + titleHeight)}" role="img">`,
    "<defs>",
    ...Object.entries(ROUTE_STYLES).map(([routeClass, style]) => (
      `<marker id="arrow-${routeClass}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${style.color}"/></marker>`
    )),
    `<style>${css()}</style>`,
    "</defs>",
    `<rect x="0" y="0" width="${format(page.width)}" height="${format(page.height + titleHeight)}" fill="${background}"/>`,
  ];
  if (title) lines.push(`<text class="scene-title" x="${format(page.width / 2)}" y="20">${escapeXml(title)}</text>`);
  lines.push(`<g transform="translate(0 ${titleHeight})">`);
  for (const group of groups) lines.push(renderGroup(group));
  for (const connector of scene.connectors) lines.push(renderConnector(connector));
  for (const primitive of [...bodies, ...decorations].sort((left, right) => (left.zIndex || 0) - (right.zIndex || 0))) {
    lines.push(renderPrimitive(primitive));
  }
  lines.push("</g>", "</svg>");
  return lines.join("\n");
}

function renderGroup(group) {
  if (!validBounds(group.bounds)) return "";
  const bounds = group.bounds;
  const label = cleanText(group.label || group.id);
  return [
    `<g class="scene-group">`,
    `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" rx="8"/>`,
    label ? `<text x="${n(bounds.x + 10)}" y="${n(bounds.y + 16)}">${escapeXml(label)}</text>` : "",
    `</g>`,
  ].filter(Boolean).join("");
}

function renderConnector(connector) {
  const points = (connector.points || []).filter(validPoint);
  if (points.length < 2) return "";
  const routeClass = String(connector.routeClass || "main-flow");
  const style = ROUTE_STYLES[routeClass] || ROUTE_STYLES["main-flow"];
  const path = points.map((point, index) => `${index ? "L" : "M"} ${n(point.x)} ${n(point.y)}`).join(" ");
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  return `<path class="scene-connector ${escapeAttribute(routeClass)}" d="${path}" stroke="${style.color}" stroke-width="${style.width}"${dash} marker-end="url(#arrow-${escapeAttribute(routeClass)})"/>`;
}

function renderPrimitive(primitive) {
  if (!validBounds(primitive.bounds)) return "";
  if (primitive.role !== "body") return renderDecoration(primitive);
  const bounds = primitive.bounds;
  const style = styleForPrimitive(primitive);
  const shape = renderBodyShape(primitive, bounds, style);
  const badge = primitive.blockBadge
    ? `<text class="block-badge" x="${n(bounds.x + bounds.w - 8)}" y="${n(bounds.y + 14)}">${escapeXml(primitive.blockBadge)}</text>`
    : "";
  const ports = renderPorts(primitive);
  const label = bodyLabel(primitive);
  const text = label
    ? `<text class="body-label" x="${n(bounds.x + bounds.w / 2)}" y="${n(bounds.y + bounds.h / 2)}">${escapeXml(label)}</text>`
    : "";
  return `<g class="scene-body ${escapeAttribute(primitive.blockKind || primitive.form || "operator")}">${shape}${text}${badge}${ports}</g>`;
}

function renderDecoration(primitive) {
  const labels = (primitive.labels || []).map(cleanText).filter(Boolean);
  if (!labels.length) return "";
  const bounds = primitive.bounds;
  const lineHeight = 12;
  const centerY = bounds.y + bounds.h / 2 - ((labels.length - 1) * lineHeight) / 2;
  const text = labels.map((label, index) =>
    `<text class="primitive-label" x="${n(bounds.x + bounds.w / 2)}" y="${n(centerY + index * lineHeight + 4)}">${escapeXml(label)}</text>`
  ).join("");
  return `<g class="scene-decoration">${text}</g>`;
}

function renderBodyShape(primitive, bounds, style) {
  const common = `fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"`;
  if (primitive.form === "cell" || primitive.form === "glyph") {
    return `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" rx="${n(Math.min(14, bounds.h * 0.18))}" ${common}/>`;
  }
  if (primitive.form === "volume" || primitive.form === "plane") {
    const depth = Math.min(12, bounds.w * 0.12, bounds.h * 0.2);
    return [
      `<polygon points="${n(bounds.x + depth)},${n(bounds.y)} ${n(bounds.x + bounds.w)},${n(bounds.y)} ${n(bounds.x + bounds.w - depth)},${n(bounds.y + depth)} ${n(bounds.x)},${n(bounds.y + depth)}" ${common}/>`,
      `<rect x="${n(bounds.x)}" y="${n(bounds.y + depth)}" width="${n(bounds.w - depth)}" height="${n(bounds.h - depth)}" ${common}/>`,
    ].join("");
  }
  return `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" rx="6" ${common}/>`;
}

function renderPorts(primitive) {
  if (!primitive.blockKind) return "";
  const inputs = primitive.anchors?.inputs || [];
  const outputs = primitive.anchors?.outputs || [];
  return [
    ...inputs.map((anchor) => `<circle class="block-port input" cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="3.2"/>`),
    ...outputs.map((anchor) => `<circle class="block-port output" cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="3.2"/>`),
  ].join("");
}

function styleForPrimitive(primitive) {
  if (primitive.blockKind && BLOCK_STYLES[primitive.blockKind]) return BLOCK_STYLES[primitive.blockKind];
  const role = String(primitive.styleProfile || primitive.visualRole || primitive.form || "");
  if (/input/.test(role)) return { fill: "#DCEAF4", stroke: "#52708D" };
  if (/output/.test(role)) return { fill: "#FAD9D2", stroke: "#C0432E" };
  if (/attention/.test(role)) return { fill: "#E8DDF5", stroke: "#7A4BA0" };
  if (/recurrent|state/.test(role)) return { fill: "#E8DDF5", stroke: "#70459B" };
  if (/merge/.test(role)) return { fill: "#F4D7A8", stroke: "#8B6A32" };
  if (/pool|reduce/.test(role)) return { fill: "#F4D7A8", stroke: "#C05B35" };
  if (/upsample|expand/.test(role)) return { fill: "#D8F0DE", stroke: "#3E8E5A" };
  return { fill: "#F2F4F6", stroke: "#64748B" };
}

function bodyLabel(primitive) {
  const first = (primitive.sourceNodeIds || [])[0] || "";
  const label = (primitive.labels || []).map(cleanText).find(Boolean);
  return label || first;
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

function css() {
  return [
    "text{font-family:Segoe UI,Arial,sans-serif;fill:#1F2937}",
    ".scene-title{text-anchor:middle;font-size:16px;font-weight:600}",
    ".scene-group rect{fill:#F8FAFC;stroke:#CBD5E1;stroke-dasharray:5 4;stroke-width:1.1}",
    ".scene-group text{font-size:10px;font-weight:600;fill:#475569}",
    ".body-label{text-anchor:middle;dominant-baseline:middle;font-size:10px;font-weight:600}",
    ".primitive-label{text-anchor:middle;font-size:9px}",
    ".block-badge{text-anchor:end;font-size:8px;fill:#475569}",
    ".block-port{stroke:#FFFFFF;stroke-width:1}",
    ".block-port.input{fill:#5B86A6}",
    ".block-port.output{fill:#5B9E78}",
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
