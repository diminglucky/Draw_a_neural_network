const VISIO_DIAGRAM_PLAN_VERSION = "visio-diagram-plan/v1";

export function createVisioDiagramPlan({ ir = {}, scene, geometry, layout, diagnostics = [] } = {}) {
  const sourceLayout = scene?.version === "laid-out-neural-scene/v1"
    ? sceneCompatibilityLayout(ir, scene)
    : hasLayoutContent(geometry)
      ? geometry
      : (layout || {});
  const layoutNodes = Array.isArray(sourceLayout.nodes) ? sourceLayout.nodes : [];
  const layoutEdges = Array.isArray(sourceLayout.edges) ? sourceLayout.edges : [];
  const recurrentLayout = sourceLayout.recurrentLayout;
  const recurrentUnresolvedSourceIds = new Set(
    recurrentLayout?.uncertainty?.unresolved
      ? (recurrentLayout.instances || []).map((instance) => String(instance.sourceNodeId || "")).filter(Boolean)
      : [],
  );
  const sourceNodes = new Map();
  (Array.isArray(ir.nodes) ? ir.nodes : []).forEach((node) => {
    sourceNodes.set(String(node.id || ""), node);
    if (node.sourceNodeId) sourceNodes.set(String(node.sourceNodeId), node);
    (node.sourceNodeIds || []).forEach((sourceNodeId) => sourceNodes.set(String(sourceNodeId), node));
  });

  const nodes = layoutNodes.map((node, index) => {
    const layoutIdentity = sourceIdentity(node.sourceNodeId || node.id || `figure-node-${index + 1}`);
    const source = sourceNodes.get(layoutIdentity);
    const sourceNodeId = sourceIdentity(node.sourceNodeId || source?.sourceNodeId || layoutIdentity);
    const unresolved = node.inner?.kind === "unresolved"
      || node.compoundKind === "unresolved"
      || node.visualRole === "unresolved-module"
      || recurrentUnresolvedSourceIds.has(String(node.sourceNodeId || node.id || ""));
    const recurrentShellUnresolved = recurrentUnresolvedSourceIds.has(String(node.sourceNodeId || node.id || ""))
      && String(node.visualRole || "") === "recurrent-state";
    const visualRole = recurrentShellUnresolved
      ? "recurrent-state"
      : unresolved ? "unresolved-module" : String(node.visualRole || "operator");
    return {
      id: String(node.id || sourceNodeId),
      sourceNodeId,
      sourceNodeIds: Array.isArray(node.sourceNodeIds)
        ? node.sourceNodeIds.map(String)
        : Array.isArray(source?.sourceNodeIds) ? source.sourceNodeIds.map(String)
          : Array.isArray(node.attributes?.groupedFrom) ? node.attributes.groupedFrom.map(String) : [sourceNodeId],
      label: String(node.figureLabel || node.label || node.op || "Operator"),
      subtitle: String(node.figureSubtitle || node.subtitle || ""),
      family: String(node.family || source?.family || "custom"),
      op: String(node.op || source?.op || node.label || "UnknownOperator"),
      compoundKind: recurrentShellUnresolved
        ? (node.compoundKind || source?.compoundKind || "operator")
        : unresolved ? "unresolved" : (node.compoundKind || source?.compoundKind),
      stage: finiteOr(node.stage, finiteOr(source?.stage, index)),
      order: finiteOr(node.order, finiteOr(source?.order, index)),
      ports: clonePorts(node.ports || source?.ports),
      semanticRole: String(node.semanticRole || source?.semanticRole || "feature_transform"),
      visualRole,
      inputGrammar: cloneValue(node.inputGrammar),
      styleProfile: String(node.styleProfile || "operator"),
      labelSlots: cloneValue(node.labelSlots || {}),
      shapeKind: String(node.representation || node.shapeKind || node.family || "operator"),
      geometryData: cloneValue(node.geometryData || {}),
      shape: cloneValue(node.shape || source?.shape),
      color: String(node.color || source?.color || ""),
      repeatCount: finiteOr(node.repeatCount, finiteOr(source?.repeatCount, 1)),
      containerId: String(node.containerId || source?.containerId || ""),
      laneId: String(node.laneId || source?.laneId || ""),
      containerPath: Array.isArray(node.containerPath) ? node.containerPath.map(String) : [],
      scopedLaneId: String(node.scopedLaneId || ""),
      geometry: geometryFor(node),
      x: finiteOr(node.x, 0),
      y: finiteOr(node.y, 0),
      w: finiteOr(node.w, 0),
      h: finiteOr(node.h, 0),
      confidence: finiteOr(node.confidence, finiteOr(source?.confidence, 1)),
      unresolved,
      ...(unresolved ? {
        unresolvedMarker: {
          kind: "unresolved-module",
          reason: String(node.note || recurrentLayout?.uncertainty?.reason || "Internal topology requires evidence or runtime tracing."),
        },
      } : {}),
      inner: cloneValue(node.inner),
      ...(node.recurrentLayout ? { recurrentLayout: cloneValue(node.recurrentLayout) } : {}),
      evidence: cloneValue(node.evidence || source?.evidence || []),
    };
  });

  const nodeByLayoutId = new Map(layoutNodes.map((node, index) => [String(node.id || `figure-node-${index + 1}`), node]));
  const edges = layoutEdges.map((edge, index) => {
    const sourceLayoutNode = nodeByLayoutId.get(String(edge.source || ""));
    const targetLayoutNode = nodeByLayoutId.get(String(edge.target || ""));
    const sourceContainerId = String(edge.sourceContainerId || sourceLayoutNode?.containerId || "");
    const targetContainerId = String(edge.targetContainerId || targetLayoutNode?.containerId || "");
    const sourceLaneId = String(edge.sourceLaneId || sourceLayoutNode?.laneId || "");
    const targetLaneId = String(edge.targetLaneId || targetLayoutNode?.laneId || "");
    return {
      id: String(edge.id || `figure-edge-${index + 1}`),
      sourceEdgeId: sourceIdentity(edge.sourceEdgeId || edge.id || `figure-edge-${index + 1}`),
      source: sourceIdentity(sourceLayoutNode?.sourceNodeId || edge.source || ""),
      target: sourceIdentity(targetLayoutNode?.sourceNodeId || edge.target || ""),
      sourceNodeId: sourceIdentity(sourceLayoutNode?.sourceNodeId || edge.source || ""),
      targetNodeId: sourceIdentity(targetLayoutNode?.sourceNodeId || edge.target || ""),
      sourceEndpointIds: cloneValue(edge.sourceEndpointIds || edge.ports || {}),
      ports: cloneValue(edge.ports || {}),
      routeClass: String(edge.routeClass || "main-flow"),
      sourceContainerId,
      targetContainerId,
      sourceLaneId,
      targetLaneId,
      type: String(edge.type || "signal"),
      label: String(edge.label || ""),
      route: cloneValue(edge.route || { kind: "unrouted", points: [] }),
      evidence: cloneValue(edge.evidence || []),
    };
  });

  return {
    version: VISIO_DIAGRAM_PLAN_VERSION,
    ...(scene ? { scene: cloneValue(scene) } : {}),
    grammar: cloneValue(sourceLayout.grammar || ir.grammar || { id: "generic-dag" }),
    figure: cloneValue(sourceLayout.figure || ir.figure || {}),
    artboard: cloneValue(sourceLayout.artboard || {}),
    nodes,
    edges,
    groups: cloneValue(sourceLayout.groups || ir.groups || []),
    architectureLayout: cloneValue(sourceLayout.architectureLayout || ir.architectureLayout || {}),
    diagnostics: cloneValue(diagnostics),
    ...(recurrentLayout ? { recurrentLayout: cloneValue(recurrentLayout) } : {}),
    ...(sourceLayout.recurrentLayouts ? { recurrentLayouts: cloneValue(sourceLayout.recurrentLayouts) } : {}),
  };
}

export function validateVisioDiagramPlan(plan = {}) {
  const base = validateVisioDiagramPlanBase(plan);
  const issues = [...base.issues];
  if (plan.version !== VISIO_DIAGRAM_PLAN_VERSION) {
    issues.unshift({ code: "invalid-visio-diagram-plan-version", value: plan.version });
  }
  if (Object.prototype.hasOwnProperty.call(plan, "projection")) {
    issues.push({ code: "renderer-projection-not-allowed" });
  }
  if (plan.scene) validateEmbeddedScene(plan, issues);
  return {
    ok: issues.length === 0,
    issues,
    summary: { ...base.summary, issueCount: issues.length },
  };
}

function validateEmbeddedScene(plan, issues) {
  const scene = plan.scene;
  if (scene.version !== "laid-out-neural-scene/v1") {
    issues.push({ code: "invalid-laid-out-scene-version", value: scene.version });
  }
  if (scene.units !== "layout-unit") issues.push({ code: "invalid-scene-units", value: scene.units });

  const primitives = Array.isArray(scene.primitives) ? scene.primitives : [];
  const connectors = Array.isArray(scene.connectors) ? scene.connectors : [];
  const primitiveIds = new Set();
  const coveredNodeIds = new Set();
  const coveredEdgeIds = new Set();
  for (const primitive of primitives) {
    const primitiveId = String(primitive?.id || "");
    if (primitiveId) primitiveIds.add(primitiveId);
    for (const nodeId of primitive?.sourceNodeIds || []) coveredNodeIds.add(String(nodeId));
    for (const edgeId of primitive?.sourceEdgeIds || []) coveredEdgeIds.add(String(edgeId));
    if (primitive?.role !== "body") continue;
    if (!validSceneBounds(primitive.bounds)) issues.push({ code: "missing-scene-body-bounds", primitiveId });
    if (!validSceneAnchors(primitive.anchors)) issues.push({ code: "missing-scene-body-anchors", primitiveId });
  }

  for (const connector of connectors) {
    for (const edgeId of connector?.sourceEdgeIds || []) coveredEdgeIds.add(String(edgeId));
    const sourceId = String(connector?.sourcePrimitiveId || "");
    const targetId = String(connector?.targetPrimitiveId || "");
    if (!primitiveIds.has(sourceId) || !primitiveIds.has(targetId)
      || !Array.isArray(connector?.points) || connector.points.length < 2) {
      issues.push({ code: "unresolved-scene-topology", connectorId: String(connector?.id || "") });
    }
  }

  const requiredNodeIds = new Set();
  for (const node of plan.nodes || []) {
    for (const nodeId of node.sourceNodeIds || [node.sourceNodeId]) if (nodeId) requiredNodeIds.add(String(nodeId));
  }
  for (const nodeId of requiredNodeIds) {
    if (!coveredNodeIds.has(nodeId)) issues.push({ code: "missing-scene-source-node", nodeId });
  }
  for (const edge of plan.edges || []) {
    const edgeId = String(edge.sourceEdgeId || "");
    if (edgeId && !coveredEdgeIds.has(edgeId)) issues.push({ code: "missing-scene-source-edge", edgeId });
  }
}

export function assertVisioDiagramPlan(plan = {}) {
  const validation = validateVisioDiagramPlan(plan);
  if (!validation.ok) {
    const codes = validation.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid Visio Diagram Plan: ${codes}`);
  }
  return plan;
}

function validateVisioDiagramPlanBase(plan = {}) {
  const issues = [];
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
  if (nodes.length === 0) issues.push({ code: "empty-visio-diagram-plan", message: "Visio Diagram Plan must contain at least one node." });
  const checkUnique = (items, property, duplicateCode, missingCode) => {
    const seen = new Set();
    for (const [index, item] of items.entries()) {
      const value = String(item?.[property] || "");
      if (!value) {
        issues.push({ code: missingCode, index, property });
      } else if (seen.has(value)) {
        issues.push({ code: duplicateCode, value, index, property });
      } else {
        seen.add(value);
      }
    }
    return seen;
  };

  const nodeIds = checkUnique(nodes, "id", "duplicate-node-id", "missing-node-id");
  checkUnique(nodes, "sourceNodeId", "duplicate-source-node-id", "missing-source-node-id");
  checkUnique(edges, "id", "duplicate-edge-id", "missing-edge-id");
  checkUnique(edges, "sourceEdgeId", "duplicate-source-edge-id", "missing-source-edge-id");

  for (const [index, edge] of edges.entries()) {
    const source = String(edge?.sourceNodeId || edge?.source || "");
    const target = String(edge?.targetNodeId || edge?.target || "");
    if (!source) issues.push({ code: "missing-edge-source", index });
    else if (!nodeIds.has(source) && !nodes.some((node) => String(node.sourceNodeId || "") === source)) {
      issues.push({ code: "missing-edge-source", index, value: source });
    }
    if (!target) issues.push({ code: "missing-edge-target", index });
    else if (!nodeIds.has(target) && !nodes.some((node) => String(node.sourceNodeId || "") === target)) {
      issues.push({ code: "missing-edge-target", index, value: target });
    }
    if (!String(edge?.sourceEdgeId || "")) issues.push({ code: "missing-edge-source-identity", index });
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      issueCount: issues.length,
      unresolvedNodeCount: nodes.filter((node) => node.unresolved).length,
    },
  };
}

function hasLayoutContent(value) {
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

function sceneCompatibilityLayout(ir, scene) {
  const bodies = (scene.primitives || []).filter((primitive) => primitive.role === "body");
  const bodyBySourceNode = new Map();
  for (const body of bodies) {
    for (const sourceNodeId of body.sourceNodeIds || []) bodyBySourceNode.set(String(sourceNodeId), body);
  }
  const connectorBySourceEdge = new Map();
  for (const connector of scene.connectors || []) {
    for (const sourceEdgeId of connector.sourceEdgeIds || []) connectorBySourceEdge.set(String(sourceEdgeId), connector);
  }

  const nodes = (ir.nodes || []).map((node, index) => {
    const body = bodyBySourceNode.get(String(node.id));
    const bounds = body?.bounds || {};
    return {
      ...cloneValue(node),
      id: String(node.id || `scene-node-${index + 1}`),
      sourceNodeId: String(node.id || `scene-node-${index + 1}`),
      sourceNodeIds: [String(node.id || `scene-node-${index + 1}`)],
      figureLabel: String(body?.labels?.[0]?.text || node.label || node.op || "Operator"),
      visualRole: sceneCompatibilityVisualRole(node, body),
      representation: String(body?.form || node.shapeKind || node.family || "operator"),
      styleProfile: String(body?.category || node.styleProfile || "operator"),
      x: finiteOr(bounds.x, 0),
      y: finiteOr(bounds.y, 0),
      w: finiteOr(bounds.w, 0),
      h: finiteOr(bounds.h, 0),
    };
  });

  const edges = (ir.edges || []).map((edge, index) => {
    const connector = connectorBySourceEdge.get(String(edge.id));
    return {
      ...cloneValue(edge),
      id: String(edge.id || `scene-edge-${index + 1}`),
      sourceEdgeId: String(edge.id || `scene-edge-${index + 1}`),
      routeClass: String(connector?.routeClass || edge.routeClass || "main-flow"),
      route: { kind: "polyline", points: cloneValue(connector?.points || []) },
    };
  });

  return {
    figure: cloneValue(ir.figure || {}),
    artboard: cloneValue(scene.page || {}),
    nodes,
    edges,
    groups: cloneValue(scene.groups || []),
    architectureLayout: cloneValue(ir.architectureLayout || {}),
  };
}

function sceneCompatibilityVisualRole(node, body) {
  if (node.visualRole) return String(node.visualRole);
  const tags = new Set(body?.semanticTags || []);
  if (node.family === "recurrent" || tags.has("stateful")) return "recurrent-state";
  if (node.family === "input") return "input";
  if (node.family === "output") return "output";
  return String(body?.category || "operator");
}

function validSceneBounds(bounds) {
  return bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0;
}

function validSceneAnchors(anchors) {
  return anchors && Array.isArray(anchors.inputs) && Array.isArray(anchors.outputs);
}

function geometryFor(node) {
  return {
    x: finiteOr(node.x, 0),
    y: finiteOr(node.y, 0),
    width: finiteOr(node.w, 0),
    height: finiteOr(node.h, 0),
    ...(node.geometryData ? { data: cloneValue(node.geometryData) } : {}),
  };
}

function clonePorts(ports = {}) {
  return {
    inputs: Array.isArray(ports?.inputs) ? ports.inputs.map(String) : [],
    outputs: Array.isArray(ports?.outputs) ? ports.outputs.map(String) : [],
  };
}

function sourceIdentity(value) {
  return String(value || "");
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
