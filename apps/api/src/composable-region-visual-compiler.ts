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
  readonly kind: "rank" | "order" | "containment" | "collision_safe_spacing" | "orthogonal_route";
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
  const descriptors = graph.components.map((component) => componentDescriptor(component));
  const groups: ComposableRegionVisualGroup[] = [];
  const constraints: ComposableRegionLayoutConstraint[] = [];
  let semanticOrder = 0;

  for (const region of [...graph.semanticRegions].sort((left, right) => compareCodeUnits(left.regionId, right.regionId))) {
    const regionDescriptors = compileRegion(region, descriptors, componentByNodeId, relationBySourceEdgeId, semanticOrder);
    semanticOrder += regionDescriptors.length + 1;
    for (const descriptor of regionDescriptors) {
      if (!descriptors.some((item) => item.primitiveId === descriptor.primitiveId)) descriptors.push(descriptor);
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
    }
  }

  for (const descriptor of descriptors) {
    constraints.push(
      constraint(`constraint:rank:${descriptor.primitiveId}`, "rank", [descriptor.primitiveId]),
      constraint(`constraint:order:${descriptor.primitiveId}`, "order", [descriptor.primitiveId]),
    );
  }
  for (const relation of graph.relations) constraints.push(constraint(`constraint:route:${relation.relationId}`, "orthogonal_route", [relation.sourceComponentId, relation.targetComponentId]));

  return {
    descriptors: [...descriptors].sort(descriptorOrder),
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
  if (region.kind === "scale_transition") return scaleDescriptors(region, descriptors, relationBySourceEdgeId, semanticOrder);
  if (region.kind === "repeat_group") return existingComponentDescriptors(region, descriptors, componentByNodeId, "RepeatBadge");
  if (region.kind === "add_merge") return existingComponentDescriptors(region, descriptors, componentByNodeId, "AddMarker");
  if (region.kind === "concat_fusion") return existingComponentDescriptors(region, descriptors, componentByNodeId, "ConcatMarker");
  if (region.kind === "token_attention") return attentionDescriptors(region, descriptors, componentByNodeId, semanticOrder);
  if (region.kind === "custom_module") return existingComponentDescriptors(region, descriptors, componentByNodeId, "ModuleFrame");
  return splitDescriptors(region, descriptors, componentByNodeId, semanticOrder);
}

function scaleDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], relations: Map<string, GeneralPublicationRelation>, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  const relation = region.sourceEdgeIds.map((edgeId) => relations.get(edgeId)).find((item): item is GeneralPublicationRelation => item !== undefined);
  const source = relation ? descriptors.find((item) => item.topologyComponentId === relation.sourceComponentId) : undefined;
  const target = relation ? descriptors.find((item) => item.topologyComponentId === relation.targetComponentId) : undefined;
  const result: ComposableRegionVisualDescriptor[] = [];
  if (source && canEnhanceTensor(source.kind)) result.push(upgradeDescriptor(descriptors, source, "TensorStage", "scale_transition"));
  else result.push(semanticVisual(region, "stage", "TensorStage", semanticOrder));
  if (target && canEnhanceTensor(target.kind)) result.push(upgradeDescriptor(descriptors, target, "TensorVolume", "scale_transition"));
  else result.push(semanticVisual(region, "volume", "TensorVolume", semanticOrder + 1));
  return result;
}

function attentionDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], components: Map<string, GeneralPublicationComponent>, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  const component = firstComponent(region, components);
  const current = component ? descriptors.find((item) => item.topologyComponentId === component.componentId) : undefined;
  const result = current ? [upgradeDescriptor(descriptors, current, "AttentionTokenStrip", "token_attention")] : [semanticVisual(region, "tokens", "AttentionTokenStrip", semanticOrder)];
  result.push(semanticVisual(region, "relation", "AttentionRelation", semanticOrder + 1));
  return result;
}

function splitDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], components: Map<string, GeneralPublicationComponent>, semanticOrder: number): ComposableRegionVisualDescriptor[] {
  const component = firstComponent(region, components);
  const current = component ? descriptors.find((item) => item.topologyComponentId === component.componentId) : undefined;
  if (current?.kind === "SplitMarker") return [upgradeDescriptor(descriptors, current, "SplitMarker", "multi_branch")];
  return [semanticVisual(region, "split", "SplitMarker", semanticOrder)];
}

function candidateDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], semanticOrder: number): ComposableRegionVisualDescriptor[] {
  const existing = descriptors.filter((item) => item.kind === "CandidateCallout" && item.sourceEdgeIds.some((edgeId) => region.sourceEdgeIds.includes(edgeId)));
  return existing.length > 0 ? existing.map((item) => upgradeDescriptor(descriptors, item, "CandidateCallout", "candidate_feedback")) : [semanticVisual(region, "callout", "CandidateCallout", semanticOrder)];
}

function existingComponentDescriptors(region: ComposableSemanticRegion, descriptors: ComposableRegionVisualDescriptor[], components: Map<string, GeneralPublicationComponent>, kind: PublicationVisualPrimitiveKind): ComposableRegionVisualDescriptor[] {
  const candidates = [...region.sourceNodeIds].sort(compareCodeUnits)
    .map((nodeId) => components.get(nodeId))
    .filter((item): item is GeneralPublicationComponent => item !== undefined)
    .map((component) => descriptors.find((item) => item.topologyComponentId === component.componentId))
    .filter((item): item is ComposableRegionVisualDescriptor => item !== undefined);
  const current = candidates.find((item) => item.kind === kind) ?? candidates[0];
  return current ? [upgradeDescriptor(descriptors, current, kind, region.kind)] : [];
}

function firstComponent(region: ComposableSemanticRegion, components: Map<string, GeneralPublicationComponent>): GeneralPublicationComponent | undefined {
  return [...region.sourceNodeIds].sort(compareCodeUnits).map((nodeId) => components.get(nodeId)).find((item): item is GeneralPublicationComponent => item !== undefined);
}

function semanticVisual(region: ComposableSemanticRegion, suffix: string, kind: PublicationVisualPrimitiveKind, order: number): ComposableRegionVisualDescriptor {
  const rank = Math.max(0, ...region.sourceNodeIds.map(() => 0));
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
    layout: { rank, lane: 100 + order, order },
  });
}

function upgradeDescriptor(descriptors: ComposableRegionVisualDescriptor[], current: ComposableRegionVisualDescriptor, kind: PublicationVisualPrimitiveKind, regionRole: PublicationVisualRegionRole): ComposableRegionVisualDescriptor {
  const replacement = visual({ ...current, kind, regionRole });
  const index = descriptors.findIndex((item) => item.primitiveId === current.primitiveId);
  if (index < 0) throw new Error(`Visual descriptor is missing: ${current.primitiveId}`);
  descriptors[index] = replacement;
  return replacement;
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

function componentIndex(components: readonly GeneralPublicationComponent[]): Map<string, GeneralPublicationComponent> {
  return new Map(components.flatMap((component) => component.sourceNodeIds.map((nodeId) => [nodeId, component] as const)));
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

function canEnhanceTensor(kind: PublicationVisualPrimitiveKind): boolean {
  return kind === "OperatorFrame" || kind === "ModuleFrame";
}

function descriptorOrder(left: ComposableRegionVisualDescriptor, right: ComposableRegionVisualDescriptor): number {
  return left.layout.rank - right.layout.rank || left.layout.lane - right.layout.lane || left.layout.order - right.layout.order || compareCodeUnits(left.primitiveId, right.primitiveId);
}

function constraint(constraintId: string, kind: ComposableRegionLayoutConstraint["kind"], subjectIds: readonly string[]): ComposableRegionLayoutConstraint {
  return { constraintId, kind, subjectIds: uniqueSorted([...subjectIds]) };
}

function uniqueSorted(values: readonly string[]): string[] { return [...new Set(values)].sort(compareCodeUnits); }
