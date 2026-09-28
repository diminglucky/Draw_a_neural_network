import {
  createAnchorConnectorPrimitive,
  createDenseLayerPrimitive,
  createGroupBoxPrimitive,
  createLayerStackPrimitive,
  createRightBandedTensorPrimitive,
  createTensorBoxPrimitive,
} from "./publication-primitives.mjs";

export const NEURAL_FIGURE_DSL_VERSION = "neural-figure-dsl/v1";

const PRIMITIVE_KINDS = new Set([
  "tensor_box",
  "right_banded_tensor",
  "dense_layer",
  "layer_stack",
  "group_box",
  "anchor_connector",
]);

export function createNeuralFigureProgram(input = {}) {
  return {
    version: NEURAL_FIGURE_DSL_VERSION,
    title: String(input.title || ""),
    direction: String(input.direction || "left-to-right"),
    primitives: Array.isArray(input.primitives) ? input.primitives.map((item) => ({ ...item })) : [],
    connectors: Array.isArray(input.connectors) ? input.connectors.map((item) => ({ ...item })) : [],
    groups: Array.isArray(input.groups) ? input.groups.map((item) => ({ ...item })) : [],
    constraints: Array.isArray(input.constraints) ? input.constraints.map((item) => ({ ...item })) : [],
    styleTokens: input.styleTokens && typeof input.styleTokens === "object" ? { ...input.styleTokens } : {},
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics.map((item) => ({ ...item })) : [],
  };
}

export function validateNeuralFigureProgram(program = {}) {
  const issues = [];
  if (program.version !== NEURAL_FIGURE_DSL_VERSION) issues.push({ code: "invalid-neural-figure-dsl-version", value: program.version });
  const primitiveIds = new Set();
  for (const primitive of program.primitives || []) {
    const id = String(primitive?.id || "");
    if (!id) issues.push({ code: "missing-dsl-primitive-id" });
    else if (primitiveIds.has(id)) issues.push({ code: "duplicate-dsl-primitive-id", primitiveId: id });
    else primitiveIds.add(id);
    if (!PRIMITIVE_KINDS.has(String(primitive?.kind || ""))) issues.push({ code: "invalid-dsl-primitive-kind", primitiveId: id, kind: primitive?.kind });
  }
  for (const connector of program.connectors || []) {
    validateConnectorEndpoint(connector?.from, primitiveIds, "source", connector?.id, issues);
    validateConnectorEndpoint(connector?.to, primitiveIds, "target", connector?.id, issues);
  }
  for (const group of program.groups || []) {
    for (const childId of group.childIds || []) {
      if (!primitiveIds.has(String(childId))) issues.push({ code: "dsl-group-missing-child", groupId: group.id, childId });
    }
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: program.primitives?.length || 0, connectorCount: program.connectors?.length || 0, groupCount: program.groups?.length || 0 } };
}

export function compileNeuralFigureProgram(program = {}) {
  const validation = validateNeuralFigureProgram(program);
  if (!validation.ok) throw new TypeError(`Invalid Neural Figure DSL: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  const primitives = (program.primitives || []).map(compilePrimitive);
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const connectors = (program.connectors || []).map((connector) => compileConnector(connector, primitiveById));
  const groups = (program.groups || []).map((group) => createGroupBoxPrimitive({
    ...(group.options || {}),
    id: group.id,
    evidence: group.evidence,
  }));
  return {
    version: NEURAL_FIGURE_DSL_VERSION,
    title: String(program.title || ""),
    direction: String(program.direction || "left-to-right"),
    primitives,
    connectors,
    groups,
    constraints: (program.constraints || []).map((item) => ({ ...item })),
    styleTokens: { ...(program.styleTokens || {}) },
    diagnostics: [],
  };
}

function compilePrimitive(primitive = {}) {
  const options = primitive.options || {};
  if (primitive.kind === "tensor_box") return createTensorBoxPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  if (primitive.kind === "right_banded_tensor") return createRightBandedTensorPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  if (primitive.kind === "dense_layer") return createDenseLayerPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  if (primitive.kind === "layer_stack") return createLayerStackPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  if (primitive.kind === "group_box") return createGroupBoxPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  if (primitive.kind === "anchor_connector") return createAnchorConnectorPrimitive({ ...options, id: primitive.id, evidence: primitive.evidence });
  throw new TypeError(`Unsupported DSL primitive kind: ${primitive.kind}`);
}

function compileConnector(connector = {}, primitiveById) {
  const source = primitiveById.get(String(connector.from?.primitiveId || ""));
  const target = primitiveById.get(String(connector.to?.primitiveId || ""));
  const sourceAnchorId = String(connector.from?.anchor || "east");
  const targetAnchorId = String(connector.to?.anchor || "west");
  const sourceAnchor = source?.anchors?.[sourceAnchorId] || source?.cell?.[0]?.anchors?.[sourceAnchorId] || null;
  const targetAnchor = target?.anchors?.[targetAnchorId] || target?.cell?.[0]?.anchors?.[targetAnchorId] || null;
  return createAnchorConnectorPrimitive({
    id: connector.id,
    sourcePrimitiveId: connector.from?.primitiveId,
    targetPrimitiveId: connector.to?.primitiveId,
    sourceAnchorId,
    targetAnchorId,
    sourceAnchor: sourceAnchor || connector.points?.[0] || { x: 0, y: 0 },
    targetAnchor: targetAnchor || connector.points?.at(-1) || { x: 0, y: 0 },
    points: connector.points,
    routeClass: connector.routeClass,
    evidence: connector.evidence,
  });
}

function validateConnectorEndpoint(endpoint = {}, primitiveIds, side, connectorId, issues) {
  const primitiveId = String(endpoint?.primitiveId || "");
  if (!primitiveId || !primitiveIds.has(primitiveId)) {
    issues.push({ code: "dsl-connector-missing-primitive", connectorId, side, primitiveId });
  }
  if (!String(endpoint?.anchor || "").trim()) {
    issues.push({ code: "dsl-connector-missing-anchor", connectorId, side });
  }
}
