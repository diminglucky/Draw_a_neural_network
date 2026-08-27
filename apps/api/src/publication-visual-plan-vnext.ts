import { createHash } from "node:crypto";
import { compareCodeUnits } from "./stable-string-order.js";
import type {
  SemanticArchitectureGraph,
  SemanticDataObject,
  SemanticModule,
  SemanticRelation,
  SemanticRelationType,
  SemanticExportEligibility,
} from "./semantic-visual-module.js";
import type {
  SemanticVisualCompilation,
  VisualModulePart,
  VisualRelationMarker,
  VisualRelationRole,
} from "./semantic-visual-module-compiler.js";
import type { FigureStoryPlan, StoryPanelKind } from "./figure-story-composer.js";

export const PUBLICATION_VISUAL_PLAN_VNEXT_VERSION = 1 as const;

export type VNextOrientation = "landscape" | "portrait";
export type VNextDensity = "compact" | "comfortable" | "detailed";

export interface PublicationVisualPlanVNextInput {
  graph: SemanticArchitectureGraph;
  compilation: SemanticVisualCompilation;
  story: FigureStoryPlan;
  layoutSeed: string;
  layoutIntent: { orientation: VNextOrientation; density: VNextDensity };
}

export interface VNextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VNextPoint {
  x: number;
  y: number;
}

export interface VNextCoordinateSpace {
  id: "pvp-vnext-du-1";
  origin: "top_left";
  axes: "x_right_y_down";
  unit: "du";
  duPerInch: 1000;
  page: VNextBounds;
  safeMargins: VNextBounds;
}

export interface PlannedVisualPanel {
  panelId: string;
  kind: StoryPanelKind;
  purpose: string;
  moduleIds: string[];
  relationIds: string[];
  bounds: VNextBounds;
  zIndex: number;
}

export interface PlannedVisualPart {
  partId: string;
  kind: string;
  role: string;
  label: string;
  bounds: VNextBounds;
  sourcePartIds: string[];
  evidenceIds: string[];
}

export interface PlannedVisualModule {
  moduleId: string;
  semanticType: string;
  visualGrammarId: string;
  panelId: string;
  bounds: VNextBounds;
  zIndex: number;
  styleTokenIds: string[];
  sourceNodeIds: string[];
  evidenceIds: string[];
  parts: PlannedVisualPart[];
  repeat: SemanticModule["repeat"];
  state: SemanticModule["state"];
  condition: SemanticModule["condition"];
  readback: ReadbackManifest;
}

export interface PlannedDataObject {
  dataId: string;
  dataType: string;
  visualRole: string;
  panelId: string;
  bounds: VNextBounds;
  shape: SemanticDataObject["shape"];
  sourceNodeIds: string[];
  evidenceIds: string[];
}

export interface PlannedVisualPort {
  portId: string;
  semanticPortId: string;
  moduleId: string;
  role: string;
  anchor: VNextPoint;
}

export interface PlannedVisualRelation {
  relationId: string;
  relationType: SemanticRelationType;
  visualRole: VisualRelationRole;
  marker: VisualRelationMarker;
  sourceModuleId: string;
  targetModuleId: string;
  sourcePortId: string;
  targetPortId: string;
  sourceAnchor: VNextPoint;
  targetAnchor: VNextPoint;
  route: VNextPoint[];
  evidenceIds: string[];
}

export interface PlannedContainer {
  containerId: string;
  panelId: string;
  kind: "panel";
  label: string;
  bounds: VNextBounds;
  zIndex: number;
}

export interface FigureInsetLink {
  insetId: string;
  sourceModuleId: string;
  panelId: string;
  referenceLabel: string;
  partIds: string[];
}

export interface ProcessTrack {
  trackId: string;
  panelId: string;
  laneId: string;
  moduleIds: string[];
  relationIds: string[];
  axisLabel: string;
  bounds: VNextBounds;
}

export interface FigureLegendEntry {
  legendId: string;
  semanticType: string;
  visualRole: string;
  explanation: string;
}

export interface FigureLegend {
  panelId: string;
  entries: FigureLegendEntry[];
}

export interface SourceMapping {
  visualId: string;
  sourceNodeIds: string[];
  sourceRelationIds: string[];
  evidenceIds: string[];
}

export interface ReadbackManifest {
  ownershipMarker: "pvp-vnext-module";
  moduleId: string;
  semanticType: string;
  panelId: string;
  partIds: string[];
  requiredShapeData: string[];
}

export interface PublicationVisualPlanVNext {
  version: typeof PUBLICATION_VISUAL_PLAN_VNEXT_VERSION;
  identity: { snapshotId: string; canonicalHash: string };
  graphId: string;
  revision: string;
  grammarManifestVersion: number;
  layoutSeed: string;
  layoutIntent: { orientation: VNextOrientation; density: VNextDensity };
  eligibility: {
    kind: Exclude<SemanticExportEligibility, "blocked">;
    formalReasons: string[];
    blockingReasons: string[];
    qaStatus: "pending";
  };
  coordinateSpace: VNextCoordinateSpace;
  panels: PlannedVisualPanel[];
  modules: PlannedVisualModule[];
  dataObjects: PlannedDataObject[];
  ports: PlannedVisualPort[];
  relations: PlannedVisualRelation[];
  containers: PlannedContainer[];
  insets: FigureInsetLink[];
  processTracks: ProcessTrack[];
  legend: FigureLegend;
  diagnostics: FigureStoryPlan["diagnostics"];
  sourceMappings: SourceMapping[];
  rendererRequirements: {
    protocolVersion: "pvp-vnext-1";
    requiredCapabilities: string[];
    optionalCapabilities: string[];
  };
}

const MARGIN = 240;
const PANEL_GAP = 160;
const MODULE_GAP = 120;
const PART_GAP = 24;
const PANEL_WIDTH = 4720;
const PANEL_HEIGHT: Record<StoryPanelKind, number> = {
  overview: 1280,
  detail: 1080,
  process: 720,
  legend: 400,
};

export function compilePublicationVisualPlanVNext(input: PublicationVisualPlanVNextInput): PublicationVisualPlanVNext {
  assertInput(input);
  if (input.graph.exportEligibility === "blocked") throw new Error("PVP vNext refuses blocked graph");

  const modulePanelById = assignModulePanels(input.graph, input.story);
  const panelBounds = createPanelBounds(input.story, input.graph.modules, modulePanelById, input.layoutIntent);
  const moduleBoundsById = placeModules(input.graph.modules, modulePanelById, panelBounds, input.layoutIntent);
  const compilationByModuleId = new Map(input.compilation.modules.map((module) => [module.moduleId, module]));
  const modules = orderedModules(input.graph.modules, input.story.mainPathModuleIds)
    .map((module) => plannedModule(module, modulePanelById.get(module.moduleId)!, moduleBoundsById.get(module.moduleId)!, compilationByModuleId.get(module.moduleId)));
  const dataObjects = planDataObjects(input.graph.dataObjects, panelBounds);
  const ports = planPorts(input.graph.modules, moduleBoundsById);
  const portBySemanticId = new Map(ports.map((port) => [port.semanticPortId, port]));
  const compilationRelations = new Map(input.compilation.relations.map((relation) => [relation.relationId, relation]));
  const relations = input.graph.relations
    .slice()
    .sort((left, right) => compareCodeUnits(left.relationId, right.relationId))
    .map((relation) => plannedRelation(relation, compilationRelations.get(relation.relationId), portBySemanticId));
  const panels = input.story.panels.map((panel, index) => ({
    panelId: panel.panelId,
    kind: panel.kind,
    purpose: panel.purpose,
    moduleIds: [...panel.moduleIds],
    relationIds: [...panel.relationIds],
    bounds: panelBounds.get(panel.panelId)!,
    zIndex: index,
  }));
  const containers = panels.map((panel) => ({
    containerId: "container:" + panel.panelId,
    panelId: panel.panelId,
    kind: "panel" as const,
    label: panel.purpose,
    bounds: panel.bounds,
    zIndex: panel.zIndex,
  })).sort((left, right) => compareCodeUnits(left.containerId, right.containerId));
  const insets = input.story.insets.slice().sort((left, right) => compareCodeUnits(left.insetId, right.insetId)).map((inset) => ({ ...inset, partIds: [...inset.partIds].sort(compareCodeUnits) }));
  const processTracks = input.story.lanes
    .filter((lane) => lane.kind === "process")
    .map((lane) => ({
      trackId: "track:" + lane.laneId,
      panelId: "panel:process",
      laneId: lane.laneId,
      moduleIds: [...lane.moduleIds].sort(compareCodeUnits),
      relationIds: [...lane.relationIds].sort(compareCodeUnits),
      axisLabel: "time / diffusion process",
      bounds: panelBounds.get("panel:process")!,
    }));
  const snapshotWithoutHash = {
    version: PUBLICATION_VISUAL_PLAN_VNEXT_VERSION,
    identity: { snapshotId: `pvp-vnext:${input.graph.graphId}:${input.graph.revision}:${input.layoutSeed}`, canonicalHash: "" },
    graphId: input.graph.graphId,
    revision: input.graph.revision,
    grammarManifestVersion: input.compilation.version,
    layoutSeed: input.layoutSeed,
    layoutIntent: { ...input.layoutIntent },
    eligibility: eligibilityFor(input.graph.exportEligibility),
    coordinateSpace: coordinateSpaceFor(panelBounds),
    panels,
    modules,
    dataObjects,
    ports,
    relations,
    containers,
    insets,
    processTracks,
    legend: { panelId: "panel:legend", entries: input.story.legend.map((entry) => ({ ...entry })) },
    diagnostics: input.story.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    sourceMappings: createSourceMappings(input.graph, modules, dataObjects, relations),
    rendererRequirements: {
      protocolVersion: "pvp-vnext-1" as const,
      requiredCapabilities: ["group-readback", "native-group", "native-text", "orthogonal-route", "shape-data"],
      optionalCapabilities: ["native-3d-face", "native-ellipsis"],
    },
  } satisfies Omit<PublicationVisualPlanVNext, "identity"> & { identity: { snapshotId: string; canonicalHash: string } };
  const canonicalHash = sha256(canonicalJson(snapshotWithoutHash));
  return deepFreeze({ ...snapshotWithoutHash, identity: { ...snapshotWithoutHash.identity, canonicalHash } });
}

export function canonicalPublicationVisualPlanVNextJson(snapshot: PublicationVisualPlanVNext): string {
  const withoutHash = structuredClone(snapshot);
  withoutHash.identity.canonicalHash = "";
  return canonicalJson(withoutHash);
}

export function digestPublicationVisualPlanVNext(snapshot: PublicationVisualPlanVNext): string {
  return sha256(canonicalPublicationVisualPlanVNextJson(snapshot));
}

function assertInput(input: PublicationVisualPlanVNextInput): void {
  if (input.graph.graphId !== input.compilation.graphId || input.graph.graphId !== input.story.graphId) throw new Error("PVP vNext graph IDs must match");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.layoutSeed)) throw new Error("PVP vNext layoutSeed must be a non-empty stable identifier");
  if (input.graph.exportEligibility !== input.compilation.exportEligibility || input.graph.exportEligibility !== input.story.exportEligibility) throw new Error("PVP vNext eligibility must match semantic inputs");
}

function createPanelBounds(
  story: FigureStoryPlan,
  modules: readonly SemanticModule[],
  panelByModule: ReadonlyMap<string, string>,
  intent: PublicationVisualPlanVNextInput["layoutIntent"],
): Map<string, VNextBounds> {
  const result = new Map<string, VNextBounds>();
  const moduleWidth = intent.density === "compact" ? 620 : intent.density === "detailed" ? 820 : 720;
  const moduleHeight = intent.density === "compact" ? 220 : intent.density === "detailed" ? 320 : 270;
  const columns = intent.orientation === "portrait" ? 2 : Math.max(1, Math.floor((PANEL_WIDTH - 200 + MODULE_GAP) / (moduleWidth + MODULE_GAP)));
  let y = MARGIN;
  for (const panel of story.panels) {
    const moduleCount = modules.filter((module) => panelByModule.get(module.moduleId) === panel.panelId).length;
    const rows = Math.max(1, Math.ceil(moduleCount / columns));
    const contentHeight = 260 + rows * moduleHeight + Math.max(0, rows - 1) * 120;
    const bounds = { x: MARGIN, y, width: PANEL_WIDTH, height: Math.max(PANEL_HEIGHT[panel.kind], contentHeight) };
    result.set(panel.panelId, bounds);
    y += bounds.height + PANEL_GAP;
  }
  return result;
}

function assignModulePanels(graph: SemanticArchitectureGraph, story: FigureStoryPlan): Map<string, string> {
  const main = new Set(story.mainPathModuleIds);
  const detail = new Set(story.panels.find((panel) => panel.kind === "detail")?.moduleIds ?? []);
  const process = new Set(story.lanes.find((lane) => lane.kind === "process")?.moduleIds ?? []);
  const result = new Map<string, string>();
  for (const module of graph.modules) {
    if (main.has(module.moduleId)) result.set(module.moduleId, "panel:overview");
    else if (process.has(module.moduleId)) result.set(module.moduleId, "panel:process");
    else if (detail.has(module.moduleId)) result.set(module.moduleId, "panel:detail");
    else result.set(module.moduleId, module.layoutIntent.preferredPanel === "process" ? "panel:process" : "panel:detail");
  }
  return result;
}

function orderedModules(modules: readonly SemanticModule[], mainPath: readonly string[]): SemanticModule[] {
  const byId = new Map(modules.map((module) => [module.moduleId, module]));
  const pathModules = mainPath.flatMap((moduleId) => {
    const module = byId.get(moduleId);
    return module ? [module] : [];
  });
  const pathIds = new Set(pathModules.map((module) => module.moduleId));
  const auxiliary = modules.filter((module) => !pathIds.has(module.moduleId)).sort((left, right) => compareCodeUnits(left.moduleId, right.moduleId));
  return [...pathModules, ...auxiliary];
}

function placeModules(
  modules: readonly SemanticModule[],
  panelByModule: ReadonlyMap<string, string>,
  panelBounds: ReadonlyMap<string, VNextBounds>,
  intent: PublicationVisualPlanVNextInput["layoutIntent"],
): Map<string, VNextBounds> {
  const result = new Map<string, VNextBounds>();
  const width = intent.density === "compact" ? 620 : intent.density === "detailed" ? 820 : 720;
  const height = intent.density === "compact" ? 220 : intent.density === "detailed" ? 320 : 270;
  const groups = new Map<string, SemanticModule[]>();
  for (const module of modules) groups.set(panelByModule.get(module.moduleId)!, [...(groups.get(panelByModule.get(module.moduleId)!) ?? []), module]);
  for (const [panelId, values] of groups) {
    const panel = panelBounds.get(panelId);
    if (!panel) throw new Error(`PVP vNext module panel is missing: ${panelId}`);
    const ordered = values.slice().sort((left, right) => moduleOrder(left.moduleId, right.moduleId, panelId));
    const columns = intent.orientation === "portrait" ? 2 : Math.max(1, Math.floor((panel.width - 200 + MODULE_GAP) / (width + MODULE_GAP)));
    ordered.forEach((module, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      result.set(module.moduleId, {
        x: panel.x + 100 + column * (width + MODULE_GAP),
        y: panel.y + 180 + row * (height + 120),
        width,
        height,
      });
    });
  }
  return result;
}

function moduleOrder(left: string, right: string, panelId: string): number {
  if (panelId === "panel:overview") return compareCodeUnits(left, right);
  return compareCodeUnits(left, right);
}

function plannedModule(module: SemanticModule, panelId: string, bounds: VNextBounds, visual: SemanticVisualCompilation["modules"][number] | undefined): PlannedVisualModule {
  if (!visual) throw new Error(`PVP vNext visual compilation is missing module: ${module.moduleId}`);
  const sourceParts = visual.parts.slice().sort((left, right) => compareCodeUnits(left.partId, right.partId));
  const columns = Math.min(4, Math.max(1, sourceParts.length));
  const partWidth = Math.floor((bounds.width - 80 - (columns - 1) * PART_GAP) / columns);
  const partHeight = Math.min(82, Math.floor((bounds.height - 100) / Math.max(1, Math.ceil(sourceParts.length / columns)) - PART_GAP));
  const parts = sourceParts.map((part, index) => ({
    partId: part.partId,
    kind: part.kind,
    role: part.role,
    label: part.label,
    bounds: {
      x: bounds.x + 40 + (index % columns) * (partWidth + PART_GAP),
      y: bounds.y + 60 + Math.floor(index / columns) * (partHeight + PART_GAP),
      width: partWidth,
      height: partHeight,
    },
    sourcePartIds: [...part.sourcePartIds].sort(compareCodeUnits),
    evidenceIds: [...part.evidenceIds].sort(compareCodeUnits),
  }));
  return {
    moduleId: module.moduleId,
    semanticType: module.semanticType,
    visualGrammarId: visual.visualGrammarId,
    panelId,
    bounds,
    zIndex: 10,
    styleTokenIds: [`style:module:${module.semanticType}`],
    sourceNodeIds: [...module.sourceNodeIds].sort(compareCodeUnits),
    evidenceIds: [...module.evidenceIds].sort(compareCodeUnits),
    parts,
    repeat: module.repeat ? structuredClone(module.repeat) : null,
    state: module.state ? structuredClone(module.state) : null,
    condition: module.condition ? structuredClone(module.condition) : null,
    readback: {
      ownershipMarker: "pvp-vnext-module",
      moduleId: module.moduleId,
      semanticType: module.semanticType,
      panelId,
      partIds: parts.map((part) => part.partId),
      requiredShapeData: ["moduleId", "semanticType", "panelId", "sourceNodeIds", "evidenceIds", "grammarId", "ownershipMarker"],
    },
  };
}

function planDataObjects(dataObjects: readonly SemanticDataObject[], panelBounds: ReadonlyMap<string, VNextBounds>): PlannedDataObject[] {
  const panel = panelBounds.get("panel:overview");
  if (!panel) throw new Error("PVP vNext requires an overview panel");
  return dataObjects.slice().sort((left, right) => compareCodeUnits(left.dataId, right.dataId)).map((data, index) => ({
    dataId: data.dataId,
    dataType: data.dataType,
    visualRole: data.visualRole,
    panelId: "panel:overview",
    bounds: { x: panel.x + 100 + index * 460, y: panel.y + 40, width: 360, height: 80 },
    shape: data.shape ? structuredClone(data.shape) : null,
    sourceNodeIds: [...data.sourceNodeIds].sort(compareCodeUnits),
    evidenceIds: [...data.evidenceIds].sort(compareCodeUnits),
  }));
}

function planPorts(modules: readonly SemanticModule[], boundsByModuleId: ReadonlyMap<string, VNextBounds>): PlannedVisualPort[] {
  const ports: PlannedVisualPort[] = [];
  for (const module of modules.slice().sort((left, right) => compareCodeUnits(left.moduleId, right.moduleId))) {
    const bounds = boundsByModuleId.get(module.moduleId);
    if (!bounds) throw new Error(`PVP vNext module bounds are missing: ${module.moduleId}`);
    const inputs = module.inputs.slice().sort((left, right) => compareCodeUnits(left.portId, right.portId));
    const outputs = module.outputs.slice().sort((left, right) => compareCodeUnits(left.portId, right.portId));
    inputs.forEach((port, index) => ports.push({ portId: `port:${module.moduleId}:${port.portId}`, semanticPortId: port.portId, moduleId: module.moduleId, role: port.role, anchor: { x: bounds.x, y: Math.round(bounds.y + bounds.height * (index + 1) / (inputs.length + 1)) } }));
    outputs.forEach((port, index) => ports.push({ portId: `port:${module.moduleId}:${port.portId}`, semanticPortId: port.portId, moduleId: module.moduleId, role: port.role, anchor: { x: bounds.x + bounds.width, y: Math.round(bounds.y + bounds.height * (index + 1) / (outputs.length + 1)) } }));
  }
  return ports.sort((left, right) => compareCodeUnits(left.portId, right.portId));
}

function plannedRelation(relation: SemanticRelation, visual: SemanticVisualCompilation["relations"][number] | undefined, portBySemanticId: ReadonlyMap<string, PlannedVisualPort>): PlannedVisualRelation {
  if (!visual) throw new Error(`PVP vNext visual compilation is missing relation: ${relation.relationId}`);
  const source = portBySemanticId.get(relation.source.portId);
  const target = portBySemanticId.get(relation.target.portId);
  if (!source || !target) throw new Error(`PVP vNext relation ports are missing: ${relation.relationId}`);
  return {
    relationId: relation.relationId,
    relationType: relation.type,
    visualRole: visual.visualRole,
    marker: visual.marker,
    sourceModuleId: relation.source.moduleId,
    targetModuleId: relation.target.moduleId,
    sourcePortId: source.portId,
    targetPortId: target.portId,
    sourceAnchor: source.anchor,
    targetAnchor: target.anchor,
    route: orthogonalRoute(source.anchor, target.anchor),
    evidenceIds: [...relation.evidenceIds].sort(compareCodeUnits),
  };
}

function orthogonalRoute(source: VNextPoint, target: VNextPoint): VNextPoint[] {
  if (source.x <= target.x) return [{ ...source }, { ...target }];
  const middleX = Math.round((source.x + target.x) / 2);
  return [{ ...source }, { x: middleX, y: source.y }, { x: middleX, y: target.y }, { ...target }];
}

function coordinateSpaceFor(panelBounds: ReadonlyMap<string, VNextBounds>): VNextCoordinateSpace {
  const values = [...panelBounds.values()];
  const right = Math.max(...values.map((bounds) => bounds.x + bounds.width)) + MARGIN;
  const bottom = Math.max(...values.map((bounds) => bounds.y + bounds.height)) + MARGIN;
  const page = { x: 0, y: 0, width: right, height: bottom };
  return { id: "pvp-vnext-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page, safeMargins: { x: MARGIN, y: MARGIN, width: page.width - MARGIN * 2, height: page.height - MARGIN * 2 } };
}

function eligibilityFor(value: SemanticExportEligibility): PublicationVisualPlanVNext["eligibility"] {
  if (value === "blocked") throw new Error("PVP vNext refuses blocked graph");
  if (value === "candidate") return { kind: "candidate", formalReasons: [], blockingReasons: ["candidate-structure"], qaStatus: "pending" };
  return { kind: "formal", formalReasons: ["semantic-story-compiled"], blockingReasons: [], qaStatus: "pending" };
}

function createSourceMappings(graph: SemanticArchitectureGraph, modules: readonly PlannedVisualModule[], dataObjects: readonly PlannedDataObject[], relations: readonly PlannedVisualRelation[]): SourceMapping[] {
  const sourceNodesByModuleId = new Map(graph.modules.map((module) => [module.moduleId, module.sourceNodeIds]));
  const moduleMappings = modules.map((module) => ({ visualId: `module:${module.moduleId}`, sourceNodeIds: [...module.sourceNodeIds], sourceRelationIds: [], evidenceIds: [...module.evidenceIds] }));
  const dataMappings = dataObjects.map((data) => ({ visualId: `data:${data.dataId}`, sourceNodeIds: [...data.sourceNodeIds], sourceRelationIds: [], evidenceIds: [...data.evidenceIds] }));
  const relationMappings = relations.map((relation) => ({
    visualId: `relation:${relation.relationId}`,
    sourceNodeIds: [...new Set([
      ...(sourceNodesByModuleId.get(relation.sourceModuleId) ?? []),
      ...(sourceNodesByModuleId.get(relation.targetModuleId) ?? []),
    ])].sort(compareCodeUnits),
    sourceRelationIds: [relation.relationId],
    evidenceIds: [...relation.evidenceIds],
  }));
  return [...moduleMappings, ...dataMappings, ...relationMappings].sort((left, right) => compareCodeUnits(left.visualId, right.visualId));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PVP vNext canonical JSON does not permit non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") throw new Error("PVP vNext canonical JSON accepts only JSON values");
  return Object.fromEntries(Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
