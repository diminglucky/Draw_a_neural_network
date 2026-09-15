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
  const laidPrimitives = laidBodies.map((primitive) => ({ ...primitive, anchors: anchorsFor(primitive) }));
  for (const primitive of primitives.filter((item) => item.role !== "body")) {
    const owner = bodyPosition.get(primitive.projectionId) || bodyPosition.get(primitive.sourceNodeIds?.[0]);
    if (!owner) continue;
    laidPrimitives.push({ ...primitive, bounds: { x: owner.bounds.x, y: owner.bounds.y + owner.bounds.h + 12, w: owner.bounds.w, h: 18 }, anchors: { inputs: [], outputs: [] }, zIndex: owner.zIndex + 10 });
  }
  const maxX = Math.max(...laidPrimitives.map((primitive) => primitive.bounds.x + primitive.bounds.w), MARGIN);
  const maxY = Math.max(...laidPrimitives.map((primitive) => primitive.bounds.y + primitive.bounds.h), MARGIN);
  const page = { x: 0, y: 0, width: maxX + MARGIN, height: maxY + MARGIN };
  const connectors = relations.map((relation) => routeRelation(relation, bodyPosition, laidPrimitives));
  const groups = (scene.groups || []).map((group) => {
    const members = (group.primitiveIds || []).map((id) => bodyPosition.get(id)).filter(Boolean);
    const padding = 24;
    const minX = Math.min(...members.map((member) => member.bounds.x), MARGIN) - padding;
    const minY = Math.min(...members.map((member) => member.bounds.y), MARGIN) - padding;
    const maxX = Math.max(...members.map((member) => member.bounds.x + member.bounds.w), MARGIN) + padding;
    const maxY = Math.max(...members.map((member) => member.bounds.y + member.bounds.h), MARGIN) + padding;
    return { id: String(group.id), parentId: group.parentId ? String(group.parentId) : "", primitiveIds: [...(group.primitiveIds || [])], bounds: { x: Math.max(0, minX), y: Math.max(0, minY), w: maxX - Math.max(0, minX), h: maxY - Math.max(0, minY) }, role: String(group.role || "module") };
  });
  const diagnostics = [...(scene.diagnostics || [])];
  for (const relation of relations) if (relation.relationTags?.includes("crossScale")) diagnostics.push({ code: "cross-scale-transfer", relationId: relation.id, severity: "warning" });
  const maxPrimitives = Number.isFinite(profiles.maxPrimitives) ? profiles.maxPrimitives : Infinity;
  if (laidPrimitives.length > maxPrimitives) diagnostics.push({ code: "layout-budget-exceeded", primitiveCount: laidPrimitives.length, budget: maxPrimitives, severity: "warning" });
  const result = { version: VERSION, units: "layout-unit", primitives: laidPrimitives.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)), connectors, groups, page, diagnostics, softScore: scoreLayout(laidBodies, connectors) };
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
  for (const group of layout.groups || []) {
    for (const primitiveId of group.primitiveIds || []) {
      const member = primitiveById.get(primitiveId);
      if (!member) issues.push({ code: "missing-group-primitive", groupId: group.id, primitiveId });
      else if (!contains(group.bounds, member.bounds)) issues.push({ code: "group-containment-violation", groupId: group.id, primitiveId });
    }
  }
  const positions = new Map(bodies.map((primitive) => [primitive.id, primitive.bounds]));
  for (const connector of layout.connectors || []) {
    const source = positions.get(connector.sourcePrimitiveId);
    const target = positions.get(connector.targetPrimitiveId);
    if (source && target && connector.relationTags?.includes("data") && target.x < source.x) issues.push({ code: "dag-direction-violation", relationId: connector.id });
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: layout.primitives?.length || 0, connectorCount: layout.connectors?.length || 0 } };
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

function routeRelation(relation, bodyPosition, primitives) {
  const source = bodyPosition.get(relation.sourcePrimitiveId);
  const target = bodyPosition.get(relation.targetPrimitiveId);
  const sourceAnchor = source ? { x: source.bounds.x + source.bounds.w, y: source.bounds.y + source.bounds.h / 2 } : null;
  const targetAnchor = target ? { x: target.bounds.x, y: target.bounds.y + target.bounds.h / 2 } : null;
  const routeClass = relation.relationTags?.includes("state") ? "state" : relation.relationTags?.includes("bypass") ? "bypass" : relation.relationTags?.includes("crossScale") ? "cross-scale" : "main-flow";
  if (!sourceAnchor || !targetAnchor) return { ...relation, routeClass, points: [] };
  if (routeClass === "bypass") {
    const top = Math.min(source.bounds.y, target.bounds.y) - 30;
    return { ...relation, routeClass, points: [sourceAnchor, { x: sourceAnchor.x + 18, y: top }, { x: targetAnchor.x - 18, y: top }, targetAnchor] };
  }
  if (routeClass === "state") {
    const left = Math.min(source.bounds.x, target.bounds.x) - 36;
    return { ...relation, routeClass, points: [sourceAnchor, { x: left, y: sourceAnchor.y }, { x: left, y: targetAnchor.y }, targetAnchor] };
  }
  const middle = (sourceAnchor.x + targetAnchor.x) / 2;
  return { ...relation, routeClass, points: [sourceAnchor, { x: middle, y: sourceAnchor.y }, { x: middle, y: targetAnchor.y }, targetAnchor] };
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
function scoreLayout(bodies, connectors) { return { crossings: 0, bends: connectors.reduce((sum, connector) => sum + Math.max(0, connector.points.length - 2), 0), crossScaleAlignment: bodies.length ? 1 : 0 }; }
