export const PUBLICATION_PRIMITIVE_VERSION = "publication-primitive/v1";

export function createTensorBoxPrimitive(options = {}) {
  const geometry = tensorGeometry(options);
  const metadata = primitiveMetadata(options, "tensor-box", geometry);
  return {
    ...metadata,
    faces: {
      front: rectangle(geometry.x, geometry.y, geometry.w, geometry.h),
      top: quad(
        [geometry.x, geometry.y],
        [geometry.x + geometry.dx, geometry.y + geometry.dy],
        [geometry.x + geometry.w + geometry.dx, geometry.y + geometry.dy],
        [geometry.x + geometry.w, geometry.y],
      ),
      side: quad(
        [geometry.x + geometry.w, geometry.y],
        [geometry.x + geometry.w + geometry.dx, geometry.y + geometry.dy],
        [geometry.x + geometry.w + geometry.dx, geometry.y + geometry.h + geometry.dy],
        [geometry.x + geometry.w, geometry.y + geometry.h],
      ),
    },
    anchors: tensorAnchors(geometry),
  };
}

export function createRightBandedTensorPrimitive(options = {}) {
  const base = createTensorBoxPrimitive(options);
  const bandRatio = clamp(Number(options.bandRatio) || 1 / 3, 0.18, 0.5);
  const bandX = base.geometry.x + base.geometry.w * (1 - bandRatio);
  const bandDx = base.geometry.dx;
  const bandDy = base.geometry.dy;
  return {
    ...base,
    kind: "right-banded-tensor",
    band: {
      ratio: bandRatio,
      front: rectangle(bandX, base.geometry.y, base.geometry.w * bandRatio, base.geometry.h),
      top: quad(
        [bandX, base.geometry.y],
        [bandX + bandDx, base.geometry.y + bandDy],
        [base.geometry.x + base.geometry.w + bandDx, base.geometry.y + bandDy],
        [base.geometry.x + base.geometry.w, base.geometry.y],
      ),
      side: quad(
        [base.geometry.x + base.geometry.w, base.geometry.y],
        [base.geometry.x + base.geometry.w + bandDx, base.geometry.y + bandDy],
        [base.geometry.x + base.geometry.w + bandDx, base.geometry.y + base.geometry.h + bandDy],
        [base.geometry.x + base.geometry.w, base.geometry.y + base.geometry.h],
      ),
    },
  };
}

export function createDenseLayerPrimitive(options = {}) {
  const layers = (Array.isArray(options.layers) ? options.layers : []).map((value) => Math.max(0, Math.floor(Number(value) || 0)));
  const x = finite(options.x, 0);
  const y = finite(options.y, 0);
  const nodeRadius = finite(options.nodeRadius, 12);
  const nodeGap = finite(options.nodeGap, 20);
  const layerGap = finite(options.layerGap, 160);
  const largest = Math.max(1, ...layers);
  const nodes = [];
  const links = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const count = layers[layerIndex];
    const columnHeight = count > 0 ? (count - 1) * (nodeRadius * 2 + nodeGap) : 0;
    const startY = y - columnHeight / 2;
    for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
      nodes.push({
        id: `l${layerIndex + 1}-n${nodeIndex + 1}`,
        layerIndex,
        nodeIndex,
        x: x + layerIndex * layerGap,
        y: startY + nodeIndex * (nodeRadius * 2 + nodeGap),
        r: nodeRadius,
      });
    }
  }
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const from = nodes.filter((node) => node.layerIndex === layerIndex);
    const to = nodes.filter((node) => node.layerIndex === layerIndex + 1);
    for (const source of from) {
      for (const target of to) {
        links.push({
          id: `${source.id}->${target.id}`,
          source: source.id,
          target: target.id,
          points: [[source.x + source.r, source.y], [target.x - target.r, target.y]],
        });
      }
    }
  }
  return {
    version: PUBLICATION_PRIMITIVE_VERSION,
    kind: "dense-layer",
    id: String(options.id || "dense-layer"),
    sourceNodeIds: normalizeSourceNodeIds(options),
    geometry: { x, y, widestLayerNodes: largest, layerGap, nodeGap, nodeRadius },
    bounds: boundsOfDenseNodes(nodes),
    anchors: anchorsFromBounds(boundsOfDenseNodes(nodes)),
    layers,
    layerLabels: layers.map((count, layerIndex) => ({
      layerIndex,
      count,
      x: x + layerIndex * layerGap,
      y: y + (Math.max(1, count) - 1) * (nodeRadius * 2 + nodeGap) / 2 + nodeRadius + nodeGap * 0.45,
      text: count > 0 ? String(count) : "?",
    })),
    labels: {
      caption: String(options.caption || ""),
    },
    nodes,
    links,
    style: normalizeStyle(options),
    evidence: cloneEvidence(options.evidence),
  };
}

export function createLayerStackPrimitive(options = {}) {
  const count = Math.max(1, Math.floor(Number(options.count) || 1));
  const x = finite(options.x, 0);
  const y = finite(options.y, 0);
  const h = positive(options.h, 80);
  const cellWidth = finite(options.cellWidth, finite(options.w, 48));
  const gap = finite(options.gap, 6);
  const banded = String(options.cellKind || options.cellMode || "").toLowerCase().includes("band");
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const createCell = banded ? createRightBandedTensorPrimitive : createTensorBoxPrimitive;
    cells.push(createCell({
      ...options,
      id: `${options.id || "layer-stack"}-${index + 1}`,
      x: x + index * (cellWidth + gap),
      y,
      w: cellWidth,
    }));
  }
  const bounds = boundsOfCells(cells);
  const totalFrontWidth = count * cellWidth + Math.max(0, count - 1) * gap;
  const backing = createTensorBoxPrimitive({
    ...options,
    id: `${options.id || "layer-stack"}:backing`,
    sourceNodeIds: normalizeSourceNodeIds(options),
    x,
    y: y + finite(options.backingOffsetY, 0),
    w: totalFrontWidth,
    h,
    depth: finite(options.backingDepth, finite(options.depth, 36) * 0.85),
    caption: "",
    xLabel: "",
    yLabel: "",
    zLabel: "",
    fill: String(options.backingFill || options.bandFill || "#D96543"),
    bandFill: String(options.backingFill || options.bandFill || "#D96543"),
    opacity: finite(options.backingOpacity, 0.92),
  });
  return {
    version: PUBLICATION_PRIMITIVE_VERSION,
    kind: "layer-stack",
    id: String(options.id || "layer-stack"),
    sourceNodeIds: normalizeSourceNodeIds(options),
    count,
    gap,
    cellWidth,
    bounds,
    anchors: anchorsFromBounds(bounds),
    backing,
    labels: {
      caption: String(options.caption || ""),
    },
    cells,
    style: normalizeStyle(options),
    evidence: cloneEvidence(options.evidence),
  };
}

export function createGroupBoxPrimitive(options = {}) {
  const x = finite(options.x, 0);
  const y = finite(options.y, 0);
  const w = positive(options.w, 1);
  const h = positive(options.h, 1);
  return {
    version: PUBLICATION_PRIMITIVE_VERSION,
    kind: "group-box",
    id: String(options.id || "group"),
    sourceNodeIds: normalizeSourceNodeIds(options),
    label: String(options.label || options.id || "Group"),
    bounds: { x, y, w, h },
    childIds: Array.isArray(options.childIds) ? options.childIds.map(String) : [],
    style: normalizeStyle(options),
    evidence: cloneEvidence(options.evidence),
  };
}

export function createAnchorConnectorPrimitive(options = {}) {
  const sourceAnchor = normalizePoint(options.sourceAnchor);
  const targetAnchor = normalizePoint(options.targetAnchor);
  const points = Array.isArray(options.points) && options.points.length
    ? options.points.map(normalizePoint)
    : [sourceAnchor, targetAnchor];
  return {
    version: PUBLICATION_PRIMITIVE_VERSION,
    kind: "anchor-connector",
    id: String(options.id || "connector"),
    sourceNodeIds: normalizeSourceNodeIds(options),
    sourcePrimitiveId: String(options.sourcePrimitiveId || ""),
    targetPrimitiveId: String(options.targetPrimitiveId || ""),
    sourceAnchorId: String(options.sourceAnchorId || "east"),
    targetAnchorId: String(options.targetAnchorId || "west"),
    routeClass: String(options.routeClass || "main-flow"),
    points,
    style: normalizeStyle(options),
    evidence: cloneEvidence(options.evidence),
  };
}

export function validatePublicationPrimitive(primitive = {}) {
  const issues = [];
  if (primitive.version !== PUBLICATION_PRIMITIVE_VERSION) issues.push({ code: "invalid-publication-primitive-version", value: primitive.version });
  if (!String(primitive.id || "").trim()) issues.push({ code: "missing-publication-primitive-id" });
  if (primitive.kind === "tensor-box" || primitive.kind === "right-banded-tensor") {
    if (!finite(primitive.geometry?.w, 0) || !finite(primitive.geometry?.h, 0) || !finite(primitive.geometry?.depth, 0)) {
      issues.push({ code: "invalid-tensor-box-geometry", primitiveId: primitive.id });
    }
    for (const [name, polygon] of Object.entries(primitive.faces || {})) {
      if (!Array.isArray(polygon) || polygon.length < 3) issues.push({ code: "invalid-tensor-box-face", primitiveId: primitive.id, face: name });
    }
  }
  if (primitive.kind === "dense-layer") {
    if (!Array.isArray(primitive.nodes) || !Array.isArray(primitive.links)) issues.push({ code: "invalid-dense-layer-index", primitiveId: primitive.id });
  }
  return { ok: issues.length === 0, issues };
}

function tensorGeometry(options) {
  const w = positive(options.w, 120);
  const h = positive(options.h, 80);
  const depth = positive(options.depth, Math.min(w, h) * 0.35);
  return {
    x: finite(options.x, 0),
    y: finite(options.y, 0),
    w,
    h,
    depth,
    dx: depth * 0.58,
    dy: -depth * 0.42,
  };
}

function tensorAnchors(geometry) {
  return {
    west: { x: geometry.x, y: geometry.y + geometry.h / 2 },
    east: { x: geometry.x + geometry.w, y: geometry.y + geometry.h / 2 },
    north: { x: geometry.x + geometry.w / 2, y: geometry.y },
    south: { x: geometry.x + geometry.w / 2, y: geometry.y + geometry.h },
    near: { x: geometry.x + geometry.w / 2, y: geometry.y + geometry.h / 2 },
    far: { x: geometry.x + geometry.w / 2 + geometry.dx, y: geometry.y + geometry.h / 2 + geometry.dy },
    northeast: { x: geometry.x + geometry.w, y: geometry.y },
    southeast: { x: geometry.x + geometry.w, y: geometry.y + geometry.h },
    northwest: { x: geometry.x, y: geometry.y },
    southwest: { x: geometry.x, y: geometry.y + geometry.h },
  };
}

function primitiveMetadata(options, kind, geometry) {
  return {
    version: PUBLICATION_PRIMITIVE_VERSION,
    kind,
    id: String(options.id || kind),
    sourceNodeIds: normalizeSourceNodeIds(options),
    geometry,
    labels: {
      x: String(options.xLabel || ""),
      y: String(options.yLabel || ""),
      z: String(options.zLabel || ""),
      caption: String(options.caption || ""),
    },
    style: normalizeStyle(options),
    evidence: cloneEvidence(options.evidence),
  };
}

function normalizeStyle(options) {
  return {
    fill: String(options.fill || "#F5E1D2"),
    bandFill: String(options.bandFill || "#D97656"),
    stroke: String(options.stroke || "#445668"),
    opacity: clamp(Number(options.opacity) || 0.72, 0, 1),
    bandOpacity: clamp(Number(options.bandOpacity) || 0.78, 0, 1),
  };
}

function rectangle(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function quad(...points) {
  return points.map(normalizePoint);
}

function normalizePoint(value) {
  if (Array.isArray(value)) return [finite(value[0], 0), finite(value[1], 0)];
  return [finite(value?.x, 0), finite(value?.y, 0)];
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneEvidence(value) {
  return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
}

function normalizeSourceNodeIds(options = {}) {
  const values = Array.isArray(options.sourceNodeIds) ? options.sourceNodeIds : [];
  const normalized = values.map(String).filter(Boolean);
  if (normalized.length) return [...new Set(normalized)];
  return [String(options.sourceNodeId || options.id || "")].filter(Boolean);
}

function boundsOfDenseNodes(nodes = []) {
  const boxes = nodes.map((node) => ({
    x: Number(node.x) - Number(node.r),
    y: Number(node.y) - Number(node.r),
    w: Number(node.r) * 2,
    h: Number(node.r) * 2,
  })).filter((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite));
  return boundsOfBoxes(boxes);
}

function boundsOfCells(cells = []) {
  const points = cells.flatMap((cell) => Object.values(cell.faces || {}).flat());
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = points.map((point) => Number(point[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function boundsOfBoxes(boxes = []) {
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function anchorsFromBounds(bounds = {}) {
  const x = Number(bounds.x) || 0;
  const y = Number(bounds.y) || 0;
  const w = Math.max(1, Number(bounds.w) || 1);
  const h = Math.max(1, Number(bounds.h) || 1);
  return {
    west: { x, y: y + h / 2 },
    east: { x: x + w, y: y + h / 2 },
    north: { x: x + w / 2, y },
    south: { x: x + w / 2, y: y + h },
    center: { x: x + w / 2, y: y + h / 2 },
  };
}
