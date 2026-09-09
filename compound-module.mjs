// compound-module.mjs
//
// Compound-module rendering is fully data-driven. A compound node renders in
// exactly one of three ways:
//
//   1. `recurrentLayout`   — the node unrolls its recurrent time instances
//                            (previous / expanded / next) plus state rails.
//   2. `layoutFromInternalGraph` — the node renders the internal graph the
//                            analyzer *evidenced* (node.inner /
//                            attributes.internalGraph / node.children) through
//                            a generic topology layout.
//   3. `unresolvedLayout`  — no evidence, so it stays an unresolved block.
//
// There is NO per-architecture template here: no hand-written "Transformer
// Block looks like this", "Residual Block looks like this", "Diffusion Core
// looks like this". A named module (C2f, SPPF, Bottleneck, Transformer Block,
// …) either brings its internal graph as data or renders as a single color
// block (`compoundKind:"module"`). The renderer never invents structure.

export function getCompoundLayout(node = {}) {
  const width = Math.max(Number(node.w) || 0, 320);
  const height = Math.max(Number(node.h) || 0, 250);

  if (node.recurrentLayout) {
    return recurrentLayout(node, width, height);
  }

  const evidencedLayout = layoutFromInternalGraph(node, width, height);
  if (evidencedLayout) return evidencedLayout;

  return unresolvedLayout(node, width, height);
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

function unresolvedLayout(node, width, height) {
  return {
    kind: "unresolved",
    width,
    height,
    title: node.label || "Unresolved module",
    subtitle: node.subtitle || "structure requires review",
    repeat: null,
    children: [{
      id: `${node.id || "compound"}-unresolved`,
      kind: "unresolved",
      label: node.label || "Unresolved module",
      subtitle: "structure requires review",
      x: 20,
      y: 92,
      w: width - 40,
      h: Math.max(70, height - 125),
    }],
    edges: [],
  };
}

function repeatLabel(node) {
  const count = Number(node.repeatCount ?? node.layers);
  return Number.isFinite(count) && count > 1 ? `×${count}` : null;
}
