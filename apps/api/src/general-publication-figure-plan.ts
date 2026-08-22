import { createHash } from "node:crypto";
import { z } from "zod";
import { getUniversalGraphEligibility, parseUniversalGraphSpec, type UniversalGraphSpec } from "./universal-graph-spec.js";
import { composeGeneralPublicationGraph, type GeneralPublicationComponentRole, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { compareCodeUnits } from "./stable-string-order.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const DIGEST = /^[a-f0-9]{64}$/i;
const MARGIN = 72;
const COLUMN_GAP = 96;
const LANE_GAP = 32;
const BASE_WIDTH = 144;
const BASE_HEIGHT = 72;
const MAX_DOCUMENT_UNITS = 10_000;
const MAX_PLAN_IDENTIFIER_LENGTH = 192;
const MAX_PLAN_PRIMITIVES = 768;
const MAX_PLAN_CONNECTORS = 2_048;

export interface GeneralPublicationFigurePlan {
  version: 1;
  graphId: string;
  detail: "overview" | "architecture" | "operator_detail";
  sourceGraphHash: string;
  page: { width: number; height: number; margin: number };
  primitives: GeneralPublicationFigurePrimitive[];
  connectors: GeneralPublicationFigureConnector[];
  sourceMappings: GeneralPublicationFigureSourceMapping[];
}

export interface GeneralPublicationFigurePrimitive {
  primitiveId: string;
  role: GeneralPublicationComponentRole;
  label: string;
  bounds: { left: number; top: number; width: number; height: number };
  sourceComponentIds: string[];
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  evidenceIds: string[];
}

export interface GeneralPublicationFigureConnector {
  connectorId: string;
  role: "flow" | "skip" | "merge" | "condition";
  sourceRelationIds: string[];
  fromPrimitiveId: string;
  toPrimitiveId: string;
  evidenceIds: string[];
}

export interface GeneralPublicationFigureSourceMapping {
  primitiveId: string;
  sourceComponentIds: string[];
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  evidenceIds: string[];
}

const roleSchema = z.enum(["input", "output", "generic_module", "custom_operator", "custom_module", "split", "merge_add", "merge_concat", "custom_fusion", "repeat_badge", "candidate_region"]);
const idSchema = z.string().min(1).max(MAX_PLAN_IDENTIFIER_LENGTH).regex(ID);
const labelSchema = z.string().min(1).max(240);
const identifierListSchema = z.array(idSchema).min(1).max(512);
const boundsSchema = z.object({
  left: z.number().finite().min(0).max(MAX_DOCUMENT_UNITS),
  top: z.number().finite().min(0).max(MAX_DOCUMENT_UNITS),
  width: z.number().finite().positive().max(MAX_DOCUMENT_UNITS),
  height: z.number().finite().positive().max(MAX_DOCUMENT_UNITS),
}).strict();
const primitiveSchema = z.object({
  primitiveId: idSchema,
  role: roleSchema,
  label: labelSchema,
  bounds: boundsSchema,
  sourceComponentIds: identifierListSchema,
  sourceNodeIds: z.array(idSchema).max(512),
  sourceEdgeIds: z.array(idSchema).max(512),
  evidenceIds: identifierListSchema,
}).strict();
const connectorSchema = z.object({
  connectorId: idSchema,
  role: z.enum(["flow", "skip", "merge", "condition"]),
  sourceRelationIds: identifierListSchema,
  fromPrimitiveId: idSchema,
  toPrimitiveId: idSchema,
  evidenceIds: identifierListSchema,
}).strict();
const mappingSchema = z.object({
  primitiveId: idSchema,
  sourceComponentIds: identifierListSchema,
  sourceNodeIds: z.array(idSchema).max(512),
  sourceEdgeIds: z.array(idSchema).max(512),
  evidenceIds: identifierListSchema,
}).strict();
const planSchema = z.object({
  version: z.literal(1),
  graphId: idSchema,
  detail: z.enum(["overview", "architecture", "operator_detail"]),
  sourceGraphHash: z.string().regex(DIGEST),
  page: z.object({
    width: z.number().finite().positive().max(MAX_DOCUMENT_UNITS),
    height: z.number().finite().positive().max(MAX_DOCUMENT_UNITS),
    margin: z.number().finite().nonnegative().max(MAX_DOCUMENT_UNITS),
  }).strict(),
  primitives: z.array(primitiveSchema).min(1).max(MAX_PLAN_PRIMITIVES),
  connectors: z.array(connectorSchema).max(MAX_PLAN_CONNECTORS),
  sourceMappings: z.array(mappingSchema).min(1).max(MAX_PLAN_PRIMITIVES),
}).strict();

export function parseGeneralPublicationFigurePlan(input: unknown): GeneralPublicationFigurePlan {
  const parsed = planSchema.parse(input);
  assertUnique(parsed.primitives.map((item) => item.primitiveId), "primitive");
  assertUnique(parsed.connectors.map((item) => item.connectorId), "connector");
  assertUnique(parsed.sourceMappings.map((item) => item.primitiveId), "source mapping");
  assertCanonicalRecordOrder(parsed.primitives, (item) => item.primitiveId, "primitive");
  assertCanonicalRecordOrder(parsed.connectors, (item) => item.connectorId, "connector");
  assertCanonicalRecordOrder(parsed.sourceMappings, (item) => item.primitiveId, "source mapping");
  for (const primitive of parsed.primitives) {
    assertStableList(primitive.sourceComponentIds, "primitive source component");
    assertStableList(primitive.sourceNodeIds, "primitive source node");
    assertStableList(primitive.sourceEdgeIds, "primitive source edge");
    assertStableList(primitive.evidenceIds, "primitive evidence");
  }
  for (const connector of parsed.connectors) {
    assertStableList(connector.sourceRelationIds, "connector source relation");
    assertStableList(connector.evidenceIds, "connector evidence");
  }
  for (const mapping of parsed.sourceMappings) {
    assertStableList(mapping.sourceComponentIds, "source mapping component");
    assertStableList(mapping.sourceNodeIds, "source mapping node");
    assertStableList(mapping.sourceEdgeIds, "source mapping edge");
    assertStableList(mapping.evidenceIds, "source mapping evidence");
  }
  const primitiveById = new Map(parsed.primitives.map((item) => [item.primitiveId, item]));
  if (parsed.sourceMappings.length !== parsed.primitives.length) throw new Error("Figure Plan requires exactly one provenance mapping per primitive");
  const mappingsByPrimitiveId = new Map(parsed.sourceMappings.map((item) => [item.primitiveId, item]));
  for (const primitive of parsed.primitives) {
    const mapping = mappingsByPrimitiveId.get(primitive.primitiveId);
    if (!mapping || !sameList(mapping.sourceComponentIds, primitive.sourceComponentIds) || !sameList(mapping.sourceNodeIds, primitive.sourceNodeIds) || !sameList(mapping.sourceEdgeIds, primitive.sourceEdgeIds) || !sameList(mapping.evidenceIds, primitive.evidenceIds)) {
      throw new Error("Figure Plan provenance mapping must exactly match its primitive");
    }
  }
  for (const connector of parsed.connectors) {
    if (!primitiveById.has(connector.fromPrimitiveId) || !primitiveById.has(connector.toPrimitiveId)) throw new Error("Figure Plan connector references an unknown primitive");
    if (connector.fromPrimitiveId === connector.toPrimitiveId) throw new Error("Figure Plan connector must not self-reference a primitive");
  }
  for (const mapping of parsed.sourceMappings) if (!primitiveById.has(mapping.primitiveId)) throw new Error("Figure Plan source mapping references an unknown primitive");
  const expectedPageWidth = Math.max(...parsed.primitives.map((item) => item.bounds.left + item.bounds.width)) + parsed.page.margin;
  const expectedPageHeight = Math.max(...parsed.primitives.map((item) => item.bounds.top + item.bounds.height)) + parsed.page.margin;
  if (parsed.page.width !== expectedPageWidth || parsed.page.height !== expectedPageHeight) throw new Error("Figure Plan page extents must match primitive bounds");
  return deepFreeze(structuredClone(parsed));
}

export function compileGeneralPublicationFigurePlan(input: { ugs: UniversalGraphSpec; graph: GeneralPublicationGraph }): GeneralPublicationFigurePlan {
  const ugs = parseUniversalGraphSpec(input.ugs);
  assertEligible(ugs, input.graph);
  if (ugs.graphId !== input.graph.graphId) throw new Error("UGS and General Publication Graph IDs must match");
  const canonicalGraph = composeGeneralPublicationGraph(ugs, { detail: input.graph.detail });
  if (canonicalJson(input.graph) !== canonicalJson(canonicalGraph)) throw new Error("General Publication Graph must exactly match the canonical UGS projection");

  const components = [...input.graph.components].sort((left, right) => compareCodeUnits(left.componentId, right.componentId));
  const geometry = scaledGeometryFor(components);
  const layoutByComponentId = new Map(input.graph.layoutOrder.map((item) => [item.componentId, item]));
  const primitiveByComponentId = new Map<string, GeneralPublicationFigurePrimitive>();
  for (const component of components) {
    const layout = layoutByComponentId.get(component.componentId);
    if (!layout || layout.rank !== component.layoutOrder.rank || layout.order !== component.layoutOrder.order) throw new Error("General Publication Graph layout order is inconsistent");
    const primitive: GeneralPublicationFigurePrimitive = {
      primitiveId: `primitive:${component.componentId}`,
      role: component.role,
      label: component.label,
      bounds: {
        left: MARGIN + layout.rank * (geometry.width + geometry.columnGap),
        top: MARGIN + layout.order * (geometry.height + geometry.laneGap),
        width: geometry.width,
        height: geometry.height,
      },
      sourceComponentIds: [component.componentId],
      sourceNodeIds: uniqueSorted(component.sourceNodeIds),
      sourceEdgeIds: uniqueSorted(component.sourceEdgeIds),
      evidenceIds: uniqueSorted(component.evidenceIds),
    };
    primitiveByComponentId.set(component.componentId, primitive);
  }
  const primitives = [...primitiveByComponentId.values()].sort((left, right) => compareCodeUnits(left.primitiveId, right.primitiveId));
  const connectors: GeneralPublicationFigureConnector[] = [];
  for (const relation of [...input.graph.relations].sort((left, right) => compareCodeUnits(left.relationId, right.relationId))) {
    if (relation.role === "feedback") throw new Error("Formal Figure Plan does not support feedback topology");
    const from = primitiveByComponentId.get(relation.sourceComponentId);
    const to = primitiveByComponentId.get(relation.targetComponentId);
    if (!from || !to) throw new Error("General Publication Graph relation lacks a formal primitive endpoint");
    connectors.push({
      connectorId: `connector:${relation.relationId}`,
      role: relation.role,
      sourceRelationIds: [relation.relationId],
      fromPrimitiveId: from.primitiveId,
      toPrimitiveId: to.primitiveId,
      evidenceIds: uniqueSorted(relation.evidenceIds),
    });
  }
  const sourceMappings = primitives.map((primitive) => ({
    primitiveId: primitive.primitiveId,
    sourceComponentIds: [...primitive.sourceComponentIds],
    sourceNodeIds: [...primitive.sourceNodeIds],
    sourceEdgeIds: [...primitive.sourceEdgeIds],
    evidenceIds: [...primitive.evidenceIds],
  }));
  const page = {
    width: Math.max(...primitives.map((item) => item.bounds.left + item.bounds.width)) + MARGIN,
    height: Math.max(...primitives.map((item) => item.bounds.top + item.bounds.height)) + MARGIN,
    margin: MARGIN,
  };
  return parseGeneralPublicationFigurePlan({
    version: 1,
    graphId: input.graph.graphId,
    detail: input.graph.detail,
    sourceGraphHash: sha256(canonicalJson(input.graph)),
    page,
    primitives,
    connectors,
    sourceMappings,
  });
}

export function verifyGeneralPublicationFigurePlan(input: { ugs: UniversalGraphSpec; graph: GeneralPublicationGraph; plan: GeneralPublicationFigurePlan }): GeneralPublicationFigurePlan {
  const parsed = parseGeneralPublicationFigurePlan(input.plan);
  const canonical = compileGeneralPublicationFigurePlan({ ugs: input.ugs, graph: input.graph });
  if (canonicalJson(parsed) !== canonicalJson(canonical)) throw new Error("Figure Plan must exactly match the canonical UGS projection");
  return canonical;
}

function assertEligible(ugs: UniversalGraphSpec, graph: GeneralPublicationGraph): void {
  const eligibility = getUniversalGraphEligibility(ugs);
  if (eligibility.preview !== "renderable" || eligibility.export !== "eligible" || graph.exportEligibility !== "eligible") throw new Error("Formal Figure Plan requires eligible topology");
  if (ugs.edges.some((edge) => edge.relation === "feedback")) throw new Error("Formal Figure Plan does not support feedback topology");
  if (graph.components.some((component) => component.role === "candidate_region")) throw new Error("Formal Figure Plan does not support candidate topology");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON does not permit non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]));
  throw new Error("canonical JSON accepts only JSON values");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scaledGeometryFor(components: GeneralPublicationGraph["components"]): { width: number; height: number; columnGap: number; laneGap: number } {
  const maximumRank = Math.max(...components.map((component) => component.layoutOrder.rank));
  const maximumOrder = Math.max(...components.map((component) => component.layoutOrder.order));
  const availableSpan = MAX_DOCUMENT_UNITS - MARGIN * 2;
  const horizontalScale = availableSpan / (BASE_WIDTH + maximumRank * (BASE_WIDTH + COLUMN_GAP));
  const verticalScale = availableSpan / (BASE_HEIGHT + maximumOrder * (BASE_HEIGHT + LANE_GAP));
  const requestedScale = Math.min(1, horizontalScale, verticalScale);
  // Leave a deterministic sub-unit margin when compression is active so
  // IEEE-754 rounding cannot turn an exact 10,000-unit extent into an
  // invalid value a few ulps above the schema cap.
  const scale = requestedScale < 1 ? requestedScale * (1 - 1e-12) : requestedScale;
  return {
    width: BASE_WIDTH * scale,
    height: BASE_HEIGHT * scale,
    columnGap: COLUMN_GAP * scale,
    laneGap: LANE_GAP * scale,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function assertUnique(values: string[], kind: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Figure Plan ${kind} IDs must be unique`);
}

function assertStableList(values: string[], kind: string): void {
  assertUnique(values, kind);
  if (!sameList(values, uniqueSorted(values))) throw new Error(`Figure Plan ${kind} IDs must be sorted`);
}

function assertCanonicalRecordOrder<T>(values: T[], identifier: (value: T) => string, kind: string): void {
  const expected = [...values].sort((left, right) => compareCodeUnits(identifier(left), identifier(right)));
  if (!values.every((value, index) => identifier(value) === identifier(expected[index]!))) throw new Error(`Figure Plan ${kind} records must be sorted`);
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
