import { compileNeuralFigureProgram } from "./neural-figure-dsl.mjs";
import { placeLabels } from "./label-placement.mjs";

export const VISIO_DSL_BRIDGE_VERSION = "visio-dsl-bridge/v1";

export function compileNeuralFigureDslToVisioLayout(program = {}, options = {}) {
  const compiled = compileNeuralFigureProgram(program);
  const nodes = [];
  const edges = [];
  const primitiveById = new Map();

  for (const group of compiled.groups) {
    nodes.push(visioNodeForGroup(group));
  }
  for (const primitive of compiled.primitives) {
    const node = visioNodeForPrimitive(primitive);
    if (!node) continue;
    nodes.push(node);
    primitiveById.set(primitive.id, primitive);
  }
  const labelNodes = createLabelNodes(nodes);
  nodes.push(...labelNodes);
  for (const connector of compiled.connectors) {
    edges.push({
      id: connector.id,
      source: connector.sourcePrimitiveId,
      target: connector.targetPrimitiveId,
      type: connector.routeClass === "main-flow" ? "signal" : connector.routeClass,
      sourceEdgeId: connector.id,
      points: connector.points.map(([x, y]) => ({ x, y })),
      sourceEndpointIds: { source: connector.sourceAnchorId, target: connector.targetAnchorId },
      routeClass: connector.routeClass,
      avoidGlue: true,
    });
  }
  normalizeLayoutCoordinates(nodes, edges, finite(options.margin, 80));
  const artboard = inferArtboard(nodes, edges);
  invertVerticalCoordinates(nodes, edges, artboard.height);
  return {
    version: "visio-diagram-plan/v1",
    bridgeVersion: VISIO_DSL_BRIDGE_VERSION,
    figure: {
      title: String(options.title || program.title || "Neural Figure DSL"),
      subtitle: String(options.subtitle || "Publication primitive composition"),
    },
    nodes,
    edges,
    artboard,
  };
}

function createLabelNodes(nodes) {
  const labelItems = nodes
    .filter((node) => node.label && node.shapeKind !== "publication-group-box")
    .map((node) => ({
      id: node.id,
      label: node.label,
      bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
    }));
  const placement = placeLabels(labelItems, { padding: 14, labelHeight: 26, preferredPlacement: "below" });
  const labeledIds = new Set(labelItems.map((item) => item.id));
  for (const node of nodes) if (labeledIds.has(node.id)) node.label = "";
  return placement.labels.map((label) => ({
    id: `label:${label.id}`,
    sourceNodeId: "",
    sourceNodeIds: [],
    label: "",
    subtitle: "",
    representation: "publication-label",
    shapeKind: "publication-label",
    visualRole: "publication-label",
    x: label.bounds.x,
    y: label.bounds.y,
    w: label.bounds.w,
    h: label.bounds.h,
    geometryData: label,
    evidence: [],
  }));
}

function visioNodeForPrimitive(primitive) {
  if (primitive.kind === "tensor-box") {
    return tensorNode(primitive, "publication-tensor-box");
  }
  if (primitive.kind === "right-banded-tensor") {
    return tensorNode(primitive, "publication-right-banded-tensor");
  }
  if (primitive.kind === "dense-layer") {
    const bounds = primitive.bounds || boundsOfDenseNodes(primitive.nodes);
    return {
      id: primitive.id,
      sourceNodeId: primitive.sourceNodeIds?.[0] || primitive.id,
      sourceNodeIds: primitive.sourceNodeIds || [primitive.id],
      label: primitive.labels?.caption || "",
      subtitle: "",
      representation: "publication-dense-layer",
      shapeKind: "publication-dense-layer",
      visualRole: "publication-dense-layer",
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      geometryData: primitive,
      evidence: primitive.evidence || [],
    };
  }
  if (primitive.kind === "layer-stack") {
    const bounds = primitive.bounds || boundsOfCells(primitive.cells);
    return {
      id: primitive.id,
      sourceNodeId: primitive.sourceNodeIds?.[0] || primitive.id,
      sourceNodeIds: primitive.sourceNodeIds || [primitive.id],
      label: primitive.labels?.caption || "",
      subtitle: "",
      representation: "publication-layer-stack",
      shapeKind: "publication-layer-stack",
      visualRole: "publication-layer-stack",
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      geometryData: primitive,
      evidence: primitive.evidence || [],
    };
  }
  return null;
}

function boundsOfDenseNodes(nodes = []) {
  const boxes = nodes.map((node) => ({
    x: Number(node.x) - Number(node.r),
    y: Number(node.y) - Number(node.r),
    w: Number(node.r) * 2,
    h: Number(node.r) * 2,
  })).filter((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite));
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function tensorNode(primitive, shapeKind) {
  const geometry = primitive.geometry || {};
  return {
    id: primitive.id,
    sourceNodeId: primitive.sourceNodeIds?.[0] || primitive.id,
    sourceNodeIds: primitive.sourceNodeIds || [primitive.id],
    label: primitive.labels?.caption || "",
    subtitle: "",
    representation: shapeKind,
    shapeKind,
    visualRole: shapeKind,
    x: Number(geometry.x) || 0,
    y: Number(geometry.y) || 0,
    w: Number(geometry.w) || 120,
    h: Number(geometry.h) || 80,
    depth: Number(geometry.depth) || 30,
    geometryData: primitive,
    evidence: primitive.evidence || [],
  };
}

function visioNodeForGroup(group) {
  return {
    id: group.id,
    sourceNodeId: group.id,
    label: "",
    subtitle: "",
    representation: "publication-group-box",
    shapeKind: "publication-group-box",
    visualRole: "publication-group-box",
    x: group.bounds.x,
    y: group.bounds.y,
    w: group.bounds.w,
    h: group.bounds.h,
    sourceNodeIds: group.sourceNodeIds || [],
    geometryData: group,
    evidence: group.evidence || [],
  };
}

function boundsOfCells(cells = []) {
  const points = cells.flatMap((cell) => Object.values(cell.faces || {}).flat());
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function inferArtboard(nodes, edges) {
  const xs = nodes.flatMap((node) => [node.x, node.x + node.w]);
  const ys = nodes.flatMap((node) => [node.y, node.y + node.h]);
  for (const edge of edges) {
    for (const point of edge.points || []) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  return {
    x: 0,
    y: 0,
    width: Math.max(1, ...xs) + 80,
    height: Math.max(1, ...ys) + 80,
  };
}

function normalizeLayoutCoordinates(nodes, edges, margin) {
  if (!nodes.length) return;
  const minX = Math.min(...nodes.map((node) => Number(node.x) || 0));
  const minY = Math.min(...nodes.map((node) => Number(node.y) || 0));
  const minEdgeX = edges.flatMap((edge) => edge.points || []).map((point) => Number(point.x) || 0).reduce((min, value) => Math.min(min, value), Infinity);
  const minEdgeY = edges.flatMap((edge) => edge.points || []).map((point) => Number(point.y) || 0).reduce((min, value) => Math.min(min, value), Infinity);
  const dx = margin - Math.min(minX, Number.isFinite(minEdgeX) ? minEdgeX : minX);
  const dy = margin - Math.min(minY, Number.isFinite(minEdgeY) ? minEdgeY : minY);
  if (dx === 0 && dy === 0) return;
  for (const node of nodes) {
    node.x = (Number(node.x) || 0) + dx;
    node.y = (Number(node.y) || 0) + dy;
    translateGeometryData(node.geometryData, dx, dy);
  }
  for (const edge of edges) {
    edge.points = (edge.points || []).map((point) => ({
      x: (Number(point.x) || 0) + dx,
      y: (Number(point.y) || 0) + dy,
    }));
  }
}

function invertVerticalCoordinates(nodes, edges, height) {
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  for (const node of nodes) {
    node.y = height - ((Number(node.y) || 0) + (Number(node.h) || 0));
    invertGeometryData(node.geometryData, height);
  }
  for (const edge of edges) {
    const source = nodeById.get(String(edge.source || ""));
    const target = nodeById.get(String(edge.target || ""));
    const connectorLift = Math.max(Number(source?.h) || 0, Number(target?.h) || 0) * 0.45;
    edge.points = (edge.points || []).map((point) => ({
      x: Number(point.x) || 0,
      y: height - (Number(point.y) || 0) + connectorLift,
    }));
  }
}

function translateGeometryData(data, dx, dy) {
  if (!data || typeof data !== "object") return;
  translatePointObject(data.geometry, dx, dy);
  translateBounds(data.bounds, dx, dy);
  translateAnchorMap(data.anchors, dx, dy);
  translatePointLists(data.faces, dx, dy);
  translatePointLists(data.band, dx, dy);
  if (Array.isArray(data.cells)) for (const cell of data.cells) translateGeometryData(cell, dx, dy);
  if (data.backing) translateGeometryData(data.backing, dx, dy);
  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) {
      node.x = (Number(node.x) || 0) + dx;
      node.y = (Number(node.y) || 0) + dy;
    }
  }
  if (Array.isArray(data.layerLabels)) {
    for (const label of data.layerLabels) {
      label.x = (Number(label.x) || 0) + dx;
      label.y = (Number(label.y) || 0) + dy;
    }
  }
  if (Array.isArray(data.links)) {
    for (const link of data.links) {
      link.points = (link.points || []).map(([x, y]) => [Number(x) + dx, Number(y) + dy]);
    }
  }
}

function invertGeometryData(data, height) {
  if (!data || typeof data !== "object") return;
  invertPointObject(data.geometry, height);
  invertBounds(data.bounds, height);
  invertAnchorMap(data.anchors, height);
  invertPointLists(data.faces, height);
  invertPointLists(data.band, height);
  if (Array.isArray(data.cells)) for (const cell of data.cells) invertGeometryData(cell, height);
  if (data.backing) invertGeometryData(data.backing, height);
  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) node.y = height - (Number(node.y) || 0);
  }
  if (Array.isArray(data.layerLabels)) {
    for (const label of data.layerLabels) label.y = height - (Number(label.y) || 0);
  }
  if (Array.isArray(data.links)) {
    for (const link of data.links) {
      link.points = (link.points || []).map(([x, y]) => [Number(x), height - Number(y)]);
    }
  }
}

function translatePointObject(point, dx, dy) {
  if (!point || typeof point !== "object") return;
  if (Number.isFinite(Number(point.x))) point.x = Number(point.x) + dx;
  if (Number.isFinite(Number(point.y))) point.y = Number(point.y) + dy;
}

function invertPointObject(point, height) {
  if (!point || typeof point !== "object") return;
  if (Number.isFinite(Number(point.y))) point.y = height - Number(point.y);
  if (Number.isFinite(Number(point.h))) point.y -= Number(point.h);
}

function translateBounds(bounds, dx, dy) {
  if (!bounds || typeof bounds !== "object") return;
  if (Number.isFinite(Number(bounds.x))) bounds.x = Number(bounds.x) + dx;
  if (Number.isFinite(Number(bounds.y))) bounds.y = Number(bounds.y) + dy;
}

function invertBounds(bounds, height) {
  if (!bounds || typeof bounds !== "object") return;
  const h = Number(bounds.h);
  if (Number.isFinite(Number(bounds.y))) bounds.y = height - Number(bounds.y) - (Number.isFinite(h) ? h : 0);
}

function translateAnchorMap(anchors, dx, dy) {
  if (!anchors || typeof anchors !== "object") return;
  for (const anchor of Object.values(anchors)) translatePointObject(anchor, dx, dy);
}

function invertAnchorMap(anchors, height) {
  if (!anchors || typeof anchors !== "object") return;
  for (const anchor of Object.values(anchors)) invertPointObject(anchor, height);
}

function translatePointLists(value, dx, dy) {
  if (!value || typeof value !== "object") return;
  for (const points of Object.values(value)) {
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (Array.isArray(point)) {
        point[0] = Number(point[0]) + dx;
        point[1] = Number(point[1]) + dy;
      }
    }
  }
}

function invertPointLists(value, height) {
  if (!value || typeof value !== "object") return;
  for (const points of Object.values(value)) {
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (Array.isArray(point)) point[1] = height - Number(point[1]);
    }
  }
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
