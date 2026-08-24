import { type GeneralPublicationGraph } from "./general-publication-graph.js";
import { type ComposableSemanticRegionKind } from "./composable-semantic-regions.js";
import { PUBLICATION_VISUAL_PRIMITIVE_KINDS } from "./publication-visual-grammar.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";

type PreviewRecord = Record<string, unknown>;
type PreviewBounds = { x: number; y: number; width: number; height: number };
type PreviewPoint = { x: number; y: number };
type PreviewLayoutOrder = { componentId: string; rank: number; order: number };

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,191}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_COLLECTION_ITEMS = 1_000;
const MAX_COORDINATE = 1_000_000;
const MAX_DISPLAY_TEXT_LENGTH = 512;
const MAX_STYLE_TEXT_LENGTH = 256;
const DETAILS = ["overview", "architecture", "operator_detail"] as const;
const COMPONENT_ROLES = ["input", "output", "generic_module", "custom_operator", "custom_module", "split", "merge_add", "merge_concat", "custom_fusion", "repeat_badge", "candidate_region"] as const;
const RELATION_ROLES = ["flow", "skip", "merge", "condition", "feedback"] as const;
const SEMANTIC_REGION_KINDS = ["scale_transition", "repeat_group", "add_merge", "concat_fusion", "token_attention", "custom_module", "multi_branch", "candidate_feedback"] as const satisfies readonly ComposableSemanticRegionKind[];
const PRIMITIVE_KINDS = [...PUBLICATION_VISUAL_PRIMITIVE_KINDS, "Input", "Output", "GenericModule", "CustomOperator", "CustomModule", "Split", "MergeAdd", "MergeConcat", "CustomFusion", "CandidateRegion"] as const;
const ANNOTATION_ROLES = ["note", "heading", "detail"] as const;
const LEGEND_KINDS = ["swatch", "line", "shape"] as const;
const STYLE_VALUE_KEYS = ["fill", "stroke", "strokeWidth", "strokeDasharray", "opacity", "color", "fontFamily", "fontSize", "fontWeight"] as const;

export interface PublicationVisualPlanPreview {
  schemaVersion: 1;
  kind: "formal" | "candidate";
  exportEligible: boolean;
  plan: {
    identity: { schemaVersion: 1; planId: string; canonicalHash: string };
    eligibility: { kind: "formal" | "candidate"; formalReasons: string[]; blockingReasons: string[]; qaStatus: "pending" | "passed" };
    coordinateSpace: PreviewRecord;
    regions: PreviewRecord[];
    primitiveGroups: PreviewRecord[];
    primitives: PreviewRecord[];
    ports: PreviewRecord[];
    connectors: PreviewRecord[];
    annotations: PreviewRecord[];
    legend: PreviewRecord;
    styleTokens: PreviewRecord;
    profileApplications: PreviewRecord[];
  };
  graph: {
    version: 1;
    graphId: string;
    detail: "overview" | "architecture" | "operator_detail";
    exportEligibility: "eligible" | "ineligible";
    components: Array<{ componentId: string; role: string; label: string; count?: number; layoutOrder: { rank: number; order: number } }>;
    relations: Array<{ relationId: string; role: string; sourceComponentId: string; targetComponentId: string }>;
    semanticRegions: PublicSemanticRegionSummary[];
    layoutOrder: PreviewLayoutOrder[];
  };
}

/** The only semantic-region representation that crosses the public preview boundary. */
export interface PublicSemanticRegionSummary {
  regionId: string;
  kind: ComposableSemanticRegionKind;
  label: string;
  state: "formal" | "candidate";
}

/** Rebuilds a detached public DTO and rejects malformed or extended v1 records. */
export function projectPublicationVisualPlanPreview(input: {
  graph: GeneralPublicationGraph;
  pvp: PublicationVisualPlan;
}): PublicationVisualPlanPreview {
  const plan = parsePublicationVisualPlan(input.pvp);
  const graph = projectGraph(input.graph);
  const planProjection = projectPlan(plan);
  if (planProjection.identity.planId !== `pvp:${graph.graphId}:${graph.detail}`) throw new Error("PVP and graph identity are incoherent");
  if (planProjection.eligibility.kind === "formal" && graph.exportEligibility !== "eligible") throw new Error("Formal PVP requires an eligible graph");
  if (planProjection.eligibility.kind === "candidate" && graph.exportEligibility !== "ineligible") throw new Error("Candidate PVP requires an ineligible graph");

  return {
    schemaVersion: 1,
    kind: planProjection.eligibility.kind,
    exportEligible: planProjection.eligibility.kind === "formal" && planProjection.eligibility.qaStatus === "passed" && graph.exportEligibility === "eligible",
    plan: planProjection,
    graph,
  };
}

function projectPlan(plan: PublicationVisualPlan): PublicationVisualPlanPreview["plan"] {
  const identity = exactRecord(plan.identity, ["schemaVersion", "planId", "canonicalHash"], "PVP identity");
  const eligibility = exactRecord(plan.eligibility, ["kind", "formalReasons", "blockingReasons", "qaStatus"], "PVP eligibility");
  const coordinateSpace = exactRecord(plan.coordinateSpace, ["id", "origin", "axes", "unit", "duPerInch", "page", "safeMargins"], "PVP coordinateSpace");
  if (own(identity, "schemaVersion", "PVP identity") !== 1 || own(coordinateSpace, "id", "PVP coordinateSpace") !== "pvp-du-1" || own(coordinateSpace, "origin", "PVP coordinateSpace") !== "top_left" || own(coordinateSpace, "axes", "PVP coordinateSpace") !== "x_right_y_down" || own(coordinateSpace, "unit", "PVP coordinateSpace") !== "du" || own(coordinateSpace, "duPerInch", "PVP coordinateSpace") !== 1000) throw new Error("PVP coordinateSpace is invalid");
  const kind = enumValue(own(eligibility, "kind", "PVP eligibility"), ["formal", "candidate"], "PVP eligibility kind");
  const qaStatus = enumValue(own(eligibility, "qaStatus", "PVP eligibility"), ["pending", "passed"], "PVP QA status");
  return {
    identity: { schemaVersion: 1, planId: identifier(own(identity, "planId", "PVP identity"), "PVP plan ID"), canonicalHash: digest(own(identity, "canonicalHash", "PVP identity"), "PVP canonical hash") },
    eligibility: { kind, formalReasons: tokens(own(eligibility, "formalReasons", "PVP eligibility"), "PVP formal reasons"), blockingReasons: tokens(own(eligibility, "blockingReasons", "PVP eligibility"), "PVP blocking reasons"), qaStatus },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: bounds(own(coordinateSpace, "page", "PVP coordinateSpace"), "PVP page"), safeMargins: bounds(own(coordinateSpace, "safeMargins", "PVP coordinateSpace"), "PVP safeMargins") },
    regions: array(own(plan as PreviewRecord, "regions", "PVP"), "PVP regions").map(projectRegion),
    primitiveGroups: array(own(plan as PreviewRecord, "primitiveGroups", "PVP"), "PVP primitive groups").map(projectPrimitiveGroup),
    primitives: array(own(plan as PreviewRecord, "primitives", "PVP"), "PVP primitives").map(projectPrimitive),
    ports: array(own(plan as PreviewRecord, "ports", "PVP"), "PVP ports").map(projectPort),
    connectors: array(own(plan as PreviewRecord, "connectors", "PVP"), "PVP connectors").map(projectConnector),
    annotations: array(own(plan as PreviewRecord, "annotations", "PVP"), "PVP annotations").map(projectAnnotation),
    legend: projectLegend(own(plan as PreviewRecord, "legend", "PVP")),
    styleTokens: projectStyleTokens(own(plan as PreviewRecord, "styleTokens", "PVP")),
    profileApplications: array(own(plan as PreviewRecord, "profileApplications", "PVP"), "PVP profile applications").map(projectProfileApplication),
  };
}

function projectRegion(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["regionId", "bounds", "role", "zIndex"], "PVP region");
  return { regionId: identifier(own(item, "regionId", "PVP region"), "PVP region ID"), bounds: bounds(own(item, "bounds", "PVP region"), "PVP region bounds"), role: enumValue(own(item, "role", "PVP region"), ["main"], "PVP region role"), zIndex: index(own(item, "zIndex", "PVP region"), "PVP region zIndex") };
}

function projectPrimitiveGroup(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["groupId", "regionId", "semanticRegionId", "label", "zIndex", "primitiveIds", "styleTokenIds"], "PVP primitive group", true);
  const projection = { groupId: identifier(own(item, "groupId", "PVP primitive group"), "PVP group ID"), regionId: identifier(own(item, "regionId", "PVP primitive group"), "PVP group region ID"), label: displayText(own(item, "label", "PVP primitive group"), "PVP group label"), zIndex: index(own(item, "zIndex", "PVP primitive group"), "PVP group zIndex"), primitiveIds: identifiers(own(item, "primitiveIds", "PVP group primitive IDs"), "PVP group primitive IDs"), styleTokenIds: identifiers(own(item, "styleTokenIds", "PVP group style token IDs"), "PVP group style token IDs") };
  return Object.hasOwn(item, "semanticRegionId") ? { ...projection, semanticRegionId: identifier(own(item, "semanticRegionId", "PVP primitive group"), "PVP group semantic region ID") } : projection;
}

function projectPrimitive(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["primitiveId", "componentId", "kind", "regionId", "bounds", "zIndex", "styleTokenIds", "label", "visual"], "PVP primitive", true);
  const kind = enumValue(own(item, "kind", "PVP primitive"), PRIMITIVE_KINDS, "PVP primitive kind");
  const projection = { primitiveId: identifier(own(item, "primitiveId", "PVP primitive"), "PVP primitive ID"), componentId: identifier(own(item, "componentId", "PVP primitive"), "PVP component ID"), kind, regionId: identifier(own(item, "regionId", "PVP primitive"), "PVP primitive region ID"), bounds: bounds(own(item, "bounds", "PVP primitive"), "PVP primitive bounds"), zIndex: index(own(item, "zIndex", "PVP primitive"), "PVP primitive zIndex"), styleTokenIds: identifiers(own(item, "styleTokenIds", "PVP primitive"), "PVP primitive style token IDs"), label: displayText(own(item, "label", "PVP primitive"), "PVP primitive label") };
  return Object.hasOwn(item, "visual") ? { ...projection, visual: projectVisual(own(item, "visual", "PVP primitive"), kind) } : projection;
}

function projectVisual(value: unknown, kind: string): PreviewRecord {
  const visual = exactRecord(value, ["regionRole", "nativeSupport", "geometry"], "PVP primitive visual");
  const geometry = exactRecord(own(visual, "geometry", "PVP primitive visual"), kind === "TensorVolume" ? ["kind", "frontFace", "depthFace"] : kind === "AttentionTokenStrip" ? ["kind", "orderedCells"] : ["kind"], "PVP primitive geometry");
  const projection: PreviewRecord = { regionRole: enumValue(own(visual, "regionRole", "PVP primitive visual"), ["base", ...SEMANTIC_REGION_KINDS], "PVP primitive visual role"), nativeSupport: enumValue(own(visual, "nativeSupport", "PVP primitive visual"), ["supported", "restricted"], "PVP primitive native support") };
  if (kind === "TensorVolume") return { ...projection, geometry: { kind: enumValue(own(geometry, "kind", "PVP tensor geometry"), ["tensor_volume"], "PVP tensor geometry kind"), frontFace: array(own(geometry, "frontFace", "PVP tensor geometry"), "PVP tensor face").map((point) => pointValue(point, "PVP tensor face")), depthFace: array(own(geometry, "depthFace", "PVP tensor geometry"), "PVP tensor face").map((point) => pointValue(point, "PVP tensor face")) } };
  if (kind === "AttentionTokenStrip") return { ...projection, geometry: { kind: enumValue(own(geometry, "kind", "PVP token geometry"), ["ordered_cells"], "PVP token geometry kind"), orderedCells: array(own(geometry, "orderedCells", "PVP token geometry"), "PVP token cells").map((cell) => { const item = exactRecord(cell, ["cellId", "order", "bounds"], "PVP token cell"); return { cellId: identifier(own(item, "cellId", "PVP token cell"), "PVP token cell ID"), order: index(own(item, "order", "PVP token cell"), "PVP token cell order"), bounds: bounds(own(item, "bounds", "PVP token cell"), "PVP token cell bounds") }; }) } };
  return { ...projection, geometry: { kind: enumValue(own(geometry, "kind", "PVP primitive geometry"), ["none"], "PVP primitive geometry kind") } };
}

function projectPort(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["portId", "primitiveId", "role", "anchor", "order", "semanticPortId"], "PVP port");
  const anchor = exactRecord(own(item, "anchor", "PVP port"), ["side", "offset"], "PVP port anchor");
  return { portId: identifier(own(item, "portId", "PVP port"), "PVP port ID"), primitiveId: identifier(own(item, "primitiveId", "PVP port"), "PVP port primitive ID"), role: enumValue(own(item, "role", "PVP port"), ["input", "output"], "PVP port role"), anchor: { side: enumValue(own(anchor, "side", "PVP port anchor"), ["left", "right", "top", "bottom"], "PVP port side"), offset: offset(own(anchor, "offset", "PVP port anchor"), "PVP port offset") }, order: index(own(item, "order", "PVP port"), "PVP port order"), semanticPortId: identifier(own(item, "semanticPortId", "PVP port"), "PVP semantic port ID") };
}

function projectConnector(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["connectorId", "sourcePortId", "targetPortId", "relation", "route", "styleTokenIds", "zIndex"], "PVP connector");
  const route = array(own(item, "route", "PVP connector"), "PVP connector route");
  if (route.length < 2) throw new Error("PVP connector route is invalid");
  return { connectorId: identifier(own(item, "connectorId", "PVP connector"), "PVP connector ID"), sourcePortId: identifier(own(item, "sourcePortId", "PVP connector"), "PVP connector source port ID"), targetPortId: identifier(own(item, "targetPortId", "PVP connector"), "PVP connector target port ID"), relation: enumValue(own(item, "relation", "PVP connector"), RELATION_ROLES, "PVP connector relation"), route: route.map((point) => pointValue(point, "PVP connector route point")), styleTokenIds: identifiers(own(item, "styleTokenIds", "PVP connector"), "PVP connector style token IDs"), zIndex: index(own(item, "zIndex", "PVP connector"), "PVP connector zIndex") };
}

function projectAnnotation(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["annotationId", "targetIds", "bounds", "text", "role", "styleTokenIds"], "PVP annotation");
  return { annotationId: identifier(own(item, "annotationId", "PVP annotation"), "PVP annotation ID"), targetIds: identifiers(own(item, "targetIds", "PVP annotation"), "PVP annotation target IDs"), bounds: bounds(own(item, "bounds", "PVP annotation"), "PVP annotation bounds"), text: displayText(own(item, "text", "PVP annotation"), "PVP annotation text"), role: enumValue(own(item, "role", "PVP annotation"), ANNOTATION_ROLES, "PVP annotation role"), styleTokenIds: identifiers(own(item, "styleTokenIds", "PVP annotation"), "PVP annotation style token IDs") };
}

function projectLegend(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["entries", "styleTokenIds"], "PVP legend");
  return { entries: array(own(item, "entries", "PVP legend"), "PVP legend entries").map((entry) => {
    const legend = exactRecord(entry, ["legendId", "label", "kind", "targetIds", "styleTokenIds"], "PVP legend entry");
    return { legendId: identifier(own(legend, "legendId", "PVP legend entry"), "PVP legend ID"), label: displayText(own(legend, "label", "PVP legend entry"), "PVP legend label"), kind: enumValue(own(legend, "kind", "PVP legend entry"), LEGEND_KINDS, "PVP legend kind"), targetIds: identifiers(own(legend, "targetIds", "PVP legend entry"), "PVP legend target IDs"), styleTokenIds: identifiers(own(legend, "styleTokenIds", "PVP legend entry"), "PVP legend style token IDs") };
  }), styleTokenIds: identifiers(own(item, "styleTokenIds", "PVP legend"), "PVP legend style token IDs") };
}

function projectStyleTokens(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["tokenSetVersion", "tokens"], "PVP style tokens");
  if (own(item, "tokenSetVersion", "PVP style tokens") !== "pvp-style-1") throw new Error("PVP style token version is invalid");
  return { tokenSetVersion: "pvp-style-1", tokens: array(own(item, "tokens", "PVP style tokens"), "PVP style tokens").map((token) => {
    const styleToken = exactRecord(token, ["tokenId", "values"], "PVP style token");
    const values = exactRecord(own(styleToken, "values", "PVP style token"), STYLE_VALUE_KEYS, "PVP style values", true);
    return { tokenId: identifier(own(styleToken, "tokenId", "PVP style token"), "PVP style token ID"), values: Object.fromEntries(Object.keys(values).map((key) => [key, styleValue(own(values, key, "PVP style values"), `PVP style ${key}`)])) };
  }) };
}

function projectProfileApplication(value: unknown): PreviewRecord {
  const item = exactRecord(value, ["applicationId", "profileId", "profileVersion", "inputHash", "outputHash", "affectedIds"], "PVP profile application");
  return { applicationId: identifier(own(item, "applicationId", "PVP profile application"), "PVP profile application ID"), profileId: identifier(own(item, "profileId", "PVP profile application"), "PVP profile ID"), profileVersion: token(own(item, "profileVersion", "PVP profile application"), "PVP profile version"), inputHash: digest(own(item, "inputHash", "PVP profile application"), "PVP profile input hash"), outputHash: digest(own(item, "outputHash", "PVP profile application"), "PVP profile output hash"), affectedIds: identifiers(own(item, "affectedIds", "PVP profile application"), "PVP profile affected IDs") };
}

function projectGraph(value: unknown): PublicationVisualPlanPreview["graph"] {
  const graph = exactRecord(value, ["version", "graphId", "detail", "exportEligibility", "components", "relations", "semanticRegions", "sourceMappings", "layoutOrder"], "General Publication Graph");
  if (own(graph, "version", "General Publication Graph") !== 1) throw new Error("General Publication Graph version is invalid");
  const components = array(own(graph, "components", "General Publication Graph"), "General Publication Graph components").map(projectComponent);
  const relations = array(own(graph, "relations", "General Publication Graph"), "General Publication Graph relations").map(projectRelation);
  const semanticRegions = array(own(graph, "semanticRegions", "General Publication Graph"), "General Publication Graph semantic regions").map(projectSemanticRegion);
  const layoutOrder = array(own(graph, "layoutOrder", "General Publication Graph"), "General Publication Graph layout order").map(projectLayoutOrder);
  const componentIds = new Set(components.map((component) => component.componentId));
  if (componentIds.size !== components.length || layoutOrder.length !== components.length || new Set(layoutOrder.map((item) => item.componentId)).size !== layoutOrder.length || layoutOrder.some((item) => !componentIds.has(item.componentId))) throw new Error("General Publication Graph component layout is invalid");
  for (const component of components) {
    const layout = layoutOrder.find((item) => item.componentId === component.componentId);
    if (!layout || layout.rank !== component.layoutOrder.rank || layout.order !== component.layoutOrder.order) throw new Error("General Publication Graph layout order is incoherent");
  }
  if (new Set(relations.map((relation) => relation.relationId)).size !== relations.length || relations.some((relation) => !componentIds.has(relation.sourceComponentId) || !componentIds.has(relation.targetComponentId) || relation.sourceComponentId === relation.targetComponentId)) throw new Error("General Publication Graph relations are invalid");
  if (new Set(semanticRegions.map((region) => region.regionId)).size !== semanticRegions.length) throw new Error("General Publication Graph semantic regions are invalid");
  validateIgnoredSourceMappings(own(graph, "sourceMappings", "General Publication Graph"), componentIds);
  return { version: 1, graphId: identifier(own(graph, "graphId", "General Publication Graph"), "General Publication Graph ID"), detail: enumValue(own(graph, "detail", "General Publication Graph"), DETAILS, "General Publication Graph detail"), exportEligibility: enumValue(own(graph, "exportEligibility", "General Publication Graph"), ["eligible", "ineligible"], "General Publication Graph export eligibility"), components, relations, semanticRegions, layoutOrder };
}

function projectSemanticRegion(value: unknown): PublicSemanticRegionSummary {
  const region = exactRecord(value, ["regionId", "kind", "label", "state", "sourceNodeIds", "sourceEdgeIds", "sourceGroupIds", "evidenceIds"], "General Publication Graph semantic region");
  validateIgnoredIdentifiers(region, ["sourceNodeIds", "sourceEdgeIds", "sourceGroupIds", "evidenceIds"], "General Publication Graph semantic region");
  return {
    regionId: identifier(own(region, "regionId", "General Publication Graph semantic region"), "General Publication Graph semantic region ID"),
    kind: enumValue(own(region, "kind", "General Publication Graph semantic region"), SEMANTIC_REGION_KINDS, "General Publication Graph semantic region kind"),
    label: displayText(own(region, "label", "General Publication Graph semantic region"), "General Publication Graph semantic region label"),
    state: enumValue(own(region, "state", "General Publication Graph semantic region"), ["formal", "candidate"], "General Publication Graph semantic region state"),
  };
}

function projectComponent(value: unknown): PublicationVisualPlanPreview["graph"]["components"][number] {
  const item = exactRecord(value, ["componentId", "role", "label", "count", "sourceNodeIds", "sourceEdgeIds", "evidenceIds", "layoutOrder"], "General Publication Graph component", true);
  validateIgnoredIdentifiers(item, ["sourceNodeIds", "sourceEdgeIds", "evidenceIds"], "General Publication Graph component");
  const result = { componentId: identifier(own(item, "componentId", "General Publication Graph component"), "General Publication Graph component ID"), role: enumValue(own(item, "role", "General Publication Graph component"), COMPONENT_ROLES, "General Publication Graph component role"), label: displayText(own(item, "label", "General Publication Graph component"), "General Publication Graph component label"), layoutOrder: layout(own(item, "layoutOrder", "General Publication Graph component"), "General Publication Graph component layout") };
  if (!Object.hasOwn(item, "count")) return result;
  return { ...result, count: positiveCount(own(item, "count", "General Publication Graph component"), "General Publication Graph component count") };
}

function projectRelation(value: unknown): PublicationVisualPlanPreview["graph"]["relations"][number] {
  const item = exactRecord(value, ["relationId", "role", "sourceComponentId", "targetComponentId", "sourceEdgeIds", "evidenceIds"], "General Publication Graph relation");
  validateIgnoredIdentifiers(item, ["sourceEdgeIds", "evidenceIds"], "General Publication Graph relation");
  return { relationId: identifier(own(item, "relationId", "General Publication Graph relation"), "General Publication Graph relation ID"), role: enumValue(own(item, "role", "General Publication Graph relation"), RELATION_ROLES, "General Publication Graph relation role"), sourceComponentId: identifier(own(item, "sourceComponentId", "General Publication Graph relation"), "General Publication Graph relation source component ID"), targetComponentId: identifier(own(item, "targetComponentId", "General Publication Graph relation"), "General Publication Graph relation target component ID") };
}

function projectLayoutOrder(value: unknown): PreviewLayoutOrder {
  const item = exactRecord(value, ["componentId", "rank", "order"], "General Publication Graph layout order");
  return { componentId: identifier(own(item, "componentId", "General Publication Graph layout order"), "General Publication Graph layout component ID"), rank: index(own(item, "rank", "General Publication Graph layout order"), "General Publication Graph layout rank"), order: index(own(item, "order", "General Publication Graph layout order"), "General Publication Graph layout order") };
}

function validateIgnoredSourceMappings(value: unknown, componentIds: Set<string>): void {
  const mappings = array(value, "General Publication Graph source mappings");
  if (mappings.length !== componentIds.size) throw new Error("General Publication Graph source mappings are invalid");
  const mappingIds = new Set<string>();
  for (const value of mappings) {
    const item = exactRecord(value, ["componentId", "sourceNodeIds", "sourceEdgeIds", "evidenceIds"], "General Publication Graph source mapping");
    mappingIds.add(identifier(own(item, "componentId", "General Publication Graph source mapping"), "General Publication Graph source mapping component ID"));
    validateIgnoredIdentifiers(item, ["sourceNodeIds", "sourceEdgeIds", "evidenceIds"], "General Publication Graph source mapping");
  }
  if (mappingIds.size !== componentIds.size || [...componentIds].some((componentId) => !mappingIds.has(componentId))) throw new Error("General Publication Graph source mappings are incoherent");
}

function validateIgnoredIdentifiers(item: PreviewRecord, keys: readonly string[], label: string): void {
  for (const key of keys) identifiers(own(item, key, label), `${label} ${key}`);
}

function exactRecord(value: unknown, keys: readonly string[], label: string, optional = false): PreviewRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.some((key) => !expected.includes(key)) || (!optional && (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))))) throw new Error(`${label} has unknown or missing fields`);
  return value as PreviewRecord;
}

function own(value: PreviewRecord, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw new Error(`${label} ${key} is missing or unsafe`);
  return descriptor.value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS || Array.from({ length: value.length }, (_item, index) => !Object.hasOwn(value, index)).some(Boolean)) throw new Error(`${label} must be a dense bounded array`);
  return value;
}

function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} is invalid`); return value; }
function token(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 192 || /[\0\r\n]/.test(value)) throw new Error(`${label} is invalid`); return value; }
function tokens(value: unknown, label: string): string[] { return array(value, label).map((item) => token(item, label)); }
function identifiers(value: unknown, label: string): string[] { return array(value, label).map((item) => identifier(item, label)); }
function displayText(value: unknown, label: string): string { if (typeof value !== "string" || value.length > MAX_DISPLAY_TEXT_LENGTH || /[\0\r\n]/.test(value)) throw new Error(`${label} is invalid`); return value; }
function styleValue(value: unknown, label: string): string | number { if (typeof value === "string" && value.length <= MAX_STYLE_TEXT_LENGTH && !/[\0\r\n]/.test(value)) return value; if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE) return value; throw new Error(`${label} is invalid`); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T { if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new Error(`${label} is invalid`); return value as T; }
function index(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_COORDINATE) throw new Error(`${label} is invalid`); return value; }
function offset(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1000) throw new Error(`${label} is invalid`); return value; }
function positiveCount(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 2 || value > MAX_COLLECTION_ITEMS) throw new Error(`${label} is invalid`); return value; }
function bounds(value: unknown, label: string): PreviewBounds { const item = exactRecord(value, ["x", "y", "width", "height"], label); return { x: index(own(item, "x", label), `${label} x`), y: index(own(item, "y", label), `${label} y`), width: index(own(item, "width", label), `${label} width`), height: index(own(item, "height", label), `${label} height`) }; }
function pointValue(value: unknown, label: string): PreviewPoint { const item = exactRecord(value, ["x", "y"], label); return { x: index(own(item, "x", label), `${label} x`), y: index(own(item, "y", label), `${label} y`) }; }
function layout(value: unknown, label: string): { rank: number; order: number } { const item = exactRecord(value, ["rank", "order"], label); return { rank: index(own(item, "rank", label), `${label} rank`), order: index(own(item, "order", label), `${label} order`) }; }
