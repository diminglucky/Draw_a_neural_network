const TITLE_BAND = 26;

export function layoutVisioHierarchy(tree = {}, options = {}) {
  const origin = options.origin || { x: 0, y: 0 };
  const suppliedNodes = Array.isArray(options.nodes) ? options.nodes : tree.nodes || [];
  const nodeById = Object.fromEntries(suppliedNodes.map((node) => [String(node.id), {
    ...(tree.nodeById?.[String(node.id)] || {}),
    ...node,
    w: positive(node.w, 120),
    h: positive(node.h, 80),
  }]));
  const measured = new Map();
  const visiting = new Set();

  const measureContainer = (id) => {
    if (measured.has(id)) return measured.get(id);
    if (visiting.has(id)) return emptyContainer(id);
    visiting.add(id);
    const source = tree.containerById?.[id];
    if (!source) return emptyContainer(id);
    const items = (source.children || []).map((child) => child.kind === "container"
      ? { kind: "container", id: child.id, box: measureContainer(child.id) }
      : { kind: "node", id: child.id, box: nodeById[child.id] })
      .filter((item) => item.box);
    const arranged = arrange(items, source);
    const padding = positive(source.padding, 28);
    const result = {
      ...source,
      x: 0,
      y: 0,
      w: arranged.w + padding * 2,
      h: arranged.h + padding * 2 + TITLE_BAND,
      titleBand: TITLE_BAND,
      padding,
      items: arranged.items,
    };
    visiting.delete(id);
    measured.set(id, result);
    return result;
  };

  const roots = (tree.rootIds || []).map(measureContainer);
  const rootLayout = arrange(roots.map((box) => ({ kind: "container", id: box.id, box })), {
    direction: options.rootDirection || "horizontal",
    gap: options.rootGap || 48,
  });
  const containerById = {};

  const placeContainer = (box, x, y) => {
    const placed = {
      ...box,
      x,
      y,
      contentBounds: {
        x: x + box.padding,
        y: y + box.padding + box.titleBand,
        w: Math.max(0, box.w - box.padding * 2),
        h: Math.max(0, box.h - box.padding * 2 - box.titleBand),
      },
    };
    delete placed.items;
    containerById[box.id] = placed;
    for (const item of box.items || []) {
      const itemX = placed.contentBounds.x + item.x;
      const itemY = placed.contentBounds.y + item.y;
      if (item.kind === "container") placeContainer(item.box, itemX, itemY);
      else Object.assign(nodeById[item.id], { x: itemX, y: itemY });
    }
  };

  for (const item of rootLayout.items) {
    placeContainer(item.box, Number(origin.x || 0) + item.x, Number(origin.y || 0) + item.y);
  }

  alignScopedLanes(tree, nodeById, containerById);
  reflowHorizontalRoots(tree, nodeById, containerById, Number(origin.x || 0), positive(options.rootGap, 48));
  const placedBoxes = [...Object.values(nodeById), ...Object.values(containerById)];
  const minX = Math.min(Number(origin.x || 0), ...placedBoxes.map((box) => box.x));
  const minY = Math.min(Number(origin.y || 0), ...placedBoxes.map((box) => box.y));
  const maxX = Math.max(minX, ...placedBoxes.map((box) => box.x + box.w));
  const maxY = Math.max(minY, ...placedBoxes.map((box) => box.y + box.h));

  return {
    version: "visio-hierarchical-geometry/v1",
    nodes: Object.values(nodeById),
    nodeById,
    containers: Object.values(containerById),
    containerById,
    bounds: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
  };
}

function reflowHorizontalRoots(tree, nodeById, containerById, originX, gap) {
  let cursor = originX;
  for (const rootId of tree.rootIds || []) {
    reflowHorizontalContainer(rootId, tree, nodeById, containerById);
    const root = containerById[rootId];
    if (!root) continue;
    const delta = cursor - root.x;
    if (delta) translateContainerTree(rootId, delta, nodeById, containerById, tree.containerById || {});
    cursor += root.w + gap;
  }
}

function reflowHorizontalContainer(containerId, tree, nodeById, containerById) {
  const source = tree.containerById?.[containerId];
  const container = containerById[containerId];
  if (!source || !container) return;
  for (const child of source.children || []) {
    if (child.kind === "container") reflowHorizontalContainer(child.id, tree, nodeById, containerById);
  }
  if (source.direction !== "horizontal") return;
  let cursor = container.contentBounds.x;
  for (const child of source.children || []) {
    const box = child.kind === "container" ? containerById[child.id] : nodeById[child.id];
    if (!box) continue;
    const delta = cursor - box.x;
    if (delta) {
      if (child.kind === "container") translateContainerTree(child.id, delta, nodeById, containerById, tree.containerById || {});
      else box.x += delta;
    }
    cursor += box.w + positive(source.gap, 22);
  }
  const requiredWidth = Math.max(0, cursor - positive(source.gap, 22) - container.contentBounds.x);
  container.w = Math.max(container.w, requiredWidth + container.padding * 2);
  container.contentBounds.w = Math.max(0, container.w - container.padding * 2);
}

function translateContainerTree(containerId, deltaX, nodeById, containerById, sourceContainers) {
  const container = containerById[containerId];
  if (!container) return;
  container.x += deltaX;
  container.contentBounds.x += deltaX;
  for (const child of sourceContainers[containerId]?.children || []) {
    if (child.kind === "container") translateContainerTree(child.id, deltaX, nodeById, containerById, sourceContainers);
    else if (nodeById[child.id]) nodeById[child.id].x += deltaX;
  }
}

function alignScopedLanes(tree, nodeById, containerById) {
  const laneByScopedId = Object.fromEntries((tree.lanes || []).map((lane) => [lane.scopedId, lane]));
  const groups = new Map();
  for (const node of Object.values(nodeById)) {
    if (!node.scopedLaneId || !Array.isArray(node.containerPath)) continue;
    const scopeId = node.scopedLaneId.split("::", 1)[0];
    const scopeIndex = node.containerPath.indexOf(scopeId);
    const branchId = node.containerPath[scopeIndex + 1];
    if (scopeIndex < 0 || !branchId) continue;
    if (!groups.has(node.scopedLaneId)) groups.set(node.scopedLaneId, []);
    groups.get(node.scopedLaneId).push({ node, branchId, scopeId });
  }

  // Spatial scales are global presentation lanes. Operators at the same scale
  // share a y baseline; repeated operators within one branch advance on x.
  const spatial = new Map();
  for (const node of Object.values(nodeById)) {
    const laneId = String(node.scopedLaneId || "");
    const lane = laneByScopedId[laneId];
    if (!lane || String(lane.kind || "").toLowerCase() !== "spatial-scale") continue;
    if (!spatial.has(laneId)) spatial.set(laneId, []);
    spatial.get(laneId).push(node);
  }
  const spatialLanes = [...spatial.keys()].sort((left, right) => (
    Number(laneByScopedId[left].order || 0) - Number(laneByScopedId[right].order || 0)
      || left.localeCompare(right)
  ));
  const top = Math.min(...Object.values(nodeById).map((node) => node.y));
  const maxHeight = Math.max(...Object.values(nodeById).map((node) => node.h));
  const laneGap = Math.max(82, maxHeight + 22);
  spatialLanes.forEach((laneId, laneIndex) => {
    const baseline = top + laneIndex * laneGap;
    const byBranch = new Map();
    for (const node of spatial.get(laneId)) {
      const branchId = node.containerPath.at(-1) || "root";
      if (!byBranch.has(branchId)) byBranch.set(branchId, []);
      byBranch.get(branchId).push(node);
    }
    for (const members of byBranch.values()) {
      members.sort((left, right) => Number(left.stage || 0) - Number(right.stage || 0)
        || Number(left.order || 0) - Number(right.order || 0) || left.id.localeCompare(right.id));
      let cursor = Math.min(...members.map((node) => node.x));
      for (const node of members) {
        node.x = cursor;
        node.y = baseline;
        cursor += node.w + 18;
        for (const containerId of [...node.containerPath].reverse()) {
          growContainingContainers(node, "x", containerById);
          growContainingContainers(node, "y", containerById);
        }
      }
    }
  });

  for (const [scopedLaneId, members] of groups) {
    if (String(laneByScopedId[scopedLaneId]?.kind || "").toLowerCase() === "spatial-scale") continue;
    if (new Set(members.map((member) => member.branchId)).size < 2) continue;
    const lane = laneByScopedId[scopedLaneId] || {};
    const scope = tree.containerById?.[members[0].scopeId] || {};
    const axis = laneAxis(lane, scope);
    const centerKey = axis === "x" ? "w" : "h";
    const byBranch = new Map();
    for (const member of members) {
      if (!byBranch.has(member.branchId)) byBranch.set(member.branchId, []);
      byBranch.get(member.branchId).push(member.node);
    }
    const branchCenters = new Map([...byBranch].map(([branchId, branchNodes]) => {
      const start = Math.min(...branchNodes.map((node) => node[axis]));
      const end = Math.max(...branchNodes.map((node) => node[axis] + node[centerKey]));
      return [branchId, (start + end) / 2];
    }));
    const target = Math.max(...branchCenters.values());
    for (const [branchId, branchNodes] of byBranch) {
      const delta = target - branchCenters.get(branchId);
      if (delta <= 0) continue;
      for (const node of branchNodes) {
        node[axis] += delta;
        growContainingContainers(node, axis, containerById);
      }
    }
  }
}

function laneAxis(lane, scope) {
  if (String(lane.kind || "").toLowerCase() === "spatial-scale") return "y";
  const declared = String(lane.axis || lane.orientation || "").toLowerCase();
  if (declared === "x" || declared === "vertical") return "x";
  if (declared === "y" || declared === "horizontal") return "y";
  return scope.direction === "vertical" ? "x" : "y";
}

function growContainingContainers(node, axis, containerById) {
  const extentKey = axis === "x" ? "w" : "h";
  const nodeEnd = node[axis] + node[extentKey];
  for (const containerId of [...node.containerPath].reverse()) {
    const container = containerById[containerId];
    if (!container) continue;
    const requiredEnd = nodeEnd + container.padding;
    const currentEnd = container[axis] + container[extentKey];
    if (requiredEnd > currentEnd) {
      container[extentKey] += requiredEnd - currentEnd;
      container.contentBounds[extentKey] = Math.max(0,
        container[extentKey] - container.padding * 2 - (axis === "y" ? container.titleBand : 0));
    }
  }
}

function arrange(items, container) {
  const direction = String(container.direction || "vertical");
  const gap = positive(container.gap, 22);
  if (items.length === 0) return { w: 0, h: 0, items: [] };
  if (direction === "stack") return arrangeStack(items);
  if (direction === "grid" || direction === "flow") {
    return arrangeGrid(items, Math.max(1, Math.round(positive(container.columns, Math.ceil(Math.sqrt(items.length))))), gap);
  }
  return arrangeAxis(items, direction === "horizontal" ? "x" : "y", gap);
}

function arrangeAxis(items, axis, gap) {
  let cursor = 0;
  let cross = 0;
  const positioned = items.map((item) => {
    const result = { ...item, x: axis === "x" ? cursor : 0, y: axis === "y" ? cursor : 0 };
    cursor += (axis === "x" ? item.box.w : item.box.h) + gap;
    cross = Math.max(cross, axis === "x" ? item.box.h : item.box.w);
    return result;
  });
  return axis === "x"
    ? { w: cursor - gap, h: cross, items: positioned }
    : { w: cross, h: cursor - gap, items: positioned };
}

function arrangeGrid(items, columns, gap) {
  const rows = Math.ceil(items.length / columns);
  const colWidths = Array(columns).fill(0);
  const rowHeights = Array(rows).fill(0);
  items.forEach((item, index) => {
    colWidths[index % columns] = Math.max(colWidths[index % columns], item.box.w);
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], item.box.h);
  });
  const offsets = (sizes) => sizes.map((_, index) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0) + index * gap);
  const xs = offsets(colWidths);
  const ys = offsets(rowHeights);
  return {
    w: colWidths.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, columns - 1),
    h: rowHeights.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, rows - 1),
    items: items.map((item, index) => ({ ...item, x: xs[index % columns], y: ys[Math.floor(index / columns)] })),
  };
}

function arrangeStack(items) {
  const offset = 12;
  return {
    w: Math.max(...items.map((item, index) => item.box.w + index * offset)),
    h: Math.max(...items.map((item, index) => item.box.h + index * offset)),
    items: items.map((item, index) => ({ ...item, x: index * offset, y: index * offset })),
  };
}

function emptyContainer(id) {
  return { id, w: 0, h: 0, padding: 0, titleBand: 0, items: [] };
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
