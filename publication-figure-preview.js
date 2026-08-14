const PRIMITIVE_KINDS = new Set([
  "semantic_region",
  "tensor_volume",
  "block_frame",
  "flow_arrow",
  "residual_skip",
  "merge_marker",
  "annotation_track",
]);
const RELATION_KINDS = new Set(["flow_arrow", "residual_skip", "merge_marker"]);

export function renderPublicationFigurePreview(preview) {
  const plan = preview?.plan;
  const page = pageDimensions(plan);
  const regions = array(plan?.regions, "regions");
  const primitives = array(plan?.primitives, "primitives");
  const relations = array(plan?.relations, "relations");
  const annotations = array(plan?.annotations, "annotations");

  primitives.forEach(validatePrimitive);
  relations.forEach(validateRelation);
  regions.forEach((region) => validateBounds(region?.bounds, "region"));
  annotations.forEach((annotation) => validateBounds(annotation?.bounds, "annotation"));

  const printMode = plan?.renderIntent?.printMode === "grayscale" ? "grayscale" : "color";
  return `<svg class="publication-figure-svg publication-figure-svg--${printMode}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Publication figure preview" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="xMidYMid meet"><defs><marker id="publication-figure-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="publication-figure-arrow-head"/></marker><linearGradient id="publication-figure-tensor-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b80df"/><stop offset="1" stop-color="#16345f"/></linearGradient></defs><rect class="publication-figure-page" x="0" y="0" width="${page.width}" height="${page.height}"/>${regions.map(renderRegion).join("")}${relations.map(renderRelation).join("")}${primitives.map(renderPrimitive).join("")}${annotations.map(renderAnnotation).join("")}</svg>`;
}

export function previewSummary(preview) {
  const grammar = preview?.grammar;
  const qa = preview?.qa;
  return {
    grammar: `${text(grammar?.id || "unknown")} v${positiveInteger(grammar?.version, "grammar version")}`,
    status: text(preview?.draft?.status || "unknown"),
    warnings: array(qa?.warnings ?? [], "qa warnings").map((issue) => text(issue?.message || issue?.code || "Visual QA warning")),
    blocking: array(qa?.blocking ?? [], "qa blocking").map((issue) => text(issue?.message || issue?.code || "Visual QA issue")),
  };
}

function renderRegion(region) {
  const bounds = validateBounds(region.bounds, "region");
  return `<g class="publication-figure-region"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="16"/><text x="${bounds.x + 16}" y="${bounds.y + 24}" class="publication-figure-region-label">${escapeHtml(text(region.label || "Region"))}</text></g>`;
}

function renderPrimitive(primitive) {
  const bounds = validateBounds(primitive.bounds, "primitive");
  if (primitive.kind === "semantic_region") return `<rect class="publication-figure-semantic-region" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="12"/>`;
  if (primitive.kind === "tensor_volume") return renderTensor(bounds);
  if (primitive.kind === "block_frame") return `<g class="publication-figure-block"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="10"/><path d="M ${bounds.x + 12} ${bounds.y + 12} H ${bounds.x + bounds.width - 12}"/></g>`;
  if (primitive.kind === "flow_arrow") return `<path class="publication-figure-flow-primitive" d="M ${bounds.x} ${bounds.y + bounds.height / 2} H ${bounds.x + bounds.width}" marker-end="url(#publication-figure-arrow)"/>`;
  if (primitive.kind === "residual_skip") return `<path class="publication-figure-residual" d="M ${bounds.x} ${bounds.y + bounds.height} V ${bounds.y} H ${bounds.x + bounds.width} V ${bounds.y + bounds.height}" marker-end="url(#publication-figure-arrow)"/>`;
  if (primitive.kind === "merge_marker") return `<path class="publication-figure-merge" d="M ${bounds.x + bounds.width / 2} ${bounds.y} L ${bounds.x + bounds.width} ${bounds.y + bounds.height / 2} L ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height} L ${bounds.x} ${bounds.y + bounds.height / 2} Z"/>`;
  return `<rect class="publication-figure-annotation-track" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8"/>`;
}

function renderTensor(bounds) {
  const depth = Math.max(8, Math.min(24, bounds.width * 0.16));
  return `<g class="publication-figure-tensor"><path d="M ${bounds.x} ${bounds.y + depth} L ${bounds.x + depth} ${bounds.y} H ${bounds.x + bounds.width} L ${bounds.x + bounds.width - depth} ${bounds.y + depth} Z"/><rect x="${bounds.x}" y="${bounds.y + depth}" width="${bounds.width - depth}" height="${bounds.height - depth}" rx="5"/><path d="M ${bounds.x + bounds.width - depth} ${bounds.y + depth} L ${bounds.x + bounds.width} ${bounds.y} V ${bounds.y + bounds.height - depth} L ${bounds.x + bounds.width - depth} ${bounds.y + bounds.height} Z"/></g>`;
}

function renderRelation(relation) {
  const route = array(relation.route, "relation route");
  if (route.length < 2) throw new Error("Publication figure relation route requires at least two points");
  const points = route.map((point) => `${finite(point?.x, "relation x")} ${finite(point?.y, "relation y")}`);
  const style = relation.style ?? {};
  const dash = relation.kind === "residual_skip" || style.stroke === "dashed" ? ' stroke-dasharray="8 6"' : style.stroke === "dotted" ? ' stroke-dasharray="2 6"' : "";
  const tone = style.tone === "light" ? " light" : style.tone === "mid" ? " mid" : "";
  const thickness = Math.min(12, Math.max(0.5, Number.isFinite(style.thickness) ? style.thickness : 1));
  return `<path class="publication-figure-relation${tone}" d="M ${points.join(" L ")}" fill="none" stroke-width="${thickness}"${dash} marker-end="url(#publication-figure-arrow)"/>`;
}

function renderAnnotation(annotation) {
  const bounds = validateBounds(annotation.bounds, "annotation");
  const fontSize = Math.min(72, Math.max(1, Number.isFinite(annotation.fontSizePt) ? annotation.fontSizePt : 9));
  return `<text class="publication-figure-annotation" x="${bounds.x}" y="${bounds.y + Math.min(bounds.height, fontSize)}" font-size="${fontSize}">${escapeHtml(text(annotation.text || ""))}</text>`;
}

function validatePrimitive(primitive) {
  if (!PRIMITIVE_KINDS.has(primitive?.kind)) throw new Error(`Unsupported publication figure primitive: ${text(primitive?.kind || "unknown")}`);
  validateBounds(primitive.bounds, "primitive");
}

function validateRelation(relation) {
  if (!RELATION_KINDS.has(relation?.kind)) throw new Error(`Unsupported publication figure relation: ${text(relation?.kind || "unknown")}`);
  array(relation.route, "relation route").forEach((point) => { finite(point?.x, "relation x"); finite(point?.y, "relation y"); });
}

function pageDimensions(plan) {
  const coordinateSpace = plan?.coordinateSpace;
  return { width: finite(coordinateSpace?.width, "preview width"), height: finite(coordinateSpace?.height, "preview height") };
}

function validateBounds(bounds, label) {
  return {
    x: finite(bounds?.x, `${label} x`, true),
    y: finite(bounds?.y, `${label} y`, true),
    width: finite(bounds?.width, `${label} width`),
    height: finite(bounds?.height, `${label} height`),
  };
}

function finite(value, label, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`Publication figure ${label} must be finite${allowZero ? " and non-negative" : " and positive"}`);
  return Number(value);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Publication figure ${label} must be a positive integer`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`Publication figure ${label} must be an array`);
  return value;
}

function text(value) { return String(value ?? "").trim(); }
function escapeHtml(value) { return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
