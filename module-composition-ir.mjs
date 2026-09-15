const PATTERNS = new Set(["sequential", "parallel", "residual", "fusion", "attention", "recurrent", "transform", "opaque"]);
const FAMILY_SIZE = Object.freeze({ conv: [96, 46], norm: [82, 38], activation: [82, 38], merge: [54, 54], attention: [128, 64], recurrent: [128, 64], custom: [110, 46], default: [92, 42] });

export function compileModuleComposition(node = {}) {
  const raw = node.attributes?.internalGraph || node.internalGraph || (node.children ? {
    nodes: node.children,
    edges: node.internalEdges || [],
  } : null);
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.map((child, index) => normalizeChild(child, index)) : [];
  const ids = new Set(nodes.map((child) => child.id));
  const edges = Array.isArray(raw?.edges)
    ? raw.edges.map((edge, index) => normalizeEdge(edge, index)).filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    : [];
  const pattern = inferPattern(nodes, edges, node.modulePattern);
  return {
    version: "module-composition-ir/v1",
    id: String(node.id || "module"),
    pattern,
    nodes,
    edges,
    ports: {
      inputs: findBoundaryNodes(nodes, edges, "input"),
      outputs: findBoundaryNodes(nodes, edges, "output"),
    },
    repeat: { count: Math.max(1, Number(node.repeatCount || node.repeat?.count || 1)) },
  };
}

export function layoutModuleComposition(composition = {}, options = {}) {
  const nodes = Array.isArray(composition.nodes) ? composition.nodes.map((node) => ({ ...node })) : [];
  const edges = Array.isArray(composition.edges) ? composition.edges.map((edge) => ({ ...edge })) : [];
  const gap = positive(options.gap, 18);
  const padding = positive(options.padding, 24);
  if (!nodes.length) return { ...composition, nodes, edges, bounds: { x: 0, y: 0, w: padding * 2, h: padding * 2 + 28 } };
  const columns = assignColumns(nodes, edges);
  const byColumn = new Map();
  for (const node of nodes) {
    const column = columns.get(node.id) || 0;
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column).push(node);
  }
  let x = padding;
  let maxY = padding + 28;
  for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
    const members = byColumn.get(column).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    let y = padding + 28;
    let width = 0;
    for (const node of members) {
      node.x = x;
      node.y = y;
      y += node.h + gap;
      width = Math.max(width, node.w);
    }
    maxY = Math.max(maxY, y - gap);
    x += width + gap * 2;
  }
  const translated = normalizeLocalEdges(nodes, edges);
  return {
    ...composition,
    nodes,
    edges: translated,
    bounds: { x: 0, y: 0, w: Math.max(padding * 2, x - gap + padding), h: maxY + padding },
  };
}

function normalizeChild(child = {}, index) {
  return {
    ...child,
    id: String(child.id || `inner-${index + 1}`),
    label: String(child.label || child.op || `Operator ${index + 1}`),
    family: String(child.family || child.type || "custom").toLowerCase(),
    order: Number.isFinite(Number(child.order)) ? Number(child.order) : index,
    w: positive(child.w, FAMILY_SIZE[String(child.family || child.type || "custom").toLowerCase()]?.[0] || FAMILY_SIZE.default[0]),
    h: positive(child.h, FAMILY_SIZE[String(child.family || child.type || "custom").toLowerCase()]?.[1] || FAMILY_SIZE.default[1]),
  };
}

function normalizeEdge(edge = {}, index) {
  return { ...edge, id: String(edge.id || `inner-edge-${index + 1}`), source: String(edge.source || ""), target: String(edge.target || "") };
}

function inferPattern(nodes, edges, declared) {
  if (PATTERNS.has(String(declared || "").toLowerCase())) return String(declared).toLowerCase();
  const incoming = degree(nodes, edges, "target");
  const outgoing = degree(nodes, edges, "source");
  if (edges.some((edge) => /attention|cross/i.test(String(edge.type || "")))) return "attention";
  if (edges.some((edge) => /recurrent|state|loop/i.test(String(edge.type || "")))) return "recurrent";
  if (edges.some((edge) => /residual|skip|shortcut/i.test(String(edge.type || "")))) return "residual";
  if ([...outgoing.values()].some((count) => count > 1)) return "parallel";
  if ([...incoming.values()].some((count) => count > 1)) return "fusion";
  return edges.length ? "sequential" : "opaque";
}

function assignColumns(nodes, edges) {
  const column = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.max(column.get(edge.target) || 0, (column.get(edge.source) || 0) + 1);
      if (next !== column.get(edge.target)) { column.set(edge.target, next); changed = true; }
    }
    if (!changed) break;
  }
  return column;
}

function normalizeLocalEdges(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return { ...edge };
    const from = { x: source.x + source.w, y: source.y + source.h / 2 };
    const to = { x: target.x, y: target.y + target.h / 2 };
    const kind = /residual|skip|shortcut/i.test(String(edge.type || "")) ? "bypass" : "direct";
    const top = Math.min(source.y, target.y) - 14;
    return { ...edge, route: { kind, points: kind === "bypass"
      ? [from, { x: from.x + 10, y: from.y }, { x: from.x + 10, y: top }, { x: to.x - 10, y: top }, { x: to.x - 10, y: to.y }, to]
      : [from, to] } };
  });
}

function findBoundaryNodes(nodes, edges, side) {
  const connected = new Set(edges.map((edge) => side === "input" ? edge.target : edge.source));
  return nodes.filter((node) => !connected.has(node.id)).map((node) => node.id);
}

function degree(nodes, edges, key) {
  const result = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => result.set(edge[key], (result.get(edge[key]) || 0) + 1));
  return result;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
