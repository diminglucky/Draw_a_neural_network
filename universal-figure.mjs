import {
  compileSemanticVisualNode,
  compileSemanticVisualNodes,
  recurrentEvidenceForNode,
} from "./semantic-visual-grammar.mjs";

const DEFAULT_ARTBOARD = Object.freeze({ x: 170, y: 160, width: 2260, height: 1060 });
const PLAN_VERSION = "universal-publication-figure/v1";

const FAMILY_SIZE = Object.freeze({
  input: [122, 188],
  output: [110, 148],
  conv: [86, 220],
  volume: [150, 220],
  pool: [92, 92],
  dense: [132, 210],
  flatten: [150, 138],
  merge: [92, 92],
  attention: [320, 250],
  recurrent: [320, 250],
  graph: [320, 250],
  custom: [320, 250],
  default: [176, 128],
});

export function selectFigureGrammar(ir = {}) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  const families = new Set(nodes.map((node) => String(node.family || "unknown").toLowerCase()));
  const hasSkip = edges.some((edge) => /skip|residual|shortcut/i.test(String(edge.type || "")));
  const hasMerge = families.has("merge") || edges.some((edge) => /concat|merge|residual/i.test(String(edge.type || "")));
  const hasAttention = families.has("attention") || edges.some((edge) => edge.type === "attention");
  const hasEncoderDecoder = nodes.some((node) => /encoder|decoder|upsample|downsample/i.test(`${node.family} ${node.op} ${node.label}`));
  const hasTensor = families.has("conv") || families.has("volume") || families.has("pool");
  const hasRecurrentFlow = families.has("recurrent")
    || edges.some((edge) => /^(state|recurrent-state|loop)$/i.test(String(edge.type || "")))
    || nodes.some((node) => isRecurrentEvidence(node));
  const hasControlFlow = edges.some((edge) => /^(control|alternative|branch)$/i.test(String(edge.type || "")))
    || nodes.some((node) => node.attributes?.controlKind);

  if (hasRecurrentFlow) {
    return grammar("recurrent-flow", "recurrent nodes or state/loop edges are present", 0.95);
  }
  if (hasControlFlow) {
    return grammar("control-flow", "conditional or iterative control-flow evidence is present", 0.9);
  }
  if (hasAttention) {
    return grammar("token-attention", "attention or token interaction edges are present", 0.94);
  }
  if (hasEncoderDecoder && hasSkip) {
    return grammar("encoder-decoder", "encoder/decoder operators and skip paths are present", 0.93);
  }
  if (hasSkip || hasMerge) {
    return grammar("residual-graph", "residual, skip, or merge topology is present", 0.92);
  }
  if (hasTensor) {
    return grammar("tensor-flow", "tensor-producing operators are present", 0.88);
  }
  return grammar("generic-dag", "no specialized visual grammar is justified by the evidence", 0.72);
}

export function layoutUniversalFigure(ir = {}, options = {}) {
  const grammar = selectFigureGrammar(ir);
  const figure = normalizeFigure(ir.figure);
  const artboard = normalizeArtboard(options.artboard);
  const normalizedNodes = Array.isArray(ir.nodes) ? ir.nodes.map((node, index) => normalizeNode(node, index)) : [];
  const normalizedEdges = Array.isArray(ir.edges) ? ir.edges.map((edge, index) => normalizeEdge(edge, index)) : [];
  const condensed = condenseLinearConvRuns(normalizedNodes, normalizedEdges);
  const sourceNodes = resolvePublicationGeometry(
    compileSemanticVisualNodes(condensed.nodes, condensed.edges),
  );
  const sourceEdges = condensed.edges;
  // Single placement model: every supported topology (linear chain, FPN/PAN
  // pyramid, generic stage DAG) projects nodes onto a column/row grid through
  // one xFor/yFor interface. The main loop no longer branches per topology.
  const placement = computePlacement(sourceNodes, sourceEdges, ir.groups, artboard);
  const fittedArtboard = placement.artboard;
  const stages = stageOrder(sourceNodes);
  const stageIndexByStage = new Map(stages.map((stage, index) => [stage, index]));
  const nodes = [];

  [...sourceNodes].sort(compareStageThenOrder).forEach((node) => {
    const visualWidth = compactVisualWidth(node);
    const positioned = {
      ...node,
      x: placement.xFor(node),
      y: placement.yFor(node),
      w: visualWidth,
      stageIndex: stageIndexByStage.get(String(node.stage)) ?? 0,
      representation: representationFor(node),
      inner: layoutInnerGraph(node),
      note: node.note || (node.family === "custom" ? "unresolved structure · review evidence" : ""),
    };
    nodes.push(positioned);
  });

  // 标记分叉/合并点：出度 >1 = fork（输出分叉），入度 >1 = merge（输入汇聚）。
  // 渲染层据此在对应锚点画小圆点（PlotNeuralNet 惯例）。
  const outDegree = new Map();
  const inDegree = new Map();
  sourceEdges.forEach((edge) => {
    if (edge.source === edge.target) return; // 自环不计入分叉/合并
    outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  });
  nodes.forEach((node) => {
    const out = outDegree.get(node.id) || 0;
    const inn = inDegree.get(node.id) || 0;
    if (out > 1 && inn > 1) node.junctionRole = "fork-merge";
    else if (out > 1) node.junctionRole = "fork";
    else if (inn > 1) node.junctionRole = "merge";
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = sourceEdges.map((edge, index) => routeEdge(edge, nodeMap, index, fittedArtboard));
  const recurrentLayouts = grammar.id === "recurrent-flow"
    ? buildRecurrentFigureLayouts(sourceNodes, nodes, sourceEdges, fittedArtboard)
    : {};
  const recurrentLayout = Object.values(recurrentLayouts)[0];
  nodes.forEach((node) => {
    const layoutForNode = recurrentLayouts[node.id];
    if (layoutForNode) node.recurrentLayout = layoutForNode;
  });
  if (recurrentLayout?.uncertainty?.unresolved) {
    const recurrentNode = nodes.find((node) => node.id === recurrentLayout.instances[1]?.layoutNodeId);
    if (recurrentNode) {
      recurrentNode.representation = "compound";
      recurrentNode.inner = {
        kind: "unresolved",
        nodes: [],
        edges: [],
        message: recurrentLayout.uncertainty.reason,
      };
      recurrentNode.note = `unresolved structure · ${recurrentLayout.uncertainty.reason}`;
    }
  }
  const validation = validateFigureLayout(nodes, edges, fittedArtboard);
  const groups = (Array.isArray(ir.groups) ? ir.groups : [])
    .map((group) => {
      const memberIds = new Set((group.nodeIds || []).map(String));
      const members = nodes.filter((node) => (
        memberIds.has(String(node.id))
        || memberIds.has(String(node.sourceNodeId))
        || (Array.isArray(node.sourceNodeIds) && node.sourceNodeIds.some((id) => memberIds.has(String(id))))
      ));
      if (members.length === 0) return null;
      const minX = Math.min(...members.map((node) => node.x));
      const minY = Math.min(...members.map((node) => node.y));
      const maxX = Math.max(...members.map((node) => node.x + node.w));
      const maxY = Math.max(...members.map((node) => node.y + node.h));
      const pad = 22;
      const titleBand = 22;
      return {
        id: String(group.id || group.label || ""),
        label: String(group.label || group.id || "Group"),
        kind: String(group.kind || "module"),
        nodeIds: (group.nodeIds || []).map(String),
        bounds: {
          x: Math.round(minX - pad),
          y: Math.round(minY - pad - titleBand),
          w: Math.round(maxX - minX + pad * 2),
          h: Math.round(maxY - minY + pad * 2 + titleBand),
        },
      };
    })
    .filter(Boolean);
  return {
    version: PLAN_VERSION,
    grammar,
    figure: { ...figure, stages: stages.map((stage) => stageLabel(stage, sourceNodes)) },
    artboard: fittedArtboard,
    nodes,
    edges,
    groups,
    validation,
    ...(recurrentLayout ? { recurrentLayout } : {}),
    ...(Object.keys(recurrentLayouts).length ? { recurrentLayouts } : {}),
  };
}

function compactVisualWidth(node) {
  // Publication blocks are uniform cards; the preferred geometry already
  // encodes the width and per-role 3D compression is no longer applied.
  return node.w;
}

function resolutionOf(node) {
  // Feature-map height H from channels-last [H, W, C] shape inference output.
  const shape = node.shape?.output;
  if (!Array.isArray(shape) || shape.length < 2) return null;
  const h = Number(shape[0]);
  return Number.isFinite(h) && h > 0 ? h : null;
}

function pyramidLayoutFor(nodes, artboard) {
  // FPN/PAN-style detectors (YOLO, RetinaNet, …) flow through a feature
  // pyramid: downsampling descends (H shrinks) while upsampling ascends
  // (H grows). Top-journal figures render this as a vertical hourglass,
  // not a single horizontal lane. Detect that topology and assign one
  // vertical lane per distinct resolution, largest on top.
  const hasUpsample = nodes.some((node) => String(node.family) === "upsample");
  if (!hasUpsample) return null;
  const resolutions = [...new Set(nodes.map(resolutionOf).filter((r) => r != null))].sort((a, b) => b - a);
  if (resolutions.length < 3) return null;
  const maxNodeHeight = nodes.reduce((max, node) => Math.max(max, node.h), 0);
  const laneGap = Math.max(150, maxNodeHeight + 64);
  const top = artboard.y + 70;
  const yByResolution = new Map(resolutions.map((r, index) => [r, Math.round(top + index * laneGap)]));
  return {
    yFor: (node) => {
      const r = resolutionOf(node);
      return r != null ? yByResolution.get(r) : null;
    },
    laneGap,
    laneCount: resolutions.length,
    height: Math.round(top + resolutions.length * laneGap + 80),
  };
}

function pyramidColumns(nodes, groups) {
  // Top-journal detector figures place Backbone / Neck / Head in separate
  // vertical columns (backbone left, neck middle, head right), not one long
  // horizontal chain. Map each node to a column from its group membership;
  // unknown kinds get an extra column appended to the right.
  const knownKinds = new Map([["backbone", 0], ["neck", 1], ["head", 2]]);
  const extraKinds = [];
  const colOf = new Map();
  for (const group of (Array.isArray(groups) ? groups : [])) {
    const kind = String(group.kind || "").toLowerCase();
    let col = knownKinds.get(kind);
    if (col == null) {
      let found = extraKinds.indexOf(kind);
      if (found < 0) { found = extraKinds.length; extraKinds.push(kind); }
      col = 3 + found;
    }
    for (const id of (Array.isArray(group.nodeIds) ? group.nodeIds : [])) {
      colOf.set(String(id), col);
    }
  }
  return { colOf, colCount: 3 + extraKinds.length };
}

// ---------------------------------------------------------------------------
// Unified placement: project nodes onto a column/row grid. The three modes
// differ only in what defines a "column" and a "row"; the main loop consumes a
// single xFor/yFor interface so topology-specific logic stays isolated here.
// ---------------------------------------------------------------------------
function computePlacement(nodes, edges, groups, artboard) {
  const pyramid = pyramidLayoutFor(nodes, artboard);
  if (pyramid) return pyramidPlacement(nodes, groups, pyramid, artboard);
  if (isLinearChain(nodes, edges)) return linearPlacement(nodes, artboard);
  return stagePlacement(nodes, artboard);
}

// FPN/PAN detectors: column = semantic group (backbone/neck/head), row =
// feature-map resolution lane (largest on top). Same-resolution siblings in a
// column offset horizontally; columns widen dynamically so lanes never overlap.
function pyramidPlacement(nodes, groups, pyramid, artboard) {
  const columns = pyramidColumns(nodes, groups);
  const maxWidth = nodes.reduce((max, node) => Math.max(max, node.w), 0);
  // Same-lane siblings advance by at least the widest block plus a gutter, so
  // adjacent blocks can never overlap regardless of per-role width.
  const step = Math.max(132, maxWidth + 24);
  const laneSeq = new Map();
  const colMaxSeq = new Map();
  const laneCounts = new Map();
  const ordered = [...nodes].sort(compareStageThenOrder);
  for (const node of ordered) {
    const laneY = pyramid.yFor(node);
    if (laneY == null) continue;
    const col = columns.colOf.get(String(node.id)) ?? 0;
    const key = `${col}:${laneY}`;
    const seq = laneCounts.get(key) || 0;
    laneCounts.set(key, seq + 1);
    laneSeq.set(String(node.id), seq);
    colMaxSeq.set(col, Math.max(colMaxSeq.get(col) || 0, seq));
  }
  const colX = new Map();
  const colCount = Math.max(...[...colMaxSeq.keys()].map((col) => col + 1), 3);
  let cursorX = 0;
  for (let col = 0; col < colCount; col += 1) {
    colX.set(col, cursorX);
    cursorX += ((colMaxSeq.get(col) ?? 0) + 1) * step + 150;
  }
  return {
    mode: "pyramid",
    artboard: { ...artboard, height: Math.max(artboard.height, pyramid.height) },
    xFor: (node) => {
      const col = columns.colOf.get(String(node.id)) ?? 0;
      const seq = laneSeq.get(String(node.id)) ?? 0;
      return Math.round(artboard.x + 50 + (colX.get(col) ?? 0) + seq * step);
    },
    yFor: (node) => pyramid.yFor(node),
  };
}

// Plain linear chain: a single horizontal lane, each node vertically centered.
function linearPlacement(nodes, artboard) {
  const fitted = fitSingleLaneArtboard(artboard, nodes);
  const positions = packSingleLaneX(nodes, fitted);
  return {
    mode: "linear",
    artboard: fitted,
    xFor: (node) => {
      const rawX = positions.get(node.id) ?? Math.round(fitted.x);
      const width = compactVisualWidth(node);
      return Math.max(fitted.x, Math.min(fitted.x + fitted.width - width, rawX));
    },
    yFor: (node) => Math.round(fitted.y + Math.max(60, Math.floor((fitted.height - node.h) / 2))),
  };
}

// Generic stage DAG: column = stage (left-to-right), row = order within stage
// (top-to-bottom), the default fallback layout.
function stagePlacement(nodes, artboard) {
  const stages = stageOrder(nodes);
  const stageGap = stages.length > 1 ? (artboard.width - 260) / (stages.length - 1) : 0;
  const stageIndexByStage = new Map(stages.map((stage, index) => [stage, index]));
  const yByNode = new Map();
  for (const stage of stages) {
    const members = nodes.filter((node) => String(node.stage) === stage).sort(compareNode);
    const totalHeight = members.reduce((sum, node) => sum + node.h, 0);
    const gap = members.length > 1
      ? Math.max(26, Math.min(54, Math.floor((artboard.height - 120 - totalHeight) / (members.length - 1))))
      : 0;
    let cursor = artboard.y + Math.max(60, Math.floor((artboard.height - totalHeight - gap * Math.max(0, members.length - 1)) / 2));
    for (const node of members) {
      yByNode.set(node.id, Math.round(cursor));
      cursor += node.h + gap;
    }
  }
  return {
    mode: "stage",
    artboard,
    xFor: (node) => {
      const width = compactVisualWidth(node);
      const stageIndex = stageIndexByStage.get(String(node.stage)) ?? 0;
      const rawX = Math.round(artboard.x + 130 + stageGap * stageIndex - width / 2);
      return Math.max(artboard.x, Math.min(artboard.x + artboard.width - width, rawX));
    },
    yFor: (node) => yByNode.get(node.id) ?? artboard.y,
  };
}

function resolvePublicationGeometry(nodes) {
  const ordered = [...nodes].sort(compareStageThenOrder);
  const resolved = nodes.map((node) => {
    const preferredWidth = Number(node.geometryData?.preferredWidth);
    const preferredHeight = Number(node.geometryData?.preferredHeight);
    return {
      ...node,
      w: Number.isFinite(preferredWidth) && preferredWidth > 0 ? preferredWidth : node.w,
      h: Number.isFinite(preferredHeight) && preferredHeight > 0 ? preferredHeight : node.h,
    };
  });
  return resolved.map((node) => ({
    ...node,
    geometryData: {
      ...node.geometryData,
      ...visualEnvelopeFor(node),
    },
  }));
}

function compareStageThenOrder(left, right) {
  return compareStage(left, right) || compareNode(left, right);
}

function isLinearChain(nodes, edges) {
  if (nodes.length < 2 || edges.length !== nodes.length - 1) return false;
  const ordered = [...nodes].sort((left, right) => compareStage(left, right) || compareNode(left, right));
  if (new Set(ordered.map((node) => String(node.stage))).size !== ordered.length) return false;
  return edges.every((edge, index) => (
    !/skip|residual|shortcut/i.test(String(edge.type || ""))
      && edge.source === ordered[index].id
      && edge.target === ordered[index + 1].id
  ));
}

function fitSingleLaneArtboard(artboard, nodes) {
  const minimumGap = 48;
  const horizontalMargin = 50;
  const requiredWidth = horizontalMargin * 2 + singleLaneFootprintWidth(nodes, minimumGap);
  const maximumNodeHeight = nodes.reduce((maximum, node) => Math.max(maximum, node.h), 0);
  const compactHeight = Math.max(640, maximumNodeHeight + 300);
  return {
    ...artboard,
    x: artboard.x,
    y: compactHeight < artboard.height ? 20 : artboard.y,
    width: Math.max(900, requiredWidth),
    height: Math.min(artboard.height, compactHeight),
  };
}

function packSingleLaneX(nodes, artboard) {
  const ordered = [...nodes].sort((left, right) => compareStage(left, right) || compareNode(left, right));
  const horizontalMargin = 50;
  const minimumGap = 48;
  let cursor = artboard.x + horizontalMargin + visualLeftOutset(ordered[0]);
  const positions = new Map();
  for (let index = 0; index < ordered.length; index += 1) {
    const node = ordered[index];
    positions.set(node.id, Math.round(cursor));
    // The east face is a translucent perspective projection that overlaps the
    // next tensor (PlotNeuralNet convention), so it does not consume layout
    // width. Only the front face advances the cursor.
    cursor += compactVisualWidth(node);
    const next = ordered[index + 1];
    if (next) cursor += publicationGapAfter(node, next, minimumGap) + visualLeftOutset(next);
  }
  return positions;
}

function singleLaneFootprintWidth(nodes, minimumGap) {
  if (nodes.length === 0) return 0;
  let width = visualLeftOutset(nodes[0]);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    width += compactVisualWidth(node);
    const next = nodes[index + 1];
    if (next) width += publicationGapAfter(node, next, minimumGap) + visualLeftOutset(next);
  }
  return width;
}

function publicationGapAfter(previous, next, fallbackGap) {
  const role = String(next.visualRole || next.family || "").toLowerCase();
  if (role === "pool-downsample") return 40;
  if (role === "feature-map-stage") return 60;
  if (role === "vectorize") return 64;
  if (role === "neuron-layer") return 52;
  if (role === "output-distribution") return 60;
  return fallbackGap;
}

function visualEnvelopeFor(node) {
  const width = compactVisualWidth(node);
  switch (node.visualRole) {
    case "input-tensor":
      return { visualLeftOutset: Math.round(width * 0.24), visualRightOutset: Math.round(width * 0.22) };
    case "feature-map-stage":
      return { visualLeftOutset: 0, visualRightOutset: Math.max(Math.round(width * 0.16), Math.round(node.h * 0.38)) };
    case "pool-downsample":
      return { visualLeftOutset: 0, visualRightOutset: Math.max(Math.round(width * 0.20), Math.round(node.h * 0.38)) };
    case "output-distribution":
      return { visualLeftOutset: 0, visualRightOutset: Math.round(width * 0.30) };
    default:
      return { visualLeftOutset: 0, visualRightOutset: 0 };
  }
}

function visualLeftOutset(node) {
  return Math.max(0, Number(node.geometryData?.visualLeftOutset) || 0);
}

function visualRightOutset(node) {
  return Math.max(0, Number(node.geometryData?.visualRightOutset) || 0);
}

function grammar(id, reason, confidence) {
  return { id, reason, confidence, source: "semantic-topology" };
}

function normalizeNode(node = {}, index) {
  const family = String(node.family || node.type || "custom").toLowerCase();
  const [defaultW, defaultH] = FAMILY_SIZE[family] || FAMILY_SIZE.default;
  const normalized = {
    ...node,
    id: String(node.id || `figure-node-${index + 1}`),
    sourceNodeId: String(node.sourceNodeId || node.id || `figure-node-${index + 1}`),
    family,
    op: String(node.op || node.operation || node.label || "UnknownOperator"),
    label: String(node.label || node.op || `Node ${index + 1}`),
    subtitle: String(node.subtitle || shapeLabel(node.shape)),
    stage: node.stage ?? index,
    order: Number.isFinite(node.order) ? node.order : index,
    w: Number.isFinite(node.w) ? Math.max(64, Math.round(node.w)) : defaultW,
    h: Number.isFinite(node.h) ? Math.max(64, Math.round(node.h)) : defaultH,
    confidence: Number.isFinite(node.confidence) ? node.confidence : 1,
    evidence: Array.isArray(node.evidence) ? node.evidence.map((item) => ({ ...item })) : [],
    semanticRole: String(node.semanticRole || semanticRole(family)),
  };
  return compileSemanticVisualNode(normalized);
}

function normalizeEdge(edge = {}, index) {
  return {
    ...edge,
    id: String(edge.id || `figure-edge-${index + 1}`),
    sourceEdgeId: String(edge.sourceEdgeId || edge.id || `figure-edge-${index + 1}`),
    source: String(edge.source || ""),
    target: String(edge.target || ""),
    type: String(edge.type || "signal"),
    label: String(edge.label || ""),
  };
}

function normalizeFigure(figure = {}) {
  return {
    title: String(figure?.title || "Neural Network Architecture"),
    subtitle: String(figure?.subtitle || "Universal publication figure"),
    stages: Array.isArray(figure?.stages) ? figure.stages.map(String) : [],
  };
}

function stageOrder(nodes) {
  const stages = [...new Set(nodes.map((node) => String(node.stage)))];
  return stages.sort((left, right) => {
    const a = Number(left);
    const b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
    return left.localeCompare(right);
  });
}

function stageLabel(stage, nodes) {
  const node = nodes.find((item) => String(item.stage) === stage);
  return node?.stageLabel || node?.figureLabel || node?.label || stage;
}

function compareNode(left, right) {
  return (left.order - right.order) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function representationFor(node) {
  // Publication (journal) style: processing layers are drawn as uniform
  // rounded "stage blocks" that carry the operator label and feature-map
  // dimensions inside the block, not as per-operator 3D glyphs. Input planes
  // and merge symbols keep their glyphs because journals draw them that way.
  if (node.family === "merge") return "operator-symbol";
  if (node.visualRole === "image-input") return "image-plane";
  if (node.visualRole === "sequence-input") return "sequence-strip";
  if (node.visualRole === "state-input") return "state-vector";
  if (node.visualRole === "vector-input") return "vector-column";
  if (node.visualRole === "volume-input") return "volume";
  if (node.visualRole === "unknown-input") return "unknown-outline";
  if (node.visualRole === "named-module") return "named-module";
  if (["attention", "recurrent", "graph", "custom"].includes(node.family)) return "compound";
  if (node.compoundKind && Array.isArray(node.attributes?.internalGraph?.nodes) && node.attributes.internalGraph.nodes.length > 0) return "compound";
  // Everything else (conv, pool, upsample, flatten, dense, output, …) is a
  // uniform publication block whose title is the operator and whose subtitle
  // is the tensor shape. Upsample/downsample direction is carried separately.
  return "publication-block";
}

function condenseLinearConvRuns(nodes, edges) {
  const ordered = [...nodes].sort(compareStageThenOrder);
  const outgoing = new Map();
  const incoming = new Map();
  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  });

  const replacement = new Map();
  const condensedNodes = [];
  let index = 0;

  while (index < ordered.length) {
    const first = ordered[index];

    // Only conv/volume/dense primaries absorb a trailing activation/norm.
    if (!isFoldablePrimary(first.family)) {
      condensedNodes.push(first);
      index += 1;
      continue;
    }

    // One unit: the primary plus its trailing modifier(s), in source order.
    const firstModifiers = collectTrailingModifiers(first, index + 1, ordered, outgoing, incoming);
    const sequence = [first, ...firstModifiers.modifiers];
    let cursor = firstModifiers.nextIndex;

    // Conv/volume chains repeat-merge consecutive structurally-identical
    // units; dense layers absorb their trailing modifier but keep one card
    // each (FC layers have distinct dimensions and must stay separate).
    if (isConvFamily(first.family)) {
      while (cursor < ordered.length) {
        const next = ordered[cursor];
        if (!isConvFamily(next.family) || next.family !== first.family) break;
        if (!isSingleLinearLink(sequence[sequence.length - 1].id, next.id, outgoing, incoming)) break;
        const nextModifiers = collectTrailingModifiers(next, cursor + 1, ordered, outgoing, incoming);
        if (modifierShape(nextModifiers.modifiers) !== modifierShape(firstModifiers.modifiers)) break;
        sequence.push(next, ...nextModifiers.modifiers);
        cursor = nextModifiers.nextIndex;
      }
    }

    if (sequence.length === 1) {
      // A lone primary with no trailing modifier and no repeat stays as-is.
      condensedNodes.push(first);
      index += 1;
      continue;
    }

    const primaryCount = sequence.filter((child) => isFoldablePrimary(child.family)).length;
    const modifierOps = [...new Set(sequence
      .filter((child) => isModifierFamily(child.family))
      .map((child) => child.op || child.label || child.family))];
    const last = sequence[sequence.length - 1];
    const groupId = `stage-${sequence[0].id}-${last.id}`;
    const internalEdges = [];
    for (let childIndex = 0; childIndex < sequence.length - 1; childIndex += 1) {
      const childEdge = (outgoing.get(sequence[childIndex].id) || []).find((edge) => edge.target === sequence[childIndex + 1].id);
      if (childEdge) internalEdges.push({ ...childEdge });
    }
    const children = sequence.map((child, childIndex) => ({
      ...child,
      x: 20 + childIndex * (Math.max(64, Math.min(92, child.w)) + 14),
      y: 74,
      w: Math.max(64, Math.min(92, child.w)),
      h: Math.max(96, Math.min(156, child.h)),
    }));
    const familyName = first.family === "volume" ? "Volume" : first.family === "dense" ? "FC" : "Conv";
    const modifierSuffix = modifierOps.length ? `+${modifierOps.join("+")}` : "";
    const repeatSuffix = primaryCount > 1 ? ` ×${primaryCount}` : "";
    const grouped = {
      ...first,
      id: groupId,
      label: `${familyName}${modifierSuffix}${repeatSuffix}`,
      subtitle: last.subtitle || shapeLabel(last.shape),
      shape: last.shape || first.shape,
      order: first.order,
      stage: first.stage,
      w: Math.max(104, 26 + primaryCount * 36),
      h: Math.max(96, first.h),
      repeatCount: primaryCount,
      layers: primaryCount,
      renderInternalGraph: false,
      attributes: {
        ...first.attributes,
        internalGraph: { nodes: children, edges: internalEdges },
        groupedFrom: sequence.map((child) => child.id),
      },
    };
    sequence.forEach((child) => replacement.set(child.id, groupId));
    condensedNodes.push(grouped);
    index = cursor;
  }

  const condensedEdges = edges
    .map((edge) => ({
      ...edge,
      source: replacement.get(edge.source) || edge.source,
      target: replacement.get(edge.target) || edge.target,
      preserveSelfLoop: edge.source === edge.target,
    }))
    .filter((edge) => edge.source !== edge.target || edge.preserveSelfLoop)
    .map(({ preserveSelfLoop, ...edge }) => edge);
  return { nodes: condensedNodes, edges: condensedEdges };
}

function isConvFamily(family) {
  return family === "conv" || family === "volume";
}

function isFoldablePrimary(family) {
  return isConvFamily(family) || family === "dense";
}

function isModifierFamily(family) {
  return family === "activation" || family === "norm";
}

function isSingleLinearLink(sourceId, targetId, outgoing, incoming) {
  const sourceOut = outgoing.get(sourceId) || [];
  const targetIn = incoming.get(targetId) || [];
  return sourceOut.length === 1 && targetIn.length === 1 && sourceOut[0].target === targetId;
}

function collectTrailingModifiers(primary, startIndex, ordered, outgoing, incoming) {
  const modifiers = [];
  let cursor = startIndex;
  let previous = primary;
  while (cursor < ordered.length && isModifierFamily(ordered[cursor].family)) {
    const next = ordered[cursor];
    if (!isSingleLinearLink(previous.id, next.id, outgoing, incoming)) break;
    modifiers.push(next);
    previous = next;
    cursor += 1;
  }
  return { modifiers, nextIndex: cursor };
}

function modifierShape(modifiers) {
  return modifiers.map((modifier) => modifier.family).join(",");
}

function compareStage(left, right) {
  const a = Number(left.stage);
  const b = Number(right.stage);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
  return String(left.stage).localeCompare(String(right.stage));
}

function layoutInnerGraph(node) {
  const raw = node.attributes?.internalGraph || node.internalGraph || (node.children ? {
    nodes: node.children,
    edges: node.internalEdges || [],
  } : null);
  if (!raw || !Array.isArray(raw.nodes)) {
    return node.family === "custom" || node.compoundKind === "unresolved"
      ? { kind: "unresolved", nodes: [], edges: [], message: "Internal topology requires evidence or runtime tracing." }
      : { kind: "semantic", nodes: [], edges: [] };
  }
  const innerNodes = raw.nodes.map((child, index) => {
    const family = String(child.family || child.type || "custom").toLowerCase();
    const [w, h] = FAMILY_SIZE[family] || [92, 54];
    return {
      ...child,
      id: String(child.id || `${node.id}-inner-${index + 1}`),
      family,
      label: String(child.label || child.op || `Op ${index + 1}`),
      subtitle: String(child.subtitle || ""),
      x: Number.isFinite(child.x) ? child.x : 20 + index * (w + 18),
      y: Number.isFinite(child.y) ? child.y : 82,
      w: Number.isFinite(child.w) ? child.w : w,
      h: Number.isFinite(child.h) ? child.h : h,
    };
  });
  const ids = new Set(innerNodes.map((child) => child.id));
  const innerEdges = Array.isArray(raw.edges)
    ? raw.edges
      .map((edge, index) => normalizeEdge(edge, index))
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    : [];
  return { kind: "topology", nodes: innerNodes, edges: innerEdges };
}

function buildRecurrentFigureLayout(sourceNodes, positionedNodes, sourceEdges, artboard) {
  const recurrentNode = sourceNodes.find((node) => isRecurrentLayoutNode(node))
    || sourceNodes.find((candidate) => sourceEdges.some((edge) => isStateEdge(edge) && String(edge.source) === String(candidate.id) && String(edge.target) === String(candidate.id)));
  if (!recurrentNode) return undefined;

  const positioned = positionedNodes.find((node) => node.id === recurrentNode.id);
  if (!positioned) return undefined;
  const sourceNodeId = String(recurrentNode.sourceNodeId || recurrentNode.id);
  const evidence = recurrentNode.recurrentEvidence || recurrentEvidenceForNode(recurrentNode, sourceEdges);
  const axis = ["time", "iteration", "unknown"].includes(String(evidence.repetition?.axis))
    ? String(evidence.repetition.axis)
    : "unknown";
  const collapsedWidth = Math.max(92, Math.min(132, Math.round(positioned.w * 0.4)));
  const expandedWidth = Math.max(positioned.w, collapsedWidth + 72);
  const gap = 44;
  const instances = [
    { role: "previous", expanded: false, x: positioned.x - gap - collapsedWidth, w: collapsedWidth },
    { role: "expanded", expanded: true, x: positioned.x, w: expandedWidth },
    { role: "next", expanded: false, x: positioned.x + expandedWidth + gap, w: collapsedWidth },
  ].map((instance) => ({
    id: `${sourceNodeId}:${instance.role}`,
    layoutNodeId: recurrentNode.id,
    sourceNodeId,
    role: instance.role,
    x: Math.round(instance.x),
    y: Math.round(positioned.y),
    w: Math.round(instance.w),
    h: Math.round(positioned.h),
    expanded: instance.expanded,
  }));
  const instanceMinX = Math.min(...instances.map((instance) => instance.x));
  const instanceMaxX = Math.max(...instances.map((instance) => instance.x + instance.w));
  const minX = artboard.x;
  const maxX = artboard.x + artboard.width;
  const shiftX = instanceMinX < minX
    ? minX - instanceMinX
    : instanceMaxX > maxX ? maxX - instanceMaxX : 0;
  instances.forEach((instance) => { instance.x += shiftX; });

  const edgeById = new Map(sourceEdges.map((edge) => [String(edge.sourceEdgeId || edge.id || ""), edge]));
  const transitions = Array.isArray(evidence.stateTransitions) ? evidence.stateTransitions : [];
  const railSources = new Map();
  transitions.forEach((transition) => {
    const sourceEdgeId = String(transition?.sourceEdgeId || "");
    const edge = edgeById.get(sourceEdgeId);
    if (edge && !transition.status && isStateEdge(edge)) {
      railSources.set(sourceEdgeId, {
        kind: normalizeRailKind(transition.kind),
        sourceEdgeId,
        sourceEndpointIds: cloneValue(transition.sourceEndpointIds || edge.sourceEndpointIds || edge.ports || {}),
      });
    }
  });
  sourceEdges.forEach((edge) => {
    if (!isStateEdge(edge)) return;
    const source = String(edge.source || "");
    const target = String(edge.target || "");
    if (source !== recurrentNode.id || target !== recurrentNode.id) return;
    const sourceEdgeId = String(edge.sourceEdgeId || edge.id || "");
    if (!railSources.has(sourceEdgeId)) {
      railSources.set(sourceEdgeId, {
        kind: normalizeRailKind(edge.type),
        sourceEdgeId,
        sourceEndpointIds: cloneValue(edge.sourceEndpointIds || edge.ports || {}),
      });
    }
  });
  const stateRails = [...railSources.values()].map((rail, index) => ({
    id: `${sourceNodeId}:state-rail:${rail.sourceEdgeId || index + 1}`,
    kind: rail.kind,
    sourceEdgeId: rail.sourceEdgeId,
    sourceEndpointIds: rail.sourceEndpointIds,
    points: railPoints(instances, index),
  }));
  const expandedInternalGraph = expandedInternalGraphFor(recurrentNode, evidence);
  const unresolved = expandedInternalGraph.status !== "resolved";
  const reason = expandedInternalGraph.reason || "internal topology evidence is absent";

  return {
    timeAxis: {
      axis,
      direction: "left-to-right",
      labels: ["previous", "current", "next"],
    },
    instances,
    expandedInstanceId: `${sourceNodeId}:expanded`,
    stateRails,
    expandedInternalGraph,
    uncertainty: { unresolved, reason: unresolved ? reason : "" },
  };
}

function buildRecurrentFigureLayouts(sourceNodes, positionedNodes, sourceEdges, artboard) {
  const layouts = {};
  sourceNodes.filter(isRecurrentLayoutNode).forEach((recurrentNode) => {
    const layout = buildRecurrentFigureLayout([recurrentNode], positionedNodes, sourceEdges, artboard);
    if (layout) layouts[String(recurrentNode.id)] = layout;
  });
  return layouts;
}

function isRecurrentLayoutNode(node = {}) {
  const family = String(node.family || node.type || "").toLowerCase();
  return ["recurrent", "rnn", "lstm", "gru"].includes(family)
    || isRecurrentEvidence(node);
}

function isRecurrentEvidence(node = {}) {
  const attributes = node.attributes || {};
  return isRecord(attributes.repetition)
    || Array.isArray(attributes.stateTransitions)
    || isRecord(node.recurrentEvidence?.repetition)
    || Array.isArray(node.recurrentEvidence?.stateTransitions);
}

function isStateEdge(edge = {}) {
  return /^(state|recurrent-state|loop)$/i.test(String(edge.type || ""));
}

function normalizeRailKind(kind) {
  return ["carry", "feedback", "update"].includes(String(kind)) ? String(kind) : "carry";
}

function railPoints(instances, index) {
  const y = Math.round(instances[0].y + 20 + index * 18);
  return [
    { x: instances[0].x + instances[0].w / 2, y },
    { x: instances[1].x + instances[1].w / 2, y },
    { x: instances[2].x + instances[2].w / 2, y },
  ];
}

function expandedInternalGraphFor(node, evidence) {
  const graph = evidence?.internalGraph || {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.map((child, index) => ({
    ...child,
    id: String(child?.id || child?.sourceNodeId || `${node.id}:internal-${index + 1}`),
    ...(child?.sourceNodeId !== undefined ? { sourceNodeId: String(child.sourceNodeId) } : {}),
  })) : [];
  const nodeIds = new Set(nodes.map((child) => child.id));
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const invalidEdges = rawEdges.filter((edge) => !nodeIds.has(String(edge?.source || "")) || !nodeIds.has(String(edge?.target || "")));
  const edges = rawEdges
      .filter((edge) => nodeIds.has(String(edge?.source || "")) && nodeIds.has(String(edge?.target || "")))
      .map((edge, index) => ({
        ...edge,
        id: String(edge?.id || edge?.sourceEdgeId || `${node.id}:internal-edge-${index + 1}`),
        sourceEdgeId: String(edge?.sourceEdgeId || edge?.id || `${node.id}:internal-edge-${index + 1}`),
        source: String(edge.source),
        target: String(edge.target),
      }))
  const status = graph.status === "resolved" && nodes.length > 0 && invalidEdges.length === 0 ? "resolved" : "unresolved";
  return {
    nodes,
    edges,
    ports: cloneValue(graph.ports || {}),
    status,
    diagnostics: cloneValue([...(graph.diagnostics || []), ...invalidEdges.map((edge) => ({ kind: "invalid-internal-edge", edge }))]),
    ...(status === "unresolved" ? { reason: String(graph.reason || "internal topology evidence is absent") } : {}),
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function routeEdge(edge, nodeMap, index, artboard) {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  const result = { ...edge, order: index };
  if (!source || !target) return result;
  const from = { x: source.x + source.w, y: source.y + source.h / 2 };
  const to = { x: target.x, y: target.y + target.h / 2 };
  if (source.id === target.id || edge.type === "loop") {
    const laneX = source.x + source.w + 34 + index * 8;
    result.route = {
      kind: "loop",
      points: [
        from,
        { x: laneX, y: from.y },
        { x: laneX, y: source.y - 28 - index * 12 },
        { x: source.x + source.w / 2, y: source.y - 28 - index * 12 },
        { x: to.x + source.w / 2, y: to.y - 28 - index * 12 },
        to,
      ],
    };
  } else if (["skip", "residual", "control", "alternative", "branch"].includes(String(edge.type).toLowerCase())) {
    const laneY = artboard.y + 36 + index * 24;
    // 平滑上绕弧线：从 source 右侧垂直上扬、越过顶部水平段、再垂直降到 target 左侧。
    // 用三次贝塞尔采样（kind 保持 "skip-lane" 以兼容既有消费者），折线点密集即视觉平滑。
    result.route = {
      kind: "skip-lane",
      points: bezierCurve(
        from,
        { x: from.x, y: laneY },
        { x: to.x, y: laneY },
        to,
        20,
      ),
    };
  } else if (Math.abs(to.y - from.y) > Math.max(source.h, target.h) * 0.8) {
    // Vertically separated endpoints (multi-row or cross-stage layouts): route
    // orthogonally instead of as a long diagonal across the gutter.
    const turnY = Math.round((from.y + to.y) / 2);
    result.route = {
      kind: "wrap",
      points: [from, { x: from.x, y: turnY }, { x: to.x, y: turnY }, to],
    };
  } else {
    result.route = { kind: "direct", points: [from, to] };
  }
  return result;
}

function bezierCurve(p0, p1, p2, p3, segments = 20) {
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push({
      x: Math.round(a * p0.x + b * p1.x + c * p2.x + d * p3.x),
      y: Math.round(a * p0.y + b * p1.y + c * p2.y + d * p3.y),
    });
  }
  return points;
}

function validateFigureLayout(nodes, edges, artboard) {
  const overlaps = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (intersects(nodes[left], nodes[right])) overlaps.push({ a: nodes[left].id, b: nodes[right].id });
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const invalidEdges = edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  const boundaryViolations = nodes.filter((node) => (
    node.x < artboard.x || node.y < artboard.y
      || node.x + node.w > artboard.x + artboard.width
      || node.y + node.h > artboard.y + artboard.height
  )).map((node) => node.id);
  return {
    ok: overlaps.length === 0 && invalidEdges.length === 0 && boundaryViolations.length === 0,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      overlapCount: overlaps.length,
      invalidEdgeCount: invalidEdges.length,
      boundaryViolationCount: boundaryViolations.length,
    },
    overlaps,
    invalidEdges,
    boundaryViolations,
  };
}

function intersects(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x
    && left.y < right.y + right.h && left.y + left.h > right.y;
}

function semanticRole(family) {
  if (family === "input") return "input";
  if (family === "output") return "output";
  if (family === "merge") return "merge";
  if (family === "attention") return "contextual_interaction";
  if (family === "custom") return "unresolved_operator";
  return "feature_transform";
}

function shapeLabel(shape) {
  const value = shape?.output || shape?.input;
  return Array.isArray(value) ? value.join(" × ") : "";
}

function normalizeArtboard(artboard) {
  return {
    x: Number.isFinite(artboard?.x) ? artboard.x : DEFAULT_ARTBOARD.x,
    y: Number.isFinite(artboard?.y) ? artboard.y : DEFAULT_ARTBOARD.y,
    width: Number.isFinite(artboard?.width) ? artboard.width : DEFAULT_ARTBOARD.width,
    height: Number.isFinite(artboard?.height) ? artboard.height : DEFAULT_ARTBOARD.height,
  };
}
