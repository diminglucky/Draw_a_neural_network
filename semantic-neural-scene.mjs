import { applyNeuralVisualRules, createDefaultNeuralVisualRules } from "./neural-visual-rules.mjs";

const VERSION = "semantic-neural-scene/v1";

export function compileSemanticScene(ir = {}, facts = {}, projectionMap = {}, intent = {}, options = {}) {
  const nodeById = new Map((ir.nodes || []).map((node) => [node.id, node]));
  const primitives = [];
  const projectionToBody = {};
  const rules = options.rules || createDefaultNeuralVisualRules();
  for (const projection of projectionMap.projections || []) {
    const nodes = projection.orderedNodeIds.map((id) => nodeById.get(id)).filter(Boolean);
    const nodeFacts = projection.orderedNodeIds.map((id) => facts.nodeFacts?.[id]).filter(Boolean);
    const emitted = applyNeuralVisualRules({ projection, nodes, nodeFacts, facts, intent }, rules);
    const common = {
      sourceNodeIds: [...projection.orderedNodeIds],
      sourceEdgeIds: [...projection.internalEdgeIds],
      projectionId: projection.id,
      ports: { inputs: [...projection.entryPorts], outputs: [...projection.exitPorts] },
      derivedFrom: [...projection.evidenceIds],
    };
    const body = enrichPrimitive(emitted.body[0], common, `primitive:${projection.id}:body`, "body");
    primitives.push(body);
    projectionToBody[projection.id] = body.id;
    emitted.structure.forEach((primitive, index) => primitives.push(enrichPrimitive(primitive, common, `primitive:${projection.id}:structure:${index + 1}`, "structure")));
    emitted.decorations.forEach((primitive, index) => primitives.push(enrichPrimitive(primitive, common, `primitive:${projection.id}:decoration:${index + 1}`, "decoration")));
  }

  const relations = [];
  for (const edge of ir.edges || []) {
    const mapping = projectionMap.edgeToProjection?.[edge.id];
    if (!mapping || mapping.disposition !== "visible") continue;
    relations.push({
      id: `relation:${edge.id}`,
      sourcePrimitiveId: projectionToBody[mapping.sourceProjectionId],
      targetPrimitiveId: projectionToBody[mapping.targetProjectionId],
      sourcePortId: mapping.sourcePortId,
      targetPortId: mapping.targetPortId,
      relationTags: relationTags(facts.edgeFacts?.[edge.id]),
      sourceEdgeIds: [edge.id],
      derivedFrom: facts.edgeFacts?.[edge.id]?.relation?.evidenceIds || [`derived:edge:${edge.id}`],
    });
  }
  return { version: VERSION, irVersion: String(ir.version || ""), primitives, relations, constraints: [], projectionToBody, diagnostics: [...(projectionMap.diagnostics || [])] };
}

export function validateSemanticScene(scene = {}, ir = {}, projectionMap = {}) {
  const issues = [];
  if (scene.version !== VERSION) issues.push({ code: "invalid-semantic-scene-version" });
  const bodiesByProjection = new Map();
  const bodyBySourceNode = new Map();
  const primitiveIds = new Set((scene.primitives || []).map((primitive) => primitive.id));
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
  for (const node of ir.nodes || []) if (!sourceNodes.has(node.id)) issues.push({ code: "missing-source-node-coverage", nodeId: node.id });
  for (const edge of ir.edges || []) {
    const disposition = projectionMap.edgeToProjection?.[edge.id]?.disposition;
    if (["visible", "internal"].includes(disposition) && !sourceEdges.has(edge.id)) issues.push({ code: "missing-source-edge-coverage", edgeId: edge.id });
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: scene.primitives?.length || 0, relationCount: scene.relations?.length || 0 } };
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

function relationTags(edgeFacts) {
  const relation = edgeFacts?.relation?.value || "data";
  const topology = edgeFacts?.topology?.value || {};
  return [...new Set([relation, ...Object.entries(topology).filter(([, enabled]) => enabled === true).map(([key]) => key)])];
}
