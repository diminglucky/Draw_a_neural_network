export const VISIO_OPERATION_PLAN_VERSION = "visio-native-bridge/v1";

export function validateVisioOperationPlan(plan = {}) {
  const issues = [];
  if (plan.version !== VISIO_OPERATION_PLAN_VERSION) {
    issues.push({ code: "invalid-visio-operation-plan-version", value: plan.version });
  }
  if (!String(plan.documentPath || "").trim()) issues.push({ code: "missing-operation-document-path" });
  if (plan.createDocument !== false) issues.push({ code: "implicit-document-creation-not-allowed" });
  if (!String(plan.pageName || "").trim()) issues.push({ code: "missing-operation-page-name" });
  if (!String(plan.renderId || "").trim()) issues.push({ code: "missing-operation-render-id" });
  if (!Number.isFinite(plan.unitScale) || plan.unitScale <= 0) issues.push({ code: "invalid-operation-unit-scale" });
  validateUniqueIds(plan.shapes, "id", "operation-shape", issues);
  validateUniqueIds(plan.connectors, "id", "operation-connector", issues);

  const shapeIds = new Set((plan.shapes || []).map((shape) => String(shape?.id || "")).filter(Boolean));
  for (const connector of plan.connectors || []) {
    const connectorId = String(connector?.id || "");
    const sourceShapeId = String(connector?.sourceShapeId || "");
    const targetShapeId = String(connector?.targetShapeId || "");
    if (sourceShapeId && !shapeIds.has(sourceShapeId)) {
      issues.push({ code: "missing-operation-source-shape", connectorId, sourceShapeId });
    }
    if (targetShapeId && !shapeIds.has(targetShapeId)) {
      issues.push({ code: "missing-operation-target-shape", connectorId, targetShapeId });
    }
    if (!Array.isArray(connector?.points) || connector.points.length < 2) {
      issues.push({ code: "missing-operation-connector-route", connectorId });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      shapeCount: plan.shapes?.length || 0,
      connectorCount: plan.connectors?.length || 0,
      issueCount: issues.length,
    },
  };
}

export function assertVisioOperationPlan(plan = {}) {
  const validation = validateVisioOperationPlan(plan);
  if (!validation.ok) {
    throw new Error(`Invalid Visio Operation Plan: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  return plan;
}

function validateUniqueIds(items, property, issuePrefix, issues) {
  const ids = new Set();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = String(item?.[property] || "");
    if (!id) {
      issues.push({ code: `missing-${issuePrefix}-id`, index });
    } else if (ids.has(id)) {
      issues.push({ code: `duplicate-${issuePrefix}-id`, id, index });
    } else {
      ids.add(id);
    }
  }
}
