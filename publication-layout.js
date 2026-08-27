"use strict";

const defaultCanvas = { width: 2600, height: 1500 };
const defaultArtboard = { x: 170, y: 160, width: 2260, height: 1060 };
const defaultPaletteName = "dopamine";

const palettes = {
  dopamine: {
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
  },
};

const nodeTypeDefaults = {
  tensor: { w: 122, h: 188 },
  conv: { w: 80, h: 240 },
  "volume-stack": { w: 138, h: 230 },
  volume: { w: 145, h: 210 },
  pool: { w: 92, h: 92 },
  flatten: { w: 150, h: 138 },
  "dense-layer": { w: 132, h: 210 },
  output: { w: 110, h: 148 },
  concat: { w: 82, h: 82 },
  "patch-grid": { w: 184, h: 184 },
  token: { w: 148, h: 58 },
  encoder: { w: 190, h: 150 },
  attention: { w: 205, h: 140 },
  block: { w: 176, h: 128 },
  compound: { w: 320, h: 250 },
  transformer: { w: 320, h: 250 },
  residual: { w: 300, h: 220 },
  diffusion: { w: 320, h: 250 },
  stage: { w: 250, h: 180 },
  "volume-stage": { w: 300, h: 220 },
  neuron: { w: 64, h: 64 },
  default: { w: 160, h: 110 },
};

const nodeBwByType = {
  tensor: { fillPattern: "solid", strokePattern: "solid", tone: "light" },
  conv: { fillPattern: "diagonal-stripe", strokePattern: "solid", tone: "medium" },
  "volume-stack": { fillPattern: "diagonal-stripe", strokePattern: "solid", tone: "dark" },
  volume: { fillPattern: "solid", strokePattern: "solid", tone: "medium" },
  pool: { fillPattern: "crosshatch", strokePattern: "solid", tone: "light" },
  flatten: { fillPattern: "vertical-stripe", strokePattern: "solid", tone: "medium" },
  "dense-layer": { fillPattern: "vertical-stripe", strokePattern: "solid", tone: "dark" },
  output: { fillPattern: "solid", strokePattern: "double", tone: "dark" },
  concat: { fillPattern: "crosshatch", strokePattern: "solid", tone: "light" },
  "patch-grid": { fillPattern: "grid", strokePattern: "solid", tone: "light" },
  token: { fillPattern: "dot", strokePattern: "solid", tone: "light" },
  encoder: { fillPattern: "horizontal-stripe", strokePattern: "solid", tone: "dark" },
  attention: { fillPattern: "horizontal-stripe", strokePattern: "solid", tone: "medium" },
  block: { fillPattern: "horizontal-stripe", strokePattern: "solid", tone: "medium" },
  compound: { fillPattern: "horizontal-stripe", strokePattern: "solid", tone: "dark" },
  neuron: { fillPattern: "solid", strokePattern: "solid", tone: "medium" },
  default: { fillPattern: "solid", strokePattern: "solid", tone: "medium" },
};

const edgeBwByType = {
  signal: { linePattern: "solid", weight: "medium" },
  attention: { linePattern: "dash", weight: "medium" },
  skip: { linePattern: "dash-dot", weight: "medium" },
  default: { linePattern: "solid", weight: "medium" },
};

function layoutNetworkIR(ir, options = {}) {
  const normalized = normalizeIR(ir);
  const paletteName = palettes[options.paletteName] ? options.paletteName : defaultPaletteName;
  const palette = palettes[paletteName];
  const artboard = normalizeArtboard(options.artboard);

  const stageGap = normalized.stageOrder.length > 1
    ? (artboard.width - 300) / (normalized.stageOrder.length - 1)
    : 0;
  const stageColumns = normalized.stageOrder.map((stageId, index) => ({
    id: stageId,
    label: normalized.stageMeta.get(stageId).label,
    index,
    centerX: round(artboard.x + 150 + stageGap * index),
  }));
  const columnMap = new Map(stageColumns.map((column) => [column.id, column]));

  const nodesByStage = new Map(stageColumns.map((column) => [column.id, []]));
  normalized.nodes.forEach((node) => {
    nodesByStage.get(node.stage).push(node);
  });

  const laidOutNodes = [];
  stageColumns.forEach((column) => {
    const stageNodes = stableNodeOrder(nodesByStage.get(column.id) || []);
    const usableTop = artboard.y + 60;
    const usableBottom = artboard.y + artboard.height - 60;
    const totalHeight = stageNodes.reduce((sum, node) => sum + node.h, 0);
    const naturalGap = stageNodes.length > 1 ? 46 : 0;
    const availableHeight = usableBottom - usableTop - totalHeight;
    const gapY = stageNodes.length > 1
      ? Math.max(24, Math.min(naturalGap, Math.floor(availableHeight / (stageNodes.length - 1))))
      : 0;
    const packedHeight = totalHeight + gapY * Math.max(0, stageNodes.length - 1);
    let cursorY = round(usableTop + Math.max(0, (usableBottom - usableTop - packedHeight) / 2));

    stageNodes.forEach((node) => {
      const x = round(column.centerX - node.w / 2);
      const y = cursorY;
      const color = colorForNode(node, palette, column.index, stageColumns.length);
      const laidOut = {
        ...node,
        x,
        y,
        stage: column.index,
        stageKey: column.id,
        columnX: column.centerX,
        color,
        bwStyle: clone(nodeBwStyle(node)),
      };
      laidOutNodes.push(laidOut);
      cursorY += node.h + gapY;
    });
  });

  const nodeMap = new Map(laidOutNodes.map((node) => [node.id, node]));
  const laidOutEdges = layoutEdges(normalized.edges, nodeMap, palette, artboard);

  const layout = {
    figure: {
      title: normalized.title,
      subtitle: normalized.subtitle,
      stages: stageColumns.map((column) => column.label),
    },
    paletteName,
    nodes: laidOutNodes.sort(compareLaidOutNodes),
    edges: laidOutEdges,
  };

  layout.validation = validatePublicationLayout(layout, { artboard, canvas: options.canvas || defaultCanvas });
  return layout;
}

function validatePublicationLayout(layout, options = {}) {
  const artboard = normalizeArtboard(options.artboard);
  const readableMargin = Number.isFinite(options.readableMargin) ? options.readableMargin : 24;
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const edges = Array.isArray(layout?.edges) ? layout.edges : [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  const overlaps = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left];
      const b = nodes[right];
      const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (x > 0 && y > 0) {
        overlaps.push({ a: a.id, b: b.id, intersection: { x, y } });
      }
    }
  }

  const invalidEdges = [];
  const stageOrderIssues = [];
  const skipLanes = [];
  edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) {
      invalidEdges.push({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        reason: "missing-endpoint",
      });
      return;
    }
    if (edge.type !== "skip" && target.stage < source.stage) {
      stageOrderIssues.push({
        edgeId: edge.id,
        sourceStage: source.stage,
        targetStage: target.stage,
        reason: "backward-non-skip-edge",
      });
    }
    if (edge.type === "skip") {
      skipLanes.push({
        edgeId: edge.id,
        laneIndex: edge.route?.laneIndex,
        laneY: edge.route?.laneY,
        sourceStage: source.stage,
        targetStage: target.stage,
      });
    }
  });

  const boundaryViolations = [];
  const unreadableNodes = [];
  nodes.forEach((node) => {
    if (node.x < artboard.x + readableMargin) {
      boundaryViolations.push({ nodeId: node.id, side: "left", amount: artboard.x + readableMargin - node.x });
    }
    if (node.y < artboard.y + readableMargin) {
      boundaryViolations.push({ nodeId: node.id, side: "top", amount: artboard.y + readableMargin - node.y });
    }
    if (node.x + node.w > artboard.x + artboard.width - readableMargin) {
      boundaryViolations.push({
        nodeId: node.id,
        side: "right",
        amount: node.x + node.w - (artboard.x + artboard.width - readableMargin),
      });
    }
    if (node.y + node.h > artboard.y + artboard.height - readableMargin) {
      boundaryViolations.push({
        nodeId: node.id,
        side: "bottom",
        amount: node.y + node.h - (artboard.y + artboard.height - readableMargin),
      });
    }
    if (!String(node.label || "").trim()) {
      unreadableNodes.push({ nodeId: node.id, reason: "missing-label" });
    }
    if (!Number.isFinite(node.w) || !Number.isFinite(node.h) || node.w < 48 || node.h < 40) {
      unreadableNodes.push({ nodeId: node.id, reason: "undersized-node" });
    }
  });

  const styleIssues = [];
  nodes.forEach((node) => {
    if (!node.color) styleIssues.push({ kind: "node-color", id: node.id });
    if (!isValidNodeBwStyle(node.bwStyle)) styleIssues.push({ kind: "node-bw", id: node.id });
  });
  edges.forEach((edge) => {
    if (!edge.color) styleIssues.push({ kind: "edge-color", id: edge.id });
    if (!isValidEdgeBwStyle(edge.bwStyle)) styleIssues.push({ kind: "edge-bw", id: edge.id });
    if (edge.type === "skip") {
      if (!edge.route || !Array.isArray(edge.route.points) || edge.route.points.length < 4) {
        styleIssues.push({ kind: "skip-route", id: edge.id });
      }
    }
  });

  const stageColumns = buildStageColumns(nodes, layout?.figure?.stages || []);
  const summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    stageCount: stageColumns.length,
    overlapCount: overlaps.length,
    invalidEdgeCount: invalidEdges.length,
    boundaryViolationCount: boundaryViolations.length,
    stageOrderIssueCount: stageOrderIssues.length,
    unreadableNodeCount: unreadableNodes.length,
    styleIssueCount: styleIssues.length,
  };

  return {
    ok: summary.overlapCount === 0
      && summary.invalidEdgeCount === 0
      && summary.boundaryViolationCount === 0
      && summary.stageOrderIssueCount === 0
      && summary.unreadableNodeCount === 0
      && summary.styleIssueCount === 0,
    summary,
    overlaps,
    invalidEdges,
    boundaryViolations,
    stageOrderIssues,
    unreadableNodes,
    styleIssues,
    stageColumns,
    skipLanes,
  };
}

function normalizeIR(ir) {
  if (!ir || !Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) {
    throw new Error("layoutNetworkIR expects an IR object with nodes and edges arrays.");
  }

  const stageEntries = Array.isArray(ir.stages) && ir.stages.length
    ? ir.stages.map((stage, index) => normalizeStage(stage, index))
    : deriveStages(ir.nodes);
  const stageMeta = new Map(stageEntries.map((stage) => [stage.id, stage]));
  const stageOrder = stageEntries.map((stage) => stage.id);

  const nodes = ir.nodes.map((node, index) => normalizeNode(node, index, stageMeta, stageOrder));
  const edges = stableEdgeOrder(ir.edges.map((edge, index) => normalizeEdge(edge, index)));

  return {
    title: String(ir.title || "Neural Network Architecture"),
    subtitle: String(ir.subtitle || "Deterministic publication-style layout"),
    stageMeta,
    stageOrder,
    nodes,
    edges,
  };
}

function normalizeStage(stage, index) {
  if (typeof stage === "string") {
    return { id: stage, label: stage, index };
  }
  const id = stage?.id ?? `stage-${index}`;
  return {
    id: String(id),
    label: String(stage?.label || id),
    index,
  };
}

function deriveStages(nodes) {
  const seen = new Map();
  nodes.forEach((node) => {
    const key = String(node?.stage ?? "stage-0");
    if (!seen.has(key)) {
      seen.set(key, { id: key, label: key, index: seen.size });
    }
  });
  return [...seen.values()];
}

function normalizeNode(node, index, stageMeta, stageOrder) {
  const stageKey = String(node?.stage ?? stageOrder[0]);
  if (!stageMeta.has(stageKey)) {
    throw new Error(`Node ${node?.id || index} references unknown stage "${stageKey}".`);
  }
  const type = String(node?.type || "block");
  const dims = nodeTypeDefaults[type] || nodeTypeDefaults.default;
  return {
    id: String(node?.id || `node-${index + 1}`),
    type,
    stage: stageKey,
    order: Number.isFinite(node?.order) ? node.order : 1000,
    label: String(node?.label || `Node ${index + 1}`),
    subtitle: String(node?.subtitle || ""),
    w: Number.isFinite(node?.w) ? Math.round(node.w) : dims.w,
    h: Number.isFinite(node?.h) ? Math.round(node.h) : dims.h,
    note: node?.note || "",
  };
}

function normalizeEdge(edge, index) {
  return {
    source: String(edge?.source || ""),
    target: String(edge?.target || ""),
    label: String(edge?.label || ""),
    type: String(edge?.type || "signal"),
    order: Number.isFinite(edge?.order) ? edge.order : index,
  };
}

function stableNodeOrder(nodes) {
  return [...nodes].sort((left, right) => (
    compareNumbers(left.order, right.order)
    || compareNumbers(verticalTypePriority(left.type), verticalTypePriority(right.type))
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
}

function stableEdgeOrder(edges) {
  return [...edges].sort((left, right) => (
    compareNumbers(edgeTypePriority(left.type), edgeTypePriority(right.type))
    || left.source.localeCompare(right.source)
    || left.target.localeCompare(right.target)
    || left.label.localeCompare(right.label)
    || compareNumbers(left.order, right.order)
  ));
}

function layoutEdges(edges, nodeMap, palette, artboard) {
  const counts = new Map();
  const skipEdges = [];

  const laidOut = edges.map((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    const key = `${edge.type}:${edge.source}:${edge.target}:${edge.label}`;
    const nextCount = (counts.get(key) || 0) + 1;
    counts.set(key, nextCount);
    const laidOutEdge = {
      id: nextCount === 1 ? `edge-${edge.type}-${edge.source}-${edge.target}` : `edge-${edge.type}-${edge.source}-${edge.target}-${nextCount}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type,
      color: colorForEdge(edge.type, palette),
      bwStyle: clone(edgeBwByType[edge.type] || edgeBwByType.default),
    };
    if (source && target && edge.type === "skip") {
      skipEdges.push({ edge: laidOutEdge, source, target });
    }
    return laidOutEdge;
  });

  skipEdges
    .sort((left, right) => (
      compareNumbers(Math.abs(right.target.stage - right.source.stage), Math.abs(left.target.stage - left.source.stage))
      || left.source.id.localeCompare(right.source.id)
      || left.target.id.localeCompare(right.target.id)
    ))
    .forEach((item, laneIndex) => {
      const sourceAnchor = anchorPoint(item.source, "right");
      const targetAnchor = anchorPoint(item.target, "left");
      const laneY = round(artboard.y + 40 + laneIndex * 28);
      item.edge.route = {
        kind: "skip-lane",
        laneIndex,
        laneY,
        points: [
          { x: sourceAnchor.x, y: sourceAnchor.y },
          { x: round(sourceAnchor.x + 22), y: laneY },
          { x: round(targetAnchor.x - 22), y: laneY },
          { x: targetAnchor.x, y: targetAnchor.y },
        ],
      };
    });

  return laidOut.sort((left, right) => (
    compareNumbers(edgeTypePriority(left.type), edgeTypePriority(right.type))
    || left.source.localeCompare(right.source)
    || left.target.localeCompare(right.target)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
}

function buildStageColumns(nodes, figureStages) {
  const grouped = new Map();
  nodes.forEach((node) => {
    if (!grouped.has(node.stage)) {
      grouped.set(node.stage, {
        index: node.stage,
        label: figureStages[node.stage] || node.stageKey || String(node.stage),
        x: node.columnX ?? round(node.x + node.w / 2),
        nodeIds: [],
      });
    }
    grouped.get(node.stage).nodeIds.push(node.id);
  });
  return [...grouped.values()]
    .sort((left, right) => compareNumbers(left.index, right.index))
    .map((column) => ({
      ...column,
      nodeIds: column.nodeIds.sort(),
    }));
}

function colorForNode(node, palette, stageIndex, stageCount) {
  if (node.type === "conv") return stageIndex > 1 ? palette.convB : palette.convA;
  if (node.type === "volume-stack") return palette.encoderA;
  if (node.type === "volume") return stageIndex >= stageCount - 2 ? palette.output : palette.tensor;
  if (node.type === "pool") return palette.token;
  if (node.type === "flatten") return palette.attention;
  if (node.type === "dense-layer") return stageIndex >= stageCount - 1 ? palette.output : palette.encoderA;
  if (node.type === "concat") return palette.skip;
  if (node.type === "patch-grid") return palette.patch;
  if (node.type === "token") return palette.token;
  if (node.type === "encoder") return String(node.id || "").includes("2") ? palette.encoderB : palette.encoderA;
  if (node.type === "output") return palette.output;
  if (node.type === "neuron") return stageIndex >= stageCount - 1 ? palette.output : palette.convA;
  if (node.type === "attention" || node.type === "block" || node.type === "compound") return palette.block;
  return palette.tensor;
}

function colorForEdge(type, palette) {
  if (type === "skip") return palette.skip;
  if (type === "attention") return palette.attention;
  return palette.signal;
}

function nodeBwStyle(node) {
  return nodeBwByType[node.type] || nodeBwByType.default;
}

function anchorPoint(node, side) {
  if (side === "left") return { x: node.x, y: round(node.y + node.h / 2) };
  if (side === "right") return { x: round(node.x + node.w), y: round(node.y + node.h / 2) };
  if (side === "top") return { x: round(node.x + node.w / 2), y: node.y };
  return { x: round(node.x + node.w / 2), y: round(node.y + node.h) };
}

function normalizeArtboard(artboard) {
  if (!artboard) return { ...defaultArtboard };
  return {
    x: Number.isFinite(artboard.x) ? artboard.x : defaultArtboard.x,
    y: Number.isFinite(artboard.y) ? artboard.y : defaultArtboard.y,
    width: Number.isFinite(artboard.width) ? artboard.width : defaultArtboard.width,
    height: Number.isFinite(artboard.height) ? artboard.height : defaultArtboard.height,
  };
}

function compareLaidOutNodes(left, right) {
  return compareNumbers(left.stage, right.stage)
    || compareNumbers(left.y, right.y)
    || compareNumbers(left.x, right.x)
    || left.id.localeCompare(right.id);
}

function verticalTypePriority(type) {
  const order = {
    token: 10,
    "patch-grid": 20,
    tensor: 30,
    conv: 40,
    pool: 50,
    "volume-stack": 60,
    concat: 70,
    flatten: 80,
    encoder: 90,
    compound: 95,
    "dense-layer": 100,
    output: 110,
  };
  return order[type] ?? 500;
}

function edgeTypePriority(type) {
  const order = {
    signal: 10,
    attention: 20,
    skip: 30,
  };
  return order[type] ?? 100;
}

function isValidNodeBwStyle(style) {
  return Boolean(
    style
    && typeof style.fillPattern === "string"
    && typeof style.strokePattern === "string"
    && typeof style.tone === "string"
  );
}

function isValidEdgeBwStyle(style) {
  return Boolean(
    style
    && typeof style.linePattern === "string"
    && typeof style.weight === "string"
  );
}

function compareNumbers(left, right) {
  return left - right;
}

function round(value) {
  return Math.round(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  layoutNetworkIR,
  validatePublicationLayout,
};
