import { applyNeuralVisualRules, createDefaultNeuralVisualRules } from "./neural-visual-rules.mjs";
import { NEURAL_MOTIFS_VERSION, deriveNeuralMotifs, validateNeuralMotifs } from "./neural-motifs.mjs";
import {
  blockBadgeForKind,
  deriveNeuralBlocks,
  layoutHintForBlockKind,
  normalizeNeuralBlocks,
} from "./neural-block-ir.mjs";

export const SEMANTIC_NEURAL_SCENE_VERSION = "semantic-neural-scene/v1";
const VERSION = SEMANTIC_NEURAL_SCENE_VERSION;

export function compileSemanticScene(ir = {}, facts = {}, projectionMap = {}, intent = {}, options = {}) {
  const nodeById = new Map((ir.nodes || []).map((node) => [node.id, node]));
  const motifs = deriveNeuralMotifs(ir, facts);
  const blockIr = options.blocks ? normalizeNeuralBlocks(options.blocks, ir) : deriveNeuralBlocks(ir, facts);
  const motifValidation = validateNeuralMotifs(motifs, ir);
  if (!motifValidation.ok) {
    throw new TypeError(`Invalid Neural Motifs: ${motifValidation.issues.map((issue) => issue.code).join(", ")}`);
  }
  const primitives = [];
  const projectionToBody = {};
  const rules = options.rules || createDefaultNeuralVisualRules();
  for (const projection of projectionMap.projections || []) {
    const nodes = projection.orderedNodeIds.map((id) => nodeById.get(id)).filter(Boolean);
    const nodeFacts = projection.orderedNodeIds.map((id) => facts.nodeFacts?.[id]).filter(Boolean);
    const emitted = applyNeuralVisualRules({ projection, nodes, nodeFacts, facts, motifs, intent }, rules);
    const workspaceUi = nodes.length === 1 ? normalizeWorkspaceUi(nodes[0]?.attributes?.workspaceUi) : null;
    const blockKind = String(projection.blockKind || blockKindForProjection(blockIr, projection) || "");
    const common = {
      sourceNodeIds: [...projection.orderedNodeIds],
      sourceFamilies: nodes.map((node) => String(node.family || "")),
      sourceEdgeIds: [...projection.internalEdgeIds],
      projectionId: projection.id,
      ports: { inputs: [...projection.entryPorts], outputs: [...projection.exitPorts] },
      derivedFrom: [...projection.evidenceIds],
      ...(workspaceUi ? { workspaceUi } : {}),
      ...(blockKind ? { blockKind } : {}),
      ...(layoutHintForBlockKind(blockKind) ? { layoutHint: layoutHintForBlockKind(blockKind) } : {}),
      ...(blockBadgeForKind(blockKind) ? { blockBadge: blockBadgeForKind(blockKind) } : {}),
      ...(projection.blockDetails ? { blockDetails: { ...projection.blockDetails } } : {}),
    };
    const body = enrichPrimitive(emitted.body[0], common, `primitive:${projection.id}:body`, "body");
    primitives.push(body);
    projectionToBody[projection.id] = body.id;
    emitted.structure.forEach((primitive, index) => primitives.push(enrichPrimitive(primitive, common, `primitive:${projection.id}:structure:${index + 1}`, "structure")));
    emitted.decorations.forEach((primitive, index) => primitives.push(enrichPrimitive(primitive, common, `primitive:${projection.id}:decoration:${index + 1}`, "decoration")));
  }

  const groupIndex = createGroupContextIndex(ir);
  const relations = [];
  for (const edge of ir.edges || []) {
    const mapping = projectionMap.edgeToProjection?.[edge.id];
    if (!mapping || mapping.disposition !== "visible") continue;
    relations.push({
      id: `relation:${edge.id}`,
      sourcePrimitiveId: projectionToBody[mapping.sourceProjectionId],
      targetPrimitiveId: projectionToBody[mapping.targetProjectionId],
      sourcePortId: mapping.sourceBlockPortId || mapping.sourcePortId,
      targetPortId: mapping.targetBlockPortId || mapping.targetPortId,
      relationTags: relationTags(facts.edgeFacts?.[edge.id]),
      groupContext: relationGroupContext(mapping, groupIndex),
      sourceEdgeIds: [edge.id],
      derivedFrom: facts.edgeFacts?.[edge.id]?.relation?.evidenceIds || [`derived:edge:${edge.id}`],
    });
  }
  const { groups, diagnostics: groupDiagnostics } = compileGroups(ir, projectionMap, projectionToBody);
  const constraints = compileMotifConstraints(motifs.motifs, projectionMap, projectionToBody);
  const blockSummary = summarizeBlocks(blockIr.blocks, primitives);
  return {
    version: VERSION,
    irVersion: String(ir.version || ""),
    motifsVersion: motifs.version,
    blocksVersion: blockIr.version,
    motifs: motifs.motifs,
    blocks: blockIr.blocks,
    blockSummary,
    primitives,
    relations,
    groups,
    constraints,
    projectionToBody,
    diagnostics: [...(projectionMap.diagnostics || []), ...groupDiagnostics],
  };
}

function compileMotifConstraints(motifs, projectionMap, projectionToBody) {
  const constraints = [];
  for (const motif of motifs || []) {
    if (motif.kind !== "multi-scale-fusion" || motif.nodeIds.length < 3) continue;
    const targetNodeId = motif.nodeIds.at(-1);
    const sourceNodeIds = motif.nodeIds.slice(0, -1);
    const targetPrimitiveId = primitiveIdForNode(targetNodeId, projectionMap, projectionToBody);
    const memberPrimitiveIds = sourceNodeIds
      .map((nodeId) => primitiveIdForNode(nodeId, projectionMap, projectionToBody))
      .filter(Boolean);
    if (!targetPrimitiveId || memberPrimitiveIds.length < 2) continue;
    constraints.push({
      id: `constraint:${motif.id}:center-y-between`,
      kind: "center-y-between",
      targetPrimitiveId,
      memberPrimitiveIds,
      evidenceIds: [...motif.evidenceIds],
    });
  }
  return constraints;
}

function primitiveIdForNode(nodeId, projectionMap, projectionToBody) {
  const projectionId = projectionMap.nodeToProjection?.[nodeId];
  return projectionId ? projectionToBody[projectionId] || "" : "";
}

function createGroupContextIndex(ir) {
  const definitions = groupDefinitions(ir);
  const byId = new Map(definitions.map((group) => [group.id, group]));
  const directGroupByNode = new Map();
  for (const group of definitions) for (const nodeId of group.nodeIds) directGroupByNode.set(nodeId, group.id);
  const pathForNode = (nodeId) => {
    const reversed = [];
    const seen = new Set();
    let groupId = directGroupByNode.get(nodeId) || "";
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId);
      reversed.push(groupId);
      groupId = byId.get(groupId)?.parentId || "";
    }
    return reversed.reverse();
  };
  return { pathForNode };
}

function relationGroupContext(mapping, groupIndex) {
  const sourceGroupPath = groupIndex.pathForNode(mapping.sourceNodeId);
  const targetGroupPath = groupIndex.pathForNode(mapping.targetNodeId);
  const common = commonPrefixLength(sourceGroupPath, targetGroupPath);
  let relationScope = "ungrouped";
  if (sourceGroupPath.length || targetGroupPath.length) {
    if (sourceGroupPath.join("\u0000") === targetGroupPath.join("\u0000")) relationScope = "same-container";
    else if (common === Math.min(sourceGroupPath.length, targetGroupPath.length)) relationScope = "cross-parent-child-container";
    else if (common > 0) relationScope = "cross-sibling-container";
    else relationScope = "cross-root-container";
  }
  return { sourceGroupPath, targetGroupPath, relationScope };
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

export function validateSemanticScene(scene = {}, ir = {}, projectionMap = {}) {
  const issues = [];
  if (scene.version !== VERSION) issues.push({ code: "invalid-semantic-scene-version" });
  if (scene.motifsVersion && scene.motifsVersion !== NEURAL_MOTIFS_VERSION) issues.push({ code: "invalid-motifs-version", value: scene.motifsVersion });
  const bodiesByProjection = new Map();
  const bodyBySourceNode = new Map();
  const primitiveIds = new Set();
  for (const primitive of scene.primitives || []) {
    const primitiveId = String(primitive?.id || "");
    if (!primitiveId) issues.push({ code: "missing-scene-primitive-id" });
    else if (primitiveIds.has(primitiveId)) issues.push({ code: "duplicate-scene-primitive", primitiveId });
    else primitiveIds.add(primitiveId);
  }
  const bodyPrimitiveIds = new Set((scene.primitives || []).filter((primitive) => primitive.role === "body").map((primitive) => primitive.id));
  const groupIds = new Set((scene.groups || []).map((group) => group.id));
  const sourceNodes = new Set();
  const sourceEdges = new Set();
  for (const primitive of scene.primitives || []) {
    for (const nodeId of primitive.sourceNodeIds || []) sourceNodes.add(nodeId);
    for (const edgeId of primitive.sourceEdgeIds || []) sourceEdges.add(edgeId);
    if (primitive.role === "body") {
      if (bodiesByProjection.has(primitive.projectionId)) issues.push({ code: "duplicate-projection-body", projectionId: primitive.projectionId });
      bodiesByProjection.set(primitive.projectionId, primitive.id);
      for (const nodeId of primitive.sourceNodeIds || []) {
        if (bodyBySourceNode.has(nodeId) && bodyBySourceNode.get(nodeId) !== primitive.id) issues.push({ code: "source-node-in-multiple-bodies", nodeId });
        bodyBySourceNode.set(nodeId, primitive.id);
      }
    }
  }
  for (const projection of projectionMap.projections || []) {
    if (!bodiesByProjection.has(projection.id) || scene.projectionToBody?.[projection.id] !== bodiesByProjection.get(projection.id)) issues.push({ code: "missing-projection-body", projectionId: projection.id });
  }
  for (const relation of scene.relations || []) {
    if (!primitiveIds.has(relation.sourcePrimitiveId) || !primitiveIds.has(relation.targetPrimitiveId)) issues.push({ code: "dangling-scene-relation", relationId: relation.id });
    for (const edgeId of relation.sourceEdgeIds || []) sourceEdges.add(edgeId);
  }
  for (const group of scene.groups || []) {
    for (const primitiveId of group.primitiveIds || []) {
      if (!primitiveIds.has(primitiveId)) issues.push({ code: "dangling-group-primitive", groupId: group.id, primitiveId });
      else if (!bodyPrimitiveIds.has(primitiveId)) issues.push({ code: "non-body-group-primitive", groupId: group.id, primitiveId });
    }
    if (group.parentId && !groupIds.has(group.parentId)) issues.push({ code: "dangling-group-parent", groupId: group.id, parentId: group.parentId });
  }
  for (const node of ir.nodes || []) if (!sourceNodes.has(node.id)) issues.push({ code: "missing-source-node-coverage", nodeId: node.id });
  for (const edge of ir.edges || []) {
    const disposition = projectionMap.edgeToProjection?.[edge.id]?.disposition;
    if (["visible", "internal"].includes(disposition) && !sourceEdges.has(edge.id)) issues.push({ code: "missing-source-edge-coverage", edgeId: edge.id });
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: scene.primitives?.length || 0, relationCount: scene.relations?.length || 0 } };
}

function compileGroups(ir, projectionMap, projectionToBody) {
  const definitions = groupDefinitions(ir);
  const definitionById = new Map(definitions.map((group) => [group.id, group]));
  const directGroupsByNode = new Map((ir.nodes || []).map((node) => [node.id, []]));
  for (const group of definitions) {
    for (const nodeId of group.nodeIds) {
      const memberships = directGroupsByNode.get(nodeId);
      if (memberships && !memberships.includes(group.id)) memberships.push(group.id);
    }
  }
  const diagnostics = [];
  const primitiveIdsByGroup = new Map(definitions.map((group) => [group.id, []]));
  for (const projection of projectionMap.projections || []) {
    const memberships = projection.orderedNodeIds.map((nodeId) => directGroupsByNode.get(nodeId) || []);
    const signatures = memberships.map((ids) => [...ids].sort().join("\u0000"));
    if (new Set(signatures).size > 1) {
      diagnostics.push({
        code: "projection-group-membership-conflict",
        severity: "error",
        projectionId: projection.id,
        nodeIds: [...projection.orderedNodeIds],
        groupIds: definitions.map((group) => group.id).filter((id) => memberships.some((ids) => ids.includes(id))),
      });
      continue;
    }
    const bodyId = projectionToBody[projection.id];
    if (!bodyId) continue;
    const groupIds = new Set();
    for (const directId of memberships[0] || []) {
      let currentId = directId;
      while (currentId && !groupIds.has(currentId)) {
        groupIds.add(currentId);
        currentId = definitionById.get(currentId)?.parentId || "";
      }
    }
    for (const groupId of groupIds) primitiveIdsByGroup.get(groupId)?.push(bodyId);
  }
  return {
    groups: definitions.map((group) => ({
      id: group.id,
      label: group.label,
      role: group.role,
      parentId: group.parentId,
      direction: group.direction,
      padding: group.padding,
      gap: group.gap,
      primitiveIds: [...new Set(primitiveIdsByGroup.get(group.id) || [])],
    })),
    diagnostics,
  };
}

function groupDefinitions(ir) {
  const nodes = ir.nodes || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const sources = [
    ...(ir.groups || []).map((group) => ({ ...group, role: group.kind, children: group.nodeIds })),
    ...(ir.containers || []).map((container) => ({ ...container, role: container.kind })),
  ];
  const definitions = [];
  const byId = new Map();
  for (const [index, source] of sources.entries()) {
    const id = String(source.id || `scene-group-${index + 1}`);
    const directChildren = Array.isArray(source.children) ? source.children.map(String) : [];
    const incoming = {
      id,
      label: String(source.label || id),
      role: String(source.role || "module"),
      parentId: String(source.parentId || ""),
      direction: source.direction === "vertical" ? "vertical" : "horizontal",
      padding: finiteNonNegative(source.padding, 24),
      gap: finiteNonNegative(source.gap, 32),
      nodeIds: directChildren.filter((childId) => nodeIds.has(childId)),
      childGroupIds: directChildren.filter((childId) => !nodeIds.has(childId)),
    };
    if (!byId.has(id)) {
      definitions.push(incoming);
      byId.set(id, incoming);
    } else {
      const existing = byId.get(id);
      existing.nodeIds.push(...incoming.nodeIds.filter((nodeId) => !existing.nodeIds.includes(nodeId)));
      existing.childGroupIds.push(...incoming.childGroupIds.filter((groupId) => !existing.childGroupIds.includes(groupId)));
      if (!existing.parentId) existing.parentId = incoming.parentId;
    }
  }
  for (const node of nodes) {
    const containerId = String(node.containerId || "");
    if (containerId && !byId.has(containerId)) {
      const group = { id: containerId, label: containerId, role: "module", parentId: "", direction: "horizontal", padding: 24, gap: 32, nodeIds: [], childGroupIds: [] };
      definitions.push(group);
      byId.set(containerId, group);
    }
    const group = byId.get(containerId);
    if (group && !group.nodeIds.includes(node.id)) group.nodeIds.push(node.id);
  }
  for (const parent of definitions) {
    for (const childId of parent.childGroupIds) {
      const child = byId.get(String(childId));
      if (child && !child.parentId) child.parentId = parent.id;
    }
  }
  return definitions;
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function enrichPrimitive(primitive, common, id, role) {
  return {
    id,
    category: primitive.category,
    form: primitive.form,
    role,
    semanticTags: [...(primitive.semanticTags || [])],
    ...common,
    labels: [...(primitive.labels || [])],
    data: { ...(primitive.data || {}) },
  };
}

function summarizeBlocks(blocks = [], primitives = []) {
  const primitiveByBlockKind = new Map();
  for (const primitive of primitives) {
    if (!primitive.blockKind) continue;
    if (!primitiveByBlockKind.has(primitive.blockKind)) primitiveByBlockKind.set(primitive.blockKind, []);
    primitiveByBlockKind.get(primitive.blockKind).push(primitive);
  }
  const byKind = {};
  for (const block of blocks) {
    const kind = String(block.kind || "");
    if (!kind) continue;
    const rendered = primitiveByBlockKind.get(kind) || [];
    if (!byKind[kind]) {
      byKind[kind] = {
        count: 0,
        portCoverage: 0,
        badgeCoverage: 0,
        overlayCoverage: 0,
      };
    }
    byKind[kind].count += 1;
    if ((block.entryPorts || []).length || (block.exitPorts || []).length) byKind[kind].portCoverage += 1;
  }
  for (const [kind, items] of primitiveByBlockKind) {
    if (!byKind[kind]) continue;
    byKind[kind].badgeCoverage = items.filter((item) => item.blockBadge).length;
    byKind[kind].overlayCoverage = items.filter((item) => ["residual-block", "recurrent-cell", "moe-block", "graph-block"].includes(kind)).length;
  }
  return {
    total: blocks.length,
    byKind,
  };
}

function blockKindForProjection(blockIr, projection) {
  const projectionNodeIds = new Set((projection.orderedNodeIds || []).map(String));
  const block = (blockIr.blocks || []).find((candidate) => {
    const matched = (candidate.nodeIds || []).filter((nodeId) => projectionNodeIds.has(String(nodeId))).length;
    return matched > 0 && matched >= Math.min(2, projectionNodeIds.size);
  });
  return block ? String(block.kind) : "";
}

function normalizeWorkspaceUi(ui) {
  if (!ui || typeof ui !== "object") return null;
  const x = Number(ui.x);
  const y = Number(ui.y);
  const w = Number(ui.w);
  const h = Number(ui.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function relationTags(edgeFacts) {
  const relation = edgeFacts?.relation?.value || "data";
  const topology = edgeFacts?.topology?.value || {};
  return [...new Set([relation, ...Object.entries(topology).filter(([, enabled]) => enabled === true).map(([key]) => key)])];
}
