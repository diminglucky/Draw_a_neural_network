import { z } from "zod";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FigureIntent } from "./figure-intent.js";
import type { CanonicalNetworkIR } from "./network-ir-v2.js";

const MAX_DISPLAY_NODES = 96;
const MAX_RELATIONS = 240;
const MAX_REGIONS = 48;
const MAX_STAGE_SUMMARIES = 96;
const MAX_SEMANTIC_PROPERTIES = 32;
const idSchema = z.string().trim().min(1).max(128);
const labelSchema = z.string().trim().min(1).max(240);
const nullableSummarySchema = z.string().trim().min(1).max(240).nullable().optional().default(null);
const semanticValueSchema = z.union([z.string().trim().max(240), z.number().finite(), z.boolean(), z.null()]);
const forbiddenSemanticKey = /(?:^|_)(?:x|y|width|height|bounds|coordinate|coordinates|path|output|primitive|renderer|visio|svg|xml|command|script)(?:$|_)/i;

export type FigureGrammarId = "cnn-classifier" | "encoder-decoder" | "residual-backbone" | "token-transformer";

export interface FigureSourceMapping {
  displayId: string;
  networkNodeIds: string[];
  tensorIds: string[];
  edgeIds: string[];
  evidenceIds: string[];
}

export interface FigureSemanticModel {
  version: 1;
  grammar: { id: FigureGrammarId; version: number };
  regions: Array<{ id: string; label: string; role: string; displayIds: string[] }>;
  displayNodes: Array<{
    id: string;
    role: "input" | "tensor_stage" | "operator_block" | "vector" | "token" | "head" | "output" | "inset";
    label: string;
    summary: string | null;
    semantic: Record<string, string | number | boolean | null>;
  }>;
  displayRelations: Array<{
    id: string;
    role: "flow" | "downsample" | "upsample" | "flatten" | "residual" | "concat" | "split" | "attention" | "alignment" | "iteration";
    sourceDisplayId: string;
    targetDisplayId: string;
    label: string | null;
    semantic: Record<string, string | number | boolean | null>;
  }>;
  sourceMappings: FigureSourceMapping[];
  narrative: { title: string; summary: string; stageSummaries: string[] };
}

const semanticRecordSchema = z.record(semanticValueSchema).superRefine((value, context) => {
  const keys = Object.keys(value);
  if (keys.length > MAX_SEMANTIC_PROPERTIES) context.addIssue({ code: z.ZodIssueCode.custom, message: `semantic may contain at most ${MAX_SEMANTIC_PROPERTIES} properties` });
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || forbiddenSemanticKey.test(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `semantic property "${key}" is not permitted` });
    }
  }
});

const figureSemanticModelSchema = z.object({
  version: z.literal(1),
  grammar: z.object({
    id: z.enum(["cnn-classifier", "encoder-decoder", "residual-backbone", "token-transformer"]),
    version: z.number().int().positive(),
  }).strict(),
  regions: z.array(z.object({
    id: idSchema,
    label: labelSchema,
    role: z.string().trim().min(1).max(64),
    displayIds: z.array(idSchema).min(1).max(MAX_DISPLAY_NODES),
  }).strict()).max(MAX_REGIONS),
  displayNodes: z.array(z.object({
    id: idSchema,
    role: z.enum(["input", "tensor_stage", "operator_block", "vector", "token", "head", "output", "inset"]),
    label: labelSchema,
    summary: nullableSummarySchema,
    semantic: semanticRecordSchema.default({}),
  }).strict()).min(1).max(MAX_DISPLAY_NODES),
  displayRelations: z.array(z.object({
    id: idSchema,
    role: z.enum(["flow", "downsample", "upsample", "flatten", "residual", "concat", "split", "attention", "alignment", "iteration"]),
    sourceDisplayId: idSchema,
    targetDisplayId: idSchema,
    label: nullableSummarySchema,
    semantic: semanticRecordSchema.default({}),
  }).strict()).max(MAX_RELATIONS),
  sourceMappings: z.array(z.object({
    displayId: idSchema,
    networkNodeIds: z.array(idSchema).default([]),
    tensorIds: z.array(idSchema).default([]),
    edgeIds: z.array(idSchema).default([]),
    evidenceIds: z.array(idSchema).default([]),
  }).strict()).min(1).max(MAX_DISPLAY_NODES),
  narrative: z.object({
    title: labelSchema,
    summary: labelSchema,
    stageSummaries: z.array(labelSchema).max(MAX_STAGE_SUMMARIES),
  }).strict(),
}).strict();

export function parseFigureSemanticModel(input: unknown, ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel {
  if (intent.target !== "preview") throw invalidSemanticModel("Only preview FigureIntent values are supported in the Phase 3 foundation");

  const parsed = figureSemanticModelSchema.safeParse(input);
  if (!parsed.success) throw invalidSemanticModel(parsed.error.message);
  validateModelReferences(parsed.data as FigureSemanticModel, ir);
  return parsed.data as FigureSemanticModel;
}

function validateModelReferences(model: FigureSemanticModel, ir: CanonicalNetworkIR): void {
  const displayIds = uniqueIds(model.displayNodes.map((node) => node.id), "display node");
  uniqueIds(model.displayRelations.map((relation) => relation.id), "display relation");
  uniqueIds(model.regions.map((region) => region.id), "region");

  for (const region of model.regions) {
    for (const displayId of region.displayIds) ensureKnown(displayIds, displayId, `Region "${region.id}" references an unknown display object`);
  }
  for (const relation of model.displayRelations) {
    ensureKnown(displayIds, relation.sourceDisplayId, `Relation "${relation.id}" has an unknown source display object`);
    ensureKnown(displayIds, relation.targetDisplayId, `Relation "${relation.id}" has an unknown target display object`);
    if (relation.sourceDisplayId === relation.targetDisplayId && relation.role !== "iteration") {
      throw invalidSemanticModel(`Relation "${relation.id}" cannot self-reference unless it is an iteration`);
    }
  }

  const nodeIds = new Set(ir.nodes.map((node) => node.id));
  const tensorIds = new Set(ir.tensors.map((tensor) => tensor.id));
  const edgeIds = new Set(ir.edges.map((edge) => edge.id));
  const evidenceIds = new Set([
    ...ir.nodes.flatMap((node) => node.sourceEvidenceIds),
    ...ir.edges.flatMap((edge) => edge.evidenceIds),
    ...ir.groups.flatMap((group) => group.sourceEvidenceIds),
    ...ir.unresolved.flatMap((unresolved) => unresolved.evidenceIds),
  ]);
  const mappings = new Map<string, FigureSourceMapping>();
  for (const mapping of model.sourceMappings) {
    ensureKnown(displayIds, mapping.displayId, `Source mapping references an unknown display object "${mapping.displayId}"`);
    if (mappings.has(mapping.displayId)) throw invalidSemanticModel(`Display object "${mapping.displayId}" has more than one source mapping`);
    if (mapping.networkNodeIds.length + mapping.tensorIds.length + mapping.edgeIds.length === 0) {
      throw invalidSemanticModel(`Display object "${mapping.displayId}" has no Canonical NetworkIR source`);
    }
    mapping.networkNodeIds.forEach((id) => ensureKnown(nodeIds, id, `Unknown Canonical NetworkIR node ID "${id}"`));
    mapping.tensorIds.forEach((id) => ensureKnown(tensorIds, id, `Unknown Canonical NetworkIR tensor ID "${id}"`));
    mapping.edgeIds.forEach((id) => ensureKnown(edgeIds, id, `Unknown Canonical NetworkIR edge ID "${id}"`));
    mapping.evidenceIds.forEach((id) => ensureKnown(evidenceIds, id, `Unknown public evidence ID "${id}"`));
    mappings.set(mapping.displayId, mapping);
  }
  for (const displayId of displayIds) {
    if (!mappings.has(displayId)) throw invalidSemanticModel(`Display object "${displayId}" is missing a source mapping`);
  }
}

function uniqueIds(ids: string[], description: string): Set<string> {
  const values = new Set<string>();
  for (const id of ids) {
    if (values.has(id)) throw invalidSemanticModel(`Duplicate ${description} ID "${id}"`);
    values.add(id);
  }
  return values;
}

function ensureKnown(values: Set<string>, id: string, message: string): void {
  if (!values.has(id)) throw invalidSemanticModel(message);
}

function invalidSemanticModel(cause: string): FoundationError {
  return new FoundationError(
    ApiErrorCode.VALIDATION_FAILED,
    "Figure semantic model failed validation",
    400,
    { cause },
  );
}
