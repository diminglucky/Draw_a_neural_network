import { createHash } from "node:crypto";
import { z } from "zod";
import type { FigureAnalysisStatus } from "./figure-analysis.js";
import type { PublicComposableDagPublicationPlan } from "./figure-analysis-preview-service.js";
import type { CompilerManifest, PreviewArtifactHash, VisualQaResult } from "./plan-snapshot.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface AnalysisPlanSnapshotOwner {
  tenantId: string;
  userId: string;
}

export interface CreateAnalysisPlanSnapshotInput extends AnalysisPlanSnapshotOwner {
  analysisId: string;
  analysisStatus: FigureAnalysisStatus;
  architectureIrHash: string;
  figureIntentHash: string;
  publicationPlan: PublicComposableDagPublicationPlan;
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  previewArtifactHashes: PreviewArtifactHash[];
  createdAt: string;
}

export interface AnalysisPlanSnapshot extends AnalysisPlanSnapshotOwner {
  version: 1;
  snapshotId: string;
  analysisId: string;
  architectureIrHash: string;
  figureIntentHash: string;
  publicationPlanHash: string;
  publicationPlan: PublicComposableDagPublicationPlan;
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  previewArtifactHashes: PreviewArtifactHash[];
  createdAt: string;
  immutable: true;
}

export function createAnalysisPlanSnapshot(input: CreateAnalysisPlanSnapshotInput): AnalysisPlanSnapshot {
  const safe = validateInput(input);
  const publicationPlan = projectSafePublicationPlan(input.publicationPlan);
  const publicationPlanHash = sha256(canonicalJson(publicationPlan));
  const identity = {
    tenantId: input.tenantId,
    userId: input.userId,
    analysisId: input.analysisId,
    architectureIrHash: input.architectureIrHash,
    figureIntentHash: input.figureIntentHash,
    publicationPlanHash,
    compilerManifest: safe.compilerManifest,
    layoutSeed: safe.compilerManifest.layoutSeed,
    visualQa: safe.visualQa,
    previewArtifactHashes: safe.previewArtifactHashes,
  };
  const snapshotId = `analysis-plan-${sha256(canonicalJson(identity)).slice(0, 32)}`;
  return deepFreeze({
    version: 1,
    snapshotId,
    tenantId: input.tenantId,
    userId: input.userId,
    analysisId: input.analysisId,
    architectureIrHash: input.architectureIrHash,
    figureIntentHash: input.figureIntentHash,
    publicationPlanHash,
    publicationPlan,
    compilerManifest: structuredClone(safe.compilerManifest),
    visualQa: structuredClone(safe.visualQa),
    previewArtifactHashes: structuredClone(safe.previewArtifactHashes),
    createdAt: input.createdAt,
    immutable: true,
  });
}

export function cloneAnalysisPlanSnapshot(snapshot: AnalysisPlanSnapshot): AnalysisPlanSnapshot {
  return deepFreeze(structuredClone(snapshot));
}

export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(value, "canonical JSON");
}

const stableIdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedVersionSchema = z.string().trim().min(1).max(128);
const boundedTextSchema = z.string().min(1).max(256);
const finiteNumberSchema = z.number().finite();
const boundsSchema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.positive(),
  height: finiteNumberSchema.positive(),
}).strict();
const shapeExpressionSchema: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), value: z.number().finite().positive().safe() }).strict(),
  z.object({ kind: z.literal("symbol"), name: stableIdentifierSchema }).strict(),
  z.object({
    kind: z.literal("derived"),
    operator: z.enum(["add", "subtract", "multiply", "divide", "ceil_div"]),
    operands: z.array(shapeExpressionSchema).min(1).max(8),
  }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]));
const tensorShapeSchema = z.object({
  axes: z.array(z.enum(["B", "C", "H", "W", "D", "T", "N", "F", "unknown"])).min(1).max(8),
  dimensions: z.array(shapeExpressionSchema).min(1).max(8),
  batchSemantics: z.enum(["independent", "broadcastable", "unknown"]),
}).strict().superRefine((shape, context) => {
  if (shape.axes.length !== shape.dimensions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "shape axes and dimensions must have the same length", path: ["dimensions"] });
  }
});
const figurePortSchema = z.object({
  id: stableIdentifierSchema,
  direction: z.enum(["input", "output"]),
  representation: z.enum(["spatial_feature_map", "vector", "token_sequence", "query_sequence", "node_feature", "coordinate", "state", "scalar_distribution"]),
  semanticType: z.enum(["data", "query", "key", "value", "mask", "skip", "condition", "prediction", "state"]),
  shape: tensorShapeSchema.optional(),
}).strict().transform(({ shape, ...port }) => ({ ...port, ...(shape ? { shape } : {}) }));
const repeatSchema = z.object({
  count: z.union([z.number().int().positive().max(1_000_000), z.literal("unknown")]),
  unitNodeIds: z.array(stableIdentifierSchema).min(1).max(128),
  expansionPolicy: z.enum(["collapsed", "first_and_last", "fully_expanded"]),
}).strict();
const componentSchema = z.object({
  id: stableIdentifierSchema,
  kind: z.enum(["terminal", "operator", "merge", "attention", "repeat"]),
  semanticRole: boundedTextSchema,
  parentModuleId: stableIdentifierSchema.nullable(),
  bounds: boundsSchema,
  inputPorts: z.array(figurePortSchema).max(64),
  outputPorts: z.array(figurePortSchema).max(64),
  repeat: repeatSchema.optional(),
}).strict().transform(({ repeat, ...component }) => ({ ...component, ...(repeat ? { repeat } : {}) }));
const portRefSchema = z.object({ nodeId: stableIdentifierSchema, portId: stableIdentifierSchema }).strict();
const connectionSchema = z.object({
  id: stableIdentifierSchema,
  source: portRefSchema,
  target: portRefSchema,
  transport: z.enum(["data", "condition"]),
  route: z.array(z.object({ x: finiteNumberSchema, y: finiteNumberSchema }).strict()).min(2).max(16),
}).strict();
const figureIntentSchema = z.object({
  version: z.literal(1),
  purpose: z.enum(["paper_overview", "architecture_detail", "module_detail", "presentation"]),
  density: z.enum(["compact", "standard", "detailed"]),
  orientation: z.enum(["auto", "landscape", "portrait"]),
  printMode: z.enum(["color", "grayscale"]),
  emphasis: z.array(z.enum(["tensor_scale", "repetition", "branching", "skip", "attention", "fusion", "outputs"])).max(7),
  target: z.literal("preview"),
  stylePreset: z.enum(["publication_neutral", "publication_monochrome"]),
}).strict();
const componentStyleSchema = z.object({
  fill: z.string().min(1).max(32),
  stroke: z.string().min(1).max(32),
  grayscalePattern: z.enum(["solid", "stripe", "dot", "hatch", "none"]),
}).strict();
const connectionStyleSchema = z.object({
  stroke: z.string().min(1).max(32),
  grayscalePattern: z.enum(["solid", "dash", "dot", "double"]),
  thickness: finiteNumberSchema.positive().max(32),
}).strict();
const visualSpecSchema = z.object({
  page: z.object({
    background: z.string().min(1).max(32),
    minMargin: finiteNumberSchema.nonnegative(),
    minFontSizePt: finiteNumberSchema.positive().max(128),
    minContrastRatio: finiteNumberSchema.nonnegative().max(21),
  }).strict(),
  componentStyles: z.object({
    terminal: componentStyleSchema,
    operator: componentStyleSchema,
    merge: componentStyleSchema,
    attention: componentStyleSchema,
    repeat: componentStyleSchema,
  }).strict(),
  connectionStyles: z.object({ data: connectionStyleSchema, condition: connectionStyleSchema }).strict(),
  labels: z.array(z.object({
    id: stableIdentifierSchema,
    semanticId: stableIdentifierSchema,
    text: boundedTextSchema,
    bounds: boundsSchema,
    fontSizePt: finiteNumberSchema.positive().max(128),
  }).strict()).max(512),
}).strict();
const publicPublicationPlanSchema = z.object({
  version: z.literal(1),
  graphId: stableIdentifierSchema,
  compilerVersion: boundedVersionSchema,
  layoutVersion: boundedVersionSchema,
  intent: figureIntentSchema,
  pageBounds: boundsSchema,
  components: z.array(componentSchema).min(1).max(512),
  connections: z.array(connectionSchema).max(1024),
  visualSpec: visualSpecSchema,
  qaVersion: boundedVersionSchema,
}).strict();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const compilerManifestSchema = z.object({
  canonicalization: z.literal("RFC-8785-JCS"),
  architectureIrHash: digestSchema,
  figureIntentHash: digestSchema,
  componentCompilerVersion: boundedVersionSchema,
  layoutCompilerVersion: boundedVersionSchema,
  styleTokenVersion: boundedVersionSchema,
  layoutSeed: boundedVersionSchema,
}).strict();
const visualQaCheckSchema = z.object({
  id: stableIdentifierSchema,
  severity: z.enum(["blocking", "warning"]),
  passed: z.boolean(),
  message: z.string().min(1).max(512),
}).strict();
const visualQaSchema = z.object({
  status: z.enum(["pass", "fail"]),
  checks: z.array(visualQaCheckSchema).min(1).max(256),
}).strict();
const previewArtifactHashSchema = z.object({
  panelId: stableIdentifierSchema,
  kind: z.enum(["svg", "png"]),
  sha256: digestSchema,
}).strict();
const isoTimestampSchema = z.string().datetime({ offset: true, precision: 3 });

export function projectSafePublicationPlan(value: unknown): PublicComposableDagPublicationPlan {
  const parsed = publicPublicationPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error(`publication plan failed safe projection: ${parsed.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}`);
  return structuredClone(parsed.data) as PublicComposableDagPublicationPlan;
}

function validateInput(input: CreateAnalysisPlanSnapshotInput): {
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  previewArtifactHashes: PreviewArtifactHash[];
} {
  assertOwner(input);
  requireIdentifier(input.analysisId, "analysisId");
  if (input.analysisStatus !== "ready_for_preview") throw new Error("AnalysisPlanSnapshot requires a ready analysis");
  requireDigest(input.architectureIrHash, "architectureIrHash");
  requireDigest(input.figureIntentHash, "figureIntentHash");
  const compilerManifest = compilerManifestSchema.parse(input.compilerManifest) as CompilerManifest;
  const visualQa = visualQaSchema.parse(input.visualQa) as VisualQaResult;
  const previewArtifactHashes = z.array(previewArtifactHashSchema).min(1).max(1024).parse(input.previewArtifactHashes) as PreviewArtifactHash[];
  if (compilerManifest.architectureIrHash !== input.architectureIrHash) throw new Error("compiler manifest architecture IR hash must match the snapshot");
  if (compilerManifest.figureIntentHash !== input.figureIntentHash) throw new Error("compiler manifest figure intent hash must match the snapshot");
  for (const field of [
    compilerManifest.componentCompilerVersion,
    compilerManifest.layoutCompilerVersion,
    compilerManifest.styleTokenVersion,
    compilerManifest.layoutSeed,
  ]) if (!isBoundedText(field, 128)) throw new Error("compiler manifest contains an invalid value");
  if (visualQa.status !== "pass" || visualQa.checks.some((check) => check.severity === "blocking" && !check.passed)) {
    throw new Error("AnalysisPlanSnapshot requires passing blocking visual QA");
  }
  const artifactKeys = new Set<string>();
  for (const artifact of previewArtifactHashes) {
    const key = `${artifact.panelId}:${artifact.kind}`;
    if (artifactKeys.has(key)) throw new Error("preview artifact panel/kind pairs must be unique");
    artifactKeys.add(key);
  }
  isoTimestampSchema.parse(input.createdAt);
  return { compilerManifest, visualQa, previewArtifactHashes };
}

function assertOwner(owner: AnalysisPlanSnapshotOwner): void {
  requireIdentifier(owner.tenantId, "tenantId");
  requireIdentifier(owner.userId, "userId");
}

function assertSafeJson(value: unknown, path: string): asserts value is JsonValue {
  assertJsonValue(value, path, true);
}

function assertJsonValue(value: unknown, path: string, rejectForbiddenFields: boolean): asserts value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, rejectForbiddenFields));
    return;
  }
  if (!value || typeof value !== "object" || !isPlainObject(value)) throw new Error(`${path} must contain JSON values only`);
  for (const [key, item] of Object.entries(value)) {
    if (rejectForbiddenFields && isForbiddenFieldName(key)) throw new Error(`${path}.${key} is a forbidden snapshot field`);
    assertJsonValue(item, `${path}.${key}`, rejectForbiddenFields);
  }
}

function serializeCanonicalJson(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertNoLoneSurrogate(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => serializeCanonicalJson(item, `${path}[${index}]`)).join(",")}]`;
  if (!value || typeof value !== "object" || !isPlainObject(value)) throw new Error(`${path} must contain JSON values only`);

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return `{${keys.map((key) => {
    assertNoLoneSurrogate(key, `${path} key`);
    return `${JSON.stringify(key)}:${serializeCanonicalJson(record[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

function assertNoLoneSurrogate(value: string, path: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) throw new Error(`${path} contains a lone UTF-16 surrogate`);
      index++;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) throw new Error(`${path} contains a lone UTF-16 surrogate`);
  }
}

function isForbiddenFieldName(value: string): boolean {
  const normalized = value.toLowerCase();
  return ["source", "provider", "evidence", "locator", "worker", "path", "command"].some((fragment) => normalized.includes(fragment));
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function requireDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
}

function isBoundedText(value: string, maximum: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
