const PORT_GAP = 16;
const CORRIDOR_GAP = 24;

export function resolveVisioPorts(geometryGraph = {}) {
  const nodes = normalizedNodes(geometryGraph);
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const edges = normalizedEdges(geometryGraph);
  const diagnostics = [];
  const uses = new Map();

  for (const edge of edges) {
    const source = nodeById[edge.source];
    const target = nodeById[edge.target];
    if (!source || !target) {
      diagnostics.push({ code: "missing-route-endpoint", edgeId: edge.id, source: edge.source, target: edge.target });
      continue;
    }
    addUse(uses, source, edge.sourcePort || "out", "output", edge, target, geometryGraph);
    addUse(uses, target, edge.targetPort || "in", "input", edge, source, geometryGraph);
  }

  for (const node of nodes) {
    for (const direction of ["input", "output"]) {
      for (const declaration of portDeclarations(node, direction)) {
        const key = `${node.id}::${declaration.id}`;
        if (!uses.has(key)) uses.set(key, { key, node, id: declaration.id, direction, declaredSide: declaration.side, connections: [] });
        else if (declaration.side) uses.get(key).declaredSide = declaration.side;
      }
    }
  }

  const ports = [];
  const grouped = new Map();
  for (const use of uses.values()) {
    use.side = use.declaredSide || inferredSide(use, geometryGraph);
    const key = `${use.node.id}::${use.side}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(use);
  }

  for (const sideUses of grouped.values()) {
    sideUses.sort((left, right) => peerCoordinate(left) - peerCoordinate(right)
      || left.id.localeCompare(right.id)
      || connectionId(left).localeCompare(connectionId(right)));
    sideUses.forEach((use, index) => ports.push(anchorFor(use, index, sideUses.length)));
  }
  ports.sort((left, right) => left.nodeId.localeCompare(right.nodeId) || sideOrder(left.side) - sideOrder(right.side) || left.order - right.order || left.id.localeCompare(right.id));
  const portByKey = Object.fromEntries(ports.map((port) => [port.key, port]));
  return { version: "visio-port-geometry/v1", ports, portByKey, diagnostics };
}

export function routeVisioConnectors(geometryGraph = {}, resolvedPorts = resolveVisioPorts(geometryGraph), options = {}) {
  const edges = normalizedEdges(geometryGraph);
  const nodes = normalizedNodes(geometryGraph);
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const containers = normalizedContainers(geometryGraph);
  const portByKey = resolvedPorts?.portByKey || Object.fromEntries((resolvedPorts?.ports || []).map((port) => [port.key, port]));
  const diagnostics = [...(resolvedPorts?.diagnostics || [])];
  const connectors = [];

  for (const edge of edges) {
    const sourcePort = portByKey[`${edge.source}::${edge.sourcePort || "out"}`];
    const targetPort = portByKey[`${edge.target}::${edge.targetPort || "in"}`];
    if (!sourcePort || !targetPort) {
      diagnostics.push({ code: "missing-edge-port", edgeId: edge.id, sourcePort: edge.sourcePort || "out", targetPort: edge.targetPort || "in" });
      connectors.push({ ...edge, status: "rejected", points: [] });
      continue;
    }
    const obstacles = buildObstacles(edge, nodeById, containers);
    const candidates = routeCandidates(edge, sourcePort, targetPort, nodeById, containers, options);
    let selected;
    let blocked = [];
    for (const candidate of candidates) {
      blocked = intersectedObstacles(candidate.points, obstacles);
      if (blocked.length === 0) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      diagnostics.push({ code: "route-hard-obstacle", edgeId: edge.id, obstacleIds: [...new Set(blocked.map((item) => item.id))] });
      connectors.push({ ...edge, sourcePort: sourcePort.key, targetPort: targetPort.key, status: "rejected", points: [] });
      continue;
    }
    connectors.push({
      ...edge,
      sourcePort: sourcePort.key,
      targetPort: targetPort.key,
      status: "routed",
      corridor: selected.corridor,
      points: dedupePoints(selected.points),
    });
  }
  return { version: "visio-connector-routing/v1", connectors, diagnostics };
}

function addUse(uses, node, id, direction, edge, peer, graph) {
  const key = `${node.id}::${id}`;
  if (!uses.has(key)) uses.set(key, { key, node, id, direction, declaredSide: declaredSide(node, id, direction), connections: [] });
  uses.get(key).connections.push({ edge, peer, preferredSide: sideForEdge(node, peer, direction, edge, graph) });
}

function portDeclarations(node, direction) {
  const values = node.ports?.[direction === "input" ? "inputs" : "outputs"] || [];
  return values.map((value, index) => typeof value === "object" && value !== null
    ? { id: String(value.id || value.name || `${direction}-${index + 1}`), side: normalizeSide(value.side) }
    : { id: String(value), side: "" });
}

function declaredSide(node, id, direction) {
  return portDeclarations(node, direction).find((port) => port.id === id)?.side || "";
}

function inferredSide(use, graph) {
  const preferred = use.connections.map((item) => item.preferredSide).filter(Boolean).sort();
  if (preferred.length) return mostFrequent(preferred);
  const container = containerForNode(use.node, graph);
  if (container?.direction === "vertical") return use.direction === "output" ? "bottom" : "top";
  return use.direction === "output" ? "right" : "left";
}

function sideForEdge(node, peer, direction, edge, graph) {
  const routeClass = String(edge.routeClass || edge.type || "main-flow").toLowerCase();
  if (routeClass === "feedback") return direction === "output" ? "right" : "left";
  if (["residual", "skip"].includes(routeClass)) return "top";
  const container = containerForNode(node, graph);
  if (routeClass === "main-flow" && container?.direction === "vertical") return direction === "output" ? "bottom" : "top";
  const dx = center(peer).x - center(node).x;
  const dy = center(peer).y - center(node).y;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
}

function anchorFor(use, index, count) {
  const node = use.node;
  const along = (index + 1) / (count + 1);
  let x;
  let y;
  if (use.side === "left" || use.side === "right") {
    x = use.side === "left" ? node.x : node.x + node.w;
    y = node.y + node.h * along;
  } else {
    x = node.x + node.w * along;
    y = use.side === "top" ? node.y : node.y + node.h;
  }
  return { key: use.key, nodeId: node.id, id: use.id, direction: use.direction, side: use.side, order: index, x, y };
}

function routeCandidates(edge, source, target, nodeById, containers, options) {
  const routeClass = String(edge.routeClass || edge.type || "main-flow").toLowerCase();
  const sourceContainerId = String(edge.sourceContainerId || nodeById[edge.source]?.containerId || "");
  const targetContainerId = String(edge.targetContainerId || nodeById[edge.target]?.containerId || "");
  const crossesContainers = Boolean(sourceContainerId && targetContainerId && sourceContainerId !== targetContainerId);
  if (routeClass === "feedback") {
    const involved = involvedContainers(edge, nodeById, containers);
    const top = Math.min(source.y, target.y, ...involved.map((item) => item.y)) - CORRIDOR_GAP;
    const left = Math.min(source.x, target.x, ...involved.map((item) => item.x)) - CORRIDOR_GAP;
    const right = Math.max(source.x, target.x, ...involved.map((item) => item.x + item.w)) + CORRIDOR_GAP;
    return [{ corridor: "external", points: [point(source), { x: right, y: source.y }, { x: right, y: top }, { x: left, y: top }, { x: left, y: target.y }, point(target)] }];
  }
  if (["residual", "skip"].includes(routeClass)) {
    const sourceNode = nodeById[edge.source];
    const targetNode = nodeById[edge.target];
    const top = Math.min(sourceNode.y, targetNode.y) - CORRIDOR_GAP;
    return [{ corridor: "local", points: [point(source), { x: source.x, y: top }, { x: target.x, y: top }, point(target)] }];
  }
  const base = orthogonal(source, target);
  const maxDetour = finite(options.maxDetour, 160);
  const offsets = [CORRIDOR_GAP, 48, 80, 120, 160].filter((value) => value <= maxDetour);
  const candidates = [{ corridor: routeClass === "cross-container" || crossesContainers ? "cross-container" : "direct", points: base }];
  for (const offset of offsets) {
    candidates.push({ corridor: "detour", points: [point(source), { x: source.x, y: Math.min(source.y, target.y) - offset }, { x: target.x, y: Math.min(source.y, target.y) - offset }, point(target)] });
    candidates.push({ corridor: "detour", points: [point(source), { x: source.x, y: Math.max(source.y, target.y) + offset }, { x: target.x, y: Math.max(source.y, target.y) + offset }, point(target)] });
  }
  return candidates;
}

function orthogonal(source, target) {
  if (source.x === target.x || source.y === target.y) return [point(source), point(target)];
  if (["left", "right"].includes(source.side)) {
    const middle = (source.x + target.x) / 2;
    return [point(source), { x: middle, y: source.y }, { x: middle, y: target.y }, point(target)];
  }
  const middle = (source.y + target.y) / 2;
  return [point(source), { x: source.x, y: middle }, { x: target.x, y: middle }, point(target)];
}

function buildObstacles(edge, nodeById, containers) {
  const obstacles = [];
  for (const node of Object.values(nodeById)) {
    if (node.id !== edge.source && node.id !== edge.target) obstacles.push({ id: `node:${node.id}`, x: node.x, y: node.y, w: node.w, h: node.h });
  }
  const endpointContainers = new Set([nodeById[edge.source]?.containerId, nodeById[edge.target]?.containerId].filter(Boolean));
  for (const container of containers) {
    if (container.titleBand > 0) obstacles.push({ id: `title:${container.id}`, x: container.x, y: container.y, w: container.w, h: container.titleBand });
    if (!endpointContainers.has(container.id) && !isAncestorOfEndpoint(container.id, endpointContainers, containers)) {
      obstacles.push({ id: `container:${container.id}`, x: container.x, y: container.y, w: container.w, h: container.h });
    }
  }
  return obstacles;
}

function intersectedObstacles(points, obstacles) {
  return obstacles.filter((obstacle) => {
    for (let index = 1; index < points.length; index += 1) {
      if (segmentIntersectsRect(points[index - 1], points[index], obstacle)) return true;
    }
    return false;
  });
}

function segmentIntersectsRect(a, b, rect) {
  const epsilon = 0.001;
  const left = rect.x + epsilon;
  const right = rect.x + rect.w - epsilon;
  const top = rect.y + epsilon;
  const bottom = rect.y + rect.h - epsilon;
  if (a.x === b.x) return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
  if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  return true;
}

function involvedContainers(edge, nodeById, containers) {
  const ids = new Set([nodeById[edge.source]?.containerId, nodeById[edge.target]?.containerId].filter(Boolean));
  return containers.filter((item) => ids.has(item.id));
}

function isAncestorOfEndpoint(id, endpointIds, containers) {
  const byId = Object.fromEntries(containers.map((item) => [item.id, item]));
  for (const endpointId of endpointIds) {
    let current = byId[endpointId];
    while (current?.parentId) {
      if (current.parentId === id) return true;
      current = byId[current.parentId];
    }
  }
  return false;
}

function normalizedNodes(graph) {
  return (Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodeById || {})).map((node) => ({ ...node, id: String(node.id), x: Number(node.x), y: Number(node.y), w: Number(node.w), h: Number(node.h) }));
}

function normalizedContainers(graph) {
  return Array.isArray(graph.containers) ? graph.containers : Object.values(graph.containerById || {});
}

function normalizedEdges(graph) {
  return (Array.isArray(graph.edges) ? graph.edges : []).map((edge, index) => ({ ...edge, id: String(edge.id || `edge-${index + 1}`), source: String(edge.source || ""), target: String(edge.target || "") })).sort((a, b) => a.id.localeCompare(b.id));
}

function containerForNode(node, graph) {
  return graph.containerById?.[node.containerId] || normalizedContainers(graph).find((item) => item.id === node.containerId);
}

function peerCoordinate(use) {
  if (!use.connections.length) return Number.POSITIVE_INFINITY;
  const values = use.connections.map(({ peer }) => ["left", "right"].includes(use.side) ? center(peer).y : center(peer).x);
  return Math.min(...values);
}

function connectionId(use) {
  return use.connections.map((item) => item.edge.id).sort()[0] || "";
}

function mostFrequent(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || sideOrder(a[0]) - sideOrder(b[0]))[0][0];
}

function normalizeSide(side) {
  const value = String(side || "").toLowerCase();
  return ["left", "right", "top", "bottom"].includes(value) ? value : "";
}

function sideOrder(side) {
  return ({ top: 0, right: 1, bottom: 2, left: 3 })[side] ?? 4;
}

function center(box) {
  return { x: Number(box.x) + Number(box.w) / 2, y: Number(box.y) + Number(box.h) / 2 };
}

function point(port) {
  return { x: port.x, y: port.y };
}

function dedupePoints(points) {
  return points.filter((pointValue, index) => index === 0 || pointValue.x !== points[index - 1].x || pointValue.y !== points[index - 1].y);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
