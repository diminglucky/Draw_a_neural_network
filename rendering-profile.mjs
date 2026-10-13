import { detectArchitectureFamily } from "./architecture-family.mjs";

export const RENDERING_PROFILE_VERSION = "neural-rendering-profile/v1";

export function createRenderingProfile({ canonicalModel = {}, facts = {}, motifs = {}, blocks = {} } = {}) {
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

  // 架构家族识别：判出"这是一张什么网络"，再按家族选布局原型。
  // 旧实现只有一条 encoder-decoder 判定，其余网络一律通用顺序流，
  // 于是 YOLO 和 ViT 画出来是同一种东西。
  const family = detectArchitectureFamily({ canonicalModel, blocks });
  if (family.archetype && family.archetype !== "sequential-flow") {
    constraints.push({
      id: `constraint:global:${family.archetype}`,
      kind: "layout-archetype",
      archetype: family.archetype,
      priority: 120,
    });
  }

  return {
    version: RENDERING_PROFILE_VERSION,
    direction: "left-to-right",
    constraints,
    // 家族信息进 profile，供下游（布局 / 渲染 / UI）按家族取画法约定。
    architectureFamily: {
      family: family.family,
      label: family.label,
      archetype: family.archetype,
      canonical: family.canonical,
      confidence: family.confidence,
      evidence: family.evidence,
    },
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
      architectureFamily: family.family,
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

function routeClassForEdge(edge = {}) {
  const type = String(edge.type || "");
  if (/state|loop|feedback/i.test(type)) return "state";
  if (/condition|control|route|gate/i.test(type)) return "conditional";
  if (/residual|skip|bypass/i.test(type)) return "bypass";
  return "main-flow";
}
