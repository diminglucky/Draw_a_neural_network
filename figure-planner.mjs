import { buildCanonicalModelGraph, CANONICAL_MODEL_GRAPH_VERSION } from "./canonical-model-graph.mjs";
import { createNeuralFigureProgram } from "./neural-figure-dsl.mjs";
import { deriveNeuralMotifs } from "./neural-motifs.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";

export const NEURAL_FIGURE_PLANNER_VERSION = "neural-figure-planner/v1";

const DEFAULT_NODE_WIDTH = 156;
const DEFAULT_NODE_HEIGHT = 104;
const DEFAULT_DEPTH = 32;
const COLUMN_GAP = 198;
const ROW_GAP = 56;
const MARGIN = 96;
const GROUP_PADDING = 38;
const GROUP_TITLE_BAND = 48;

export function planNeuralFigure(input = {}, options = {}) {
  const canonicalModel = input?.version === CANONICAL_MODEL_GRAPH_VERSION ? input : buildCanonicalModelGraph(input);
  const facts = options.facts || deriveNeuralSemanticFacts(canonicalModel);
  const motifs = options.motifs || deriveNeuralMotifs(canonicalModel.ir, facts);
  const layout = planGraphColumns(canonicalModel, facts, options);
  const primitiveEntries = [];
  const primitiveByNodeId = new Map();

  for (const placed of layout.nodes) {
    const entry = primitiveForNode(placed, options);
    primitiveEntries.push(entry);
    primitiveByNodeId.set(placed.node.canonicalId, entry);
  }

  const connectors = (canonicalModel.edges || []).map((edge) => connectorForEdge(edge, primitiveByNodeId, facts, options));
  const groups = groupsForCanonicalModel(canonicalModel, primitiveByNodeId, options);
  const program = createNeuralFigureProgram({
    title: String(options.title || canonicalModel.ir?.figure?.title || "Neural Network Architecture"),
    direction: String(options.direction || "left-to-right"),
    primitives: primitiveEntries,
    connectors,
    groups,
    constraints: [
      { kind: "stable-layer-order", direction: "left-to-right" },
      { kind: "labels-outside-shapes" },
      { kind: "route-classes", classes: ["main-flow", "bypass", "state", "conditional", "cross-scale"] },
    ],
    styleTokens: {
      visualLanguage: "publication-primitives",
      source: "canonical-model-graph",
      ...(options.styleTokens || {}),
    },
    diagnostics: [
      {
        code: "planner-summary",
        severity: "info",
        primitiveCount: primitiveEntries.length,
        connectorCount: connectors.length,
        groupCount: groups.length,
        motifCount: motifs.motifs?.length || 0,
      },
    ],
  });
  program.plannerVersion = NEURAL_FIGURE_PLANNER_VERSION;
  program.sourceGraphVersion = canonicalModel.version;
  program.sourceCanonicalModel = {
    nodeCount: canonicalModel.nodes?.length || 0,
    edgeCount: canonicalModel.edges?.length || 0,
  };
  return program;
}

export function validateNeuralFigurePlan(plan = {}, canonicalModel = null) {
  const issues = [];
  if (plan.plannerVersion !== NEURAL_FIGURE_PLANNER_VERSION) {
    issues.push({ code: "invalid-neural-figure-planner-version", value: plan.plannerVersion });
  }
  if (canonicalModel?.version === CANONICAL_MODEL_GRAPH_VERSION) {
    const plannedNodeIds = new Set((plan.primitives || []).flatMap((primitive) => primitive.sourceNodeIds || []).map(String));
    for (const node of canonicalModel.nodes || []) {
      if (!plannedNodeIds.has(String(node.canonicalId))) {
        issues.push({ code: "missing-planned-node", nodeId: node.canonicalId });
      }
    }
    const plannedEdgeIds = new Set((plan.connectors || []).map((connector) => String(connector.sourceEdgeId || connector.id || "")));
    for (const edge of canonicalModel.edges || []) {
      if (!plannedEdgeIds.has(String(edge.id))) {
        issues.push({ code: "missing-planned-edge", edgeId: edge.id });
      }
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      primitiveCount: plan.primitives?.length || 0,
      connectorCount: plan.connectors?.length || 0,
      groupCount: plan.groups?.length || 0,
    },
  };
}

function planGraphColumns(canonicalModel, facts, options) {
  const nodes = canonicalModel.nodes || [];
  const edges = (canonicalModel.edges || []).filter((edge) => String(edge.canonicalSource) !== String(edge.canonicalTarget));
  const rankByNodeId = computeRanks(nodes, edges);
  const yOffsets = scaleYOffsets(nodes, rankByNodeId, facts, options);
  const sizeByNodeId = new Map();
  for (const node of nodes) {
    sizeByNodeId.set(node.canonicalId, sizeForNode(node, facts));
  }
  const rankGroups = new Map();
  for (const node of nodes) {
    const rank = rankByNodeId.get(node.canonicalId) || 0;
    if (!rankGroups.has(rank)) rankGroups.set(rank, []);
    rankGroups.get(rank).push(node);
  }
  const maxWidthByRank = new Map();
  for (const [rank, rankNodes] of rankGroups) {
    maxWidthByRank.set(rank, Math.max(...rankNodes.map((node) => sizeByNodeId.get(node.canonicalId).w)));
  }
  const columnX = new Map();
  let x = MARGIN;
  for (const rank of [...rankGroups.keys()].sort((left, right) => left - right)) {
    columnX.set(rank, x);
    x += (maxWidthByRank.get(rank) || DEFAULT_NODE_WIDTH) + finite(options.columnGap, COLUMN_GAP);
  }
  const placedNodes = [];
  for (const rank of [...rankGroups.keys()].sort((left, right) => left - right)) {
    const rankNodes = [...rankGroups.get(rank)].sort((left, right) => left.sourceOrder - right.sourceOrder || left.canonicalId.localeCompare(right.canonicalId));
    const sizes = rankNodes.map((node) => sizeByNodeId.get(node.canonicalId));
    const totalHeight = sizes.reduce((sum, size) => sum + size.h, 0) + Math.max(0, rankNodes.length - 1) * finite(options.rowGap, ROW_GAP);
    let cursorY = -totalHeight / 2;
    for (const [index, node] of rankNodes.entries()) {
      const size = sizeByNodeId.get(node.canonicalId);
      placedNodes.push({
        node,
        x: columnX.get(rank),
        y: cursorY + (yOffsets.get(node.canonicalId) || 0),
        w: size.w,
        h: size.h,
        depth: size.depth,
        rank,
      });
      cursorY += size.h + finite(options.rowGap, ROW_GAP);
    }
  }
  return { nodes: placedNodes, rankByNodeId, columnX };
}

function scaleYOffsets(nodes, rankByNodeId, facts, options) {
  const result = new Map(nodes.map((node) => [String(node.canonicalId), 0]));
  const reduceNodes = nodes
    .filter((node) => isReduceNode(node, facts))
    .sort((left, right) => (rankByNodeId.get(left.canonicalId) || 0) - (rankByNodeId.get(right.canonicalId) || 0));
  const expandNodes = nodes
    .filter((node) => isExpandNode(node, facts))
    .sort((left, right) => (rankByNodeId.get(left.canonicalId) || 0) - (rankByNodeId.get(right.canonicalId) || 0));
  const firstReduce = reduceNodes[0];
  const lastExpand = expandNodes.at(-1);
  if (!firstReduce || !lastExpand) return result;
  const reduceRank = rankByNodeId.get(firstReduce.canonicalId) || 0;
  const expandRank = rankByNodeId.get(lastExpand.canonicalId) || 0;
  if (expandRank <= reduceRank) return result;
  const drop = finite(options.encoderDecoderDrop, 150);
  for (const node of nodes) {
    const rank = rankByNodeId.get(node.canonicalId) || 0;
    if (rank <= reduceRank || rank >= expandRank) continue;
    const t = (rank - reduceRank) / Math.max(1, expandRank - reduceRank);
    result.set(node.canonicalId, Math.sin(Math.PI * t) * drop);
  }
  return result;
}

function isReduceNode(node, facts) {
  const effect = facts?.nodeFacts?.[node.canonicalId]?.operationEffect?.value;
  return effect === "reduce" || String(node.family || "") === "pool";
}

function isExpandNode(node, facts) {
  const effect = facts?.nodeFacts?.[node.canonicalId]?.operationEffect?.value;
  return effect === "expand" || String(node.family || "") === "upsample";
}

function computeRanks(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => String(node.canonicalId)));
  const rankByNodeId = new Map(nodes.map((node) => [String(node.canonicalId), 0]));
  const incomingCount = new Map(nodes.map((node) => [String(node.canonicalId), 0]));
  const outgoing = new Map(nodes.map((node) => [String(node.canonicalId), []]));
  for (const edge of edges) {
    const source = String(edge.canonicalSource);
    const target = String(edge.canonicalTarget);
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    outgoing.get(source).push(target);
    incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
  }
  const queue = nodes
    .map((node) => String(node.canonicalId))
    .filter((nodeId) => (incomingCount.get(nodeId) || 0) === 0);
  const processed = new Set();
  while (queue.length) {
    const nodeId = queue.shift();
    if (processed.has(nodeId)) continue;
    processed.add(nodeId);
    for (const target of outgoing.get(nodeId) || []) {
      rankByNodeId.set(target, Math.max(rankByNodeId.get(target) || 0, (rankByNodeId.get(nodeId) || 0) + 1));
      incomingCount.set(target, Math.max(0, (incomingCount.get(target) || 0) - 1));
      if ((incomingCount.get(target) || 0) === 0) queue.push(target);
    }
  }
  let changed = true;
  let iterations = 0;
  while (changed && iterations < nodes.length + 1) {
    changed = false;
    iterations += 1;
    for (const edge of edges) {
      const source = String(edge.canonicalSource);
      const target = String(edge.canonicalTarget);
      const nextRank = (rankByNodeId.get(source) || 0) + 1;
      if (nextRank > (rankByNodeId.get(target) || 0) && isRouteClass(edge, "main-flow")) {
        rankByNodeId.set(target, nextRank);
        changed = true;
      }
    }
  }
  return rankByNodeId;
}

function sizeForNode(node, facts) {
  if (isDenseNode(node)) {
    const dense = denseOptionsForNode(node, 0, 0);
    const layerCount = Math.max(1, dense.layers.length);
    const largest = Math.max(1, ...dense.layers);
    return {
      w: Math.max(DEFAULT_NODE_WIDTH * 0.8, (layerCount - 1) * dense.layerGap + dense.nodeRadius * 2),
      h: Math.max(DEFAULT_NODE_HEIGHT, (largest - 1) * (dense.nodeRadius * 2 + dense.nodeGap) + dense.nodeRadius * 2),
      depth: 0,
    };
  }
  const repeatCount = repeatCountForNode(node);
  const shape = outputShape(node);
  const spatial = spatialSize(shape, node);
  const widthScale = spatial ? clamp(Math.sqrt(spatial.w / Math.max(1, spatial.h)), 0.72, 1.42) : 1;
  const baseWidth = node.family === "input" || node.family === "output" ? DEFAULT_NODE_WIDTH * 1.05 : DEFAULT_NODE_WIDTH;
  const baseHeight = node.family === "attention" ? DEFAULT_NODE_HEIGHT * 1.12 : DEFAULT_NODE_HEIGHT;
  const semanticScale = facts?.nodeFacts?.[node.canonicalId]?.spatialScale?.value?.dimensions?.length ? 1.06 : 1;
  if (repeatCount > 1) {
    return {
      w: repeatCount * (46 + 7) - 7 + DEFAULT_DEPTH * 0.45,
      h: baseHeight,
      depth: DEFAULT_DEPTH,
    };
  }
  return {
    w: baseWidth * widthScale * semanticScale,
    h: baseHeight,
    depth: DEFAULT_DEPTH,
  };
}

function primitiveForNode(placed, options) {
  const { node, x, y, w, h, depth } = placed;
  const shared = {
    id: node.canonicalId,
    sourceNodeIds: [node.canonicalId],
    x,
    y,
    w,
    h,
    depth,
    caption: captionForNode(node),
    evidence: node.evidence || [],
  };
  const labels = dimensionLabels(node);
  if (isDenseNode(node)) {
    return {
      id: node.canonicalId,
      kind: "dense_layer",
      sourceNodeIds: [node.canonicalId],
      evidence: node.evidence || [],
      options: {
        ...denseOptionsForNode(node, x, y),
        id: node.canonicalId,
        sourceNodeIds: [node.canonicalId],
        caption: captionForNode(node),
        evidence: node.evidence || [],
      },
    };
  }
  if (repeatCountForNode(node) > 1) {
    return {
      id: node.canonicalId,
      kind: "layer_stack",
      sourceNodeIds: [node.canonicalId],
      evidence: node.evidence || [],
      options: {
        ...shared,
        id: node.canonicalId,
        sourceNodeIds: [node.canonicalId],
        count: repeatCountForNode(node),
        cellWidth: 46,
        gap: 7,
        ...labels,
      },
    };
  }
  return {
    id: node.canonicalId,
    kind: shouldBandTensor(node, options) ? "right_banded_tensor" : "tensor_box",
    sourceNodeIds: [node.canonicalId],
    evidence: node.evidence || [],
    options: {
      ...shared,
      id: node.canonicalId,
      sourceNodeIds: [node.canonicalId],
      ...labels,
    },
  };
}

function connectorForEdge(edge, primitiveByNodeId, facts, options) {
  const sourceNodeId = String(edge.canonicalSource);
  const targetNodeId = String(edge.canonicalTarget);
  const source = primitiveByNodeId.get(sourceNodeId);
  const target = primitiveByNodeId.get(targetNodeId);
  const routeClass = routeClassForEdge(edge, facts);
  const sourceAnchor = chooseSourceAnchor(edge, source, target, routeClass);
  const targetAnchor = chooseTargetAnchor(edge, source, target, routeClass);
  return {
    id: String(edge.id),
    sourceEdgeId: String(edge.id),
    from: { primitiveId: sourceNodeId, anchor: sourceAnchor },
    to: { primitiveId: targetNodeId, anchor: targetAnchor },
    routeClass,
    points: routePointsForEdge(edge, source, target, routeClass, sourceAnchor, targetAnchor, options),
    evidence: edge.evidence || [],
  };
}

function groupsForCanonicalModel(canonicalModel, primitiveByNodeId, options) {
  const groups = [];
  for (const group of canonicalModel.moduleTree || []) {
    const childIds = (group.nodeIds || []).map(String).filter((nodeId) => primitiveByNodeId.has(nodeId));
    if (!childIds.length) continue;
    const bounds = boundsOfPrimitiveEntries(childIds.map((nodeId) => primitiveByNodeId.get(nodeId)));
    const includesTitle = options.groupTitleBand !== false;
    groups.push({
      id: `module:${String(group.id)}`,
      kind: "group_box",
      sourceNodeIds: [...childIds],
      evidence: [],
      options: {
        id: `module:${String(group.id)}`,
        sourceNodeIds: [...childIds],
        label: String(group.label || group.id),
        x: bounds.x - GROUP_PADDING,
        y: bounds.y - GROUP_PADDING - (includesTitle ? GROUP_TITLE_BAND : 0),
        w: bounds.w + GROUP_PADDING * 2,
        h: bounds.h + GROUP_PADDING * 2 + (includesTitle ? GROUP_TITLE_BAND : 0),
        childIds,
        evidence: [],
      },
    });
  }
  return groups;
}

function routeClassForEdge(edge, facts) {
  const edgeFact = facts?.edgeFacts?.[edge.id];
  const relation = edgeFact?.relation?.value || "";
  const topology = edgeFact?.topology?.value || {};
  if (relation === "state" || topology.state) return "state";
  if (relation === "bypass" || topology.bypass) return "bypass";
  if (relation === "conditional" || topology.conditional) return "conditional";
  if (topology.crossScale) return "cross-scale";
  const type = String(edge.type || "").toLowerCase();
  if (/state|loop|feedback|recurrent/.test(type)) return "state";
  if (/residual|skip|bypass/.test(type)) return "bypass";
  if (/condition|control|route|gate/.test(type)) return "conditional";
  if (/cross.?scale/.test(type)) return "cross-scale";
  return "main-flow";
}

function routePointsForEdge(edge, source, target, routeClass, sourceAnchor, targetAnchor, options) {
  if (!source || !target) return [];
  const sourcePoint = pointForPrimitive(source, sourceAnchor);
  const targetPoint = pointForPrimitive(target, targetAnchor);
  if (String(edge.canonicalSource) === String(edge.canonicalTarget) || routeClass === "state") {
    const bounds = primitiveEntryBounds(source);
    const corridorY = bounds.y - finite(options.feedbackCorridor, 84);
    const rightX = bounds.x + bounds.w + finite(options.feedbackOffset, 74);
    return [sourcePoint, { x: rightX, y: sourcePoint.y }, { x: rightX, y: corridorY }, { x: bounds.x + bounds.w / 2, y: corridorY }, targetPoint];
  }
  if (routeClass === "main-flow") return [];
  const sourceBounds = primitiveEntryBounds(source);
  const targetBounds = primitiveEntryBounds(target);
  const goesRight = targetBounds.x >= sourceBounds.x;
  if (!goesRight) {
    const corridorY = Math.min(sourceBounds.y, targetBounds.y) - finite(options.feedbackCorridor, 88);
    return [sourcePoint, { x: sourcePoint.x, y: corridorY }, { x: targetPoint.x, y: corridorY }, targetPoint];
  }
  const above = targetBounds.y <= sourceBounds.y || routeClass === "conditional";
  const corridorY = above
    ? Math.min(sourceBounds.y, targetBounds.y) - finite(options.routeCorridor, 72)
    : Math.max(sourceBounds.y + sourceBounds.h, targetBounds.y + targetBounds.h) + finite(options.routeCorridor, 72);
  return [
    sourcePoint,
    { x: sourcePoint.x + finite(options.routeLead, 36), y: corridorY },
    { x: targetPoint.x - finite(options.routeLead, 36), y: corridorY },
    targetPoint,
  ];
}

function chooseSourceAnchor(edge, source, target, routeClass) {
  if (String(edge.canonicalSource) === String(edge.canonicalTarget) || routeClass === "state") return "north";
  if (routeClass === "bypass" || routeClass === "cross-scale") return "south";
  if (routeClass === "conditional") return "east";
  const sourceBounds = primitiveEntryBounds(source);
  const targetBounds = primitiveEntryBounds(target);
  return targetBounds.x >= sourceBounds.x ? "east" : "west";
}

function chooseTargetAnchor(edge, source, target, routeClass) {
  if (String(edge.canonicalSource) === String(edge.canonicalTarget) || routeClass === "state") return "west";
  if (routeClass === "bypass" || routeClass === "cross-scale") return "south";
  if (routeClass === "conditional") return "north";
  const sourceBounds = primitiveEntryBounds(source);
  const targetBounds = primitiveEntryBounds(target);
  return targetBounds.x >= sourceBounds.x ? "west" : "east";
}

function pointForPrimitive(entry, anchor) {
  const bounds = primitiveEntryBounds(entry);
  return {
    west: { x: bounds.x, y: bounds.y + bounds.h / 2 },
    east: { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
    north: { x: bounds.x + bounds.w / 2, y: bounds.y },
    south: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
  }[anchor] || { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 };
}

function boundsOfPrimitiveEntries(entries) {
  const boxes = entries.map(primitiveEntryBounds);
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function primitiveEntryBounds(entry = {}) {
  const options = entry.options || {};
  if (entry.kind === "dense_layer") {
    return denseBoundsForOptions(options);
  }
  if (entry.kind === "layer_stack") {
    const count = Math.max(1, Math.floor(Number(options.count) || 1));
    const cellWidth = finite(options.cellWidth, 46);
    const gap = finite(options.gap, 7);
    return {
      x: finite(options.x, 0),
      y: finite(options.y, 0),
      w: count * cellWidth + Math.max(0, count - 1) * gap + finite(options.depth, DEFAULT_DEPTH) * 0.46,
      h: finite(options.h, DEFAULT_NODE_HEIGHT),
    };
  }
  return {
    x: finite(options.x, 0),
    y: finite(options.y, 0),
    w: finite(options.w, DEFAULT_NODE_WIDTH),
    h: finite(options.h, DEFAULT_NODE_HEIGHT),
  };
}

function denseBoundsForOptions(options = {}) {
  const layers = Array.isArray(options.layers) ? options.layers.map((value) => Math.max(0, Math.floor(Number(value) || 0))) : [0];
  const nodeRadius = finite(options.nodeRadius, 11);
  const nodeGap = finite(options.nodeGap, 14);
  const layerGap = finite(options.layerGap, 130);
  const largest = Math.max(1, ...layers);
  return {
    x: finite(options.x, 0),
    y: finite(options.y, 0) - ((largest - 1) * (nodeRadius * 2 + nodeGap)) / 2,
    w: Math.max(nodeRadius * 2, (Math.max(1, layers.length) - 1) * layerGap + nodeRadius * 2),
    h: (largest - 1) * (nodeRadius * 2 + nodeGap) + nodeRadius * 2,
  };
}

function denseOptionsForNode(node, fallbackX, fallbackY) {
  const units = numericUnits(node);
  const layers = units > 0 && units <= 12 ? [units] : [Math.min(8, Math.max(3, units || 4))];
  return {
    layers,
    x: fallbackX,
    y: fallbackY,
    nodeRadius: 11,
    nodeGap: 14,
    layerGap: 130,
  };
}

function captionForNode(node) {
  const label = String(node.label || node.op || node.family || "Operator");
  const shape = outputShape(node);
  if (!shape.length) return label;
  const compact = shape.length <= 2 ? shape.map(String).join("x") : shape.slice(-3).map(String).join("x");
  return label.toLowerCase().includes(compact.toLowerCase()) ? label : `${label} ${compact}`;
}

function dimensionLabels() {
  return {};
}

function outputShape(node) {
  const output = node?.shape?.output;
  return Array.isArray(output) ? output : [];
}

function numericUnits(node) {
  const shape = outputShape(node);
  const value = Number(shape.at(-1));
  return Number.isFinite(value) ? value : 0;
}

function spatialSize(shape, node) {
  if (!Array.isArray(shape) || !shape.length) return null;
  if (shape.length >= 4) {
    const h = Number(shape.at(-2));
    const w = Number(shape.at(-3));
    return [h, w].every(Number.isFinite) ? { h, w } : null;
  }
  if (shape.length === 3 && isSpatialTriple(shape, node)) {
    const h = Number(shape[0]);
    const w = Number(shape[1]);
    return [h, w].every(Number.isFinite) ? { h, w } : null;
  }
  return null;
}

function isSpatialTriple(shape, node) {
  if (String(node?.attributes?.dataDomain || "").toLowerCase() === "sequence") return false;
  const [a, b] = shape;
  const first = Number(a);
  const second = Number(b);
  if (![first, second].every(Number.isFinite)) return false;
  if (first > 4 && second > 4) return true;
  return ["conv", "pool", "upsample", "volume"].includes(String(node?.family || ""));
}

function repeatCountForNode(node) {
  return Math.max(1, Math.floor(Number(node.repeatCount || node.repeat || 1) || 1));
}

function isDenseNode(node) {
  return String(node.family || "") === "dense" || /dense|linear|fully.?connected|classifier/i.test(String(node.op || ""));
}

function shouldBandTensor(node, options) {
  if (options.banded === "all") return true;
  if (options.banded === "none") return false;
  return String(node.family || "") === "conv" || /conv|relu/i.test(String(node.op || ""));
}

function isRouteClass(edge, routeClass) {
  const type = String(edge.type || "").toLowerCase();
  if (routeClass === "main-flow") return !/state|loop|feedback|residual|skip|bypass|condition|control|route|gate|cross.?scale/.test(type);
  return false;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
