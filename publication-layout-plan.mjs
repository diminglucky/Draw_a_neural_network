export const PUBLICATION_LAYOUT_PLAN_VERSION = "publication-layout-plan/v1";

export function createPublicationLayoutPlan({ canonicalModel = {}, facts = {}, motifs = {}, styleCompilation = null } = {}) {
  const nodes = canonicalModel.nodes || [];
  const edges = canonicalModel.edges || [];
  const styleConstraints = Array.isArray(styleCompilation?.constraints) ? styleCompilation.constraints.map((constraint) => ({ ...constraint })) : [];
  const constraints = [
    ...(styleConstraints.some((constraint) => constraint.kind === "align-scale-centerlines") ? [] : [{
      id: "constraint:global:align-scale-centerlines",
      kind: "align-scale-centerlines",
      priority: 100,
      evidenceIds: [],
    }]),
    ...styleConstraints,
  ];
  for (const group of canonicalModel.moduleTree || []) {
    constraints.push({
      id: `constraint:${group.id}:preserve-group`,
      kind: "preserve-group",
      groupId: group.id,
      nodeIds: [...group.nodeIds],
      priority: 80,
    });
  }
  for (const edge of edges) {
    if (!/state|loop|feedback|residual|skip|bypass|condition|control|route|gate/i.test(String(edge.type || ""))) continue;
    constraints.push({
      id: `constraint:${edge.id}:route-corridor`,
      kind: "reserve-route-corridor",
      edgeId: String(edge.id),
      routeClass: /state|loop|feedback/i.test(String(edge.type || ""))
        ? "state"
        : /condition|control|route|gate/i.test(String(edge.type || ""))
          ? "conditional"
          : "bypass",
      priority: 70,
    });
  }
  if (detectEncoderDecoder(nodes, edges)) {
    constraints.push({
      id: "constraint:global:encoder-decoder-u",
      kind: "layout-archetype",
      archetype: "encoder-decoder-u",
      priority: 120,
    });
  }
  return {
    version: PUBLICATION_LAYOUT_PLAN_VERSION,
    direction: "left-to-right",
    constraints,
    styleTokens: {
      bodyStroke: "semantic-line",
      labelPlacement: "outside-below",
      connectorRouting: "orthogonal-corridor",
      ...(styleCompilation?.styleTokens || {}),
    },
    diagnostics: [],
    summary: {
      constraintCount: constraints.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      motifCount: Array.isArray(motifs.motifs) ? motifs.motifs.length : 0,
      regionCount: facts.regionFacts ? Object.keys(facts.regionFacts).length : 0,
    },
  };
}

function detectEncoderDecoder(nodes, edges) {
  const hasDown = nodes.some((node) => node.family === "pool" || /pool|downsample/i.test(String(node.op || "")));
  const hasUp = nodes.some((node) => node.family === "upsample" || /upsample|interpolate/i.test(String(node.op || "")));
  if (!hasDown || !hasUp) return false;
  const nodeIds = new Set(nodes.map((node) => String(node.canonicalId || node.id)));
  const hasSkip = edges.some((edge) => {
    const type = String(edge.type || "");
    return /skip|residual|bypass/i.test(type)
      && nodeIds.has(String(edge.canonicalSource || edge.source))
      && nodeIds.has(String(edge.canonicalTarget || edge.target));
  });
  return hasSkip;
}

export function validatePublicationLayoutPlan(plan = {}, canonicalModel = {}) {
  const issues = [];
  if (plan.version !== PUBLICATION_LAYOUT_PLAN_VERSION) issues.push({ code: "invalid-publication-layout-plan-version", value: plan.version });
  if (plan.direction !== "left-to-right") issues.push({ code: "invalid-publication-layout-direction", value: plan.direction });
  const nodeIds = new Set((canonicalModel.nodes || []).map((node) => String(node.canonicalId || node.id)));
  const edgeIds = new Set((canonicalModel.edges || []).map((edge) => String(edge.id)));
  for (const constraint of plan.constraints || []) {
    if (!constraint?.id || !constraint?.kind) issues.push({ code: "invalid-publication-layout-constraint", constraintId: constraint?.id });
    for (const nodeId of constraint.nodeIds || []) {
      if (!nodeIds.has(String(nodeId))) issues.push({ code: "layout-constraint-missing-node", constraintId: constraint.id, nodeId });
    }
    if (constraint.edgeId && !edgeIds.has(String(constraint.edgeId))) {
      issues.push({ code: "layout-constraint-missing-edge", constraintId: constraint.id, edgeId: constraint.edgeId });
    }
  }
  return { ok: issues.length === 0, issues, summary: { constraintCount: plan.constraints?.length || 0 } };
}
