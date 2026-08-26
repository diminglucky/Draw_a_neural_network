import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import { compileComposableRegionVisuals, type ComposableRegionVisualDescriptor } from "./composable-region-visual-compiler.js";
import { composeGeneralPublicationGraph, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { composePublicationLayout, type PublicationCompositionBounds } from "./publication-composition-kernel.js";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec, type UniversalGraphSpec } from "./universal-graph-spec.js";
import { compareCodeUnits } from "./stable-string-order.js";

type Bounds = PublicationCompositionBounds;

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
  const graph = composeGeneralPublicationGraph(ugs, { detail: input.graph.detail });
  if (digestGenericPlanSnapshotValue(input.graph) !== digestGenericPlanSnapshotValue(graph)) throw new Error("General Publication Graph must match canonical UGS projection");
  return compileGeneralPublicationVisualPlan({ ugs, graph, updateIdentity: input.updateIdentity });
}

/** Produces the renderer-neutral General PVP before any optional presentation enhancement. */
export function compileGeneralPublicationVisualPlan(input: { ugs: UniversalGraphSpec; graph: GeneralPublicationGraph; updateIdentity: PublicationVisualPlanUpdateIdentity }): PublicationVisualPlan {
  const ugs = parseUniversalGraphSpec(input.ugs);
  const canonicalGraph = composeGeneralPublicationGraph(ugs, { detail: input.graph.detail });
  if (digestGenericPlanSnapshotValue(input.graph) !== digestGenericPlanSnapshotValue(canonicalGraph)) throw new Error("General Publication Graph must match canonical UGS projection");
  const visualCompilation = compileComposableRegionVisuals(canonicalGraph);
  const composition = composePublicationLayout(visualCompilation.descriptors);
  const descriptors = composition.descriptors;
  const boundsByPrimitive = composition.boundsByPrimitive;
  const candidate = getUniversalGraphEligibility(ugs).preview === "candidate" || !visualCompilation.exportEligible || canonicalGraph.exportEligibility !== "eligible" || canonicalGraph.relations.some((relation) => relation.role === "feedback");
  const primitives = descriptors.map((descriptor) => ({
    primitiveId: descriptor.primitiveId,
    componentId: descriptor.componentId,
    kind: descriptor.kind,
    regionId: descriptor.regionId,
    bounds: boundsByPrimitive.get(descriptor.primitiveId),
    zIndex: descriptor.attachment !== null ? 3 : descriptor.topologyComponentId === null ? 2 : 1,
    styleTokenIds: [...descriptor.styleTokenIds],
    label: descriptor.label,
    visual: visualFor(descriptor, boundsByPrimitive.get(descriptor.primitiveId)!),
  }));
  const { ports, connectors } = connectorsFor(canonicalGraph, descriptors, boundsByPrimitive);
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: `pvp:${ugs.graphId}:${canonicalGraph.detail}` },
    eligibility: candidate ? { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: "pending" } : { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "pending" },
    lineage: { ugsHash: digestGenericPlanSnapshotValue(ugs), gpgHash: digestGenericPlanSnapshotValue(canonicalGraph), sourceHashes: [...ugs.sourceHashes].sort(compareCodeUnits), composerHash: digestGenericPlanSnapshotValue({ version: "gpg-visual-grammar-1", detail: canonicalGraph.detail }), profileSetHash: digestGenericPlanSnapshotValue([]) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: composition.page, safeMargins: composition.safeMargins },
    regions: [{ regionId: "region:main", bounds: composition.safeMargins, role: "main", zIndex: 0 }],
    primitiveGroups: visualCompilation.groups.map((group) => ({ ...group, zIndex: 1 })),
    primitives, ports, connectors, annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: styleTokensFor(descriptors, connectors) }, profileApplications: [],
    sourceMappings: descriptors.map((descriptor) => ({ visualId: descriptor.primitiveId, ugsIds: [...descriptor.sourceNodeIds].sort(compareCodeUnits), evidenceIds: [...descriptor.evidenceIds].sort(compareCodeUnits) })),
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] }, updateIdentity: input.updateIdentity,
  });
}

function connectorsFor(graph: GeneralPublicationGraph, descriptors: readonly ComposableRegionVisualDescriptor[], boundsByPrimitive: ReadonlyMap<string, Bounds>): { ports: Record<string, unknown>[]; connectors: Record<string, unknown>[] } {
  const primitiveByComponentId = new Map(descriptors.filter((descriptor) => descriptor.topologyComponentId !== null).map((descriptor) => [descriptor.topologyComponentId!, descriptor]));
  const incomingByComponent = new Map<string, string[]>();
  for (const relation of graph.relations) incomingByComponent.set(relation.targetComponentId, [...(incomingByComponent.get(relation.targetComponentId) ?? []), relation.relationId]);
  const ports: Record<string, unknown>[] = [];
  const connectors: Record<string, unknown>[] = [];
  const skipRelations = graph.relations.filter((relation) => relation.role === "skip").sort((left, right) => compareCodeUnits(left.relationId, right.relationId));
  const primaryTop = Math.min(...descriptors
    .filter((descriptor) => descriptor.topologyComponentId !== null)
    .map((descriptor) => boundsByPrimitive.get(descriptor.primitiveId)?.y ?? Number.POSITIVE_INFINITY));
  for (const relation of [...graph.relations].sort((left, right) => compareCodeUnits(left.relationId, right.relationId))) {
    const source = primitiveByComponentId.get(relation.sourceComponentId);
    const target = primitiveByComponentId.get(relation.targetComponentId);
    if (!source || !target) throw new Error("General Publication Graph relation lacks a visual primitive");
    const sourceBounds = boundsByPrimitive.get(source.primitiveId);
    const targetBounds = boundsByPrimitive.get(target.primitiveId);
    if (!sourceBounds || !targetBounds) throw new Error("Visual primitive lacks layout bounds");
    const sourcePortId = `port:${relation.relationId}:source`;
    const targetPortId = `port:${relation.relationId}:target`;
    const targetRelations = [...(incomingByComponent.get(relation.targetComponentId) ?? [])].sort(compareCodeUnits);
    const targetIndex = Math.max(0, targetRelations.indexOf(relation.relationId));
    const targetOffset = Math.floor((targetIndex + 1) * 1000 / (targetRelations.length + 1));
    const sourcePoint = anchor(sourceBounds, "right", 500);
    const targetPoint = anchor(targetBounds, "left", targetOffset);
    const middleX = Math.max(sourcePoint.x + 80, Math.floor((sourcePoint.x + targetPoint.x) / 2));
    const route = relation.role === "skip"
      ? skipRoute(sourcePoint, targetPoint, primaryTop, Math.max(0, skipRelations.indexOf(relation)))
      : [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }, targetPoint];
    ports.push(
      { portId: sourcePortId, primitiveId: source.primitiveId, role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: `${relation.relationId}:source` },
      { portId: targetPortId, primitiveId: target.primitiveId, role: "input", anchor: { side: "left", offset: targetOffset }, order: targetIndex, semanticPortId: `${relation.relationId}:target` },
    );
    connectors.push({ connectorId: `connector:${relation.relationId}`, sourcePortId, targetPortId, relation: relation.role, route, styleTokenIds: [relation.role === "skip" ? "style:skip" : "style:relation"], zIndex: 0 });
  }
  return { ports, connectors };
}

function visualFor(descriptor: ComposableRegionVisualDescriptor, bounds: { x: number; y: number; width: number; height: number }): Record<string, unknown> {
  if (descriptor.kind === "TensorVolume") {
    const depth = Math.max(24, Math.floor(Math.min(bounds.width, bounds.height) / 8));
    const frontFace = [{ x: bounds.x, y: bounds.y + depth }, { x: bounds.x + bounds.width - depth, y: bounds.y + depth }, { x: bounds.x + bounds.width - depth, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }];
    const depthFace = [{ x: bounds.x + bounds.width - depth, y: bounds.y + depth }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height - depth }, { x: bounds.x + bounds.width - depth, y: bounds.y + bounds.height }];
    return { regionRole: descriptor.regionRole, nativeSupport: descriptor.nativeSupport, geometry: { kind: "tensor_volume", frontFace, depthFace } };
  }
  if (descriptor.kind === "AttentionTokenStrip") {
    const cellWidth = Math.floor(bounds.width / 4);
    const orderedCells = [0, 1, 2, 3].map((order) => ({ cellId: `${descriptor.primitiveId}:cell:${order}`, order, bounds: { x: bounds.x + order * cellWidth, y: bounds.y, width: cellWidth, height: bounds.height } }));
    return { regionRole: descriptor.regionRole, nativeSupport: descriptor.nativeSupport, geometry: { kind: "ordered_cells", orderedCells } };
  }
  return { regionRole: descriptor.regionRole, nativeSupport: descriptor.nativeSupport, geometry: { kind: "none" } };
}

function styleTokensFor(descriptors: readonly ComposableRegionVisualDescriptor[], connectors: readonly Record<string, unknown>[]): Array<{ tokenId: string; values: Record<string, string | number> }> {
  const fills: Record<string, string> = {
    "style:terminal": "#e0f2fe", "style:tensor-stage": "#bae6fd", "style:tensor-volume": "#7dd3fc", "style:operator": "#eef2ff", "style:module": "#dcfce7", "style:repeat": "#fef3c7", "style:add": "#fee2e2", "style:concat": "#ede9fe", "style:attention": "#e0e7ff", "style:candidate": "#ffedd5", "style:relation": "#475569",
  };
  const connectorTokens = connectors.flatMap((connector) => connector.styleTokenIds as string[]);
  return [...new Set(descriptors.flatMap((descriptor) => descriptor.styleTokenIds).concat(connectorTokens))].sort(compareCodeUnits).map((tokenId) => ({
    tokenId,
    values: tokenId === "style:relation"
      ? { fill: fills[tokenId] ?? "#ffffff", stroke: "#475569", strokeWidth: "1.2" }
      : tokenId === "style:skip"
        ? { fill: "#ffffff", stroke: "#64748b", strokeWidth: "1.2" }
        : tokenId === "style:split"
          ? { fill: "#334155", stroke: "#334155", strokeWidth: "1.2" }
          : { fill: fills[tokenId] ?? "#ffffff", stroke: "#1e293b", strokeWidth: "1.2" },
  }));
}

function anchor(bounds: { x: number; y: number; width: number; height: number }, side: "left" | "right", offset: number): { x: number; y: number } {
  const y = Math.round(bounds.y + bounds.height * offset / 1000);
  return side === "left" ? { x: bounds.x, y } : { x: bounds.x + bounds.width, y };
}

function skipRoute(source: { x: number; y: number }, target: { x: number; y: number }, primaryTop: number, laneIndex: number): Array<{ x: number; y: number }> {
  const sourceExitX = source.x + 80;
  const targetEntryX = target.x - 80;
  const laneY = Math.max(40, primaryTop - 120 - laneIndex * 60);
  return [
    source,
    { x: sourceExitX, y: source.y },
    { x: sourceExitX, y: laneY },
    { x: targetEntryX, y: laneY },
    { x: targetEntryX, y: target.y },
    target,
  ];
}
