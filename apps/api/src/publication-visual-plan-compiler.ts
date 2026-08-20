import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import { composeGeneralPublicationGraph, type GeneralPublicationComponentRole, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec, type UniversalGraphSpec } from "./universal-graph-spec.js";
import { compareCodeUnits } from "./stable-string-order.js";

const MARGIN = 200;
const WIDTH = 900;
const HEIGHT = 400;
const COLUMN_GAP = 700;
const LANE_GAP = 240;

export interface PublicationVisualPlanUpdateIdentity {
  ownerId: string; deviceId: string; workflowId: string; documentId: string; pageId: string; expectedRevision: number;
}

export function assertPublicationVisualPlanRendererCapabilities(plan: PublicationVisualPlan, capabilities: readonly string[]): void {
  if (!Array.isArray(capabilities) || capabilities.some((item) => typeof item !== "string" || item.length === 0)) throw new Error("PVP renderer capabilities are invalid");
  const requirements = plan.rendererRequirements as { protocolVersion?: unknown; requiredCapabilities?: unknown } | undefined;
  if (!requirements || requirements.protocolVersion !== "pvp-renderer-1" || !Array.isArray(requirements.requiredCapabilities)) throw new Error("PVP renderer requirements are invalid");
  const available = new Set(capabilities);
  for (const required of requirements.requiredCapabilities) {
    if (typeof required !== "string" || !available.has(required)) throw new Error(`PVP renderer lacks required capability: ${String(required)}`);
  }
}

export function compilePublicationVisualPlan(input: { ugs: UniversalGraphSpec; graph: GeneralPublicationGraph; updateIdentity: PublicationVisualPlanUpdateIdentity }): PublicationVisualPlan {
  const ugs = parseUniversalGraphSpec(input.ugs);
  const canonicalGraph = composeGeneralPublicationGraph(ugs, { detail: input.graph.detail });
  if (digestGenericPlanSnapshotValue(input.graph) !== digestGenericPlanSnapshotValue(canonicalGraph)) throw new Error("General Publication Graph must match canonical UGS projection");
  const components = [...canonicalGraph.components].sort((left, right) => compareCodeUnits(left.componentId, right.componentId));
  const boundsByComponent = new Map(components.map((component) => [component.componentId, {
    x: MARGIN + component.layoutOrder.rank * (WIDTH + COLUMN_GAP), y: MARGIN + component.layoutOrder.order * (HEIGHT + LANE_GAP), width: WIDTH, height: HEIGHT,
  }]));
  const pageWidth = Math.max(...[...boundsByComponent.values()].map((item) => item.x + item.width)) + MARGIN;
  const pageHeight = Math.max(...[...boundsByComponent.values()].map((item) => item.y + item.height)) + MARGIN;
  const candidate = getUniversalGraphEligibility(ugs).preview === "candidate" || canonicalGraph.exportEligibility !== "eligible" || canonicalGraph.relations.some((relation) => relation.role === "feedback");
  const primitives = components.map((component) => ({ primitiveId: `primitive:${component.componentId}`, componentId: component.componentId, kind: primitiveKind(component.role), regionId: "region:main", bounds: boundsByComponent.get(component.componentId), zIndex: 1, styleTokenIds: [], label: component.label }));
  const ports: Record<string, unknown>[] = [];
  const connectors: Record<string, unknown>[] = [];
  for (const relation of [...canonicalGraph.relations].sort((left, right) => compareCodeUnits(left.relationId, right.relationId))) {
    const source = boundsByComponent.get(relation.sourceComponentId);
    const target = boundsByComponent.get(relation.targetComponentId);
    if (!source || !target) throw new Error("General Publication Graph relation lacks a component bound");
    const sourcePortId = `port:${relation.relationId}:source`;
    const targetPortId = `port:${relation.relationId}:target`;
    const sourcePoint = { x: source.x + source.width, y: source.y + source.height / 2 };
    const targetPoint = { x: target.x, y: target.y + target.height / 2 };
    const middleX = Math.max(sourcePoint.x + 100, Math.floor((sourcePoint.x + targetPoint.x) / 2));
    ports.push(
      { portId: sourcePortId, primitiveId: `primitive:${relation.sourceComponentId}`, role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: `${relation.relationId}:source` },
      { portId: targetPortId, primitiveId: `primitive:${relation.targetComponentId}`, role: "input", anchor: { side: "left", offset: 500 }, order: 0, semanticPortId: `${relation.relationId}:target` },
    );
    connectors.push({ connectorId: `connector:${relation.relationId}`, sourcePortId, targetPortId, relation: relation.role, route: [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }, targetPoint], styleTokenIds: [], zIndex: 0 });
  }
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: `pvp:${ugs.graphId}:${canonicalGraph.detail}` },
    eligibility: candidate ? { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: "pending" } : { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "pending" },
    lineage: { ugsHash: digestGenericPlanSnapshotValue(ugs), gpgHash: digestGenericPlanSnapshotValue(canonicalGraph), sourceHashes: [...ugs.sourceHashes].sort(compareCodeUnits), composerHash: digestGenericPlanSnapshotValue({ version: "gpg-1", detail: canonicalGraph.detail }), profileSetHash: digestGenericPlanSnapshotValue([]) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: pageWidth, height: pageHeight }, safeMargins: { x: MARGIN, y: MARGIN, width: pageWidth - MARGIN * 2, height: pageHeight - MARGIN * 2 } },
    regions: [{ regionId: "region:main", bounds: { x: MARGIN, y: MARGIN, width: pageWidth - MARGIN * 2, height: pageHeight - MARGIN * 2 }, role: "main", zIndex: 0 }],
    primitiveGroups: [], primitives, ports, connectors, annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] }, profileApplications: [],
    sourceMappings: components.map((component) => ({ visualId: `primitive:${component.componentId}`, ugsIds: [...component.sourceNodeIds].sort(compareCodeUnits), evidenceIds: [...component.evidenceIds].sort(compareCodeUnits) })),
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] }, updateIdentity: input.updateIdentity,
  });
}

function primitiveKind(role: GeneralPublicationComponentRole): string {
  return ({ input: "Input", output: "Output", generic_module: "GenericModule", custom_operator: "CustomOperator", custom_module: "CustomModule", split: "Split", merge_add: "MergeAdd", merge_concat: "MergeConcat", custom_fusion: "CustomFusion", repeat_badge: "RepeatBadge", candidate_region: "CandidateRegion" } as const)[role];
}
