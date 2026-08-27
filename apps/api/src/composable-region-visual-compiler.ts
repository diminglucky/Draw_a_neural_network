import type { ComposableSemanticRegion, ComposableSemanticRegionKind } from "./composable-semantic-regions.js";
import type { GeneralPublicationComponent, GeneralPublicationGraph, GeneralPublicationRelation } from "./general-publication-graph.js";
import {
  getPublicationVisualGrammarDescriptor,
  type PublicationVisualNativeSupport,
  type PublicationVisualPrimitiveKind,
  type PublicationVisualRegionRole,
} from "./publication-visual-grammar.js";
import { compareCodeUnits } from "./stable-string-order.js";

export interface ComposableRegionVisualDescriptor {
  readonly primitiveId: string;
  readonly componentId: string;
  readonly topologyComponentId: string | null;
  readonly kind: PublicationVisualPrimitiveKind;
  readonly regionId: string;
  readonly regionRole: PublicationVisualRegionRole;
  readonly label: string;
  readonly styleTokenIds: readonly string[];
  readonly nativeSupport: PublicationVisualNativeSupport;
  readonly connectorPorts: readonly string[];
  readonly geometryRequirement: "none" | "tensor_volume" | "ordered_cells";
  readonly sourceNodeIds: readonly string[];
  readonly sourceEdgeIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly layout: Readonly<{ readonly rank: number; readonly lane: number; readonly order: number }>;
  /** Renderer-neutral relationship to the stable topology primitive that owns an auxiliary semantic visual. */
  readonly attachment: ComposableRegionVisualAttachment | null;
}

export interface ComposableRegionVisualAttachment {
  readonly primaryPrimitiveId: string;
  readonly placement: "corner_top_right" | "output_side" | "adjacent_right_top" | "adjacent_right_bottom";
  /** Stable ordinal within one primary/placement family; assigned after all semantic regions are compiled. */
  readonly slot: number;
}

export interface ComposableRegionVisualGroup {
  readonly groupId: string;
  readonly regionId: string;
  readonly semanticRegionId: string;
  readonly label: string;
  readonly primitiveIds: readonly string[];
  readonly styleTokenIds: readonly string[];
}

export interface ComposableRegionLayoutConstraint {
  readonly constraintId: string;
  readonly kind: "rank" | "order" | "containment" | "collision_safe_spacing" | "orthogonal_route" | "attachment";
  readonly subjectIds: readonly string[];
}

export interface ComposableRegionVisualCompilation {
  readonly descriptors: readonly ComposableRegionVisualDescriptor[];
  readonly groups: readonly ComposableRegionVisualGroup[];
  readonly constraints: readonly ComposableRegionLayoutConstraint[];
  readonly exportEligible: boolean;
}

/**
 * Converts the canonical GPG and its already-validated semantic regions into
 * renderer-neutral visual descriptors.  It has no coordinates or renderer
 * commands and never manufactures a second topology.
 */
export function compileComposableRegionVisuals(graph: GeneralPublicationGraph): ComposableRegionVisualCompilation {
  const componentByNodeId = componentIndex(graph.components);
  const relationBySourceEdgeId = relationIndex(graph.relations);
  // A custom_fusion component is a semantic claim about the same topology
  // node, not a second topology node. Rendering it as another full frame
  // creates duplicated modules at the same rank and makes an unseen network
  // look like two architectures overlaid. The source node remains represented
  // by its canonical node component; fusion meaning is carried by its
  // multi-input relations or a verified merge semantic region.
  const descriptors = graph.components
    .filter((component) => component.role !== "custom_fusion")
    .map((component) => componentDescriptor(component));
  const groups: ComposableRegionVisualGroup[] = [];
  const constraints: ComposableRegionLayoutConstraint[] = [];
  let semanticOrder = 0;

  for (const region of [...graph.semanticRegions].sort((left, right) => compareCodeUnits(left.regionId, right.regionId))) {
    const regionDescriptors = compileRegion(region, descriptors, componentByNodeId, relationBySourceEdgeId, semanticOrder);
    semanticOrder += regionDescriptors.length + 1;
    for (const descriptor of regionDescriptors) {
      const index = descriptors.findIndex((item) => item.primitiveId === descriptor.primitiveId);
      if (index >= 0) descriptors[index] = descriptor;
      else descriptors.push(descriptor);
    }
    if (regionDescriptors.length > 0) {
      const primitiveIds = regionDescriptors.map((item) => item.primitiveId).sort(compareCodeUnits);
      groups.push({
        groupId: `group:${region.regionId}`,
        regionId: "region:main",
        semanticRegionId: region.regionId,
        label: region.label,
        primitiveIds,
        styleTokenIds: uniqueSorted(regionDescriptors.flatMap((item) => [...item.styleTokenIds])),
      });
      constraints.push(
        constraint(`constraint:containment:${region.regionId}`, "containment", primitiveIds),
        constraint(`constraint:spacing:${region.regionId}`, "collision_safe_spacing", primitiveIds),
      );
      for (const descriptor of regionDescriptors) {
        if (descriptor.attachment) constraints.push(
          constraint(`constraint:attachment:${descriptor.attachment.primaryPrimitiveId}:${descriptor.primitiveId}`, "attachment", [descriptor.attachment.primaryPrimitiveId, descriptor.primitiveId]),
        );
      }
    }
  }

  const slottedDescriptors = assignAttachmentSlots(descriptors);

  for (const descriptor of slottedDescriptors) {
    constraints.push(
      constraint(`constraint:rank:${descriptor.primitiveId}`, "rank", [descriptor.primitiveId]),
      constraint(`constraint:order:${descriptor.primitiveId}`, "order", [descriptor.primitiveId]),
    );
  }
  for (const relation of graph.relations) constraints.push(constraint(`constraint:route:${relation.relationId}`, "orthogonal_route", [relation.sourceComponentId, relation.targetComponentId]));

  return {
    descriptors: [...slottedDescriptors].sort(descriptorOrder),
    groups: [...groups].sort((left, right) => compareCodeUnits(left.groupId, right.groupId)),
    constraints: [...constraints].sort((left, right) => compareCodeUnits(left.constraintId, right.constraintId)),
    exportEligible: graph.exportEligibility === "eligible" && !graph.semanticRegions.some((region) => region.state === "candidate"),
  };
}

function componentDescriptor(component: GeneralPublicationComponent): ComposableRegionVisualDescriptor {
  const kind = kindForComponent(component);
  return visual({
    primitiveId: `primitive:${component.componentId}`,
    componentId: component.componentId,
    topologyComponentId: component.componentId,
    kind,
    regionId: "region:main",
    regionRole: roleForComponent(component),
    label: component.label,
    sourceNodeIds: component.sourceNodeIds,
    sourceEdgeIds: component.sourceEdgeIds,
    evidenceIds: component.evidenceIds,
    layout: { rank: component.layoutOrder.rank, lane: component.layoutOrder.order * 8, order: component.layoutOrder.order },
    attachment: null,
  });
}

function compileRegion(
  region: ComposableSemanticRegion,
  descriptors: ComposableRegionVisualDescriptor[],
  componentByNodeId: Map<string, GeneralPublicationComponent>,
  relationBySourceEdgeId: Map<string, GeneralPublicationRelation>,
  semanticOrder: number,
): ComposableRegionVisualDescriptor[] {
  if (region.kind === "candidate_feedback") return candidateDescriptors(region, descriptors, semanticOrder);
  const primary = primaryDescriptorFor(region, descriptors, relationBySourceEdgeId);
  if (region.kind === "scale_transition") return scaleDescriptors(region, primary, semanticOrder);
  if (region.kind === "repeat_group") return existingComponentDescriptors(region, descriptors, componentByNodeId, "RepeatBadge", primary, "corner_top_right");
  if (region.kind === "add_merge") return existingComponentDescriptors(region, descriptors, componentByNodeId, "AddMarker");
  if (region.kind === "concat_fusion") return existingComponentDescriptors(region, descriptors, componentByNodeId, "ConcatMarker");
  if (region.kind === "token_attention") return attentionDescriptors(region, primary, semanticOrder);
  if (region.kind === "custom_module") return existingComponentDescriptors(region, descriptors, componentByNodeId, "ModuleFrame");
  return splitDescriptors(region, primary, semanticOrder);
}

function scaleDescriptors(region: ComposableSemanticRegion, primary: ComposableRegionVisualDescriptor | null, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  // Data topology remains attached to its stable component primitive. Scale is
  // an additional visual meaning, not a replacement for a module/operator.
  return [
    semanticVisual(region, "stage", "TensorStage", semanticOrder, primary, "adjacent_right_top"),
    semanticVisual(region, "volume", "TensorVolume", semanticOrder + 1, primary, "adjacent_right_bottom"),
  ];
}

function attentionDescriptors(region: ComposableSemanticRegion, primary: ComposableRegionVisualDescriptor | null, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  return [
    semanticVisual(region, "tokens", "AttentionTokenStrip", semanticOrder, primary, "adjacent_right_top"),
    semanticVisual(region, "relation", "AttentionRelation", semanticOrder + 1, primary, "adjacent_right_bottom"),
  ];
}

function splitDescriptors(region: ComposableSemanticRegion, primary: ComposableRegionVisualDescriptor | null, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  return [semanticVisual(region, "split", "SplitMarker", semanticOrder, primary, "output_side")];
}

function candidateDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], semanticOrder: number): ComposableRegionVisualDescriptor[] {
  const existing = descriptors.filter((item) => item.kind === "CandidateCallout" && item.sourceEdgeIds.some((edgeId) => region.sourceEdgeIds.includes(edgeId)));
  return existing.length > 0 ? existing : [semanticVisual(region, "callout", "CandidateCallout", semanticOrder)];
}

function existingComponentDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], components: Map<string, GeneralPublicationComponent>, kind: PublicationVisualPrimitiveKind, primary: ComposableRegionVisualDescriptor | null = null, placement: ComposableRegionVisualAttachment["placement"] | null = null): ComposableRegionVisualDescriptor[] {
  const candidates = [...region.sourceNodeIds].sort(compareCodeUnits)
    .map((nodeId) => components.get(nodeId))
    .filter((item): item is GeneralPublicationComponent => item !== undefined)
    .map((component) => descriptors.find((item) => item.topologyComponentId === component.componentId))
    .filter((item): item is ComposableRegionVisualDescriptor => item !== undefined);
  const current = descriptors
    .filter((descriptor) => descriptor.kind === kind && descriptor.sourceNodeIds.some((nodeId) => region.sourceNodeIds.includes(nodeId)))
    .sort(descriptorOrder)[0]
    ?? candidates.find((item) => item.kind === kind);
  if (!current) return [semanticVisual(region, kind.toLowerCase(), kind, 0, primary, placement)];
  if (!primary || placement === null || current.primitiveId === primary.primitiveId) return [current];
  return [attach(current, primary, placement)];
}

function semanticVisual(region: ComposableSemanticRegion, suffix: string, kind: PublicationVisualPrimitiveKind, order: number, primary: ComposableRegionVisualDescriptor | null = null, placement: ComposableRegionVisualAttachment["placement"] | null = null): ComposableRegionVisualDescriptor {
  const attachment = primary && placement ? { primaryPrimitiveId: primary.primitiveId, placement, slot: 0 } : null;
  return visual({
    primitiveId: `primitive:semantic:${region.regionId}:${suffix}`,
    componentId: `semantic:${region.regionId}:${suffix}`,
    topologyComponentId: null,
    kind,
    regionId: "region:main",
    regionRole: region.kind,
    label: region.label,
    sourceNodeIds: region.sourceNodeIds,
    sourceEdgeIds: region.sourceEdgeIds,
    evidenceIds: region.evidenceIds,
    layout: attachment ? { rank: primary!.layout.rank, lane: primary!.layout.lane, order } : { rank: 0, lane: 100 + order, order },
    attachment,
  });
}

function visual(input: Omit<ComposableRegionVisualDescriptor, "styleTokenIds" | "nativeSupport" | "connectorPorts" | "geometryRequirement">): ComposableRegionVisualDescriptor {
  const grammar = getPublicationVisualGrammarDescriptor(input.kind);
  return {
    ...input,
    styleTokenIds: [...grammar.styleTokenIds],
    nativeSupport: grammar.nativeSupport,
    connectorPorts: [...grammar.requiredPorts],
    geometryRequirement: grammar.geometry.requirement,
    sourceNodeIds: uniqueSorted(input.sourceNodeIds),
    sourceEdgeIds: uniqueSorted(input.sourceEdgeIds),
    evidenceIds: uniqueSorted(input.evidenceIds),
  };
}

function attach(descriptor: ComposableRegionVisualDescriptor, primary: ComposableRegionVisualDescriptor, placement: ComposableRegionVisualAttachment["placement"]): ComposableRegionVisualDescriptor {
  return {
    ...descriptor,
    layout: { rank: primary.layout.rank, lane: primary.layout.lane, order: descriptor.layout.order },
    attachment: { primaryPrimitiveId: primary.primitiveId, placement, slot: 0 },
  };
}

function primaryDescriptorFor(region: ComposableSemanticRegion, descriptors: readonly ComposableRegionVisualDescriptor[], relations: Map<string, GeneralPublicationRelation>): ComposableRegionVisualDescriptor | null {
  if (region.kind === "scale_transition") {
    const targetComponentId = region.sourceEdgeIds.map((edgeId) => relations.get(edgeId)?.targetComponentId).find((item): item is string => item !== undefined);
    const target = targetComponentId ? descriptors.find((descriptor) => descriptor.topologyComponentId === targetComponentId) : undefined;
    if (target) return target;
  }
  const candidates = region.sourceNodeIds
    .map((nodeId) => descriptors.find((descriptor) => descriptor.topologyComponentId === `node:${nodeId}`))
    .filter((descriptor): descriptor is ComposableRegionVisualDescriptor => descriptor !== undefined)
    .filter((descriptor) => descriptor.kind !== "InputTerminal" && descriptor.kind !== "OutputTerminal")
    .sort(descriptorOrder);
  return candidates[0] ?? null;
}

function assignAttachmentSlots(descriptors: readonly ComposableRegionVisualDescriptor[]): ComposableRegionVisualDescriptor[] {
  const slotByFamily = new Map<string, number>();
  return [...descriptors].sort((left, right) => compareCodeUnits(left.primitiveId, right.primitiveId)).map((descriptor) => {
    if (!descriptor.attachment) return descriptor;
    const family = `${descriptor.attachment.primaryPrimitiveId}\u0000${descriptor.attachment.placement}`;
    const slot = slotByFamily.get(family) ?? 0;
    slotByFamily.set(family, slot + 1);
    return { ...descriptor, attachment: { ...descriptor.attachment, slot } };
  });
}

function componentIndex(components: readonly GeneralPublicationComponent[]): Map<string, GeneralPublicationComponent> {
  const byNodeId = new Map<string, GeneralPublicationComponent[]>();
  for (const component of components) {
    for (const nodeId of component.sourceNodeIds) byNodeId.set(nodeId, [...(byNodeId.get(nodeId) ?? []), component]);
  }
  return new Map([...byNodeId.entries()].map(([nodeId, candidates]) => [nodeId, [...candidates].sort((left, right) => {
    const primaryId = `node:${nodeId}`;
    if (left.componentId === primaryId) return -1;
    if (right.componentId === primaryId) return 1;
    return left.layoutOrder.order - right.layoutOrder.order || compareCodeUnits(left.componentId, right.componentId);
  })[0]]));
}

function relationIndex(relations: readonly GeneralPublicationRelation[]): Map<string, GeneralPublicationRelation> {
  return new Map(relations.flatMap((relation) => relation.sourceEdgeIds.map((edgeId) => [edgeId, relation] as const)));
}

function kindForComponent(component: GeneralPublicationComponent): PublicationVisualPrimitiveKind {
  if (component.role === "input") return "InputTerminal";
  if (component.role === "output") return "OutputTerminal";
  if (component.role === "custom_module" || component.role === "custom_fusion") return "ModuleFrame";
  if (component.role === "repeat_badge") return "RepeatBadge";
  if (component.role === "split") return "SplitMarker";
  if (component.role === "merge_add") return "AddMarker";
  if (component.role === "merge_concat") return "ConcatMarker";
  if (component.role === "candidate_region") return "CandidateCallout";
  return "OperatorFrame";
}

function roleForComponent(component: GeneralPublicationComponent): PublicationVisualRegionRole {
  if (component.role === "repeat_badge") return "repeat_group";
  if (component.role === "split") return "multi_branch";
  if (component.role === "merge_add") return "add_merge";
  if (component.role === "merge_concat") return "concat_fusion";
  if (component.role === "candidate_region") return "candidate_feedback";
  if (component.role === "custom_module" || component.role === "custom_fusion") return "custom_module";
  return "base";
}

function descriptorOrder(left: ComposableRegionVisualDescriptor, right: ComposableRegionVisualDescriptor): number {
  return left.layout.rank - right.layout.rank || left.layout.lane - right.layout.lane || left.layout.order - right.layout.order || compareCodeUnits(left.primitiveId, right.primitiveId);
}

function constraint(constraintId: string, kind: ComposableRegionLayoutConstraint["kind"], subjectIds: readonly string[]): ComposableRegionLayoutConstraint {
  return { constraintId, kind, subjectIds: uniqueSorted([...subjectIds]) };
}

function uniqueSorted(values: readonly string[]): string[] { return [...new Set(values)].sort(compareCodeUnits); }
