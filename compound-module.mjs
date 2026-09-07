const COMPOUND_MIN_SIZES = Object.freeze({
  transformer: Object.freeze({ width: 320, height: 250 }),
  attention: Object.freeze({ width: 320, height: 250 }),
  operator: Object.freeze({ width: 320, height: 250 }),
  residual: Object.freeze({ width: 300, height: 220 }),
  diffusion: Object.freeze({ width: 320, height: 250 }),
  stage: Object.freeze({ width: 250, height: 180 }),
  "volume-stage": Object.freeze({ width: 300, height: 220 }),
  unresolved: Object.freeze({ width: 320, height: 250 }),
});

const SUPPORTED_KINDS = new Set(["transformer", "attention", "operator", "residual", "diffusion", "stage", "volume-stage"]);

export function compoundKindForNode(node = {}) {
  if (node.type === "encoder" || node.type === "transformer" || node.compoundKind === "transformer") {
    return "transformer";
  }
  if (node.type === "attention" || node.compoundKind === "attention") {
    return "attention";
  }
  if (node.type === "block" || node.compoundKind === "operator") {
    return "operator";
  }
  if (node.compoundKind === "residual") return "residual";
  if (node.compoundKind === "diffusion") return "diffusion";
  if (node.compoundKind === "stage") return "stage";
  if (node.compoundKind === "volume-stage") return "volume-stage";
  if (node.type === "compound" && SUPPORTED_KINDS.has(node.compoundKind)) {
    return node.compoundKind;
  }
  return "unresolved";
}

export function normalizeCompoundNode(node = {}) {
  const kind = compoundKindForNode(node);
  const isLegacyCompound = node.type === "encoder" || node.type === "attention" || node.type === "block" || node.type === "compound";
  if (!isLegacyCompound) return { ...node };
  const minSize = COMPOUND_MIN_SIZES[kind] || COMPOUND_MIN_SIZES.unresolved;

  return {
    ...node,
    type: "compound",
    compoundKind: kind,
    w: Math.max(Number(node.w) || 0, minSize.width),
    h: Math.max(Number(node.h) || 0, minSize.height),
  };
}

export function getCompoundLayout(node = {}) {
  const normalized = normalizeCompoundNode(node);
  const kind = compoundKindForNode(normalized);
  const minSize = COMPOUND_MIN_SIZES[kind] || COMPOUND_MIN_SIZES.unresolved;
  const width = Math.max(normalized.w || 0, minSize.width);
  const height = Math.max(normalized.h || 0, minSize.height);

  if (normalized.recurrentLayout) {
    return recurrentLayout(normalized, width, height);
  }

  const evidencedLayout = layoutFromInternalGraph(normalized, width, height);
  if (evidencedLayout) return evidencedLayout;

  if (kind === "transformer") return transformerLayout(normalized, width, height);
  if (kind === "attention") return attentionLayout(normalized, width, height);
  if (kind === "operator") return operatorLayout(normalized, width, height);
  if (kind === "residual") return residualLayout(normalized, width, height);
  if (kind === "diffusion") return diffusionLayout(normalized, width, height);
  if (kind === "stage") return stageLayout(normalized, width, height);
  if (kind === "volume-stage") return volumeStageLayout(normalized, width, height);

  return {
    kind: "unresolved",
    width,
    height,
    title: normalized.label || "Unresolved module",
    subtitle: normalized.subtitle || "structure requires review",
    repeat: null,
    children: [{
      id: `${normalized.id || "compound"}-unresolved`,
      kind: "unresolved",
      label: normalized.label || "Unresolved module",
      subtitle: "structure requires review",
      x: 20,
      y: 92,
      w: width - 40,
      h: Math.max(70, height - 125),
    }],
    edges: [],
  };
}

function recurrentLayout(node, baseWidth, baseHeight) {
  const plan = node.recurrentLayout || {};
  const rawInstances = Array.isArray(plan.instances) ? plan.instances : [];
  const roles = ["previous", "expanded", "next"];
  const expandedInstanceId = String(plan.expandedInstanceId || "");
  const sourceNodeId = String(node.sourceNodeId || node.id || "compound");
  const expandedGraph = plan.expandedInternalGraph || {};
  const resolved = expandedGraph.status === "resolved" && Array.isArray(expandedGraph.nodes) && expandedGraph.nodes.length > 0;
  const collapsedWidth = 118;
  const expandedWidth = Math.max(baseWidth, 340);
  const gap = 28;
  const width = Math.max(baseWidth, collapsedWidth * 2 + expandedWidth + gap * 2 + 36);
  const height = Math.max(baseHeight, 330);
  const instanceHeight = Math.min(184, height - 108);
  const instanceSpecs = roles.map((role, index) => {
    const declared = rawInstances.find((item) => String(item?.role || "") === role) || {};
    const expanded = role === "expanded";
    const id = String(declared.id || `${sourceNodeId}:${role}`);
    return {
      id,
      sourceNodeId: String(declared.sourceNodeId || sourceNodeId),
      role,
      expanded,
      x: 18 + (index === 0 ? 0 : index === 1 ? collapsedWidth + gap : collapsedWidth + gap + expandedWidth + gap),
      y: 76,
      w: expanded ? expandedWidth : collapsedWidth,
      h: instanceHeight,
      expandedInstanceId: expanded ? (expandedInstanceId || id) : undefined,
    };
  });
  const expandedInstance = instanceSpecs[1];
  const children = resolved
    ? normalizeInternalChildren({ ...node, id: expandedInstance.id }, expandedGraph.nodes, expandedInstance.w - 24, expandedInstance.h - 24)
    : [{
      id: `${expandedInstance.id}:unresolved`,
      kind: "unresolved",
      label: node.label || "Unresolved recurrent step",
      subtitle: String(expandedGraph.reason || plan.uncertainty?.reason || "internal topology evidence is absent"),
      x: expandedInstance.x + 18,
      y: expandedInstance.y + 54,
      w: expandedInstance.w - 36,
      h: Math.max(64, expandedInstance.h - 74),
    }];

  if (resolved) {
    positionInternalChildren(children, normalizedRecurrentEdges(expandedGraph.edges, children), expandedInstance.w - 24, expandedInstance.h - 24);
    children.forEach((child) => {
      child.x += expandedInstance.x;
      child.y += expandedInstance.y;
    });
  }
  const childIds = new Set(children.map((child) => child.id));
  const edges = normalizedRecurrentEdges(expandedGraph.edges, children, expandedInstance);
  const stateRails = (Array.isArray(plan.stateRails) ? plan.stateRails : []).map((rail, index) => ({
    id: String(rail.id || `${sourceNodeId}:state-rail:${index + 1}`),
    kind: String(rail.kind || "carry"),
    sourceEdgeId: String(rail.sourceEdgeId || ""),
    points: [
      { x: instanceSpecs[0].x + instanceSpecs[0].w / 2, y: 58 + index * 16 },
      { x: instanceSpecs[1].x + instanceSpecs[1].w / 2, y: 58 + index * 16 },
      { x: instanceSpecs[2].x + instanceSpecs[2].w / 2, y: 58 + index * 16 },
    ],
  }));
  return {
    kind: "recurrent",
    width,
    height,
    title: node.label || "Recurrent module",
    subtitle: node.subtitle || "time-unrolled state transition",
    repeat: node.badge || null,
    instances: instanceSpecs.map(({ expandedInstanceId: _expandedInstanceId, ...instance }) => instance),
    expandedInstanceId: expandedInstanceId || instanceSpecs[1].id,
    stateRails,
    children: children.filter((child) => childIds.has(child.id)),
    edges,
    uncertainty: {
      unresolved: !resolved || Boolean(plan.uncertainty?.unresolved),
      reason: !resolved
        ? String(expandedGraph.reason || plan.uncertainty?.reason || "internal topology evidence is absent")
        : String(plan.uncertainty?.reason || ""),
    },
  };
}

function normalizedRecurrentEdges(rawEdges, children, expandedInstance) {
  const childIds = new Set(children.map((child) => child.id));
  return (Array.isArray(rawEdges) ? rawEdges : [])
    .map((item, index) => ({
      id: String(item?.id || `recurrent-inner-edge-${index + 1}`),
      source: String(item?.source || ""),
      target: String(item?.target || ""),
      kind: internalEdgeKind(item?.type || item?.kind),
      label: String(item?.label || ""),
    }))
    .filter((edge) => childIds.has(edge.source) && childIds.has(edge.target))
    .map((edge) => expandedInstance ? { ...edge, expandedInstanceId: expandedInstance.id } : edge);
}

function layoutFromInternalGraph(node, width, height) {
  const raw = internalGraphForNode(node);
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) return null;

  const children = normalizeInternalChildren(node, raw.nodes, width, height);
  const childIds = new Set(children.map((child) => child.id));
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map((item, index) => ({
      id: String(item.id || `${node.id || "compound"}-inner-edge-${index + 1}`),
      source: String(item.source || ""),
      target: String(item.target || ""),
      kind: internalEdgeKind(item.type || item.kind),
      label: String(item.label || ""),
    }))
    .filter((edge) => childIds.has(edge.source) && childIds.has(edge.target));

  positionInternalChildren(children, edges, width, height);
  return {
    kind: "topology",
    width,
    height,
    title: node.label || "Custom module",
    subtitle: node.subtitle || "evidenced internal topology",
    repeat: node.badge || repeatLabel(node),
    children,
    edges,
  };
}

function internalGraphForNode(node) {
  const candidates = [
    node.inner,
    node.attributes?.internalGraph,
    node.internalGraph,
    node.children ? { nodes: node.children, edges: node.internalEdges || [] } : null,
  ];
  return candidates.find((candidate) => candidate && Array.isArray(candidate.nodes) && candidate.nodes.length > 0) || null;
}

function normalizeInternalChildren(parent, rawNodes, width, height) {
  const seen = new Set();
  const maxWidth = Math.max(62, Math.floor((width - 64) / Math.max(1, Math.min(rawNodes.length, 4))));
  const maxHeight = Math.max(38, Math.floor((height - 112) / Math.max(1, Math.min(rawNodes.length, 4))));
  return rawNodes.map((item = {}, index) => {
    const requestedId = String(item.id || `${parent.id || "compound"}-inner-${index + 1}`);
    let id = requestedId;
    while (seen.has(id)) id = `${requestedId}-${index + 1}`;
    seen.add(id);
    const kind = internalChildKind(item);
    return {
      id,
      kind,
      label: String(item.label || item.op || item.type || `Operation ${index + 1}`),
      subtitle: String(item.subtitle || item.shapeLabel || ""),
      x: Number.isFinite(item.x) ? item.x : 0,
      y: Number.isFinite(item.y) ? item.y : 0,
      w: Math.min(Math.max(48, Number(item.w) || internalChildWidth(kind)), maxWidth),
      h: Math.min(Math.max(32, Number(item.h) || internalChildHeight(kind)), maxHeight),
      depth: Number.isFinite(item.depth) ? item.depth : undefined,
      order: Number.isFinite(item.order) ? item.order : index,
    };
  });
}

function internalChildKind(item = {}) {
  const value = String(item.kind || item.family || item.type || item.op || "custom").toLowerCase();
  if (["add", "merge", "concat", "sum", "join"].includes(value)) return "add";
  if (["attention", "qkv", "mlp", "latent", "timestep", "condition", "denoise", "volume", "norm", "conv", "activation", "projection", "operator", "pool", "flatten", "dense", "recurrent", "graph", "unresolved"].includes(value)) {
    return value;
  }
  return "unresolved";
}

function internalChildWidth(kind) {
  if (kind === "attention") return 104;
  if (kind === "volume") return 72;
  if (kind === "add") return 48;
  if (kind === "latent" || kind === "condition" || kind === "timestep") return 72;
  return 84;
}

function internalChildHeight(kind) {
  if (kind === "attention" || kind === "volume") return 58;
  if (kind === "add") return 48;
  return 42;
}

function internalEdgeKind(value) {
  const kind = String(value || "signal").toLowerCase();
  if (["skip", "shortcut", "residual"].includes(kind)) return "residual";
  return kind || "signal";
}

function positionInternalChildren(children, edges, width, height) {
  const childIds = new Set(children.map((child) => child.id));
  const incoming = new Map(children.map((child) => [child.id, 0]));
  const outgoing = new Map(children.map((child) => [child.id, []]));
  edges.forEach((edge) => {
    if (!childIds.has(edge.source) || !childIds.has(edge.target)) return;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  });

  const rank = new Map(children.map((child) => [child.id, 0]));
  const queue = children.filter((child) => incoming.get(child.id) === 0).sort(compareInternalChild);
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    outgoing.get(current.id).forEach((targetId) => {
      rank.set(targetId, Math.max(rank.get(targetId), rank.get(current.id) + 1));
      incoming.set(targetId, incoming.get(targetId) - 1);
      if (incoming.get(targetId) === 0) queue.push(children.find((child) => child.id === targetId));
    });
  }

  children.filter((child) => !visited.has(child.id)).forEach((child, index) => {
    rank.set(child.id, Math.max(rank.get(child.id), index));
  });
  const columns = [...new Set(children.map((child) => rank.get(child.id)))].sort((a, b) => a - b);
  const groups = columns.map((column) => children.filter((child) => rank.get(child.id) === column).sort(compareInternalChild));
  const innerX = 20;
  const innerY = 64;
  const innerWidth = Math.max(80, width - 40);
  const innerHeight = Math.max(60, height - 86);
  const gapX = columns.length > 1 ? Math.max(10, Math.min(24, Math.floor((innerWidth - 80 * columns.length) / (columns.length - 1)))) : 0;
  const columnWidths = groups.map((group) => Math.max(...group.map((child) => child.w), 48));
  const requiredWidth = columnWidths.reduce((sum, value) => sum + value, 0) + gapX * Math.max(0, columns.length - 1);
  const scaleX = requiredWidth > innerWidth ? innerWidth / requiredWidth : 1;
  let cursorX = innerX;
  groups.forEach((group, groupIndex) => {
    const columnWidth = columnWidths[groupIndex] * scaleX;
    const gapY = group.length > 1
      ? Math.max(4, Math.min(12, Math.floor((innerHeight - 4 * group.length) / (group.length - 1))))
      : 0;
    const rawHeight = group.reduce((sum, child) => sum + child.h, 0);
    const availableHeight = Math.max(4 * group.length, innerHeight - gapY * Math.max(0, group.length - 1));
    const scaleY = rawHeight > availableHeight ? availableHeight / rawHeight : 1;
    const totalHeight = group.reduce((sum, child) => sum + child.h * scaleY, 0) + gapY * Math.max(0, group.length - 1);
    let cursorY = innerY + Math.max(0, (innerHeight - totalHeight) / 2);
    group.forEach((child) => {
      child.x = Math.round(cursorX + (columnWidth - child.w * scaleX) / 2);
      child.y = Math.round(cursorY);
      child.w = Math.max(42, Math.round(child.w * scaleX));
      child.h = Math.max(4, Math.round(child.h * scaleY));
      cursorY += child.h + gapY;
    });
    cursorX += columnWidth + gapX;
  });
}

function compareInternalChild(left, right) {
  return (left.order - right.order) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function operatorLayout(node, width, height) {
  const id = node.id || "operator";
  const children = [
    child(id, "operator", "operator", node.label || "Operator", "learned transform", 24, 96, 112, 48),
    child(id, "activation", "activation", "Activation", "non-linearity", 154, 96, 92, 48),
    child(id, "projection", "projection", "Output", node.subtitle || "feature state", 256, 96, 48, 48),
  ];
  return {
    kind: "operator",
    width,
    height,
    title: node.label || "Operator module",
    subtitle: node.subtitle || "learned operator chain",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "operator", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function residualLayout(node, width, height) {
  const id = node.id || "residual";
  const children = [
    child(id, "norm", "norm", "Norm", "identity", 16, 62, 62, 30),
    child(id, "conv-1", "conv", "1×1", "reduce", 88, 54, 64, 46),
    child(id, "activation", "activation", "ReLU", "non-linearity", 160, 54, 64, 46),
    child(id, "conv-2", "conv", "3×3", "spatial", 232, 54, 64, 46),
    child(id, "projection", "projection", "Shortcut", "identity / proj", 88, 132, 82, 36),
    child(id, "add", "add", "+", "merge", 224, 126, 50, 50),
  ];
  return {
    kind: "residual",
    width,
    height,
    title: node.label || "Residual Block",
    subtitle: node.subtitle || "main branch + shortcut",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "norm", "conv-1", "signal"),
      edge(children, "conv-1", "activation", "signal"),
      edge(children, "activation", "conv-2", "signal"),
      edge(children, "conv-2", "add", "signal"),
      edge(children, "norm", "projection", "residual"),
      edge(children, "projection", "add", "residual"),
    ],
  };
}

function diffusionLayout(node, width, height) {
  const id = node.id || "diffusion";
  const children = [
    child(id, "latent", "latent", "xₜ", "noisy latent", 16, 104, 54, 38),
    child(id, "timestep", "timestep", "t", "time embedding", 84, 48, 82, 32),
    child(id, "condition", "condition", "Cond", "text / class", 84, 166, 82, 32),
    child(id, "attention", "attention", "Cross-Attn", "Q latent · K/V cond", 184, 76, 94, 68),
    child(id, "denoise", "denoise", "Denoise", "U-Net update", 184, 166, 88, 38),
    child(id, "add", "add", "+", "residual", 278, 162, 34, 46),
  ];
  return {
    kind: "diffusion",
    width,
    height,
    title: node.label || "Diffusion Core",
    subtitle: node.subtitle || "latent · timestep · condition",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "latent", "attention", "signal"),
      edge(children, "timestep", "attention", "time"),
      edge(children, "condition", "attention", "condition"),
      edge(children, "attention", "denoise", "signal"),
      edge(children, "denoise", "add", "signal"),
      edge(children, "latent", "add", "residual"),
    ],
  };
}

function stageLayout(node, width, height) {
  const id = node.id || "stage";
  const children = [
    child(id, "conv", "conv", "Conv", "feature", 12, 102, 52, 44),
    child(id, "norm", "norm", "Norm", "stabilize", 72, 102, 52, 44),
    child(id, "activation", "activation", "Act", "ReLU", 132, 102, 52, 44),
    child(id, "projection", "projection", "Out", "tensor", 192, 102, 46, 44),
  ];
  return {
    kind: "stage",
    width,
    height,
    title: node.label || "Feature Stage",
    subtitle: node.subtitle || "Conv · Norm · Activation",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "conv", "norm", "signal"),
      edge(children, "norm", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function transformerLayout(node, width, height) {
  const id = node.id || "transformer";
  const children = [
    child(id, "norm-1", "norm", "LayerNorm", "pre-attention", 18, 58, 76, 32),
    child(id, "qkv", "qkv", "Q / K / V", "linear projections", 108, 52, 82, 44),
    child(id, "attention", "attention", "Attention", "softmax(QKᵀ)V", 208, 44, 80, 62),
    child(id, "projection", "projection", "Projection", "output linear", 108, 120, 82, 32),
    child(id, "add-1", "add", "+", "residual", 220, 124, 44, 44),
    child(id, "norm-2", "norm", "LayerNorm", "pre-MLP", 18, 190, 76, 32),
    child(id, "mlp", "mlp", "MLP", "GELU · Linear", 108, 178, 92, 56),
    child(id, "add-2", "add", "+", "residual", 220, 184, 44, 44),
  ];

  return {
    kind: "transformer",
    width,
    height,
    title: node.label || "Transformer Block",
    subtitle: node.subtitle || "LayerNorm · Attention · MLP",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "norm-1", "qkv", "signal"),
      edge(children, "qkv", "attention", "attention"),
      edge(children, "attention", "projection", "signal"),
      edge(children, "projection", "add-1", "signal"),
      edge(children, "qkv", "add-1", "residual"),
      edge(children, "add-1", "norm-2", "signal"),
      edge(children, "norm-2", "mlp", "signal"),
      edge(children, "mlp", "add-2", "signal"),
      edge(children, "add-1", "add-2", "residual"),
    ],
  };
}

function attentionLayout(node, width, height) {
  const id = node.id || "attention";
  const children = [
    child(id, "norm", "norm", "Norm", "query input", 18, 82, 72, 32),
    child(id, "qkv", "qkv", "Q / K / V", "project", 104, 76, 82, 44),
    child(id, "attention", "attention", "Attention", "cross-token weights", 204, 66, 94, 70),
    child(id, "projection", "projection", "Output", "linear", 104, 144, 82, 32),
    child(id, "add", "add", "+", "residual", 222, 140, 44, 44),
  ];

  return {
    kind: "attention",
    width,
    height,
    title: node.label || "Attention",
    subtitle: node.subtitle || "Q · K · V interaction",
    repeat: node.badge || null,
    children,
    edges: [
      edge(children, "norm", "qkv", "signal"),
      edge(children, "qkv", "attention", "attention"),
      edge(children, "attention", "projection", "signal"),
      edge(children, "projection", "add", "signal"),
      edge(children, "qkv", "add", "residual"),
    ],
  };
}

function volumeStageLayout(node, width, height) {
  const id = node.id || "volume-stage";
  const children = [
    child(id, "volume", "volume", "Volume", node.subtitle || "D × H × W", 10, 72, 58, 74, { depth: 14 }),
    child(id, "conv", "conv", "Conv3D", "kernel", 80, 88, 54, 42),
    child(id, "norm", "norm", "Norm", "stabilize", 142, 88, 54, 42),
    child(id, "activation", "activation", "Act", "ReLU", 204, 88, 54, 42),
    child(id, "projection", "projection", "Out", "maps", 266, 88, 28, 42),
  ];
  return {
    kind: "volume-stage",
    width,
    height,
    title: node.label || "3D Volume Stage",
    subtitle: node.subtitle || "volume · Conv3D · Norm · Act",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "volume", "conv", "signal"),
      edge(children, "conv", "norm", "signal"),
      edge(children, "norm", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function child(parentId, suffix, kind, label, subtitle, x, y, w, h, extra = {}) {
  return { id: `${parentId}-${suffix}`, kind, label, subtitle, x, y, w, h, ...extra };
}

function edge(children, sourceSuffix, targetSuffix, kind) {
  const source = children.find((item) => item.id.endsWith(`-${sourceSuffix}`));
  const target = children.find((item) => item.id.endsWith(`-${targetSuffix}`));
  return { source: source.id, target: target.id, kind };
}

function repeatLabel(node) {
  const count = Number(node.repeatCount ?? node.layers);
  return Number.isFinite(count) && count > 1 ? `×${count}` : null;
}
