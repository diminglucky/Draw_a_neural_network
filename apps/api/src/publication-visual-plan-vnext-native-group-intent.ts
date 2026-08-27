import { compareCodeUnits } from "./stable-string-order.js";
import {
  digestPublicationVisualPlanVNext,
  type PlannedVisualModule,
  type PlannedVisualPart,
  type PublicationVisualPlanVNext,
  type VNextBounds,
  type VNextCoordinateSpace,
  type VNextPoint,
} from "./publication-visual-plan-vnext.js";

export const PUBLICATION_VISUAL_PLAN_VNEXT_NATIVE_GROUP_PROTOCOL = "pvp-vnext-native-group-1" as const;

export interface PublicationVisualPlanVNextNativeGroupIntent {
  protocolVersion: typeof PUBLICATION_VISUAL_PLAN_VNEXT_NATIVE_GROUP_PROTOCOL;
  snapshotId: string;
  snapshotHash: string;
  grammarManifestVersion: number;
  coordinateSpace: VNextCoordinateSpace;
  groups: NativeModuleGroup[];
  connectors: NativeGroupConnector[];
  readback: NativeGroupReadbackManifest;
}

export interface NativeModuleGroup {
  groupId: string;
  moduleId: string;
  semanticType: string;
  panelId: string;
  grammarId: string;
  bounds: VNextBounds;
  zIndex: number;
  styleTokenIds: string[];
  sourceNodeIds: string[];
  evidenceIds: string[];
  childShapes: NativeGroupChild[];
  shapeData: Record<string, string>;
}

export interface NativeGroupChild {
  childId: string;
  groupId: string;
  moduleId: string;
  partId: string;
  kind: string;
  role: string;
  label: string;
  bounds: VNextBounds;
  sourcePartIds: string[];
  evidenceIds: string[];
  shapeData: Record<string, string>;
}

export interface NativeGroupConnector {
  connectorId: string;
  relationId: string;
  relationType: string;
  visualRole: string;
  marker: string;
  sourceGroupId: string;
  targetGroupId: string;
  sourcePortId: string;
  targetPortId: string;
  route: VNextPoint[];
  evidenceIds: string[];
  shapeData: Record<string, string>;
}

export interface NativeGroupReadbackManifest {
  groups: NativeGroupReadbackGroup[];
  connectors: NativeGroupReadbackConnector[];
}

export interface NativeGroupReadbackGroup {
  groupId: string;
  moduleId: string;
  childIds: string[];
  children: NativeGroupReadbackChild[];
  requiredShapeDataKeys: string[];
}

export interface NativeGroupReadbackChild {
  childId: string;
  partId: string;
  requiredShapeDataKeys: string[];
}

export interface NativeGroupReadbackConnector {
  connectorId: string;
  relationId: string;
  requiredShapeDataKeys: string[];
}

const GROUP_SHAPE_DATA_KEYS = [
  "pvp-vnext.snapshotId",
  "pvp-vnext.snapshotHash",
  "pvp-vnext.groupId",
  "pvp-vnext.moduleId",
  "pvp-vnext.semanticType",
  "pvp-vnext.panelId",
  "pvp-vnext.grammarId",
  "pvp-vnext.ownership",
  "pvp-vnext.sourceNodeIds",
  "pvp-vnext.evidenceIds",
];
const CHILD_SHAPE_DATA_KEYS = [
  "pvp-vnext.snapshotId",
  "pvp-vnext.snapshotHash",
  "pvp-vnext.groupId",
  "pvp-vnext.childId",
  "pvp-vnext.moduleId",
  "pvp-vnext.partId",
  "pvp-vnext.role",
  "pvp-vnext.ownership",
  "pvp-vnext.sourcePartIds",
  "pvp-vnext.evidenceIds",
];
const CONNECTOR_SHAPE_DATA_KEYS = [
  "pvp-vnext.snapshotId",
  "pvp-vnext.snapshotHash",
  "pvp-vnext.connectorId",
  "pvp-vnext.relationId",
  "pvp-vnext.relationType",
  "pvp-vnext.ownership",
];

export function compilePublicationVisualPlanVNextNativeGroupIntent(snapshot: PublicationVisualPlanVNext): PublicationVisualPlanVNextNativeGroupIntent {
  assertSnapshot(snapshot);
  const moduleById = new Map(snapshot.modules.map((module) => [module.moduleId, module]));
  const groups = snapshot.modules.map((module) => toGroup(snapshot, module));
  const groupIds = new Set(groups.map((group) => group.groupId));
  const connectors = snapshot.relations.map((relation) => {
    const sourceGroupId = `group:${relation.sourceModuleId}`;
    const targetGroupId = `group:${relation.targetModuleId}`;
    if (!groupIds.has(sourceGroupId) || !groupIds.has(targetGroupId)) throw new Error(`Native group relation references missing module: ${relation.relationId}`);
    assertRouteInPage(relation.route, snapshot.coordinateSpace.page, relation.relationId);
    return {
      connectorId: `connector:${relation.relationId}`,
      relationId: relation.relationId,
      relationType: relation.relationType,
      visualRole: relation.visualRole,
      marker: relation.marker,
      sourceGroupId,
      targetGroupId,
      sourcePortId: relation.sourcePortId,
      targetPortId: relation.targetPortId,
      route: relation.route.map((point) => ({ ...point })),
      evidenceIds: [...relation.evidenceIds].sort(compareCodeUnits),
      shapeData: {
        "pvp-vnext.snapshotId": snapshot.identity.snapshotId,
        "pvp-vnext.snapshotHash": snapshot.identity.canonicalHash,
        "pvp-vnext.connectorId": `connector:${relation.relationId}`,
        "pvp-vnext.relationId": relation.relationId,
        "pvp-vnext.relationType": relation.relationType,
        "pvp-vnext.ownership": "agent",
      },
    } satisfies NativeGroupConnector;
  });
  const readback: NativeGroupReadbackManifest = {
    groups: groups.map((group) => ({
      groupId: group.groupId,
      moduleId: group.moduleId,
      childIds: group.childShapes.map((child) => child.childId),
      children: group.childShapes.map((child) => ({
        childId: child.childId,
        partId: child.partId,
        requiredShapeDataKeys: [...CHILD_SHAPE_DATA_KEYS],
      })),
      requiredShapeDataKeys: [...GROUP_SHAPE_DATA_KEYS],
    })),
    connectors: connectors.map((connector) => ({
      connectorId: connector.connectorId,
      relationId: connector.relationId,
      requiredShapeDataKeys: [...CONNECTOR_SHAPE_DATA_KEYS],
    })),
  };
  if (moduleById.size !== groups.length) throw new Error("Native group module IDs are duplicated");
  return deepFreeze({
    protocolVersion: PUBLICATION_VISUAL_PLAN_VNEXT_NATIVE_GROUP_PROTOCOL,
    snapshotId: snapshot.identity.snapshotId,
    snapshotHash: snapshot.identity.canonicalHash,
    grammarManifestVersion: snapshot.grammarManifestVersion,
    coordinateSpace: structuredClone(snapshot.coordinateSpace),
    groups,
    connectors,
    readback,
  });
}

function assertSnapshot(snapshot: PublicationVisualPlanVNext): void {
  if (!snapshot || snapshot.eligibility.kind !== "formal") throw new Error("Native group intent requires formal PVP vNext snapshot");
  if (snapshot.identity.canonicalHash !== digestPublicationVisualPlanVNext(snapshot)) throw new Error("Native group intent snapshot hash is invalid");
  if (snapshot.coordinateSpace.id !== "pvp-vnext-du-1") throw new Error("Native group intent coordinate space is invalid");
  for (const module of snapshot.modules) {
    assertBoundsInPage(module.bounds, snapshot.coordinateSpace.page, module.moduleId);
    for (const part of module.parts) assertBoundsInPage(part.bounds, snapshot.coordinateSpace.page, part.partId);
  }
}

function toGroup(snapshot: PublicationVisualPlanVNext, module: PlannedVisualModule): NativeModuleGroup {
  const groupId = `group:${module.moduleId}`;
  const childShapes = module.parts.map((part) => toChild(snapshot, module, part, groupId));
  return {
    groupId,
    moduleId: module.moduleId,
    semanticType: module.semanticType,
    panelId: module.panelId,
    grammarId: module.visualGrammarId,
    bounds: { ...module.bounds },
    zIndex: module.zIndex,
    styleTokenIds: [...module.styleTokenIds].sort(compareCodeUnits),
    sourceNodeIds: [...module.sourceNodeIds].sort(compareCodeUnits),
    evidenceIds: [...module.evidenceIds].sort(compareCodeUnits),
    childShapes,
    shapeData: {
      "pvp-vnext.snapshotId": snapshot.identity.snapshotId,
      "pvp-vnext.snapshotHash": snapshot.identity.canonicalHash,
      "pvp-vnext.groupId": groupId,
      "pvp-vnext.moduleId": module.moduleId,
      "pvp-vnext.semanticType": module.semanticType,
      "pvp-vnext.panelId": module.panelId,
      "pvp-vnext.grammarId": module.visualGrammarId,
      "pvp-vnext.ownership": "agent",
      "pvp-vnext.sourceNodeIds": module.sourceNodeIds.slice().sort(compareCodeUnits).join(","),
      "pvp-vnext.evidenceIds": module.evidenceIds.slice().sort(compareCodeUnits).join(","),
    },
  };
}

function toChild(snapshot: PublicationVisualPlanVNext, module: PlannedVisualModule, part: PlannedVisualPart, groupId: string): NativeGroupChild {
  const childId = `child:${part.partId}`;
  return {
    childId,
    groupId,
    moduleId: module.moduleId,
    partId: part.partId,
    kind: part.kind,
    role: part.role,
    label: part.label,
    bounds: { ...part.bounds },
    sourcePartIds: [...part.sourcePartIds].sort(compareCodeUnits),
    evidenceIds: [...part.evidenceIds].sort(compareCodeUnits),
    shapeData: {
      "pvp-vnext.snapshotId": snapshot.identity.snapshotId,
      "pvp-vnext.snapshotHash": snapshot.identity.canonicalHash,
      "pvp-vnext.groupId": groupId,
      "pvp-vnext.childId": childId,
      "pvp-vnext.moduleId": module.moduleId,
      "pvp-vnext.partId": part.partId,
      "pvp-vnext.role": part.role,
      "pvp-vnext.ownership": "agent",
      "pvp-vnext.sourcePartIds": part.sourcePartIds.slice().sort(compareCodeUnits).join(","),
      "pvp-vnext.evidenceIds": part.evidenceIds.slice().sort(compareCodeUnits).join(","),
    },
  };
}

function assertBoundsInPage(bounds: VNextBounds, page: VNextBounds, subject: string): void {
  if (bounds.x < page.x || bounds.y < page.y || bounds.width < 0 || bounds.height < 0 || bounds.x + bounds.width > page.x + page.width || bounds.y + bounds.height > page.y + page.height) throw new Error(`Native group bounds are outside page: ${subject}`);
}

function assertRouteInPage(route: readonly VNextPoint[], page: VNextBounds, subject: string): void {
  if (route.length < 2 || route.some((point) => point.x < page.x || point.y < page.y || point.x > page.x + page.width || point.y > page.y + page.height)) throw new Error(`Native group route is outside page: ${subject}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
