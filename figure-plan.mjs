const FIGURE_PLAN_VERSION = "figure-plan/v1";

export function createFigurePlan({ ir = {}, layout = {}, diagnostics = [] } = {}) {
  const layoutNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
  const layoutEdges = Array.isArray(layout.edges) ? layout.edges : [];
  const recurrentLayout = layout.recurrentLayout;
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
      evidence: cloneValue(node.evidence || source?.evidence || []),
    };
  });

  const nodeByLayoutId = new Map(layoutNodes.map((node, index) => [String(node.id || `figure-node-${index + 1}`), node]));
  const edges = layoutEdges.map((edge, index) => {
    const sourceLayoutNode = nodeByLayoutId.get(String(edge.source || ""));
    const targetLayoutNode = nodeByLayoutId.get(String(edge.target || ""));
    return {
      id: String(edge.id || `figure-edge-${index + 1}`),
      sourceEdgeId: sourceIdentity(edge.sourceEdgeId || edge.id || `figure-edge-${index + 1}`),
      source: sourceIdentity(sourceLayoutNode?.sourceNodeId || edge.source || ""),
      target: sourceIdentity(targetLayoutNode?.sourceNodeId || edge.target || ""),
      sourceNodeId: sourceIdentity(sourceLayoutNode?.sourceNodeId || edge.source || ""),
      targetNodeId: sourceIdentity(targetLayoutNode?.sourceNodeId || edge.target || ""),
      sourceEndpointIds: cloneValue(edge.sourceEndpointIds || {}),
      ports: cloneValue(edge.ports || {}),
      type: String(edge.type || "signal"),
      label: String(edge.label || ""),
      route: cloneValue(edge.route || { kind: "unrouted", points: [] }),
      evidence: cloneValue(edge.evidence || []),
    };
  });

  return {
    version: FIGURE_PLAN_VERSION,
    grammar: cloneValue(layout.grammar || ir.grammar || { id: "generic-dag" }),
    figure: cloneValue(layout.figure || ir.figure || {}),
    artboard: cloneValue(layout.artboard || {}),
    nodes,
    edges,
    diagnostics: cloneValue(diagnostics),
    ...(recurrentLayout ? { recurrentLayout: cloneValue(recurrentLayout) } : {}),
  };
}

export function validateFigurePlan(plan = {}) {
  const issues = [];
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
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

export function figurePlanForBrowser(plan = {}) {
  return projectFigurePlan(plan, { renderer: "browser" });
}

export function figurePlanForCanvas(plan = {}) {
  const projected = projectFigurePlan(plan, { renderer: "canvas" });
  const nodes = projected.nodes.map((node) => ({
    ...node,
    type: canvasTypeForRole(node.visualRole, node.family),
    compoundKind: node.compoundKind || (node.visualRole === "recurrent-state" ? "operator" : undefined),
    w: node.w || 160,
    h: node.h || 110,
  }));
  const sourceToLayout = new Map();
  nodes.forEach((node) => {
    sourceToLayout.set(node.sourceNodeId, node.id);
    (node.sourceNodeIds || []).forEach((sourceId) => sourceToLayout.set(String(sourceId), node.id));
  });
  return {
    ...projected,
    nodes,
    edges: projected.edges.map((edge) => ({
      ...edge,
      source: sourceToLayout.get(edge.sourceNodeId) || edge.source,
      target: sourceToLayout.get(edge.targetNodeId) || edge.target,
    })),
  };
}

export function mergeCanvasStateIntoFigurePlan(plan = {}, { figure = {}, nodes = [], edges = [] } = {}) {
  const currentNodes = Array.isArray(nodes) ? nodes : [];
  const currentEdges = Array.isArray(edges) ? edges : [];
  const planNodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const planEdges = Array.isArray(plan.edges) ? plan.edges : [];
  const planById = new Map(planNodes.map((node) => [String(node.id || ""), node]));
  const planBySourceId = new Map(planNodes.map((node) => [String(node.sourceNodeId || ""), node]));
  const currentById = new Map(currentNodes.map((node) => [String(node.id || ""), node]));
  const nextNodes = currentNodes
    .filter((node) => node && node.id)
    .map((current) => {
      const id = String(current.id);
      const previous = planById.get(id) || planBySourceId.get(String(current.sourceNodeId || ""));
      const sourceNodeId = String(previous?.sourceNodeId || current.sourceNodeId || id);
      return {
        ...(previous ? cloneValue(previous) : {}),
        ...cloneValue(current),
        id,
        sourceNodeId,
        sourceNodeIds: Array.isArray(previous?.sourceNodeIds)
          ? previous.sourceNodeIds.map(String)
          : Array.isArray(current.sourceNodeIds) ? current.sourceNodeIds.map(String) : [sourceNodeId],
        x: finiteOr(current.x, previous?.x ?? 0),
        y: finiteOr(current.y, previous?.y ?? 0),
        w: finiteOr(current.w, previous?.w ?? 160),
        h: finiteOr(current.h, previous?.h ?? 110),
        label: String(current.label || previous?.label || "Operator"),
        subtitle: String(current.subtitle || previous?.subtitle || ""),
        color: String(current.color || previous?.color || ""),
      };
    });
  const nextById = new Map(nextNodes.map((node) => [String(node.id || ""), node]));
  const previousEdges = new Map();
  planEdges.forEach((edge) => {
    previousEdges.set(String(edge.id || ""), edge);
    previousEdges.set(String(edge.sourceEdgeId || ""), edge);
  });
  const nextEdges = currentEdges
    .filter((edge) => edge && edge.source && edge.target && nextById.has(String(edge.source)) && nextById.has(String(edge.target)))
    .map((current, index) => {
      const previous = previousEdges.get(String(current.id || ""))
        || previousEdges.get(String(current.sourceEdgeId || ""));
      const source = nextById.get(String(current.source));
      const target = nextById.get(String(current.target));
      const edgeId = String(current.id || previous?.id || `figure-edge-${index + 1}`);
      return {
        ...(previous ? cloneValue(previous) : {}),
        ...cloneValue(current),
        id: edgeId,
        sourceEdgeId: String(previous?.sourceEdgeId || current.sourceEdgeId || edgeId),
        source: String(source.id),
        target: String(target.id),
        sourceNodeId: String(source.sourceNodeId || source.id),
        targetNodeId: String(target.sourceNodeId || target.id),
        sourceEndpointIds: cloneValue(current.sourceEndpointIds || previous?.sourceEndpointIds || {}),
        ports: cloneValue(current.ports || previous?.ports || {}),
        type: String(current.type || previous?.type || "signal"),
        label: String(current.label || previous?.label || ""),
        route: routeForCurrentEdge({
          ...(previous ? cloneValue(previous) : {}),
          ...cloneValue(current),
          type: String(current.type || previous?.type || "signal"),
        }, source, target),
      };
    });
  return {
    ...cloneValue(plan),
    figure: Object.keys(figure || {}).length ? cloneValue(figure) : cloneValue(plan.figure || {}),
    nodes: nextNodes,
    edges: nextEdges,
  };
}

export function figurePlanForVisio(plan = {}, options = {}) {
  return projectFigurePlan(plan, {
    renderer: "visio",
    documentPath: String(options.documentPath || ""),
    pageName: String(options.pageName || "Page-1"),
    renderId: String(options.renderId || ""),
  });
}

function projectFigurePlan(plan, projection) {
  return {
    ...cloneValue(plan),
    projection,
    nodes: (plan.nodes || []).map((node) => cloneValue(node)),
    edges: (plan.edges || []).map((edge) => cloneValue(edge)),
  };
}

function canvasTypeForRole(role, family) {
  const byRole = {
    "image-input": "image-input",
    "sequence-input": "sequence-input",
    "state-input": "state-input",
    "vector-input": "vector-input",
    "volume-input": "volume-input",
    "unknown-input": "unknown-input",
    "feature-map-stage": "conv",
    "pool-downsample": "pool",
    vectorize: "flatten",
    "neuron-layer": "dense-layer",
    "output-distribution": "output",
    "merge-symbol": "concat",
    "compound-module": "compound",
    "unresolved-module": "compound",
    "recurrent-state": "compound",
    "token-sequence": "token",
    "attention": "compound",
    "skip-connection": "block",
  };
  return byRole[role] || (family === "volume" ? "volume-stack" : "compound");
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

function routeForCurrentEdge(edge, source, target) {
  if (!source || !target) return cloneValue(edge.route || { kind: "unrouted", points: [] });
  const from = { x: finiteOr(source.x, 0) + finiteOr(source.w, 0), y: finiteOr(source.y, 0) + finiteOr(source.h, 0) / 2 };
  const to = { x: finiteOr(target.x, 0), y: finiteOr(target.y, 0) + finiteOr(target.h, 0) / 2 };
  const kind = String(edge.type || edge.route?.kind || "signal").toLowerCase();
  if (source.id === target.id || kind === "loop") {
    const laneX = from.x + 34;
    const laneY = Math.min(source.y, target.y) - 28;
    return { kind: "loop", points: [from, { x: laneX, y: from.y }, { x: laneX, y: laneY }, { x: source.x + source.w / 2, y: laneY }, to] };
  }
  if (/skip|residual|shortcut|control|alternative/.test(kind)) {
    const laneY = Math.min(source.y, target.y) - 24;
    return { kind: "skip-lane", points: [from, { x: from.x + 20, y: laneY }, { x: to.x - 20, y: laneY }, to] };
  }
  return { kind: Math.abs(from.y - to.y) <= 12 ? "straight" : "orthogonal", points: [from, to] };
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
