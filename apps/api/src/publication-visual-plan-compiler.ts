import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import { compileComposableRegionVisuals, type ComposableRegionVisualDescriptor } from "./composable-region-visual-compiler.js";
import { composeGeneralPublicationGraph, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec, type UniversalGraphSpec } from "./universal-graph-spec.js";
import { compareCodeUnits } from "./stable-string-order.js";

const MARGIN = 200;
const WIDTH = 760;
const HEIGHT = 320;
const COLUMN_GAP = 360;
const LANE_GAP = 120;
const ATTACHMENT_GAP = 16;

type Bounds = { x: number; y: number; width: number; height: number };

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
  const descriptors = compactDeterministicLayout(visualCompilation.descriptors);
  const boundsByPrimitive = new Map<string, Bounds>(descriptors.filter((descriptor) => descriptor.attachment === null).map((descriptor) => [descriptor.primitiveId, {
    x: MARGIN + descriptor.layout.rank * (WIDTH + COLUMN_GAP),
    y: MARGIN + descriptor.layout.lane * (HEIGHT + LANE_GAP),
    width: WIDTH,
    height: HEIGHT,
  }]));
  const attachmentsByCorridor = new Map<string, ComposableRegionVisualDescriptor[]>();
  for (const descriptor of descriptors.filter((item) => item.attachment !== null)) {
    const corridor = attachmentCorridor(descriptor);
    attachmentsByCorridor.set(corridor, [...(attachmentsByCorridor.get(corridor) ?? []), descriptor]);
  }
  for (const [, attachments] of [...attachmentsByCorridor.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
    for (const [primitiveId, bounds] of packAttachments(boundsByPrimitive, attachments)) boundsByPrimitive.set(primitiveId, bounds);
  }
  const pageWidth = Math.max(...[...boundsByPrimitive.values()].map((item) => item.x + item.width)) + MARGIN;
  const pageHeight = Math.max(...[...boundsByPrimitive.values()].map((item) => item.y + item.height)) + MARGIN;
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
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: pageWidth, height: pageHeight }, safeMargins: { x: MARGIN, y: MARGIN, width: pageWidth - MARGIN * 2, height: pageHeight - MARGIN * 2 } },
    regions: [{ regionId: "region:main", bounds: { x: MARGIN, y: MARGIN, width: pageWidth - MARGIN * 2, height: pageHeight - MARGIN * 2 }, role: "main", zIndex: 0 }],
    primitiveGroups: visualCompilation.groups.map((group) => ({ ...group, zIndex: 1 })),
    primitives, ports, connectors, annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: styleTokensFor(descriptors) }, profileApplications: [],
    sourceMappings: descriptors.map((descriptor) => ({ visualId: descriptor.primitiveId, ugsIds: [...descriptor.sourceNodeIds].sort(compareCodeUnits), evidenceIds: [...descriptor.evidenceIds].sort(compareCodeUnits) })),
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] }, updateIdentity: input.updateIdentity,
  });
}

function connectorsFor(graph: GeneralPublicationGraph, descriptors: readonly ComposableRegionVisualDescriptor[], boundsByPrimitive: Map<string, { x: number; y: number; width: number; height: number }>): { ports: Record<string, unknown>[]; connectors: Record<string, unknown>[] } {
  const primitiveByComponentId = new Map(descriptors.filter((descriptor) => descriptor.topologyComponentId !== null).map((descriptor) => [descriptor.topologyComponentId!, descriptor]));
  const incomingByComponent = new Map<string, string[]>();
  for (const relation of graph.relations) incomingByComponent.set(relation.targetComponentId, [...(incomingByComponent.get(relation.targetComponentId) ?? []), relation.relationId]);
  const ports: Record<string, unknown>[] = [];
  const connectors: Record<string, unknown>[] = [];
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
    ports.push(
      { portId: sourcePortId, primitiveId: source.primitiveId, role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: `${relation.relationId}:source` },
      { portId: targetPortId, primitiveId: target.primitiveId, role: "input", anchor: { side: "left", offset: targetOffset }, order: targetIndex, semanticPortId: `${relation.relationId}:target` },
    );
    connectors.push({ connectorId: `connector:${relation.relationId}`, sourcePortId, targetPortId, relation: relation.role, route: [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }, targetPoint], styleTokenIds: ["style:relation"], zIndex: 0 });
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

function styleTokensFor(descriptors: readonly ComposableRegionVisualDescriptor[]): Array<{ tokenId: string; values: Record<string, string | number> }> {
  const fills: Record<string, string> = {
    "style:terminal": "#e0f2fe", "style:tensor-stage": "#bae6fd", "style:tensor-volume": "#7dd3fc", "style:operator": "#eef2ff", "style:module": "#dcfce7", "style:repeat": "#fef3c7", "style:split": "#fce7f3", "style:add": "#fee2e2", "style:concat": "#ede9fe", "style:attention": "#e0e7ff", "style:candidate": "#ffedd5", "style:relation": "#475569",
  };
  return [...new Set(descriptors.flatMap((descriptor) => descriptor.styleTokenIds).concat(["style:relation"]))].sort(compareCodeUnits).map((tokenId) => ({ tokenId, values: { fill: fills[tokenId] ?? "#ffffff", stroke: "#1e293b", strokeWidth: "2" } }));
}

function anchor(bounds: { x: number; y: number; width: number; height: number }, side: "left" | "right", offset: number): { x: number; y: number } {
  const y = Math.round(bounds.y + bounds.height * offset / 1000);
  return side === "left" ? { x: bounds.x, y } : { x: bounds.x + bounds.width, y };
}

function packAttachments(primaryBoundsById: ReadonlyMap<string, Bounds>, descriptors: readonly ComposableRegionVisualDescriptor[]): Map<string, Bounds> {
  const primaryIds = [...new Set(descriptors.map((descriptor) => descriptor.attachment!.primaryPrimitiveId))].sort(compareCodeUnits);
  const allocated: Bounds[] = primaryIds.map((primaryId) => {
    const primary = primaryBoundsById.get(primaryId);
    if (!primary) throw new Error(`Attached visual primitive lacks stable primary bounds: ${primaryId}`);
    return primary;
  });
  const packed = new Map<string, Bounds>();
  for (const descriptor of [...descriptors].sort((left, right) => left.layout.lane - right.layout.lane || attachmentPriority(left) - attachmentPriority(right) || compareCodeUnits(left.primitiveId, right.primitiveId))) {
    const primary = primaryBoundsById.get(descriptor.attachment!.primaryPrimitiveId);
    if (!primary) throw new Error(`Attached visual primitive lacks stable primary bounds: ${descriptor.attachment!.primaryPrimitiveId}`);
    const preferred = preferredAttachmentBounds(primary, descriptor.attachment!);
    let bounds = preferred;
    let collision = allocated.find((item) => boundsOverlap(bounds, item));
    while (collision) {
      bounds = { ...bounds, y: collision.y + collision.height + ATTACHMENT_GAP };
      collision = allocated.find((item) => boundsOverlap(bounds, item));
    }
    allocated.push(bounds);
    packed.set(descriptor.primitiveId, bounds);
  }
  return packed;
}

function attachmentCorridor(descriptor: ComposableRegionVisualDescriptor): string {
  if (!descriptor.attachment) throw new Error(`Visual primitive is not attached: ${descriptor.primitiveId}`);
  return `${descriptor.layout.rank}\u0000right`;
}

function preferredAttachmentBounds(primary: Bounds, attachment: NonNullable<ComposableRegionVisualDescriptor["attachment"]>): Bounds {
  const x = primary.x + primary.width + ATTACHMENT_GAP;
  if (attachment.placement === "corner_top_right") return { x, y: primary.y + ATTACHMENT_GAP, width: 180, height: 48 };
  if (attachment.placement === "output_side") return { x, y: primary.y + Math.floor(primary.height / 2) - 24, width: 300, height: 48 };
  if (attachment.placement === "adjacent_right_top") return { x, y: primary.y + 80, width: 300, height: 88 };
  return { x, y: primary.y + 236, width: 300, height: 68 };
}

function attachmentPriority(descriptor: ComposableRegionVisualDescriptor): number {
  if (descriptor.kind === "RepeatBadge") return 10;
  if (descriptor.kind === "TensorStage") return 20;
  if (descriptor.kind === "TensorVolume") return 30;
  if (descriptor.kind === "SplitMarker") return 40;
  if (descriptor.kind === "AttentionTokenStrip") return 50;
  if (descriptor.kind === "AttentionRelation") return 60;
  return 100;
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function compactDeterministicLayout(input: readonly ComposableRegionVisualDescriptor[]): ComposableRegionVisualDescriptor[] {
  const byRank = new Map<number, ComposableRegionVisualDescriptor[]>();
  for (const descriptor of input.filter((item) => item.attachment === null)) byRank.set(descriptor.layout.rank, [...(byRank.get(descriptor.layout.rank) ?? []), descriptor]);
  const primaryLayouts = new Map([...byRank.entries()].sort(([left], [right]) => left - right).flatMap(([rank, descriptors]) => descriptors
    .sort((left, right) => left.layout.lane - right.layout.lane || left.layout.order - right.layout.order || compareCodeUnits(left.primitiveId, right.primitiveId))
    .map((descriptor, lane) => [descriptor.primitiveId, { rank, lane, order: lane }] as const)));
  return input.map((descriptor) => {
    if (!descriptor.attachment) {
      const layout = primaryLayouts.get(descriptor.primitiveId);
      if (!layout) throw new Error(`Visual primitive lacks compact layout: ${descriptor.primitiveId}`);
      return { ...descriptor, layout };
    }
    const layout = primaryLayouts.get(descriptor.attachment.primaryPrimitiveId);
    if (!layout) throw new Error(`Attached visual primitive lacks stable primary layout: ${descriptor.primitiveId}`);
    return { ...descriptor, layout: { ...layout, order: layout.order + descriptor.attachment.slot + 1 } };
  }).sort((left, right) => left.layout.rank - right.layout.rank || left.layout.lane - right.layout.lane || left.layout.order - right.layout.order || compareCodeUnits(left.primitiveId, right.primitiveId));
}
