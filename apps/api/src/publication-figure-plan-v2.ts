import { z } from "zod";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FigureGrammarId } from "./figure-semantic-model.js";

const MAX_PRIMITIVES = 600;
const MAX_RELATIONS = 240;
const MAX_ANNOTATIONS = 180;
const MAX_ANNOTATION_CHARS = 240;
const idSchema = z.string().trim().min(1).max(128);
const textSchema = z.string().trim().min(1).max(MAX_ANNOTATION_CHARS);
const semanticValueSchema = z.union([z.string().trim().max(240), z.number().finite(), z.boolean(), z.null()]);
const semanticSchema = z.record(semanticValueSchema).superRefine((value, context) => {
  if (Object.keys(value).length > 32) context.addIssue({ code: z.ZodIssueCode.custom, message: "semantic may contain at most 32 properties" });
});
const boundsSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict();
const pointSchema = z.object({ x: z.number().finite().min(0), y: z.number().finite().min(0) }).strict();

export const publicationPrimitiveKinds = ["semantic_region", "tensor_volume", "block_frame", "flow_arrow", "residual_skip", "merge_marker", "annotation_track"] as const;
export type PublicationPrimitiveKind = typeof publicationPrimitiveKinds[number];
export type PublicationRelationKind = "flow_arrow" | "residual_skip" | "merge_marker";

export interface PublicationFigurePlanV2 {
  version: 2;
  target: "preview";
  renderIntent: { density: "compact" | "standard" | "detailed"; printMode: "color" | "grayscale" };
  grammar: { id: FigureGrammarId; version: number };
  coordinateSpace: { unit: "figure-unit"; figureUnitInches: 0.01; origin: "top-left"; width: number; height: number };
  regions: Array<{ id: string; label: string; role: string; bounds: FigureBounds }>;
  primitives: Array<{ id: string; kind: PublicationPrimitiveKind; bounds: FigureBounds; semantic: Record<string, string | number | boolean | null>; sourceDisplayId: string }>;
  relations: Array<{ id: string; kind: PublicationRelationKind; sourcePrimitiveId: string; targetPrimitiveId: string; route: Array<{ x: number; y: number }>; semantic: Record<string, string | number | boolean | null>; sourceDisplayId: string; style: RelationStyle }>;
  annotations: Array<{ id: string; targetId: string; role: "heading" | "detail" | "relation_label" | "region_label" | "legend"; text: string; bounds: FigureBounds; fontSizePt: number }>;
  sourceMappings: Array<{ mappingId: string; displayId: string; networkNodeIds: string[]; tensorIds: string[]; edgeIds: string[]; evidenceIds: string[] }>;
  qaContract: { minFontSizePt: number; printMode: "color" | "grayscale"; maxPrimitiveCount: number };
}

export interface FigureBounds { x: number; y: number; width: number; height: number; }
export interface RelationStyle { stroke: "solid" | "dashed" | "dotted"; tone: "dark" | "mid" | "light"; thickness: number; }
export interface PublicationFigurePlanValidationIssue { code: string; message: string; path: string; }
export interface PublicationFigurePlanValidationResult { valid: boolean; issues: PublicationFigurePlanValidationIssue[]; plan: PublicationFigurePlanV2 | null; }

const planSchema = z.object({
  version: z.literal(2),
  target: z.literal("preview"),
  renderIntent: z.object({ density: z.enum(["compact", "standard", "detailed"]), printMode: z.enum(["color", "grayscale"]) }).strict(),
  grammar: z.object({ id: z.enum(["cnn-classifier", "encoder-decoder", "residual-backbone", "token-transformer", "multi-branch-fusion"]), version: z.number().int().positive() }).strict(),
  coordinateSpace: z.object({ unit: z.literal("figure-unit"), figureUnitInches: z.literal(0.01), origin: z.literal("top-left"), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(),
  regions: z.array(z.object({ id: idSchema, label: textSchema, role: z.string().trim().min(1).max(64), bounds: boundsSchema }).strict()).max(48),
  primitives: z.array(z.object({ id: idSchema, kind: z.enum(publicationPrimitiveKinds), bounds: boundsSchema, semantic: semanticSchema.default({}), sourceDisplayId: idSchema }).strict()).min(1).max(MAX_PRIMITIVES),
  relations: z.array(z.object({
    id: idSchema,
    kind: z.enum(["flow_arrow", "residual_skip", "merge_marker"]),
    sourcePrimitiveId: idSchema,
    targetPrimitiveId: idSchema,
    route: z.array(pointSchema).min(2).max(24),
    semantic: semanticSchema.default({}),
    sourceDisplayId: idSchema,
    style: z.object({ stroke: z.enum(["solid", "dashed", "dotted"]), tone: z.enum(["dark", "mid", "light"]), thickness: z.number().finite().positive().max(12) }).strict(),
  }).strict()).max(MAX_RELATIONS),
  annotations: z.array(z.object({ id: idSchema, targetId: idSchema, role: z.enum(["heading", "detail", "relation_label", "region_label", "legend"]), text: textSchema, bounds: boundsSchema, fontSizePt: z.number().finite().positive().max(72) }).strict()).max(MAX_ANNOTATIONS),
  sourceMappings: z.array(z.object({ mappingId: idSchema, displayId: idSchema, networkNodeIds: z.array(idSchema).default([]), tensorIds: z.array(idSchema).default([]), edgeIds: z.array(idSchema).default([]), evidenceIds: z.array(idSchema).default([]) }).strict()).min(1).max(96),
  qaContract: z.object({ minFontSizePt: z.number().finite().positive().max(72), printMode: z.enum(["color", "grayscale"]), maxPrimitiveCount: z.number().int().positive().max(MAX_PRIMITIVES) }).strict(),
}).strict();

export function validatePublicationFigurePlanV2(input: unknown): PublicationFigurePlanValidationResult {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => ({ code: `schema:${issue.code}`, message: issue.message, path: formatPath(issue.path) })), plan: null };

  const plan = parsed.data as PublicationFigurePlanV2;
  const issues: PublicationFigurePlanValidationIssue[] = [];
  unique(plan.primitives.map((item) => item.id), "primitive", "primitives", issues);
  unique(plan.relations.map((item) => item.id), "relation", "relations", issues);
  unique(plan.annotations.map((item) => item.id), "annotation", "annotations", issues);
  unique(plan.regions.map((item) => item.id), "region", "regions", issues);
  unique(plan.sourceMappings.map((item) => item.mappingId), "source mapping", "sourceMappings", issues);

  const primitiveIds = new Set(plan.primitives.map((item) => item.id));
  const relationIds = new Set(plan.relations.map((item) => item.id));
  const regionIds = new Set(plan.regions.map((item) => item.id));
  const mappedDisplayIds = new Set(plan.sourceMappings.map((item) => item.displayId));
  for (const [index, primitive] of plan.primitives.entries()) if (!mappedDisplayIds.has(primitive.sourceDisplayId)) issues.push(validationIssue("unknown-display-source", `Primitive "${primitive.id}" has no source mapping`, `primitives[${index}].sourceDisplayId`));
  for (const [index, relation] of plan.relations.entries()) {
    if (!primitiveIds.has(relation.sourcePrimitiveId)) issues.push(validationIssue("missing-relation-endpoint", `Relation "${relation.id}" has an unknown source primitive`, `relations[${index}].sourcePrimitiveId`));
    if (!primitiveIds.has(relation.targetPrimitiveId)) issues.push(validationIssue("missing-relation-endpoint", `Relation "${relation.id}" has an unknown target primitive`, `relations[${index}].targetPrimitiveId`));
    if (relation.sourcePrimitiveId === relation.targetPrimitiveId) issues.push(validationIssue("self-relation", `Relation "${relation.id}" cannot connect a primitive to itself`, `relations[${index}]`));
    if (!mappedDisplayIds.has(relation.sourceDisplayId)) issues.push(validationIssue("unknown-display-source", `Relation "${relation.id}" has no source mapping`, `relations[${index}].sourceDisplayId`));
  }
  for (const [index, annotation] of plan.annotations.entries()) {
    if (!primitiveIds.has(annotation.targetId) && !relationIds.has(annotation.targetId) && !regionIds.has(annotation.targetId)) issues.push(validationIssue("missing-annotation-target", `Annotation "${annotation.id}" targets an unknown plan object`, `annotations[${index}].targetId`));
    if (annotation.fontSizePt < plan.qaContract.minFontSizePt) issues.push(validationIssue("font-too-small", `Annotation "${annotation.id}" is below the minimum font size`, `annotations[${index}].fontSizePt`));
  }
  for (const [index, mapping] of plan.sourceMappings.entries()) {
    if (mapping.networkNodeIds.length + mapping.tensorIds.length + mapping.edgeIds.length === 0) issues.push(validationIssue("source-less-mapping", `Source mapping "${mapping.mappingId}" has no Canonical NetworkIR source ID`, `sourceMappings[${index}]`));
  }
  if (plan.primitives.length > plan.qaContract.maxPrimitiveCount) {
    issues.push(validationIssue("primitive-contract-limit", `Plan contains ${plan.primitives.length} primitives but its QA contract permits ${plan.qaContract.maxPrimitiveCount}`, "qaContract.maxPrimitiveCount"));
  }
  return { valid: issues.length === 0, issues, plan: issues.length === 0 ? plan : null };
}

export function parsePublicationFigurePlanV2(input: unknown): PublicationFigurePlanV2 {
  const result = validatePublicationFigurePlanV2(input);
  if (!result.valid || !result.plan) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Publication figure plan v2 failed validation", 400, { issues: result.issues });
  return result.plan;
}

function unique(ids: string[], kind: string, path: string, issues: PublicationFigurePlanValidationIssue[]): void {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) issues.push(validationIssue(`duplicate-${kind.replace(/\s+/g, "-")}-id`, `Duplicate ${kind} ID "${id}"`, `${path}[${index}].id`));
    seen.add(id);
  }
}

function validationIssue(code: string, message: string, path: string): PublicationFigurePlanValidationIssue { return { code, message, path }; }
function formatPath(path: (string | number)[]): string { return path.length === 0 ? "$" : path.reduce<string>((value, part) => typeof part === "number" ? `${value}[${part}]` : value ? `${value}.${part}` : part, ""); }
