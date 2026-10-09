export const RENDERING_PROFILE_VERSION = "neural-rendering-profile/v1";

export function createRenderingProfile({ canonicalModel = {}, facts = {}, motifs = {} } = {}) {
  const nodes = canonicalModel.nodes || [];
  const edges = canonicalModel.edges || [];
  const constraints = [
    {
      id: "constraint:global:align-scale-centerlines",
      kind: "align-scale-centerlines",
      priority: 100,
      evidenceIds: [],
    },
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
      routeClass: routeClassForEdge(edge),
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
    version: RENDERING_PROFILE_VERSION,
    direction: "left-to-right",
    constraints,
    styleTokens: {
      bodyStroke: "semantic-line",
      labelPlacement: "outside-below",
      connectorRouting: "orthogonal-corridor",
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

export function validateRenderingProfile(profile = {}, canonicalModel = {}) {
  const issues = [];
  if (profile.version !== RENDERING_PROFILE_VERSION) {
    issues.push({ code: "invalid-rendering-profile-version", value: profile.version });
  }
  if (profile.direction !== "left-to-right") {
    issues.push({ code: "invalid-rendering-profile-direction", value: profile.direction });
  }

  const nodeIds = new Set((canonicalModel.nodes || []).map((node) => String(node.canonicalId || node.id)));
  const edgeIds = new Set((canonicalModel.edges || []).map((edge) => String(edge.id)));
  for (const constraint of profile.constraints || []) {
    if (!constraint?.id || !constraint?.kind) {
      issues.push({ code: "invalid-rendering-profile-constraint", constraintId: constraint?.id });
    }
    for (const nodeId of constraint.nodeIds || []) {
      if (!nodeIds.has(String(nodeId))) {
        issues.push({ code: "rendering-profile-missing-node", constraintId: constraint.id, nodeId });
      }
    }
    if (constraint.edgeId && !edgeIds.has(String(constraint.edgeId))) {
      issues.push({ code: "rendering-profile-missing-edge", constraintId: constraint.id, edgeId: constraint.edgeId });
    }
  }

  return { ok: issues.length === 0, issues, summary: { constraintCount: profile.constraints?.length || 0 } };
}

function detectEncoderDecoder(nodes, edges) {
  const hasDown = nodes.some((node) => node.family === "pool" || /pool|downsample/i.test(String(node.op || "")));
  const hasUp = nodes.some((node) => node.family === "upsample" || /upsample|interpolate/i.test(String(node.op || "")));
  if (!hasDown || !hasUp) return false;

  const nodeIds = new Set(nodes.map((node) => String(node.canonicalId || node.id)));
  return edges.some((edge) => {
    const type = String(edge.type || "");
    return /skip|residual|bypass/i.test(type)
      && nodeIds.has(String(edge.canonicalSource || edge.source))
      && nodeIds.has(String(edge.canonicalTarget || edge.target));
  });
}

function routeClassForEdge(edge = {}) {
  const type = String(edge.type || "");
  if (/state|loop|feedback/i.test(type)) return "state";
  if (/condition|control|route|gate/i.test(type)) return "conditional";
  if (/residual|skip|bypass/i.test(type)) return "bypass";
  return "main-flow";
}
