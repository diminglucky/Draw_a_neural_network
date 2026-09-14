const DETAILS = new Set(["full", "compact", "overview"]);

export function projectVisioDetail(geometryGraph = {}, options = {}) {
  const detail = String(options.detail || "full").toLowerCase();
  if (!DETAILS.has(detail)) throw new TypeError(`Unsupported Visio detail level: ${detail}`);

  const nodes = clone(Array.isArray(geometryGraph.nodes) ? geometryGraph.nodes : [])
    .map(normalizeProjectedNode);
  const edges = clone(Array.isArray(geometryGraph.edges) ? geometryGraph.edges : []);
  if (detail === "full") return resultFor(geometryGraph, detail, nodes, normalizeEdges(edges));

  const groups = linearProjectionGroups(nodes, edges, detail);
  const nodeToProjection = new Map();
  const projectedNodes = groups.map((group) => {
    const projected = group.length > 1 ? compactNode(group, edges) : normalizeProjectedNode(group[0]);
    for (const node of group) nodeToProjection.set(node.id, projected.id);
    return projected;
  });
  const projectedEdges = edges
    .filter((edge) => !isInternalMainFlow(edge, nodeToProjection))
    .map((edge) => projectEdge(edge, nodeToProjection));

  return resultFor(geometryGraph, detail, projectedNodes, projectedEdges);
}

function linearProjectionGroups(nodes, edges, detail) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of edges.filter(isMainFlow)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    append(incoming, edge.target, edge.source);
    append(outgoing, edge.source, edge.target);
  }

  const compatible = (left, right) => sameContainer(left, right)
    && (detail === "overview" || operatorKind(left) === operatorKind(right));
  const visited = new Set();
  const groups = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    let start = node;
    while ((incoming.get(start.id) || []).length === 1) {
      const previous = nodeById.get(incoming.get(start.id)[0]);
      if (!previous || visited.has(previous.id) || (outgoing.get(previous.id) || []).length !== 1 || !compatible(previous, start)) break;
      start = previous;
    }
    const group = [start];
    visited.add(start.id);
    let current = start;
    while ((outgoing.get(current.id) || []).length === 1) {
      const next = nodeById.get(outgoing.get(current.id)[0]);
      if (!next || visited.has(next.id) || (incoming.get(next.id) || []).length !== 1 || !compatible(current, next)) break;
      group.push(next);
      visited.add(next.id);
      current = next;
    }
    groups.push(group);
  }
  return groups;
}

function compactNode(group, edges) {
  const first = group[0];
  const last = group.at(-1);
  const ids = new Set(group.map((node) => node.id));
  const sourceNodeIds = unique(group.flatMap((node) => node.sourceNodeIds));
  const x = Math.min(...group.map((node) => finite(node.x)));
  const y = Math.min(...group.map((node) => finite(node.y)));
  const right = Math.max(...group.map((node) => finite(node.x) + finite(node.w)));
  const bottom = Math.max(...group.map((node) => finite(node.y) + finite(node.h)));
  return {
    ...clone(first),
    id: `detail::${group.map((node) => node.id).join("+")}`,
    label: group.map((node) => node.label || node.id).join(" / "),
    x,
    y,
    w: right - x,
    h: bottom - y,
    sourceNodeIds,
    repeatCount: group.reduce((sum, node) => sum + positive(node.repeatCount, 1), 0),
    ports: {
      inputs: clone(first.ports?.inputs || []),
      outputs: clone(last.ports?.outputs || []),
    },
    containerPath: clone(first.containerPath || []),
    internalGraph: {
      nodes: group.map((node) => clone(node)),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => clone(edge)),
      ports: {
        inputs: clone(first.ports?.inputs || []),
        outputs: clone(last.ports?.outputs || []),
      },
    },
  };
}

function projectEdge(edge, nodeToProjection) {
  const sourceNodeId = String(edge.sourceNodeId || edge.source || "");
  const targetNodeId = String(edge.targetNodeId || edge.target || "");
  const sourcePort = String(edge.sourcePort || edge.ports?.source || "");
  const targetPort = String(edge.targetPort || edge.ports?.target || "");
  return {
    ...clone(edge),
    source: nodeToProjection.get(String(edge.source)) || String(edge.source || ""),
    target: nodeToProjection.get(String(edge.target)) || String(edge.target || ""),
    sourceNodeId,
    targetNodeId,
    sourcePort,
    targetPort,
    ports: { source: sourcePort, target: targetPort },
  };
}

function normalizeEdges(edges) {
  const identity = new Map();
  for (const edge of edges) {
    identity.set(String(edge.source), String(edge.source));
    identity.set(String(edge.target), String(edge.target));
  }
  return edges.map((edge) => projectEdge(edge, identity));
}

function normalizeProjectedNode(node) {
  const result = clone(node);
  result.id = String(result.id || "");
  result.sourceNodeIds = unique(Array.isArray(result.sourceNodeIds) && result.sourceNodeIds.length
    ? result.sourceNodeIds.map(String)
    : [result.id]);
  result.repeatCount = positive(result.repeatCount, 1);
  result.ports = {
    inputs: clone(result.ports?.inputs || []),
    outputs: clone(result.ports?.outputs || []),
  };
  result.containerPath = clone(result.containerPath || []);
  return result;
}

function resultFor(source, detail, nodes, edges) {
  return {
    ...clone(source),
    version: "visio-detail-projection/v1",
    detail,
    nodes,
    nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    edges,
    edgeById: Object.fromEntries(edges.map((edge) => [String(edge.id), edge])),
  };
}

function isInternalMainFlow(edge, projection) {
  return isMainFlow(edge)
    && projection.get(String(edge.source))
    && projection.get(String(edge.source)) === projection.get(String(edge.target));
}

function isMainFlow(edge) {
  return String(edge.routeClass || edge.type || "main-flow").toLowerCase() === "main-flow";
}

function sameContainer(left, right) {
  const leftPath = JSON.stringify(left.containerPath || []);
  const rightPath = JSON.stringify(right.containerPath || []);
  return leftPath === rightPath && String(left.containerId || "") === String(right.containerId || "");
}

function operatorKind(node) {
  return String(node.family || node.op || node.semanticRole || "custom").toLowerCase();
}

function append(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function unique(values) {
  return [...new Set(values.map(String))];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
