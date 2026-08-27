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
  const sourceNodes = Array.isArray(ir.nodes) ? ir.nodes.map((node, index) => normalizeNode(node, index)) : [];
  const sourceEdges = Array.isArray(ir.edges) ? ir.edges.map((edge, index) => normalizeEdge(edge, index)) : [];
  const stages = stageOrder(sourceNodes);
  const stageGap = stages.length > 1 ? (artboard.width - 260) / (stages.length - 1) : 0;
  const nodes = [];

  stages.forEach((stage, stageIndex) => {
    const members = sourceNodes
      .filter((node) => String(node.stage) === stage)
      .sort(compareNode);
    const totalHeight = members.reduce((sum, node) => sum + node.h, 0);
    const gap = members.length > 1 ? Math.max(26, Math.min(54, Math.floor((artboard.height - 120 - totalHeight) / (members.length - 1)))) : 0;
    let cursor = artboard.y + Math.max(60, Math.floor((artboard.height - totalHeight - gap * Math.max(0, members.length - 1)) / 2));
    members.forEach((node) => {
      const rawX = Math.round(artboard.x + 130 + stageGap * stageIndex - node.w / 2);
      const x = Math.max(artboard.x, Math.min(artboard.x + artboard.width - node.w, rawX));
      const y = Math.round(cursor);
      const positioned = {
        ...node,
        x,
        y,
        stageIndex,
        representation: representationFor(node),
        inner: layoutInnerGraph(node),
        note: node.note || (node.family === "custom" ? "unresolved structure · review evidence" : ""),
      };
      nodes.push(positioned);
      cursor += node.h + gap;
    });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = sourceEdges.map((edge, index) => routeEdge(edge, nodeMap, index, artboard));
  const validation = validateFigureLayout(nodes, edges, artboard);
  return {
    version: PLAN_VERSION,
    grammar,
    figure: { ...figure, stages: stages.map((stage) => stageLabel(stage, sourceNodes)) },
    artboard,
    nodes,
    edges,
    validation,
  };
}

function grammar(id, reason, confidence) {
  return { id, reason, confidence, source: "semantic-topology" };
}

function normalizeNode(node = {}, index) {
  const family = String(node.family || node.type || "custom").toLowerCase();
  const [defaultW, defaultH] = FAMILY_SIZE[family] || FAMILY_SIZE.default;
  return {
    ...node,
    id: String(node.id || `figure-node-${index + 1}`),
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
}

function normalizeEdge(edge = {}, index) {
  return {
    ...edge,
    id: String(edge.id || `figure-edge-${index + 1}`),
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
  return node?.stageLabel || node?.label || stage;
}

function compareNode(left, right) {
  return (left.order - right.order) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function representationFor(node) {
  if (node.family === "input" || node.family === "output" || node.family === "conv" || node.family === "volume") return "volume";
  if (node.family === "pool" || node.family === "merge") return "operator-symbol";
  if (["attention", "recurrent", "graph", "custom"].includes(node.family)) return "compound";
  return "operator";
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

function routeEdge(edge, nodeMap, index, artboard) {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  const result = { ...edge, order: index };
  if (!source || !target) return result;
  const from = { x: source.x + source.w, y: source.y + source.h / 2 };
  const to = { x: target.x, y: target.y + target.h / 2 };
  if (edge.type === "skip" || edge.type === "residual") {
    const laneY = artboard.y + 36 + index * 24;
    result.route = {
      kind: "skip-lane",
      points: [from, { x: from.x + 20, y: laneY }, { x: to.x - 20, y: laneY }, to],
    };
  } else {
    result.route = { kind: "direct", points: [from, to] };
  }
  return result;
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
