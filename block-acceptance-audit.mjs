import { createHash } from "node:crypto";

import { analyzeArchitectureInput } from "./agent-pipeline.mjs";
import { validateNeuralBlocks } from "./neural-block-ir.mjs";

export const BLOCK_ACCEPTANCE_AUDIT_VERSION = "block-acceptance-audit/v1";

export function evaluateBlockAcceptanceFixture(fixture, options = {}) {
  if (!fixture?.ir) throw new TypeError("Block acceptance fixture is missing IR.");
  const analyze = options.analyze || analyzeArchitectureInput;
  const result = analyze({ kind: "ir", ir: fixture.ir });
  const blockIrValidation = result.blockIr ? validateNeuralBlocks(result.blockIr, result.ir) : { ok: false, issues: [{ code: "missing-block-ir" }] };
  const errorDiagnostics = (result.diagnostics || []).filter((diagnostic) => diagnostic.severity === "error");
  const visualQuality = result.visioDiagramPlan?.scene?.visualQuality || result.visualQuality || null;
  const visualQualityWithinThresholds = visualQualityPasses(visualQuality);
  const expectedKinds = [...(fixture.expectedKinds || [])];
  const missingKinds = expectedKinds.filter((kind) => !(result.blockSummary?.byKind?.[kind]?.count >= 1));
  const checks = {
    readyForVisio: result.readyForVisio === true,
    diagramPlanValid: result.visioDiagramPlanValidation?.ok === true,
    blockIrValid: blockIrValidation.ok === true,
    expectedBlocksPresent: missingKinds.length === 0,
    noErrorDiagnostics: errorDiagnostics.length === 0,
    visualQualityWithinThresholds,
  };
  const accepted = Object.values(checks).every(Boolean);
  const scene = result.visioDiagramPlan?.scene || {};
  const audit = {
    version: BLOCK_ACCEPTANCE_AUDIT_VERSION,
    fixture: fixture.name,
    accepted,
    capabilities: [...(fixture.capabilities || [])],
    expectedKinds,
    missingKinds,
    checks,
    status: result.status || "",
    blockIr: result.blockIr ? {
      version: result.blockIr.version,
      blockCount: result.blockIr.blocks?.length || 0,
      kinds: [...new Set((result.blockIr.blocks || []).map((block) => block.kind))].sort(),
      validation: blockIrValidation,
    } : null,
    blockSummary: result.blockSummary || { total: 0, byKind: {} },
    scene: {
      version: scene.version || "",
      primitiveCount: scene.primitives?.length || 0,
      connectorCount: scene.connectors?.length || 0,
      groupCount: scene.groups?.length || 0,
      visualQuality,
    },
    errorDiagnostics,
    diagnostics: (result.diagnostics || []).map((diagnostic) => ({
      kind: diagnostic.kind || diagnostic.code || "",
      severity: diagnostic.severity || "",
      issueCode: diagnostic.issueCode || "",
      nodeId: diagnostic.nodeId || "",
      message: diagnostic.message || "",
    })),
    planHash: result.visioDiagramPlan ? hashPlan(result.visioDiagramPlan) : "",
  };
  return { audit, result };
}

export function summarizeBlockAcceptanceAudits(audits = []) {
  const accepted = audits.filter((audit) => audit.accepted).length;
  return {
    version: BLOCK_ACCEPTANCE_AUDIT_VERSION,
    status: accepted === audits.length ? "accepted" : "failed",
    count: audits.length,
    accepted,
    failed: audits.length - accepted,
    fixtures: audits.map((audit) => ({
      fixture: audit.fixture,
      accepted: audit.accepted,
      planHash: audit.planHash,
      blockKinds: audit.blockIr?.kinds || [],
      missingKinds: audit.missingKinds,
      errorCount: audit.errorDiagnostics.length,
    })),
  };
}

function hashPlan(plan) {
  const projection = {
    version: plan.version,
    sceneVersion: plan.scene?.version,
    primitives: (plan.scene?.primitives || []).map((primitive) => ({
      id: primitive.id,
      role: primitive.role,
      form: primitive.form,
      sourceNodeIds: primitive.sourceNodeIds,
      blockKind: primitive.blockKind || "",
      bounds: primitive.bounds,
    })),
    connectors: (plan.scene?.connectors || []).map((connector) => ({
      id: connector.id,
      sourcePrimitiveId: connector.sourcePrimitiveId,
      targetPrimitiveId: connector.targetPrimitiveId,
      sourcePortId: connector.sourcePortId || "",
      targetPortId: connector.targetPortId || "",
      points: connector.points,
    })),
    groups: (plan.scene?.groups || []).map((group) => ({
      id: group.id,
      parentId: group.parentId || "",
      primitiveIds: group.primitiveIds,
      bounds: group.bounds,
    })),
  };
  return createHash("sha256").update(stableStringify(projection)).digest("hex").slice(0, 16);
}

function visualQualityPasses(quality) {
  if (!quality?.thresholds) return false;
  const checks = [
    ["labelOverlapCount", "maxLabelOverlapCount"],
    ["labelBodyOverlapCount", "maxLabelBodyOverlapCount"],
    ["connectorBodyIntersectionCount", "maxConnectorBodyIntersectionCount"],
    ["blockBadgeMissingCount", "maxBlockBadgeMissingCount"],
    ["blockPortMissingCount", "maxBlockPortMissingCount"],
  ];
  return checks.every(([metric, threshold]) => Number(quality[metric] || 0) <= Number(quality.thresholds[threshold] ?? 0));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
