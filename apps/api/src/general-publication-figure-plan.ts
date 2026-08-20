import { createHash } from "node:crypto";
import { z } from "zod";
import { getUniversalGraphEligibility, type UniversalGraphSpec } from "./universal-graph-spec.js";
import type { GeneralPublicationComponentRole, GeneralPublicationGraph } from "./general-publication-graph.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const DIGEST = /^[a-f0-9]{64}$/i;
const MARGIN = 72;
const COLUMN_GAP = 96;
const LANE_GAP = 32;
const BASE_WIDTH = 144;
const BASE_HEIGHT = 72;
const MAX_DOCUMENT_UNITS = 10_000;

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
const idSchema = z.string().min(1).max(128).regex(ID);
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
  primitives: z.array(primitiveSchema).min(1).max(512),
  connectors: z.array(connectorSchema).max(1024),
  sourceMappings: z.array(mappingSchema).min(1).max(512),
}).strict();

export function parseGeneralPublicationFigurePlan(input: unknown): GeneralPublicationFigurePlan {
  const parsed = planSchema.parse(input);
  assertUnique(parsed.primitives.map((item) => item.primitiveId), "primitive");
  assertUnique(parsed.connectors.map((item) => item.connectorId), "connector");
  assertUnique(parsed.sourceMappings.map((item) => item.primitiveId), "source mapping");
  for (const primitive of parsed.primitives) {
    assertUnique(primitive.sourceComponentIds, "primitive source component");
    assertUnique(primitive.sourceNodeIds, "primitive source node");
    assertUnique(primitive.sourceEdgeIds, "primitive source edge");
    assertUnique(primitive.evidenceIds, "primitive evidence");
  }
  for (const connector of parsed.connectors) {
    assertUnique(connector.sourceRelationIds, "connector source relation");
    assertUnique(connector.evidenceIds, "connector evidence");
  }
  for (const mapping of parsed.sourceMappings) {
    assertUnique(mapping.sourceComponentIds, "source mapping component");
    assertUnique(mapping.sourceNodeIds, "source mapping node");
    assertUnique(mapping.sourceEdgeIds, "source mapping edge");
    assertUnique(mapping.evidenceIds, "source mapping evidence");
  }
  const primitives = new Set(parsed.primitives.map((item) => item.primitiveId));
  for (const connector of parsed.connectors) {
    if (!primitives.has(connector.fromPrimitiveId) || !primitives.has(connector.toPrimitiveId)) throw new Error("Figure Plan connector references an unknown primitive");
  }
  for (const mapping of parsed.sourceMappings) if (!primitives.has(mapping.primitiveId)) throw new Error("Figure Plan source mapping references an unknown primitive");
  return deepFreeze(structuredClone(parsed));
}

export function compileGeneralPublicationFigurePlan(input: { ugs: UniversalGraphSpec; graph: GeneralPublicationGraph }): GeneralPublicationFigurePlan {
  assertEligible(input.ugs, input.graph);
  if (input.ugs.graphId !== input.graph.graphId) throw new Error("UGS and General Publication Graph IDs must match");

  const components = [...input.graph.components].sort((left, right) => left.componentId.localeCompare(right.componentId));
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
        left: MARGIN + layout.rank * (BASE_WIDTH + COLUMN_GAP),
        top: MARGIN + layout.order * (BASE_HEIGHT + LANE_GAP),
        width: BASE_WIDTH,
        height: BASE_HEIGHT,
      },
      sourceComponentIds: [component.componentId],
      sourceNodeIds: uniqueSorted(component.sourceNodeIds),
      sourceEdgeIds: uniqueSorted(component.sourceEdgeIds),
      evidenceIds: uniqueSorted(component.evidenceIds),
    };
    primitiveByComponentId.set(component.componentId, primitive);
  }
  const primitives = [...primitiveByComponentId.values()].sort((left, right) => left.primitiveId.localeCompare(right.primitiveId));
  const connectors: GeneralPublicationFigureConnector[] = [];
  for (const relation of [...input.graph.relations].sort((left, right) => left.relationId.localeCompare(right.relationId))) {
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertUnique(values: string[], kind: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Figure Plan ${kind} IDs must be unique`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
