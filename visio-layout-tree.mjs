const DIRECTIONS = new Set(["horizontal", "vertical", "grid", "flow", "stack"]);

export function compileVisioLayoutTree(ir = {}) {
  const diagnostics = [];
  const sourceNodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const sourceContainers = Array.isArray(ir.containers) ? ir.containers : [];
  const nodes = sourceNodes.map((node, index) => normalizeNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const containerIds = new Set(sourceContainers.map((container, index) => String(container.id || `container-${index + 1}`)));
  const containers = sourceContainers.map((container, index) => normalizeContainer(container, index));

  if (containers.length === 0) {
    containers.push(normalizeContainer({ id: "root", direction: "horizontal", children: nodes.map((node) => node.id) }, 0));
    containerIds.add("root");
  }

  const containerById = Object.fromEntries(containers.map((container) => [container.id, container]));
  for (const container of containers) {
    container.children = container.children.map((child) => typedChild(child, nodeIds, containerIds, container.id, diagnostics));
    if (container.parentId && !containerIds.has(container.parentId)) {
      diagnostics.push({ code: "missing-container-parent", containerId: container.id, parentId: container.parentId });
    }
  }

  detectContainerCycles(containers, containerById, diagnostics);
  const rootIds = containers.filter((container) => !container.parentId).map((container) => container.id);
  const nodeById = {};
  for (const node of nodes) {
    const owner = node.containerId || ownerFromChildren(containers, node.id) || rootIds[0] || "";
    if (owner && !containerIds.has(owner)) diagnostics.push({ code: "missing-node-container", nodeId: node.id, containerId: owner });
    node.containerId = owner;
    node.containerPath = containerPath(owner, containerById, diagnostics);
    const laneScope = String(node.laneContainerId || owner || "root");
    node.scopedLaneId = node.laneId ? `${laneScope}::${node.laneId}` : "";
    nodeById[node.id] = node;
  }

  const lanes = (Array.isArray(ir.lanes) ? ir.lanes : []).map((lane, index) => {
    const id = String(lane.id || `lane-${index + 1}`);
    const containerId = String(lane.containerId || rootIds[0] || "root");
    return { ...structuredClone(lane), id, containerId, scopedId: `${containerId}::${id}` };
  });

  return {
    version: "visio-layout-tree/v1",
    valid: diagnostics.length === 0,
    diagnostics,
    rootIds,
    containers,
    containerById,
    nodes,
    nodeById,
    lanes,
    edges: structuredClone(Array.isArray(ir.edges) ? ir.edges : []),
  };
}

function normalizeNode(node = {}, index) {
  const repeatCount = finitePositive(node.repeatCount ?? node.repeat?.count, 1);
  return {
    ...structuredClone(node),
    id: String(node.id || `node-${index + 1}`),
    containerId: String(node.containerId || node.groupId || node.moduleId || ""),
    laneId: String(node.laneId || ""),
    repeatCount,
    repeatMode: String(node.repeatMode || node.repeat?.mode || "compact"),
  };
}

function normalizeContainer(container = {}, index) {
  const direction = String(container.direction || "flow").toLowerCase();
  return {
    ...structuredClone(container),
    id: String(container.id || `container-${index + 1}`),
    parentId: String(container.parentId || ""),
    direction: DIRECTIONS.has(direction) ? direction : "flow",
    children: Array.isArray(container.children) ? structuredClone(container.children) : [],
    padding: finitePositive(container.padding, 28),
    gap: finitePositive(container.gap, 22),
  };
}

function typedChild(child, nodeIds, containerIds, ownerId, diagnostics) {
  const id = String(typeof child === "object" && child !== null ? child.id : child);
  const declaredKind = typeof child === "object" && child !== null ? String(child.kind || "") : "";
  const ambiguous = !declaredKind && nodeIds.has(id) && containerIds.has(id);
  const kind = declaredKind || (ambiguous && id === ownerId ? "node" : containerIds.has(id) ? "container" : "node");
  if (ambiguous && id !== ownerId) diagnostics.push({ code: "ambiguous-container-child", containerId: ownerId, childId: id });
  const known = kind === "container" ? containerIds.has(id) : nodeIds.has(id);
  if (!known) diagnostics.push({ code: "missing-container-child", containerId: ownerId, childId: id, childKind: kind });
  return { id, kind };
}

function ownerFromChildren(containers, nodeId) {
  return containers.find((container) => container.children.some((child) => child.kind === "node" && child.id === nodeId))?.id || "";
}

function containerPath(ownerId, containerById, diagnostics) {
  if (!ownerId || !containerById[ownerId]) return ownerId ? [ownerId] : [];
  const path = [];
  const seen = new Set();
  let current = containerById[ownerId];
  while (current) {
    if (seen.has(current.id)) return [];
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? containerById[current.parentId] : null;
  }
  return path;
}

function detectContainerCycles(containers, containerById, diagnostics) {
  for (const start of containers) {
    const seen = new Set();
    let current = start;
    while (current?.parentId && containerById[current.parentId]) {
      if (seen.has(current.id)) {
        if (!diagnostics.some((item) => item.code === "container-cycle")) diagnostics.push({ code: "container-cycle", containerId: current.id });
        break;
      }
      seen.add(current.id);
      current = containerById[current.parentId];
    }
  }
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
