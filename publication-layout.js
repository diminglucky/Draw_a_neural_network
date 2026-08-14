"use strict";

import { buildPublicationFigurePlan } from "./publication-figure-plan.js";

const DEFAULT_CANVAS = { width: 2600, height: 1500 };
const DEFAULT_ARTBOARD = { x: 170, y: 160, width: 2260, height: 1060 };
const PALETTE = {
  tensor: "#00e5ff", conv: "#ff2aa3", convLate: "#ff9f1c", patch: "#c9ff2e",
  token: "#ffe94a", block: "#a855ff", encoder: "#2f6bff", encoderAlt: "#00e676",
  output: "#ff4fd8", signal: "#2846d8", attention: "#ff2aa3", skip: "#00d4aa",
};

const SIZES = {
  tensor: [122, 188], conv: [80, 240], "volume-stack": [138, 230], volume: [145, 210],
  pool: [92, 92], flatten: [150, 138], "dense-layer": [132, 210], output: [110, 148],
  concat: [82, 82], "patch-grid": [184, 184], token: [148, 58], encoder: [190, 150],
  attention: [205, 140], block: [176, 128], neuron: [64, 64], default: [160, 110],
};

const BW_NODES = {
  tensor: ["solid", "solid", "light"], conv: ["diagonal-stripe", "solid", "medium"],
  "volume-stack": ["diagonal-stripe", "solid", "dark"], volume: ["solid", "solid", "medium"],
  pool: ["crosshatch", "solid", "light"], flatten: ["vertical-stripe", "solid", "medium"],
  "dense-layer": ["vertical-stripe", "solid", "dark"], output: ["solid", "double", "dark"],
  concat: ["crosshatch", "solid", "light"], "patch-grid": ["grid", "solid", "light"],
  token: ["dot", "solid", "light"], encoder: ["horizontal-stripe", "solid", "dark"],
  attention: ["horizontal-stripe", "solid", "medium"], block: ["horizontal-stripe", "solid", "medium"],
  neuron: ["solid", "solid", "medium"], default: ["solid", "solid", "medium"],
};

function layoutNetworkIR(ir, options = {}) {
  const normalized = normalizeIR(ir);
  const artboard = normalizeRect(options.artboard, DEFAULT_ARTBOARD);
  const paletteName = options.paletteName === "dopamine" ? "dopamine" : "dopamine";
  const columns = normalized.stages.map((stage, index) => ({
    ...stage, index,
    x: Math.round(artboard.x + 150 + (normalized.stages.length > 1
      ? (artboard.width - 300) * index / (normalized.stages.length - 1) : 0)),
  }));
  const byStage = new Map(columns.map((column) => [column.id, []]));
  normalized.nodes.forEach((node) => byStage.get(node.stage).push(node));
  const nodes = [];
  const top = artboard.y + 80;
  const bottom = artboard.y + artboard.height - 80;
  for (const column of columns) {
    const ordered = stableSort(byStage.get(column.id), nodeCompare);
    const heights = fitHeights(ordered.map((node) => node.h), bottom - top);
    const gap = ordered.length > 1 ? Math.min(46, Math.max(24, Math.floor((bottom - top - heights.reduce((a, b) => a + b, 0)) / (ordered.length - 1)))) : 0;
    const used = heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, ordered.length - 1);
    let y = Math.round(top + Math.max(0, (bottom - top - used) / 2));
    ordered.forEach((node, index) => {
      const h = heights[index];
      const w = Math.min(node.w, Math.max(48, Math.round(node.w * h / node.h)));
      const item = {
        ...node, stage: column.index, stageKey: column.id, columnX: column.x,
        x: Math.round(column.x - w / 2), y, w, h,
        color: node.color || nodeColor(node, column.index, columns.length),
        bwStyle: nodeBw(node.type),
      };
      nodes.push(item);
      y += h + gap;
    });
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = layoutEdges(normalized.edges, nodeMap, artboard);
  const layout = {
    figure: { title: normalized.title, subtitle: normalized.subtitle, stages: columns.map((column) => column.label) },
    paletteName, nodes: nodes.sort((a, b) => a.stage - b.stage || a.y - b.y || a.id.localeCompare(b.id)), edges,
  };
  if (isVgg16Figure(ir, normalized.title)) layout.figurePlan = buildPublicationFigurePlan(ir);
  layout.validation = validatePublicationLayout(layout, { artboard, canvas: options.canvas || DEFAULT_CANVAS });
  return layout;
}

function validatePublicationLayout(layout, options = {}) {
  const artboard = normalizeRect(options.artboard, DEFAULT_ARTBOARD);
  const margin = Number.isFinite(options.readableMargin) ? options.readableMargin : 24;
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const edges = Array.isArray(layout?.edges) ? layout.edges : [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const overlaps = [];
  for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
    const a = nodes[i]; const b = nodes[j];
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 0 && iy > 0) overlaps.push({ a: a.id, b: b.id, intersection: { x: ix, y: iy } });
  }
  const invalidEdges = []; const stageOrderIssues = []; const skipLanes = [];
  for (const edge of edges) {
    const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target);
    if (!source || !target) { invalidEdges.push({ edgeId: edge.id, source: edge.source, target: edge.target, reason: "missing-endpoint" }); continue; }
    if (edge.type !== "skip" && target.stage < source.stage) stageOrderIssues.push({ edgeId: edge.id, sourceStage: source.stage, targetStage: target.stage, reason: "backward-non-skip-edge" });
    if (edge.type === "skip") {
      const points = edge.route?.points;
      if (!Array.isArray(points) || points.length < 4) invalidEdges.push({ edgeId: edge.id, reason: "missing-skip-route" });
      else {
        const first = points[0]; const last = points[points.length - 1];
        if (first.x !== source.x + source.w || first.y !== source.y + Math.round(source.h / 2) || last.x !== target.x || last.y !== target.y + Math.round(target.h / 2)) invalidEdges.push({ edgeId: edge.id, reason: "invalid-route-endpoint" });
        if (points.some((point) => point.x < artboard.x || point.x > artboard.x + artboard.width || point.y < artboard.y || point.y > artboard.y + artboard.height)) invalidEdges.push({ edgeId: edge.id, reason: "route-out-of-bounds" });
      }
      skipLanes.push({ edgeId: edge.id, laneIndex: edge.route?.laneIndex, laneY: edge.route?.laneY, sourceStage: source.stage, targetStage: target.stage });
    }
  }
  const boundaryViolations = []; const unreadableNodes = []; const styleIssues = [];
  for (const node of nodes) {
    if (node.x < artboard.x + margin) boundaryViolations.push({ nodeId: node.id, side: "left" });
    if (node.y < artboard.y + margin) boundaryViolations.push({ nodeId: node.id, side: "top" });
    if (node.x + node.w > artboard.x + artboard.width - margin) boundaryViolations.push({ nodeId: node.id, side: "right" });
    if (node.y + node.h > artboard.y + artboard.height - margin) boundaryViolations.push({ nodeId: node.id, side: "bottom" });
    if (!String(node.label || "").trim() || !Number.isFinite(node.w) || !Number.isFinite(node.h) || node.w < 48 || node.h < 40) unreadableNodes.push({ nodeId: node.id, reason: "missing-or-small-label-box" });
    if (!node.color) styleIssues.push({ kind: "node-color", id: node.id });
    if (!validNodeBW(node.bwStyle)) styleIssues.push({ kind: "node-bw", id: node.id });
  }
  for (const edge of edges) {
    if (!edge.color) styleIssues.push({ kind: "edge-color", id: edge.id });
    if (!validEdgeBW(edge.bwStyle)) styleIssues.push({ kind: "edge-bw", id: edge.id });
  }
  const stageColumns = stageColumnsOf(nodes, layout?.figure?.stages || []);
  const summary = { nodeCount: nodes.length, edgeCount: edges.length, stageCount: stageColumns.length, overlapCount: overlaps.length, invalidEdgeCount: invalidEdges.length, boundaryViolationCount: boundaryViolations.length, stageOrderIssueCount: stageOrderIssues.length, unreadableNodeCount: unreadableNodes.length, styleIssueCount: styleIssues.length };
  return { ok: Object.values(summary).slice(3).every((count) => count === 0), summary, overlaps, invalidEdges, boundaryViolations, stageOrderIssues, unreadableNodes, styleIssues, stageColumns, skipLanes };
}

function normalizeIR(ir) {
  if (!ir || !Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) throw new Error("layoutNetworkIR expects an IR object with nodes and edges arrays.");
  const stages = Array.isArray(ir.stages) && ir.stages.length ? ir.stages.map((stage, index) => typeof stage === "string" ? { id: stage, label: stage, index } : { id: String(stage.id ?? `stage-${index}`), label: String(stage.label || stage.id || `Stage ${index + 1}`), index }) : deriveStages(ir.nodes);
  const stageIds = new Set(stages.map((stage) => stage.id));
  const nodes = ir.nodes.map((node, index) => {
    const stage = String(node.stage ?? stages[0]?.id ?? "stage-0");
    if (!stageIds.has(stage)) throw new Error(`Node ${node.id || index} references unknown stage "${stage}".`);
    const type = String(node.type || formalNodeType(node.kind));
    const [w, h] = SIZES[type] || SIZES.default;
    const visualEncoding = normalizeVisualEncoding(node.visualEncoding, node.depth, node.tensor);
    return { id: String(node.id || `node-${index + 1}`), type, stage, order: Number.isFinite(node.order) ? node.order : 1000, label: String(node.label || readableKind(node.kind) || `Node ${index + 1}`), subtitle: String(node.subtitle || tensorSubtitle(node.tensor)), w: Number.isFinite(node.w) ? Math.max(48, Math.round(node.w)) : w, h: Number.isFinite(node.h) ? Math.max(40, Math.round(node.h)) : h, visualRole: String(node.visualRole || "standard"), layerRole: String(node.layerRole || "network-node"), repeatCount: Number.isInteger(node.repeatCount) && node.repeatCount > 0 ? node.repeatCount : 1, channelCount: Number.isInteger(node.channelCount) && node.channelCount > 0 ? node.channelCount : channelCountOf(node.tensor), depth: Number.isInteger(node.depth) && node.depth > 0 ? node.depth : visualEncoding.visiblePlaneCount, perspective: node.perspective === true, visualEncoding, color: typeof node.color === "string" ? node.color : null };
  });
  const edges = ir.edges.map((edge, index) => ({ source: String(edge.source || ""), target: String(edge.target || ""), type: formalEdgeType(edge), label: String(edge.label || edge.kind || ""), order: Number.isFinite(edge.order) ? edge.order : index }));
  return { title: String(ir.title || ir.figure?.title || "Neural Network Architecture"), subtitle: String(ir.subtitle || ir.figure?.description || "Deterministic publication-style layout"), stages, nodes, edges };
}

function deriveStages(nodes) {
  const ids = [...new Set(nodes.map((node) => String(node.stage ?? "stage-0")))];
  const numeric = ids.every((id) => /^\d+$/.test(id));
  if (numeric) ids.sort((a, b) => Number(a) - Number(b));
  return ids.map((id, index) => ({ id, label: numeric ? `Stage ${Number(id) + 1}` : id, index }));
}
function formalNodeType(kind) {
  return ({ input: "tensor", output: "output", conv: "conv", "depthwise-conv": "conv", pool: "pool", upsample: "volume", normalization: "block", activation: "block", residual: "block", concat: "concat", add: "concat", flatten: "flatten", dense: "dense-layer", classifier: "dense-layer", attention: "attention", "transformer-block": "encoder", embedding: "flatten", token: "token", "feature-map": "volume", volume: "volume-stack", loss: "output" })[kind] || "default";
}
function formalEdgeType(edge) { return edge.skip === true || edge.kind === "skip" ? "skip" : edge.kind === "attention" ? "attention" : String(edge.type || "signal"); }
function readableKind(kind) { return typeof kind === "string" && kind ? kind.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) : ""; }
function tensorSubtitle(tensor) { return tensor && tensor.shape != null ? Array.isArray(tensor.shape) ? tensor.shape.join(" x ") : String(tensor.shape) : ""; }
function channelCountOf(tensor) { const shape = tensor?.shape; const channel = Array.isArray(shape) ? shape.at(-1) : null; return Number.isInteger(channel) && channel > 0 ? channel : null; }
function normalizeVisualEncoding(value, legacyDepth, tensor) {
  const spatialShape = Array.isArray(value?.spatialShape) && value.spatialShape.length >= 2
    ? value.spatialShape.slice(0, 3)
    : Array.isArray(tensor?.shape) ? tensor.shape.slice(0, Math.min(3, tensor.shape.length)).filter(Number.isInteger) : [];
  return {
    visiblePlaneCount: Number.isInteger(value?.visiblePlaneCount) && value.visiblePlaneCount > 0 ? value.visiblePlaneCount : Number.isInteger(legacyDepth) && legacyDepth > 0 ? legacyDepth : 1,
    extrusionDepthFu: Number.isInteger(value?.extrusionDepthFu) && value.extrusionDepthFu >= 0 ? value.extrusionDepthFu : 0,
    projection: value?.projection === "oblique-3d" ? "oblique-3d" : "flat",
    spatialShape,
  };
}
function fitHeights(heights, available) { const total = heights.reduce((a, b) => a + b, 0); if (total <= available) return heights; const gapBudget = Math.max(0, available - 24 * Math.max(0, heights.length - 1)); const each = Math.max(40, Math.floor(gapBudget / Math.max(1, heights.length))); return heights.map(() => each); }
function layoutEdges(edges, nodeMap, artboard) {
  const counts = new Map(); const skips = [];
  const laid = edges.map((edge) => { const key = `${edge.type}:${edge.source}:${edge.target}:${edge.label}`; const count = (counts.get(key) || 0) + 1; counts.set(key, count); const id = `edge-${edge.type}-${edge.source}-${edge.target}${count > 1 ? `-${count}` : ""}`; const item = { id, source: edge.source, target: edge.target, type: edge.type, label: edge.label, color: edge.type === "skip" ? PALETTE.skip : edge.type === "attention" ? PALETTE.attention : PALETTE.signal, bwStyle: edge.type === "skip" ? { linePattern: "dash-dot", weight: "medium" } : edge.type === "attention" ? { linePattern: "dash", weight: "medium" } : { linePattern: "solid", weight: "medium" } }; if (edge.type === "skip" && nodeMap.has(edge.source) && nodeMap.has(edge.target)) skips.push({ item, source: nodeMap.get(edge.source), target: nodeMap.get(edge.target) }); return item; });
  stableSort(skips, (a, b) => Math.abs(b.target.stage - b.source.stage) - Math.abs(a.target.stage - a.source.stage) || a.source.id.localeCompare(b.source.id) || a.target.id.localeCompare(b.target.id)).forEach(({ item, source, target }, laneIndex) => { const y = artboard.y + 32 + laneIndex * 24; item.route = { kind: "skip-lane", laneIndex, laneY: y, points: [{ x: source.x + source.w, y: source.y + Math.round(source.h / 2) }, { x: source.x + source.w + 22, y }, { x: target.x - 22, y }, { x: target.x, y: target.y + Math.round(target.h / 2) }] }; });
  return laid.sort((a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
function nodeColor(node, stage, count) { if (node.type === "conv") return stage > 1 ? PALETTE.convLate : PALETTE.conv; if (node.type === "patch-grid") return PALETTE.patch; if (node.type === "token" || node.type === "pool") return PALETTE.token; if (node.type === "encoder") return String(node.id).includes("2") ? PALETTE.encoderAlt : PALETTE.encoder; if (["output", "dense-layer"].includes(node.type) && stage >= count - 1) return PALETTE.output; if (["attention", "block", "flatten"].includes(node.type)) return node.type === "flatten" ? PALETTE.attention : PALETTE.block; if (node.type === "concat") return PALETTE.skip; return node.type === "volume-stack" ? PALETTE.encoder : PALETTE.tensor; }
function nodeBw(type) { const [fillPattern, strokePattern, tone] = BW_NODES[type] || BW_NODES.default; return { fillPattern, strokePattern, tone }; }
function stageColumnsOf(nodes, labels) { const map = new Map(); nodes.forEach((node) => { if (!map.has(node.stage)) map.set(node.stage, { index: node.stage, label: labels[node.stage] || node.stageKey || String(node.stage), x: node.columnX ?? node.x + node.w / 2, nodeIds: [] }); map.get(node.stage).nodeIds.push(node.id); }); return [...map.values()].sort((a, b) => a.index - b.index).map((column) => ({ ...column, nodeIds: column.nodeIds.sort() })); }
function stableSort(items, compare) { return [...items].sort(compare); }
function nodeCompare(a, b) { return a.order - b.order || typePriority(a.type) - typePriority(b.type) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id); }
function typePriority(type) { return ({ token: 10, "patch-grid": 20, tensor: 30, conv: 40, pool: 50, "volume-stack": 60, concat: 70, flatten: 80, encoder: 90, "dense-layer": 100, output: 110 })[type] ?? 500; }
function validNodeBW(style) { return Boolean(style && typeof style.fillPattern === "string" && typeof style.strokePattern === "string" && typeof style.tone === "string"); }
function validEdgeBW(style) { return Boolean(style && typeof style.linePattern === "string" && typeof style.weight === "string"); }
function normalizeRect(value, fallback) { return { x: Number.isFinite(value?.x) ? value.x : fallback.x, y: Number.isFinite(value?.y) ? value.y : fallback.y, width: Number.isFinite(value?.width) ? value.width : fallback.width, height: Number.isFinite(value?.height) ? value.height : fallback.height }; }
function isVgg16Figure(ir, title) { return String(ir?.figure?.id || "").toLowerCase() === "vgg16" || /^vgg16\b/i.test(String(title)); }

export { layoutNetworkIR, validatePublicationLayout };
