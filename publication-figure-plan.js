const FIGURE_UNIT_INCHES = 0.01;
const PAGE = Object.freeze({ width: 1600, height: 540, margin: 45 });
const CENTER_Y = 270;

export const VGG_TENSOR_PLATE_V3 = Object.freeze({
  id: "vgg-tensor-plate-v3",
  rendererFamily: "cnn-tensor-plate",
  coordinateSpace: Object.freeze({
    unit: "figure-unit",
    figureUnitInches: FIGURE_UNIT_INCHES,
    origin: "top-left",
    width: PAGE.width,
    height: PAGE.height,
  }),
  projection: Object.freeze({ kind: "oblique-3d", skewX: 19, skewY: -14 }),
});

// Compatibility exports keep existing callers on the latest deterministic VGG grammar.
export const VGG_PAPER_PLATE_V2 = VGG_TENSOR_PLATE_V3;
export const VGG_PAPER_STYLE_V1 = VGG_TENSOR_PLATE_V3;

export function buildPublicationFigurePlan(networkIR, options = {}) {
  const style = options.style ?? VGG_TENSOR_PLATE_V3;
  const nodes = orderedNodes(networkIR);
  const draftGroups = buildGroups(nodes, style);
  const totalWidth = draftGroups.reduce((sum, group) => sum + group.bounds.width, 0);
  const gap = Math.max(20, Math.floor((PAGE.width - PAGE.margin * 2 - totalWidth) / Math.max(1, draftGroups.length - 1)));
  let cursorX = PAGE.margin;
  const primitiveGroups = draftGroups.map((group) => {
    const positioned = { ...group, bounds: { ...group.bounds, x: cursorX } };
    cursorX += group.bounds.width + gap;
    return positioned;
  });
  const byId = new Map(primitiveGroups.map((group) => [group.id, group]));
  const connectors = connectorsFor(networkIR, byId);
  const labels = primitiveGroups.flatMap((group) => labelsFor(group));
  const sourceFigure = networkIR?.figure ?? {};
  const plan = {
    version: 1,
    styleId: style.id,
    rendererFamily: style.rendererFamily,
    coordinateSpace: { ...style.coordinateSpace },
    figure: {
      id: String(sourceFigure.id ?? "vgg16"),
      title: "VGG-16",
      description: "Hierarchical convolutional feature extraction and ImageNet classification.",
    },
    primitiveGroups,
    connectors,
    labels,
  };
  return { ...plan, validation: validatePublicationFigurePlan(plan) };
}

export function validatePublicationFigurePlan(plan) {
  const violations = [];
  if (!sameCoordinateSpace(plan?.coordinateSpace)) violations.push("invalid-coordinate-space");
  const groups = Array.isArray(plan?.primitiveGroups) ? plan.primitiveGroups : [];
  const groupIds = new Set();
  const primitiveIds = new Set();
  const featureHeights = [];
  groups.forEach((group) => {
    if (!group?.id || groupIds.has(group.id)) violations.push("duplicate-group:" + String(group?.id));
    groupIds.add(group?.id);
    if (!validBounds(group?.bounds)) violations.push("invalid-bounds:" + String(group?.id));
    if (validBounds(group?.bounds) && !inPage(group.bounds)) violations.push("out-of-bounds:" + String(group.id));
    const ids = Array.isArray(group?.primitiveIds) ? group.primitiveIds : [];
    ids.forEach((id) => {
      if (primitiveIds.has(id)) violations.push("duplicate-primitive:" + String(id));
      primitiveIds.add(id);
    });
    if (group?.kind === "feature-map-stack") {
      const planeCount = visiblePlaneCount(group);
      for (let plane = 1; plane <= planeCount; plane += 1) {
        for (const face of ["front", "top", "side"]) {
          const expected = `${group.id}.plane-${plane}.${face}`;
          if (!ids.includes(expected)) violations.push("missing-stack-face:" + expected);
        }
      }
      if (ids.length !== planeCount * 3) violations.push("invalid-stack-plane-count:" + String(group.id));
      featureHeights.push({ id: group.id, stage: group.semantic?.stage ?? 0, height: group.bounds?.height ?? 0 });
    } else if (group?.kind === "flatten-ribbon") {
      if (!sameValues(ids, [`${group.id}.ribbon`])) violations.push("invalid-flatten-ribbon:" + String(group.id));
    } else if (group?.kind === "dense-vector-layer") {
      validateVectorPrimitiveIds(group, "unit", 7, violations);
    } else if (group?.kind === "score-vector-layer") {
      validateVectorPrimitiveIds(group, "score", 6, violations);
    } else if (group?.kind !== "input-rgb-tile") {
      for (const face of ["front", "top", "side"]) {
        const expected = `${group.id}.${face}`;
        if (!ids.includes(expected)) violations.push("missing-prism-face:" + expected);
      }
    } else if (!sameValues(ids, ["input.red", "input.green", "input.blue"])) {
      violations.push("invalid-input-rgb-tile");
    }
  });
  featureHeights
    .sort((left, right) => left.stage - right.stage)
    .reduce((previous, current) => {
      if (previous && current.height >= previous.height) violations.push("non-decreasing-feature-height:" + current.id);
      return current;
    }, null);
  const labels = Array.isArray(plan?.labels) ? plan.labels : [];
  const labelIds = new Set();
  labels.forEach((label) => {
    if (!label?.id || labelIds.has(label.id)) violations.push("duplicate-label:" + String(label?.id));
    labelIds.add(label?.id);
    if (!groupIds.has(label?.groupId)) violations.push("invalid-label-group:" + String(label?.id));
    if (!Number.isFinite(label?.fontSizePt) || label.fontSizePt < 7) violations.push("unreadable-label:" + String(label?.id));
    if (!validBounds(label) || !inCanvas(label)) violations.push("invalid-label-bounds:" + String(label?.id));
  });
  const connectors = Array.isArray(plan?.connectors) ? plan.connectors : [];
  connectors.forEach((connector) => {
    if (!groupIds.has(connector?.sourceGroupId) || !groupIds.has(connector?.targetGroupId)) violations.push("invalid-connector:" + String(connector?.id));
    if (!Array.isArray(connector?.points) || connector.points.length < 2) violations.push("invalid-connector-route:" + String(connector?.id));
  });
  return { valid: violations.length === 0, violations, summary: { groupCount: groups.length, primitiveCount: primitiveIds.size, connectorCount: connectors.length, labelCount: labels.length } };
}

function orderedNodes(networkIR) {
  if (!Array.isArray(networkIR?.nodes) || networkIR.nodes.length === 0) throw new Error("Publication Figure Plan requires at least one Network IR node");
  return [...networkIR.nodes].sort((left, right) => Number(left.stage ?? 0) - Number(right.stage ?? 0) || String(left.id).localeCompare(String(right.id)));
}

function buildGroups(nodes, style) {
  const groups = [];
  let flattened = false;
  nodes.forEach((node, index) => {
    const previous = nodes[index - 1] ?? null;
    if (!flattened && String(node.visualRole) === "fully-connected") {
      groups.push(buildFlattenGroup(previous, node, index, style));
      flattened = true;
    }
    groups.push(buildGroup(node, index, style, previous));
  });
  return groups;
}

function buildGroup(node, index, style, previous) {
  const id = String(node.id ?? "node-" + (index + 1));
  const role = String(node.visualRole ?? "standard");
  const kind = groupKind(id, role);
  const spatial = spatialSize(node);
  const inputSpatialSize = kind === "downsample-transition" ? spatialSize(previous) : null;
  const height = groupHeight(kind, spatial, inputSpatialSize);
  const width = groupWidth(kind, height, channelCount(node));
  return {
    id,
    kind,
    primitiveIds: primitiveIdsFor(id, kind, positiveInteger(node.repeatCount, 1)),
    bounds: { x: 0, y: Math.round(CENTER_Y - height / 2), width, height },
    extrusionDepthFu: extrusionDepth(node, kind, channelCount(node)),
    skewXFu: style.projection.skewX,
    skewYFu: style.projection.skewY,
    semantic: {
      sourceNodeId: id,
      stage: Number(node.stage ?? index),
      visualRole: role,
      layerRole: String(node.layerRole ?? "network-node"),
      repeatCount: positiveInteger(node.repeatCount, 1),
      channelCount: channelCount(node),
      tensorShape: Array.isArray(node.tensor?.shape) ? [...node.tensor.shape] : [],
      ...(inputSpatialSize ? { inputSpatialSize, outputSpatialSize: spatial } : {}),
    },
  };
}

function buildFlattenGroup(previous, node, index, style) {
  const spatial = spatialSize(previous);
  const height = groupHeight("flatten-ribbon", spatial);
  return {
    id: "flatten",
    kind: "flatten-ribbon",
    primitiveIds: ["flatten.ribbon"],
    bounds: { x: 0, y: Math.round(CENTER_Y - height / 2), width: groupWidth("flatten-ribbon", height), height },
    extrusionDepthFu: 0,
    skewXFu: style.projection.skewX,
    skewYFu: style.projection.skewY,
    semantic: {
      sourceNodeId: String(node.id ?? "fc-1"),
      stage: Number(node.stage ?? index),
      visualRole: "flatten-ribbon",
      layerRole: "flatten",
      repeatCount: 1,
      channelCount: channelCount(previous),
      tensorShape: Array.isArray(previous?.tensor?.shape) ? [...previous.tensor.shape] : [],
    },
  };
}

function groupKind(id, role) {
  if (id === "input") return "input-rgb-tile";
  if (role === "feature-map-stack") return "feature-map-stack";
  if (role === "pooling-block") return "downsample-transition";
  if (role === "fully-connected") return "dense-vector-layer";
  if (role === "softmax-block") return "score-vector-layer";
  return "standard-prism";
}

function primitiveIdsFor(id, kind, repeatCount = 1) {
  if (kind === "input-rgb-tile") return ["input.red", "input.green", "input.blue"];
  if (kind === "feature-map-stack") {
    return Array.from({ length: Math.min(6, Math.max(1, repeatCount)) }, (_, index) => index + 1)
      .flatMap((plane) => ["front", "top", "side"].map((face) => `${id}.plane-${plane}.${face}`));
  }
  if (kind === "flatten-ribbon") return [`${id}.ribbon`];
  if (kind === "dense-vector-layer") return [`${id}.frame`, ...numberedPrimitiveIds(id, "unit", 7)];
  if (kind === "score-vector-layer") return [`${id}.frame`, ...numberedPrimitiveIds(id, "score", 6)];
  return ["front", "top", "side"].map((face) => `${id}.${face}`);
}

function numberedPrimitiveIds(id, prefix, count) {
  return Array.from({ length: count }, (_, index) => `${id}.${prefix}-${index + 1}`);
}

function connectorsFor(networkIR, byId) {
  const edges = Array.isArray(networkIR?.edges) ? networkIR.edges : [];
  const firstDense = [...byId.values()].find((group) => group.kind === "dense-vector-layer")?.id;
  const connectors = edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge, index) => connectorFor(
      edge,
      index,
      byId,
      firstDense && edge.target === firstDense && byId.has("flatten") ? "flatten" : edge.target,
    ));
  if (firstDense && byId.has("flatten")) {
    connectors.push(connectorFor({ id: "flatten-to-" + firstDense, source: "flatten", target: firstDense, kind: "reshape" }, connectors.length, byId));
  }
  return connectors;
}

function connectorFor(edge, index, byId, targetId = edge.target) {
  const source = byId.get(edge.source);
  const target = byId.get(targetId);
  return {
    id: "connector-" + (edge.id ?? index + 1),
    kind: String(edge.kind ?? "forward"),
    sourceGroupId: source.id,
    targetGroupId: target.id,
    sourcePrimitiveId: leadingPrimitiveId(source),
    targetPrimitiveId: leadingPrimitiveId(target),
    points: [
      { x: source.bounds.x + source.bounds.width + 8, y: source.bounds.y + source.bounds.height / 2 },
      { x: target.bounds.x - 8, y: target.bounds.y + target.bounds.height / 2 },
    ],
  };
}

function labelsFor(group) {
  const headingY = Math.max(PAGE.margin, group.bounds.y - 42);
  const detailY = Math.min(PAGE.height - PAGE.margin - 46, group.bounds.y + group.bounds.height + 22);
  const width = Math.max(112, group.bounds.width + 46);
  const x = Math.round(group.bounds.x + (group.bounds.width - width) / 2);
  if (group.kind === "downsample-transition") {
    return [{ id: group.id + ".detail", groupId: group.id, text: "MaxPool 2×2", x, y: detailY, width, height: 20, fontSizePt: 8.25 }];
  }
  if (group.kind === "flatten-ribbon") {
    return [{ id: group.id + ".detail", groupId: group.id, text: "Flatten", x, y: detailY, width, height: 20, fontSizePt: 8.5 }];
  }
  return [
    { id: group.id + ".heading", groupId: group.id, text: headingFor(group), x, y: headingY, width, height: 24, fontSizePt: 10 },
    { id: group.id + ".detail", groupId: group.id, text: detailFor(group), x, y: detailY, width, height: 42, fontSizePt: 8.75 },
  ];
}

function headingFor(group) {
  if (group.kind === "input-rgb-tile") return "Input";
  if (group.kind === "dense-vector-layer") return group.id === "fc-1" ? "FC6" : "FC7";
  if (group.kind === "score-vector-layer") return "FC8";
  return stageHeading("CONV", group.id, /^block-(\d+)$/);
}

function detailFor(group) {
  const shape = tensorLabel(group.semantic.tensorShape, group.semantic.channelCount);
  if (group.kind === "input-rgb-tile") return `RGB image\n${shape}`;
  if (group.kind === "dense-vector-layer") return "4096 units";
  if (group.kind === "score-vector-layer") return "1000 classes";
  return `3×3 · ${group.semantic.channelCount} ×${group.semantic.repeatCount}\n${shape}`;
}

function stageHeading(prefix, id, expression = /^pool-(\d+)$/) {
  const match = expression.exec(id);
  return match ? `${prefix} ${match[1]}` : prefix;
}

function tensorLabel(tensorShape, channels) {
  const spatial = Array.isArray(tensorShape) ? tensorShape.slice(0, 2).join("×") : "";
  return spatial && channels ? `${spatial}×${channels}` : String(channels ?? "");
}

function groupHeight(kind, spatial, inputSpatialSize = null) {
  if (kind === "input-rgb-tile") return 238;
  if (kind === "dense-vector-layer") return 150;
  if (kind === "score-vector-layer") return 128;
  if (kind === "flatten-ribbon") return 92;
  const featureHeight = featureHeightFor(spatial);
  return kind === "downsample-transition" ? featureHeightFor(inputSpatialSize ?? spatial) : featureHeight;
}

function featureHeightFor(spatial) {
  return Math.max(82, Math.round(260 * Math.pow(spatial / 224, 0.4)));
}

function groupWidth(kind, height, channels = null) {
  if (kind === "input-rgb-tile") return 104;
  if (kind === "downsample-transition") return 62;
  if (kind === "flatten-ribbon") return 84;
  if (kind === "dense-vector-layer") return 50;
  if (kind === "score-vector-layer") return 62;
  return Math.max(70, Math.round(height * 0.38) + Math.round(Math.sqrt(Math.max(1, channels ?? 1)) * 1.25));
}

function spatialSize(node) {
  const explicit = node?.visualEncoding?.spatialShape;
  const tensor = node?.tensor?.shape;
  const value = Array.isArray(explicit) ? explicit[0] : Array.isArray(tensor) ? tensor[0] : null;
  return Number.isFinite(value) && value > 0 ? Number(value) : 1;
}

function extrusionDepth(node, kind, channels = null) {
  if (kind === "feature-map-stack" && Number.isFinite(channels)) {
    return Math.round(14 + 28 * Math.sqrt(Math.max(1, channels) / 512));
  }
  const value = node?.visualEncoding?.extrusionDepthFu;
  if (Number.isFinite(value) && value >= 0) return Math.round(value);
  return kind === "feature-map-stack" ? 24 : 10;
}

function channelCount(node) {
  if (Number.isInteger(node?.channelCount) && node.channelCount > 0) return node.channelCount;
  const shape = node?.tensor?.shape;
  const last = Array.isArray(shape) ? shape.at(-1) : null;
  return Number.isInteger(last) && last > 0 ? last : null;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function leadingPrimitiveId(group) {
  if (group.kind === "input-rgb-tile") return "input.blue";
  if (group.kind === "feature-map-stack") return group.primitiveIds.filter((id) => id.endsWith(".front")).at(-1);
  if (group.kind === "flatten-ribbon") return `${group.id}.ribbon`;
  if (group.kind === "dense-vector-layer" || group.kind === "score-vector-layer") return `${group.id}.frame`;
  return `${group.id}.front`;
}

function visiblePlaneCount(group) {
  const repeat = Number(group?.semantic?.repeatCount);
  return Number.isInteger(repeat) ? Math.min(6, Math.max(1, repeat)) : 1;
}

function validateVectorPrimitiveIds(group, prefix, count, violations) {
  const expected = [`${group.id}.frame`, ...numberedPrimitiveIds(group.id, prefix, count)];
  if (!sameValues(group.primitiveIds, expected)) violations.push("invalid-vector-primitives:" + String(group.id));
}

function sameCoordinateSpace(space) {
  return Boolean(space && space.unit === "figure-unit" && space.figureUnitInches === FIGURE_UNIT_INCHES && space.origin === "top-left" && space.width === PAGE.width && space.height === PAGE.height);
}

function validBounds(bounds) {
  return Boolean(bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0);
}

function inPage(bounds) {
  return bounds.x >= PAGE.margin && bounds.y >= PAGE.margin && bounds.x + bounds.width <= PAGE.width - PAGE.margin && bounds.y + bounds.height <= PAGE.height - PAGE.margin;
}

function inCanvas(bounds) {
  return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= PAGE.width && bounds.y + bounds.height <= PAGE.height;
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
