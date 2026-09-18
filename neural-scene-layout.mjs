const VERSION = "laid-out-neural-scene/v1";
const GAP_X = 90;
const GAP_Y = 54;
const MARGIN = 48;

export function layoutNeuralScene(scene = {}, profiles = {}) {
  const primitives = Array.isArray(scene.primitives) ? scene.primitives : [];
  const bodies = primitives.filter((primitive) => primitive.role === "body");
  const bodyById = new Map(bodies.map((primitive) => [primitive.id, primitive]));
  const relations = Array.isArray(scene.relations) ? scene.relations : [];
  const layers = topologicalLayers(bodies, relations);
  const scaleRows = new Map();
  const laidBodies = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    for (let rowIndex = 0; rowIndex < layer.length; rowIndex += 1) {
      const primitive = layer[rowIndex];
      const scale = scaleKey(primitive);
      if (!scaleRows.has(scale)) scaleRows.set(scale, scaleRows.size);
      const row = scale === "unknown" ? rowIndex : scaleRows.get(scale);
      const size = primitiveSize(primitive);
      laidBodies.push({ ...primitive, bounds: { x: MARGIN + layerIndex * GAP_X + layerIndex * 88, y: MARGIN + row * (size.h + GAP_Y), w: size.w, h: size.h }, zIndex: 100 + layerIndex });
    }
  }
  const bodyPosition = new Map(laidBodies.map((primitive) => [primitive.id, primitive]));
  const groups = placeGroups(scene.groups || [], bodyPosition);
  if ((scene.groups || []).some((group) => ["horizontal", "vertical"].includes(group.direction))) {
    arrangeTopLevelUnits(groups, bodyPosition, relations);
  }
  const positionedBodies = [...bodyPosition.values()];
  const laidPrimitives = positionedBodies.map((primitive) => ({ ...primitive, anchors: anchorsFor(primitive) }));
  for (const primitive of primitives.filter((item) => item.role !== "body")) {
    const owner = bodyPosition.get(primitive.projectionId) || bodyPosition.get(primitive.sourceNodeIds?.[0]);
    if (!owner) continue;
    laidPrimitives.push({ ...primitive, bounds: { x: owner.bounds.x, y: owner.bounds.y + owner.bounds.h + 12, w: owner.bounds.w, h: 18 }, anchors: { inputs: [], outputs: [] }, zIndex: owner.zIndex + 10 });
  }
  const visualBounds = [...laidPrimitives.map((primitive) => primitive.bounds), ...groups.map((group) => group.bounds)];
  const maxX = Math.max(...visualBounds.map((bounds) => bounds.x + bounds.w), MARGIN);
  const maxY = Math.max(...visualBounds.map((bounds) => bounds.y + bounds.h), MARGIN);
  const page = { x: 0, y: 0, width: maxX + MARGIN, height: maxY + MARGIN };
  const connectors = [];
  for (const relation of relations) connectors.push(routeRelation(relation, bodyPosition, laidPrimitives, connectors));
  const diagnostics = [...(scene.diagnostics || [])];
  for (const relation of relations) if (relation.relationTags?.includes("crossScale")) diagnostics.push({ code: "cross-scale-transfer", relationId: relation.id, severity: "warning" });
  const maxPrimitives = Number.isFinite(profiles.maxPrimitives) ? profiles.maxPrimitives : Infinity;
  if (laidPrimitives.length > maxPrimitives) diagnostics.push({ code: "layout-budget-exceeded", primitiveCount: laidPrimitives.length, budget: maxPrimitives, severity: "warning" });
  const result = { version: VERSION, units: "layout-unit", primitives: laidPrimitives.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)), connectors, groups, page, diagnostics, softScore: scoreLayout(positionedBodies, connectors) };
  return result;
}

export function validateLaidOutScene(layout = {}) {
  const issues = [];
  if (layout.version !== VERSION || layout.units !== "layout-unit") issues.push({ code: "invalid-laid-out-scene-version" });
  const bodies = (layout.primitives || []).filter((primitive) => primitive.role === "body");
  for (const primitive of layout.primitives || []) {
    if (!validBounds(primitive.bounds) || !insidePage(primitive.bounds, layout.page)) issues.push({ code: "primitive-out-of-page", primitiveId: primitive.id });
    if (primitive.role === "body" && (!primitive.anchors || !Array.isArray(primitive.anchors.inputs) || !Array.isArray(primitive.anchors.outputs))) issues.push({ code: "missing-primitive-anchors", primitiveId: primitive.id });
  }
  for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) if (overlaps(bodies[i].bounds, bodies[j].bounds)) issues.push({ code: "body-overlap", first: bodies[i].id, second: bodies[j].id });
  for (const connector of layout.connectors || []) if (!Array.isArray(connector.points) || connector.points.length < 2 || !connector.sourcePrimitiveId || !connector.targetPrimitiveId) issues.push({ code: "invalid-connector-route", relationId: connector.id });
  const primitiveById = new Map((layout.primitives || []).map((primitive) => [primitive.id, primitive]));
  for (const connector of layout.connectors || []) {
    if (!Array.isArray(connector.points) || connector.points.length < 2) continue;
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      if (pathIntersectsRectInterior(connector.points, body.bounds)) issues.push({ code: "connector-body-intersection", relationId: connector.id, primitiveId: body.id });
    }
  }
  for (const group of layout.groups || []) {
    if (!validBounds(group.bounds) || !insidePage(group.bounds, layout.page)) issues.push({ code: "group-out-of-page", groupId: group.id });
    for (const primitiveId of group.primitiveIds || []) {
      const member = primitiveById.get(primitiveId);
      if (!member) issues.push({ code: "missing-group-primitive", groupId: group.id, primitiveId });
      else if (!contains(group.bounds, member.bounds)) issues.push({ code: "group-containment-violation", groupId: group.id, primitiveId });
    }
  }
  const groupById = new Map((layout.groups || []).map((group) => [group.id, group]));
  for (const group of layout.groups || []) {
    if (!group.parentId) continue;
    const parent = groupById.get(group.parentId);
    if (!parent) issues.push({ code: "missing-parent-group", groupId: group.id, parentId: group.parentId });
    else if (!contains(parent.bounds, group.bounds)) issues.push({ code: "group-parent-containment-violation", groupId: group.id, parentId: group.parentId });
  }
  const positions = new Map(bodies.map((primitive) => [primitive.id, primitive.bounds]));
  for (const connector of layout.connectors || []) {
    const source = positions.get(connector.sourcePrimitiveId);
    const target = positions.get(connector.targetPrimitiveId);
    if (source && target && connector.relationTags?.includes("data") && target.x < source.x) issues.push({ code: "dag-direction-violation", relationId: connector.id });
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: layout.primitives?.length || 0, connectorCount: layout.connectors?.length || 0 } };
}

function placeGroups(sourceGroups, bodyPosition) {
  if (!sourceGroups.length) return [];
  const hasPlacementIntent = sourceGroups.some((group) => group.direction === "horizontal" || group.direction === "vertical");
  if (!hasPlacementIntent) return measureGroupBounds(sourceGroups, bodyPosition);
  const definitions = sourceGroups.map((group) => ({
    id: String(group.id),
    parentId: group.parentId ? String(group.parentId) : "",
    primitiveIds: [...(group.primitiveIds || [])],
    role: String(group.role || "module"),
    label: String(group.label || group.id || ""),
    direction: group.direction === "vertical" ? "vertical" : "horizontal",
    padding: finiteNonNegative(group.padding, 24),
    gap: finiteNonNegative(group.gap, 32),
  }));
  const byId = new Map(definitions.map((group) => [group.id, group]));
  const childrenByParent = new Map(definitions.map((group) => [group.id, []]));
  for (const group of definitions) if (byId.has(group.parentId)) childrenByParent.get(group.parentId).push(group.id);
  const measurements = new Map();
  const visiting = new Set();
  const measure = (group) => {
    if (measurements.has(group.id)) return measurements.get(group.id);
    if (visiting.has(group.id)) return { w: group.padding * 2, h: group.padding * 2, items: [] };
    visiting.add(group.id);
    const childIds = childrenByParent.get(group.id) || [];
    const childPrimitiveIds = new Set(childIds.flatMap((id) => byId.get(id).primitiveIds));
    const directPrimitiveIds = group.primitiveIds.filter((id) => bodyPosition.has(id) && !childPrimitiveIds.has(id));
    const items = [
      ...directPrimitiveIds.map((id) => ({ kind: "body", id, ...bodyPosition.get(id).bounds })),
      ...childIds.map((id) => ({ kind: "group", id, ...measure(byId.get(id)) })),
    ];
    visiting.delete(group.id);
    const primary = items.reduce((sum, item) => sum + (group.direction === "horizontal" ? item.w : item.h), 0)
      + Math.max(0, items.length - 1) * group.gap;
    const cross = items.reduce((max, item) => Math.max(max, group.direction === "horizontal" ? item.h : item.w), 0);
    const measured = {
      w: group.padding * 2 + (group.direction === "horizontal" ? primary : cross),
      h: group.padding * 2 + (group.direction === "horizontal" ? cross : primary),
      items,
    };
    measurements.set(group.id, measured);
    return measured;
  };
  const boundsById = new Map();
  const place = (group, x, y) => {
    const measured = measure(group);
    const bounds = { x, y, w: measured.w, h: measured.h };
    boundsById.set(group.id, bounds);
    let cursor = group.direction === "horizontal" ? x + group.padding : y + group.padding;
    for (const item of measured.items) {
      const itemX = group.direction === "horizontal" ? cursor : x + group.padding;
      const itemY = group.direction === "horizontal" ? y + group.padding : cursor;
      if (item.kind === "group") place(byId.get(item.id), itemX, itemY);
      else {
        const body = bodyPosition.get(item.id);
        body.bounds = { ...body.bounds, x: itemX, y: itemY };
      }
      cursor += (group.direction === "horizontal" ? item.w : item.h) + group.gap;
    }
  };
  let rootX = MARGIN;
  for (const root of definitions.filter((group) => !byId.has(group.parentId))) {
    place(root, rootX, MARGIN);
    rootX += measure(root).w + 48;
  }
  return definitions.map((group) => ({ ...group, bounds: boundsById.get(group.id) || { x: MARGIN, y: MARGIN, w: 0, h: 0 } }));
}

function measureGroupBounds(sourceGroups, bodyPosition) {
  const definitions = sourceGroups.map((group) => ({
    ...group,
    id: String(group.id),
    parentId: group.parentId ? String(group.parentId) : "",
    primitiveIds: [...(group.primitiveIds || [])],
  }));
  const byId = new Map(definitions.map((group) => [group.id, group]));
  const childrenByParent = new Map(definitions.map((group) => [group.id, []]));
  for (const group of definitions) if (byId.has(group.parentId)) childrenByParent.get(group.parentId).push(group.id);
  const measured = new Map();
  const measure = (group, visiting = new Set()) => {
    if (measured.has(group.id)) return measured.get(group.id);
    if (visiting.has(group.id)) return { x: MARGIN, y: MARGIN, w: 48, h: 48 };
    const next = new Set(visiting).add(group.id);
    const boxes = group.primitiveIds.map((id) => bodyPosition.get(id)?.bounds).filter(Boolean);
    for (const childId of childrenByParent.get(group.id) || []) boxes.push(measure(byId.get(childId), next));
    const padding = 24;
    const bounds = boxes.length ? boundingBox(boxes, padding) : { x: MARGIN, y: MARGIN, w: 48, h: 48 };
    measured.set(group.id, bounds);
    return bounds;
  };
  return definitions.map((group) => ({ ...group, bounds: measure(group) }));
}

function boundingBox(boxes, padding) {
  const minX = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding);
  const minY = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + padding;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + padding;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function arrangeTopLevelUnits(groups, bodyPosition, relations) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const roots = groups.filter((group) => !groupById.has(group.parentId));
  const rootByBody = new Map();
  for (const root of roots) for (const primitiveId of root.primitiveIds) if (!rootByBody.has(primitiveId)) rootByBody.set(primitiveId, root.id);
  const units = [
    ...roots.map((group) => ({ id: `group:${group.id}`, kind: "group", sourceId: group.id, bounds: group.bounds })),
    ...[...bodyPosition.values()]
      .filter((body) => !rootByBody.has(body.id))
      .map((body) => ({ id: `body:${body.id}`, kind: "body", sourceId: body.id, bounds: body.bounds })),
  ];
  const unitIdForBody = (bodyId) => rootByBody.has(bodyId) ? `group:${rootByBody.get(bodyId)}` : `body:${bodyId}`;
  const unitRelations = relations
    .map((relation) => ({
      ...relation,
      sourcePrimitiveId: unitIdForBody(relation.sourcePrimitiveId),
      targetPrimitiveId: unitIdForBody(relation.targetPrimitiveId),
    }))
    .filter((relation) => relation.sourcePrimitiveId !== relation.targetPrimitiveId);
  const layers = topologicalLayers(units, unitRelations);
  let x = MARGIN;
  for (const layer of layers) {
    let y = MARGIN;
    let layerWidth = 0;
    for (const unit of layer) {
      translateTopLevelUnit(unit, x - unit.bounds.x, y - unit.bounds.y, groups, groupById, bodyPosition);
      y += unit.bounds.h + GAP_Y;
      layerWidth = Math.max(layerWidth, unit.bounds.w);
    }
    x += layerWidth + GAP_X;
  }
}

function translateTopLevelUnit(unit, dx, dy, groups, groupById, bodyPosition) {
  if (unit.kind === "body") {
    const body = bodyPosition.get(unit.sourceId);
    body.bounds = translateBounds(body.bounds, dx, dy);
    unit.bounds = body.bounds;
    return;
  }
  const root = groupById.get(unit.sourceId);
  for (const primitiveId of root.primitiveIds) {
    const body = bodyPosition.get(primitiveId);
    if (body) body.bounds = translateBounds(body.bounds, dx, dy);
  }
  for (const group of groups) {
    let ancestor = group;
    while (ancestor && ancestor.id !== root.id) ancestor = groupById.get(ancestor.parentId);
    if (ancestor) group.bounds = translateBounds(group.bounds, dx, dy);
  }
  unit.bounds = root.bounds;
}

function translateBounds(bounds, dx, dy) {
  return { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
}

function topologicalLayers(bodies, relations) {
  const ids = new Set(bodies.map((primitive) => primitive.id));
  const incoming = new Map(bodies.map((primitive) => [primitive.id, 0]));
  const adjacency = new Map(bodies.map((primitive) => [primitive.id, []]));
  for (const relation of relations) {
    if (!ids.has(relation.sourcePrimitiveId) || !ids.has(relation.targetPrimitiveId) || relation.sourcePrimitiveId === relation.targetPrimitiveId) continue;
    if (relation.relationTags?.includes("state")) continue;
    adjacency.get(relation.sourcePrimitiveId).push(relation.targetPrimitiveId);
    incoming.set(relation.targetPrimitiveId, incoming.get(relation.targetPrimitiveId) + 1);
  }
  const remaining = new Set(ids);
  const result = [];
  while (remaining.size) {
    const layer = bodies.filter((primitive) => remaining.has(primitive.id) && incoming.get(primitive.id) === 0);
    if (!layer.length) return [...result, bodies.filter((primitive) => remaining.has(primitive.id))];
    result.push(layer.sort((a, b) => a.id.localeCompare(b.id)));
    for (const primitive of layer) {
      remaining.delete(primitive.id);
      for (const target of adjacency.get(primitive.id)) incoming.set(target, incoming.get(target) - 1);
    }
  }
  return result;
}

function routeRelation(relation, bodyPosition, primitives, routedConnectors) {
  const source = bodyPosition.get(relation.sourcePrimitiveId);
  const target = bodyPosition.get(relation.targetPrimitiveId);
  const sourceAnchor = source ? { x: source.bounds.x + source.bounds.w, y: source.bounds.y + source.bounds.h / 2 } : null;
  const targetAnchor = target ? { x: target.bounds.x, y: target.bounds.y + target.bounds.h / 2 } : null;
  const routeClass = relation.relationTags?.includes("state") ? "state" : relation.relationTags?.includes("bypass") ? "bypass" : relation.relationTags?.includes("crossScale") ? "cross-scale" : "main-flow";
  if (!sourceAnchor || !targetAnchor) return { ...relation, routeClass, points: [] };
  if (routeClass === "bypass") {
    const top = Math.min(source.bounds.y, target.bounds.y) - 30;
    return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: sourceAnchor.x + 18, y: top }, { x: targetAnchor.x - 18, y: top }, targetAnchor] }, source, target, primitives, routedConnectors);
  }
  if (routeClass === "state") {
    const left = Math.min(source.bounds.x, target.bounds.x) - 36;
    return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: left, y: sourceAnchor.y }, { x: left, y: targetAnchor.y }, targetAnchor] }, source, target, primitives, routedConnectors);
  }
  const middle = (sourceAnchor.x + targetAnchor.x) / 2;
  return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: middle, y: sourceAnchor.y }, { x: middle, y: targetAnchor.y }, targetAnchor] }, source, target, primitives, routedConnectors);
}

function withObstacleRouting(connector, source, target, primitives, routedConnectors) {
  const bodies = primitives.filter((primitive) => primitive.role === "body"
    && primitive.id !== source.id && primitive.id !== target.id);
  const start = connector.points[0];
  const end = connector.points.at(-1);
  const clearance = 24;
  const candidates = [{ kind: "direct", points: connector.points }];
  const topCorridors = uniqueNumbers(bodies.map((body) => body.bounds.y - clearance));
  const bottomCorridors = uniqueNumbers(bodies.map((body) => body.bounds.y + body.bounds.h + clearance));
  for (const y of topCorridors.sort((a, b) => b - a)) candidates.push({ kind: "top", points: horizontalCorridor(start, end, y) });
  for (const y of bottomCorridors.sort((a, b) => a - b)) candidates.push({ kind: "bottom", points: horizontalCorridor(start, end, y) });
  if (connector.routeClass === "state") {
    const left = Math.min(source.bounds.x, target.bounds.x, ...bodies.map((body) => body.bounds.x)) - clearance;
    const right = Math.max(source.bounds.x + source.bounds.w, target.bounds.x + target.bounds.w, ...bodies.map((body) => body.bounds.x + body.bounds.w)) + clearance;
    candidates.push({ kind: "left", points: verticalCorridor(start, end, left) });
    candidates.push({ kind: "right", points: verticalCorridor(start, end, right) });
  }
  const ranked = candidates.map((candidate, index) => {
    const points = simplifyOrthogonalPath(candidate.points);
    return {
      ...candidate,
      points,
      index,
      cost: [countBodyIntersections(points, bodies), countConnectorCrossings(points, connector, routedConnectors), countBends(points), pathLength(points), index],
    };
  }).filter((candidate) => candidate.cost[0] === 0).sort((first, second) => compareCost(first.cost, second.cost));
  const selected = ranked.find((candidate) => countBodyIntersections(candidate.points, bodies) === 0);
  return selected ? { ...connector, points: selected.points } : connector;
}

function horizontalCorridor(start, end, y) {
  const direction = end.x >= start.x ? 1 : -1;
  const startX = start.x + direction * 18;
  const endX = end.x - direction * 18;
  return [start, { x: startX, y: start.y }, { x: startX, y }, { x: endX, y }, { x: endX, y: end.y }, end];
}

function verticalCorridor(start, end, x) {
  return [start, { x, y: start.y }, { x, y: end.y }, end];
}

function uniqueNumbers(values) { return [...new Set(values.filter(Number.isFinite))]; }

function simplifyOrthogonalPath(points) {
  const compact = [];
  for (const point of points) {
    const previous = compact.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) compact.push(point);
  }
  return compact.filter((point, index) => {
    if (index === 0 || index === compact.length - 1) return true;
    const previous = compact[index - 1];
    const next = compact[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function countBodyIntersections(points, bodies) {
  return bodies.reduce((count, body) => count + Number(pathIntersectsRectInterior(points, body.bounds)), 0);
}

function countConnectorCrossings(points, connector, routedConnectors) {
  let crossings = 0;
  for (const other of routedConnectors) {
    if (connectorsShareEndpoint(connector, other)) continue;
    const intersections = new Set();
    forEachSegment(points, (start, end) => forEachSegment(other.points, (otherStart, otherEnd) => {
      const point = segmentIntersection(start, end, otherStart, otherEnd);
      if (point) intersections.add(`${point.x.toFixed(9)},${point.y.toFixed(9)}`);
    }));
    crossings += intersections.size;
  }
  return crossings;
}

function countBends(points) {
  let bends = 0;
  for (let index = 2; index < points.length; index += 1) {
    const previousHorizontal = points[index - 2].y === points[index - 1].y;
    const nextHorizontal = points[index - 1].y === points[index].y;
    if (previousHorizontal !== nextHorizontal) bends += 1;
  }
  return bends;
}

function pathLength(points) {
  let length = 0;
  forEachSegment(points, (start, end) => { length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y); });
  return length;
}

function compareCost(first, second) {
  for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) return first[index] - second[index];
  return 0;
}

function primitiveSize(primitive) {
  const form = primitive.form;
  if (form === "plane") return { w: 72, h: 86 };
  if (form === "stack") return { w: 92, h: 62 };
  if (form === "glyph" || form === "cell") return { w: 58, h: 58 };
  if (form === "strip") return { w: 96, h: 48 };
  if (form === "callout") return { w: 118, h: 64 };
  if (form === "wedge") return { w: 82, h: 62 };
  return { w: 90, h: 54 };
}

function anchorsFor(primitive) { return { inputs: [{ id: "in", x: primitive.bounds.x, y: primitive.bounds.y + primitive.bounds.h / 2 }], outputs: [{ id: "out", x: primitive.bounds.x + primitive.bounds.w, y: primitive.bounds.y + primitive.bounds.h / 2 }] }; }
function scaleKey(primitive) { return String(primitive.data?.scale || primitive.semanticTags?.find((tag) => /^scale[:=]/.test(tag)) || "unknown"); }
function validBounds(bounds) { return bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0; }
function insidePage(bounds, page) { return validBounds(bounds) && page && bounds.x >= page.x && bounds.y >= page.y && bounds.x + bounds.w <= page.x + page.width && bounds.y + bounds.h <= page.y + page.height; }
function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function contains(outer, inner) { return validBounds(outer) && validBounds(inner) && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h; }
export function scoreLayout(bodies, connectors) {
  let crossings = 0;
  for (let firstIndex = 0; firstIndex < connectors.length; firstIndex += 1) {
    const first = connectors[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < connectors.length; secondIndex += 1) {
      const second = connectors[secondIndex];
      if (connectorsShareEndpoint(first, second)) continue;
      const intersections = new Set();
      forEachSegment(first.points, (firstStart, firstEnd) => {
        forEachSegment(second.points, (secondStart, secondEnd) => {
          const point = segmentIntersection(firstStart, firstEnd, secondStart, secondEnd);
          if (point) intersections.add(`${point.x.toFixed(9)},${point.y.toFixed(9)}`);
        });
      });
      crossings += intersections.size;
    }
  }
  return { crossings, bends: connectors.reduce((sum, connector) => sum + Math.max(0, connector.points.length - 2), 0), crossScaleAlignment: bodies.length ? 1 : 0 };
}

function connectorsShareEndpoint(first, second) {
  return first.sourcePrimitiveId === second.sourcePrimitiveId
    || first.sourcePrimitiveId === second.targetPrimitiveId
    || first.targetPrimitiveId === second.sourcePrimitiveId
    || first.targetPrimitiveId === second.targetPrimitiveId;
}

function forEachSegment(points, visit) {
  if (!Array.isArray(points)) return;
  for (let index = 1; index < points.length; index += 1) visit(points[index - 1], points[index]);
}

function segmentIntersection(a, b, c, d) {
  if (![a, b, c, d].every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const firstX = b.x - a.x;
  const firstY = b.y - a.y;
  const secondX = d.x - c.x;
  const secondY = d.y - c.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (denominator === 0) return null;
  const offsetX = c.x - a.x;
  const offsetY = c.y - a.y;
  const firstRatio = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondRatio = (offsetX * firstY - offsetY * firstX) / denominator;
  if (firstRatio < 0 || firstRatio > 1 || secondRatio < 0 || secondRatio > 1) return null;
  return { x: a.x + firstRatio * firstX, y: a.y + firstRatio * firstY };
}

function pathIntersectsRectInterior(points, bounds) {
  if (!validBounds(bounds)) return false;
  let intersects = false;
  forEachSegment(points, (start, end) => {
    if (!intersects && segmentIntersectsRectInterior(start, end, bounds)) intersects = true;
  });
  return intersects;
}

function segmentIntersectsRectInterior(start, end, bounds) {
  if (![start, end].every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const xInterval = openAxisInterval(start.x, end.x - start.x, bounds.x, bounds.x + bounds.w);
  const yInterval = openAxisInterval(start.y, end.y - start.y, bounds.y, bounds.y + bounds.h);
  if (!xInterval || !yInterval) return false;
  const low = Math.max(0, xInterval.low, yInterval.low);
  const high = Math.min(1, xInterval.high, yInterval.high);
  return low < high && high > 0 && low < 1;
}

function openAxisInterval(origin, delta, minimum, maximum) {
  if (delta === 0) return origin > minimum && origin < maximum ? { low: -Infinity, high: Infinity } : null;
  const first = (minimum - origin) / delta;
  const second = (maximum - origin) / delta;
  return { low: Math.min(first, second), high: Math.max(first, second) };
}
