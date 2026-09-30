export const FIGURE_QA_VERSION = "figure-qa/v1";

const LABEL_PREFIX = "label:";

export function evaluatePublicationFigure(plan = {}, context = {}) {
  const issues = [];
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
  const bodyNodes = nodes.filter((node) => !String(node.id || "").startsWith(LABEL_PREFIX));
  const labelNodes = nodes.filter((node) => String(node.id || "").startsWith(LABEL_PREFIX));
  const nodeById = new Map(nodes.map((node) => [String(node.id || node.sourceNodeId || ""), node]));

  if (bodyNodes.length === 0) issues.push(issue("empty-publication-figure", "The publication figure has no renderable body nodes."));
  if (edges.length === 0 && bodyNodes.length > 1) issues.push(issue("missing-connectors", "The publication figure has multiple nodes but no connectors."));

  validateDepth(bodyNodes, issues);
  validateLabels(bodyNodes, labelNodes, issues);
  validateConnectorEndpoints(edges, nodeById, issues);
  validateConnectorObstacles(edges, bodyNodes, issues);
  validateEncoderDecoderShape(bodyNodes, issues);

  return {
    version: FIGURE_QA_VERSION,
    ok: issues.filter((item) => item.severity === "error").length === 0,
    issues,
    metrics: {
      bodyNodeCount: bodyNodes.length,
      labelNodeCount: labelNodes.length,
      connectorCount: edges.length,
      minDepth: minimumDepth(bodyNodes),
      maxLabelOverlapCount: labelOverlapCount(bodyNodes, labelNodes),
      connectorObstacleCount: connectorObstacleCount(edges, bodyNodes),
    },
    context: {
      hasCanonicalModel: Boolean(context.canonicalModel),
      qaMode: "structural-publication-gate",
    },
  };
}

export function validateFigureQa(result = {}) {
  const issues = [];
  if (result.version !== FIGURE_QA_VERSION) issues.push(issue("invalid-figure-qa-version", "Figure QA version is missing or invalid."));
  if (!Array.isArray(result.issues)) issues.push(issue("invalid-figure-qa-issues", "Figure QA issues must be an array."));
  return { ok: issues.length === 0, issues };
}

function validateDepth(nodes, issues) {
  const tensorNodes = nodes.filter((node) => ["publication-tensor-box", "publication-right-banded-tensor", "publication-layer-stack"].includes(String(node.shapeKind || "")));
  if (!tensorNodes.length) return;
  for (const node of tensorNodes) {
    const depth = nodeDepth(node);
    if (!(depth > 0)) {
      issues.push(issue("publication-node-without-depth", `Publication node ${node.id} has no visible depth.`, { nodeId: node.id }));
    }
  }
}

function validateLabels(bodyNodes, labelNodes, issues) {
  for (const label of labelNodes) {
    const labelBounds = boundsOf(label);
    if (!labelBounds) {
      issues.push(issue("invalid-label-bounds", `Label ${label.id} has invalid bounds.`, { nodeId: label.id }));
      continue;
    }
    const overlaps = bodyNodes.filter((node) => intersects(labelBounds, boundsOf(node)));
    if (overlaps.length) {
      issues.push(issue("label-overlaps-node", `Label ${label.id} overlaps ${overlaps.map((node) => node.id).join(", ")}.`, {
        nodeId: label.id,
        overlaps: overlaps.map((node) => String(node.id)),
      }));
    }
  }
}

function validateConnectorEndpoints(edges, nodeById, issues) {
  for (const edge of edges) {
    for (const side of ["source", "target"]) {
      const id = String(edge[side] || "");
      if (!id || !nodeById.has(id)) {
        issues.push(issue("connector-missing-endpoint", `Connector ${edge.id} references missing ${side} ${id}.`, { edgeId: edge.id, side, nodeId: id }));
      }
    }
  }
}

function validateConnectorObstacles(edges, bodyNodes, issues) {
  const bodyById = new Map(bodyNodes.map((node) => [String(node.id || node.sourceNodeId || ""), node]));
  for (const edge of edges) {
    const obstacles = obstacleNodesForEdge(edge, bodyById);
    if (obstacles.length) {
      issues.push(issue("connector-passes-through-node", `Connector ${edge.id} passes through ${obstacles.map((node) => node.id).join(", ")}.`, {
        edgeId: edge.id,
        obstacleNodeIds: obstacles.map((node) => String(node.id)),
      }));
    }
  }
}

function validateEncoderDecoderShape(bodyNodes, issues) {
  const poolNodes = bodyNodes.filter((node) => /pool|down/i.test(String(node.label || node.shapeData?.operatorFamily || "")));
  const upNodes = bodyNodes.filter((node) => /up|interpolate|upsample/i.test(String(node.label || node.shapeData?.operatorFamily || "")));
  if (!poolNodes.length || !upNodes.length) return;
  const minPoolY = Math.max(...poolNodes.map((node) => centerY(node)));
  const maxUpY = Math.min(...upNodes.map((node) => centerY(node)));
  if (maxUpY >= minPoolY) {
    issues.push(issue("encoder-decoder-not-u-shaped", "Encoder-decoder topology does not form a U shape: decoder nodes are not above the last downsampling stage."));
  }
}

function obstacleNodesForEdge(edge, bodyById) {
  const points = Array.isArray(edge.points) ? edge.points : [];
  if (points.length < 2) return [];
  const source = String(edge.source || "");
  const target = String(edge.target || "");
  const obstacles = new Map();
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    for (const [id, node] of bodyById) {
      if (id === source || id === target) continue;
      const bounds = boundsOf(node);
      if (!bounds) continue;
      if (segmentIntersectsBounds(from, to, bounds)) obstacles.set(id, node);
    }
  }
  return [...obstacles.values()];
}

function connectorObstacleCount(edges, bodyNodes) {
  const bodyById = new Map(bodyNodes.map((node) => [String(node.id || node.sourceNodeId || ""), node]));
  return edges.reduce((sum, edge) => sum + obstacleNodesForEdge(edge, bodyById).length, 0);
}

function minimumDepth(nodes) {
  const values = nodes.map(nodeDepth).filter(Number.isFinite);
  return values.length ? Math.min(...values) : 0;
}

function labelOverlapCount(bodyNodes, labelNodes) {
  let count = 0;
  for (const label of labelNodes) {
    const labelBounds = boundsOf(label);
    if (!labelBounds) continue;
    count += bodyNodes.filter((node) => intersects(labelBounds, boundsOf(node))).length;
  }
  return count;
}

function nodeDepth(node) {
  const geometry = node.geometryData || {};
  if (Number.isFinite(Number(geometry.depth))) return Number(geometry.depth);
  if (Number.isFinite(Number(geometry.geometry?.depth))) return Number(geometry.geometry.depth);
  if (Array.isArray(geometry.cells)) return Math.max(...geometry.cells.map((cell) => Number(cell.geometry?.depth) || 0));
  return Number(node.depth) || 0;
}

function boundsOf(node) {
  const x = Number(node?.x ?? node?.bounds?.x);
  const y = Number(node?.y ?? node?.bounds?.y);
  const w = Number(node?.w ?? node?.bounds?.w);
  const h = Number(node?.h ?? node?.bounds?.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function centerY(node) {
  const bounds = boundsOf(node);
  return bounds ? bounds.y + bounds.h / 2 : Number.POSITIVE_INFINITY;
}

function intersects(left, right) {
  return Boolean(left && right)
    && left.x < right.x + right.w && left.x + left.w > right.x
    && left.y < right.y + right.h && left.y + left.h > right.y;
}

function segmentIntersectsBounds(from, to, bounds) {
  return pointInBounds(from, bounds) || pointInBounds(to, bounds)
    || segmentIntersectsRect(from, to, bounds);
}

function pointInBounds(point, bounds) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y)
    && x > bounds.x && x < bounds.x + bounds.w
    && y > bounds.y && y < bounds.y + bounds.h;
}

function segmentIntersectsRect(from, to, bounds) {
  const left = bounds.x;
  const right = bounds.x + bounds.w;
  const top = bounds.y;
  const bottom = bounds.y + bounds.h;
  return segmentIntersectsSegment(from, to, { x: left, y: top }, { x: right, y: top })
    || segmentIntersectsSegment(from, to, { x: right, y: top }, { x: right, y: bottom })
    || segmentIntersectsSegment(from, to, { x: right, y: bottom }, { x: left, y: bottom })
    || segmentIntersectsSegment(from, to, { x: left, y: bottom }, { x: left, y: top });
}

function segmentIntersectsSegment(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function orientation(a, b, c) {
  const value = (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(b.x))
    - (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(b.y));
  return value === 0 ? 0 : value > 0 ? 1 : 2;
}

function issue(code, message, extra = {}) {
  return { code, severity: "error", message, ...extra };
}
