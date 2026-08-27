import { getCompoundLayout, normalizeCompoundNode } from "./compound-module.mjs";

const DEFAULT_ARTBOARD = Object.freeze({ x: 170, y: 160, width: 2260, height: 1060 });
const PALETTE = Object.freeze({
  tensor: "#00e5ff",
  convA: "#ff2aa3",
  convB: "#ff9f1c",
  patch: "#c9ff2e",
  token: "#ffe94a",
  block: "#a855ff",
  encoderA: "#2f6bff",
  encoderB: "#00e676",
  output: "#ff4fd8",
  signal: "#2846d8",
  attention: "#ff2aa3",
  skip: "#00d4aa",
});

const TYPE_PRIORITY = Object.freeze({
  token: 10,
  "patch-grid": 20,
  tensor: 30,
  conv: 40,
  pool: 50,
  "volume-stack": 60,
  concat: 70,
  flatten: 80,
  compound: 90,
  "dense-layer": 100,
  output: 110,
});

export function layoutDocumentForCanvas(document, options = {}) {
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("layoutDocumentForCanvas expects nodes and edges arrays.");
  }
  const artboard = normalizeArtboard(options.artboard);
  const sourceNodes = document.nodes.filter((node) => node && node.id).map((node, index) => normalizeInputNode(node, index));
  const stageLabels = Array.isArray(document.figure?.stages) ? document.figure.stages : [];
  const declaredStages = stageLabels.map((_, index) => index);
  const stageValues = [...new Set([...declaredStages, ...sourceNodes.map((node) => node.stage)])].sort(compareStage);
  const maxWidth = Math.max(160, ...sourceNodes.map((node) => node.footprint.w));
  const inset = Math.max(150, Math.ceil(maxWidth / 2) + 24);
  const span = Math.max(0, artboard.width - inset * 2);
  const gapX = stageValues.length > 1 ? span / (stageValues.length - 1) : 0;
  const compactWidth = gapX > 0 && gapX < maxWidth + 24;
  const columns = stageValues.map((stage, index) => ({
    stage,
    index,
    label: String(stageLabels[index] || `Stage ${index + 1}`),
    centerX: round(artboard.x + inset + gapX * index),
  }));

  const byStage = new Map(stageValues.map((stage) => [stage, []]));
  sourceNodes.forEach((node) => byStage.get(node.stage).push(node));
  const laidOutNodes = [];
  columns.forEach((column) => {
    const stageNodes = [...(byStage.get(column.stage) || [])].sort(compareInputNodes);
    const top = artboard.y + 60;
    const bottom = artboard.y + artboard.height - 60;
    const rowIndex = compactWidth ? column.index % 2 : 0;
    const rowTop = compactWidth ? top + rowIndex * Math.floor((bottom - top) / 2) : top;
    const rowBottom = compactWidth ? top + (rowIndex + 1) * Math.floor((bottom - top) / 2) : bottom;
    const totalHeight = stageNodes.reduce((sum, node) => sum + node.footprint.h, 0);
    const availableHeight = rowBottom - rowTop - totalHeight;
    const gapY = stageNodes.length > 1
      ? Math.max(24, Math.min(46, Math.floor(availableHeight / (stageNodes.length - 1))))
      : 0;
    const packedHeight = totalHeight + gapY * Math.max(0, stageNodes.length - 1);
    let cursorY = round(rowTop + Math.max(0, (rowBottom - rowTop - packedHeight) / 2));
    stageNodes.forEach((node) => {
      const outerX = round(column.centerX - node.footprint.w / 2);
      const outerY = cursorY;
      laidOutNodes.push({
        ...node.source,
        x: round(outerX - node.footprint.offsetX),
        y: round(outerY - node.footprint.offsetY),
        w: node.footprint.baseW,
        h: node.footprint.baseH,
        stage: column.index,
        stageKey: String(node.stage),
        columnX: column.centerX,
        color: node.source.color || colorForNode(node.source, column.index, columns.length),
        bwStyle: bwStyle(node.source.type),
        _layoutBounds: { x: outerX, y: outerY, w: node.footprint.w, h: node.footprint.h },
      });
      cursorY += node.footprint.h + gapY;
    });
  });

  const nodeMap = new Map(laidOutNodes.map((node) => [node.id, node]));
  const edges = layoutEdges(document.edges, nodeMap, artboard);
  const layout = {
    figure: {
      title: String(document.figure?.title || "Neural Network Architecture"),
      subtitle: String(document.figure?.subtitle || "Deterministic publication-style layout"),
      stages: columns.map((column) => column.label),
    },
    paletteName: options.paletteName || "dopamine",
    nodes: laidOutNodes.map(stripInternalBounds),
    edges,
  };
  layout.validation = validateCanvasLayout(layout, artboard, nodeMap);
  return layout;
}

function normalizeInputNode(source, index) {
  const normalized = normalizeCompoundNode({ ...source });
  const stage = Number.isFinite(normalized.stage) ? normalized.stage : index;
  const baseW = Number.isFinite(normalized.w) ? normalized.w : 160;
  const baseH = Number.isFinite(normalized.h) ? normalized.h : 110;
  const footprint = visualFootprint({ ...normalized, w: baseW, h: baseH });
  return {
    source: {
      ...normalized,
      id: String(normalized.id),
      stage,
      label: String(normalized.label || `Node ${index + 1}`),
      subtitle: String(normalized.subtitle || ""),
    },
    stage,
    footprint: { ...footprint, baseW, baseH },
  };
}

function visualFootprint(node) {
  if (node.type === "compound") {
    const compound = getCompoundLayout(node);
    return { w: compound.width, h: compound.height, offsetX: 0, offsetY: 0 };
  }
  const depth = Number(node.depth) || 0;
  let minX = 0;
  let minY = 0;
  let maxX = node.w;
  let maxY = node.h;
  if (node.type === "conv") { minY -= depth * 0.46; maxX += depth + 50; maxY += 42; }
  if (node.type === "pool") maxY += 108;
  if (node.type === "flatten" || node.type === "concat") maxY += 58;
  if (node.type === "tensor") { maxX += depth || 18; maxY += node.note ? 42 : 0; }
  if (node.type === "volume" || node.type === "volume-stack") {
    const volumeDepth = depth || 78;
    const skew = (Number(node.z) || volumeDepth * 0.62) * 0.46;
    minY -= skew;
    maxX += volumeDepth;
    maxY += node.note ? 46 : 20;
  }
  if (node.type === "patch-grid") maxY += 56;
  return { w: maxX - minX, h: maxY - minY, offsetX: minX, offsetY: minY };
}

function layoutEdges(sourceEdges, nodeMap, artboard) {
  const counts = new Map();
  const skipEdges = [];
  const edges = sourceEdges.filter((edge) => edge && nodeMap.has(edge.source) && nodeMap.has(edge.target)).map((edge, index) => {
    const key = `${edge.type || "signal"}:${edge.source}:${edge.target}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    const type = String(edge.type || "signal");
    const result = {
      ...edge,
      id: edge.id || `edge-${type}-${edge.source}-${edge.target}-${count}`,
      type,
      color: edge.color || colorForEdge(type),
    };
    if (type === "skip") skipEdges.push({ result, source: nodeMap.get(edge.source), target: nodeMap.get(edge.target) });
    return result;
  });
  skipEdges.sort((left, right) => Math.abs(right.source.stage - right.target.stage) - Math.abs(left.source.stage - left.target.stage) || left.result.id.localeCompare(right.result.id));
  const laneById = new Map(skipEdges.map((item, index) => [item.result.id, index]));
  return edges.map((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    const start = rightAnchor(source);
    const end = leftAnchor(target);
    if (edge.type === "skip") {
      const laneY = round(artboard.y + 40 + laneById.get(edge.id) * 28);
      return { ...edge, route: { kind: "skip-lane", laneIndex: laneById.get(edge.id), laneY, points: [start, { x: start.x + 22, y: laneY }, { x: end.x - 22, y: laneY }, end] } };
    }
    if (edge.type === "attention") return { ...edge, route: { kind: "direct", points: [start, end] } };
    if (Math.abs(start.y - end.y) <= 12) return { ...edge, route: { kind: "straight", points: [start, end] } };
    const midX = round(start.x + (end.x - start.x) / 2);
    return { ...edge, route: { kind: "orthogonal", points: [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end] } };
  });
}

function validateCanvasLayout(layout, artboard, nodeMap) {
  const bounds = layout.nodes.map((node) => ({ node, box: nodeMap.get(node.id)?._layoutBounds || { x: node.x, y: node.y, w: node.w, h: node.h } }));
  const overlaps = [];
  for (let left = 0; left < bounds.length; left += 1) {
    for (let right = left + 1; right < bounds.length; right += 1) {
      const a = bounds[left].box;
      const b = bounds[right].box;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push({ a: bounds[left].node.id, b: bounds[right].node.id });
    }
  }
  const boundaryViolations = bounds.flatMap(({ node, box }) => {
    const violations = [];
    if (box.x < artboard.x + 24) violations.push({ nodeId: node.id, side: "left" });
    if (box.y < artboard.y + 24) violations.push({ nodeId: node.id, side: "top" });
    if (box.x + box.w > artboard.x + artboard.width - 24) violations.push({ nodeId: node.id, side: "right" });
    if (box.y + box.h > artboard.y + artboard.height - 24) violations.push({ nodeId: node.id, side: "bottom" });
    return violations;
  });
  const invalidEdges = layout.edges.filter((edge) => !nodeMap.has(edge.source) || !nodeMap.has(edge.target) || !edge.route?.points?.length);
  const summary = {
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    stageCount: layout.figure.stages.length,
    overlapCount: overlaps.length,
    invalidEdgeCount: invalidEdges.length,
    boundaryViolationCount: boundaryViolations.length,
  };
  return {
    ok: overlaps.length === 0 && invalidEdges.length === 0 && boundaryViolations.length === 0,
    summary,
    overlaps,
    invalidEdges,
    boundaryViolations,
  };
}

function stripInternalBounds(node) {
  const { _layoutBounds, ...publicNode } = node;
  return publicNode;
}

function rightAnchor(node) { return { x: round(node._layoutBounds.x + node._layoutBounds.w), y: round(node._layoutBounds.y + node._layoutBounds.h / 2) }; }
function leftAnchor(node) { return { x: round(node._layoutBounds.x), y: round(node._layoutBounds.y + node._layoutBounds.h / 2) }; }

function colorForNode(node, stageIndex, stageCount) {
  if (node.type === "conv" || node.type === "volume-stack") return stageIndex > 1 ? PALETTE.convB : PALETTE.convA;
  if (node.type === "volume") return stageIndex >= stageCount - 2 ? PALETTE.output : PALETTE.tensor;
  if (node.type === "pool") return PALETTE.token;
  if (node.type === "flatten") return PALETTE.attention;
  if (node.type === "dense-layer") return stageIndex >= stageCount - 1 ? PALETTE.output : PALETTE.encoderA;
  if (node.type === "concat") return PALETTE.skip;
  if (node.type === "patch-grid") return PALETTE.patch;
  if (node.type === "token") return PALETTE.token;
  if (node.type === "compound") return String(node.id).includes("2") ? PALETTE.encoderB : PALETTE.encoderA;
  if (node.type === "output") return PALETTE.output;
  return PALETTE.tensor;
}

function colorForEdge(type) { return type === "skip" ? PALETTE.skip : type === "attention" ? PALETTE.attention : PALETTE.signal; }
function bwStyle(type) { return type === "compound" ? { fillPattern: "horizontal-stripe", strokePattern: "solid", tone: "dark" } : { fillPattern: "solid", strokePattern: "solid", tone: "medium" }; }
function compareInputNodes(left, right) { return (Number(left.source.order) || 1000) - (Number(right.source.order) || 1000) || (TYPE_PRIORITY[left.source.type] || 500) - (TYPE_PRIORITY[right.source.type] || 500) || left.source.label.localeCompare(right.source.label) || left.source.id.localeCompare(right.source.id); }
function compareStage(left, right) { return left - right; }
function normalizeArtboard(value) { return { ...DEFAULT_ARTBOARD, ...(value || {}) }; }
function round(value) { return Math.round(value); }
