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
      ...(node.recurrentLayout ? { recurrentLayout: cloneValue(node.recurrentLayout) } : {}),
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
    ...(layout.recurrentLayouts ? { recurrentLayouts: cloneValue(layout.recurrentLayouts) } : {}),
  };
}

export function validateFigurePlan(plan = {}) {
  const issues = [];
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
  if (nodes.length === 0) issues.push({ code: "empty-figure-plan", message: "Figure Plan must contain at least one node." });
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

export function figurePlanForVisio(plan = {}, options = {}) {
  return projectFigurePlan(plan, {
    renderer: "visio",
    documentPath: String(options.documentPath || ""),
    pageName: String(options.pageName || "Page-1"),
    renderId: String(options.renderId || ""),
  });
}

function projectFigurePlan(plan, projection) {
  const recurrentLayouts = plan.recurrentLayouts || (plan.recurrentLayout
    ? { [String(plan.recurrentLayout.instances?.[0]?.sourceNodeId || "")]: plan.recurrentLayout }
    : {});
  return {
    ...cloneValue(plan),
    projection,
    nodes: (plan.nodes || []).map((node) => {
      const projected = cloneValue(node);
      const recurrentLayout = recurrentLayouts[String(projected.sourceNodeId || "")];
      if (recurrentLayout) {
        projected.recurrentLayout = cloneValue(recurrentLayout);
      }
      return projected;
    }),
    edges: (plan.edges || []).map((edge) => cloneValue(edge)),
  };
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
