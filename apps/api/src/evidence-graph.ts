import { z } from "zod";

export type TensorRepresentation =
  | "spatial_feature_map" | "vector" | "token_sequence" | "query_sequence"
  | "node_feature" | "coordinate" | "state" | "scalar_distribution";
export type OperatorKind = "input" | "output" | "module" | "operator" | "merge" | "split" | "attention" | "repeat" | "process" | "adapter";
export type PortSemanticType = "data" | "query" | "key" | "value" | "mask" | "skip" | "condition" | "prediction" | "state";
export type AxisRole = "B" | "C" | "H" | "W" | "D" | "T" | "N" | "F" | "unknown";
export type ShapeExpr =
  | { kind: "known"; value: number }
  | { kind: "symbol"; name: string }
  | { kind: "derived"; operator: "add" | "subtract" | "multiply" | "divide" | "ceil_div"; operands: ShapeExpr[] }
  | { kind: "unknown" };
export interface TensorShape {
  axes: AxisRole[];
  dimensions: ShapeExpr[];
  batchSemantics: "independent" | "broadcastable" | "unknown";
}
export interface ProcessSemantic {
  id: string;
  kind: "iterative" | "recurrent" | "refinement" | "sampling";
  bodyNodeIds: string[];
  stateInputPortIds: string[];
  stateOutputPortIds: string[];
  iterationCount: number | "unknown";
  termination: "fixed_count" | "convergence" | "external_schedule" | "unknown";
}

export type FactKind =
  | "node_exists" | "node_kind" | "port_type" | "tensor_representation"
  | "edge_exists" | "merge_kind" | "skip_relation" | "attention_relation"
  | "repeat" | "stage_membership" | "shape" | "output_semantics"
  | "process_semantics" | "layout_hint" | "style_hint";
export type FactSubject =
  | { kind: "node"; nodeId: string }
  | { kind: "port"; nodeId: string; portId: string }
  | { kind: "edge"; sourcePortId: string; targetPortId: string }
  | { kind: "module"; moduleId: string }
  | { kind: "figure"; figureId: string };
export type FactPayload =
  | { kind: "node_exists"; operatorKind: OperatorKind }
  | { kind: "node_kind"; semanticRole: string }
  | { kind: "port_type"; representation: TensorRepresentation; semanticType: PortSemanticType }
  | { kind: "tensor_representation"; representation: TensorRepresentation }
  | { kind: "edge_exists"; transport: "data" | "condition" | "feedback" }
  | { kind: "merge_kind"; mergeKind: "add" | "concat" | "gated_sum"; concatAxis: AxisRole | null }
  | { kind: "skip_relation"; skipKind: "residual" | "cross_scale"; projection: boolean | null }
  | { kind: "attention_relation"; attentionKind: "self" | "cross"; queryPortId: string; keyPortId: string; valuePortId: string }
  | { kind: "repeat"; count: number | "unknown"; unitNodeIds: string[] }
  | { kind: "stage_membership"; moduleId: string }
  | { kind: "shape"; shape: TensorShape }
  | { kind: "output_semantics"; outputKind: "classification" | "segmentation" | "detection" | "generation" | "regression" | "embedding" | "other" }
  | { kind: "process_semantics"; process: ProcessSemantic }
  | { kind: "layout_hint"; hint: "main_path" | "inset_candidate" | "left_to_right" | "top_to_bottom" }
  | { kind: "style_hint"; token: "emphasize" | "deemphasize" | "monochrome" };
export interface CodeLocator { kind: "code"; startLine: number; startColumn: number; endLine: number; endColumn: number; }
export interface TextRangeLocator { kind: "text"; startOffset: number; endOffset: number; }
export interface ImageRegionLocator { kind: "image"; normalizedBounds: { x: number; y: number; width: number; height: number }; imageWidth: number; imageHeight: number; }
export type EvidenceLocator = CodeLocator | TextRangeLocator | ImageRegionLocator;
export interface EvidenceRef { sourceId: string; sourceSha256: string; locator: EvidenceLocator; excerptDigest: string; }
export type StructuralFact = {
  [K in FactKind]: {
    id: string;
    kind: K;
    subject: FactSubject;
    payload: Extract<FactPayload, { kind: K }>;
    evidenceRefs: EvidenceRef[];
    extractionConfidence: number;
    decisionConfidence: number;
    sourceRole: "code" | "sketch" | "text" | "reference" | "user_confirmation";
    scope: "architecture" | "narrative" | "style";
    status: "candidate" | "accepted" | "conflicted" | "superseded";
    analyzer: { id: string; version: string; policy: "static" | "vision" | "provider" | "user" };
    conflictGroupId: string | null;
    conflictKey: string;
  };
}[FactKind];
export interface FactRelation { id: string; fromFactId: string; toFactId: string; kind: "supports" | "contradicts" | "derives" | "supersedes" | "answers"; createdBy: "analyzer" | "reconciler" | "user"; }
export interface EvidenceGraph { version: 2; facts: StructuralFact[]; relations: FactRelation[]; }

const id = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "must be a stable identifier");
const boundedLabel = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:/ -]*$/, "must be a bounded semantic label");
const digest = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 hex digest");
const confidence = z.number().finite().min(0).max(1);
const axisRole = z.enum(["B", "C", "H", "W", "D", "T", "N", "F", "unknown"]);
const tensorRepresentation = z.enum(["spatial_feature_map", "vector", "token_sequence", "query_sequence", "node_feature", "coordinate", "state", "scalar_distribution"]);
const portSemanticType = z.enum(["data", "query", "key", "value", "mask", "skip", "condition", "prediction", "state"]);
const operatorKind = z.enum(["input", "output", "module", "operator", "merge", "split", "attention", "repeat", "process", "adapter"]);

const shapeExprSchema: z.ZodType<ShapeExpr> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), value: z.number().finite().positive().safe() }).strict(),
  z.object({ kind: z.literal("symbol"), name: id }).strict(),
  z.object({ kind: z.literal("derived"), operator: z.enum(["add", "subtract", "multiply", "divide", "ceil_div"]), operands: z.array(shapeExprSchema).min(1).max(8) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]));
const tensorShapeSchema: z.ZodType<TensorShape> = z.object({
  axes: z.array(axisRole).min(1).max(8).superRefine((axes, context) => {
    if (new Set(axes).size !== axes.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "shape axes must be unique" });
  }),
  dimensions: z.array(shapeExprSchema).min(1).max(8),
  batchSemantics: z.enum(["independent", "broadcastable", "unknown"]),
}).strict().superRefine((shape, context) => {
  if (shape.axes.length !== shape.dimensions.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "shape axes and dimensions must have the same length", path: ["dimensions"] });
});
const processSemanticSchema: z.ZodType<ProcessSemantic> = z.object({
  id,
  kind: z.enum(["iterative", "recurrent", "refinement", "sampling"]),
  bodyNodeIds: z.array(id).min(1).max(128),
  stateInputPortIds: z.array(id).max(32),
  stateOutputPortIds: z.array(id).max(32),
  iterationCount: z.union([z.number().int().positive().max(1_000_000), z.literal("unknown")]),
  termination: z.enum(["fixed_count", "convergence", "external_schedule", "unknown"]),
}).strict().superRefine((process, context) => {
  if (new Set(process.bodyNodeIds).size !== process.bodyNodeIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "process body node IDs must be unique", path: ["bodyNodeIds"] });
  if (process.termination === "fixed_count" && process.iterationCount === "unknown") context.addIssue({ code: z.ZodIssueCode.custom, message: "fixed-count process requires a numeric iteration count", path: ["iterationCount"] });
});
const subjectSchema: z.ZodType<FactSubject> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: id }).strict(),
  z.object({ kind: z.literal("port"), nodeId: id, portId: id }).strict(),
  z.object({ kind: z.literal("edge"), sourcePortId: id, targetPortId: id }).strict(),
  z.object({ kind: z.literal("module"), moduleId: id }).strict(),
  z.object({ kind: z.literal("figure"), figureId: id }).strict(),
]);
const locatorSchema: z.ZodType<EvidenceLocator> = z.union([
  z.object({ kind: z.literal("code"), startLine: z.number().int().positive(), startColumn: z.number().int().positive(), endLine: z.number().int().positive(), endColumn: z.number().int().positive() }).strict().superRefine((locator, context) => {
    if (locator.endLine < locator.startLine || (locator.endLine === locator.startLine && locator.endColumn <= locator.startColumn)) context.addIssue({ code: z.ZodIssueCode.custom, message: "code locator end must follow start" });
  }),
  z.object({ kind: z.literal("text"), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative() }).strict().superRefine((locator, context) => {
    if (locator.endOffset <= locator.startOffset) context.addIssue({ code: z.ZodIssueCode.custom, message: "text locator endOffset must follow startOffset" });
  }),
  z.object({ kind: z.literal("image"), normalizedBounds: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict(), imageWidth: z.number().int().positive().max(100_000), imageHeight: z.number().int().positive().max(100_000) }).strict().superRefine((locator, context) => {
    if (locator.normalizedBounds.x + locator.normalizedBounds.width > 1 || locator.normalizedBounds.y + locator.normalizedBounds.height > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "normalizedBounds must stay within the image", path: ["normalizedBounds"] });
  }),
]);
const evidenceRefSchema: z.ZodType<EvidenceRef> = z.object({ sourceId: id, sourceSha256: digest, locator: locatorSchema, excerptDigest: digest }).strict();
const payloadSchema: z.ZodType<FactPayload> = z.union([
  z.object({ kind: z.literal("node_exists"), operatorKind }).strict(),
  z.object({ kind: z.literal("node_kind"), semanticRole: boundedLabel }).strict(),
  z.object({ kind: z.literal("port_type"), representation: tensorRepresentation, semanticType: portSemanticType }).strict(),
  z.object({ kind: z.literal("tensor_representation"), representation: tensorRepresentation }).strict(),
  z.object({ kind: z.literal("edge_exists"), transport: z.enum(["data", "condition", "feedback"]) }).strict(),
  z.object({ kind: z.literal("merge_kind"), mergeKind: z.enum(["add", "concat", "gated_sum"]), concatAxis: axisRole.nullable() }).strict().superRefine((payload, context) => {
    if (payload.mergeKind === "concat" && payload.concatAxis == null) context.addIssue({ code: z.ZodIssueCode.custom, message: "concat merge requires concatAxis", path: ["concatAxis"] });
    if (payload.mergeKind !== "concat" && payload.concatAxis != null) context.addIssue({ code: z.ZodIssueCode.custom, message: "only concat merge may declare concatAxis", path: ["concatAxis"] });
  }),
  z.object({ kind: z.literal("skip_relation"), skipKind: z.enum(["residual", "cross_scale"]), projection: z.boolean().nullable() }).strict(),
  z.object({ kind: z.literal("attention_relation"), attentionKind: z.enum(["self", "cross"]), queryPortId: id, keyPortId: id, valuePortId: id }).strict(),
  z.object({ kind: z.literal("repeat"), count: z.union([z.number().int().positive().max(1_000_000), z.literal("unknown")]), unitNodeIds: z.array(id).min(1).max(128) }).strict(),
  z.object({ kind: z.literal("stage_membership"), moduleId: id }).strict(),
  z.object({ kind: z.literal("shape"), shape: tensorShapeSchema }).strict(),
  z.object({ kind: z.literal("output_semantics"), outputKind: z.enum(["classification", "segmentation", "detection", "generation", "regression", "embedding", "other"]) }).strict(),
  z.object({ kind: z.literal("process_semantics"), process: processSemanticSchema }).strict(),
  z.object({ kind: z.literal("layout_hint"), hint: z.enum(["main_path", "inset_candidate", "left_to_right", "top_to_bottom"]) }).strict(),
  z.object({ kind: z.literal("style_hint"), token: z.enum(["emphasize", "deemphasize", "monochrome"]) }).strict(),
]);
const factSchema = z.object({
  id,
  kind: z.enum(["node_exists", "node_kind", "port_type", "tensor_representation", "edge_exists", "merge_kind", "skip_relation", "attention_relation", "repeat", "stage_membership", "shape", "output_semantics", "process_semantics", "layout_hint", "style_hint"]),
  subject: subjectSchema,
  payload: payloadSchema,
  evidenceRefs: z.array(evidenceRefSchema).max(32),
  extractionConfidence: confidence,
  decisionConfidence: confidence,
  sourceRole: z.enum(["code", "sketch", "text", "reference", "user_confirmation"]),
  scope: z.enum(["architecture", "narrative", "style"]),
  status: z.enum(["candidate", "accepted", "conflicted", "superseded"]),
  analyzer: z.object({ id, version: z.string().min(1).max(64).regex(/^[0-9A-Za-z._-]+$/), policy: z.enum(["static", "vision", "provider", "user"]) }).strict(),
  conflictGroupId: id.nullable(),
  conflictKey: boundedLabel,
}).strict().superRefine((fact, context) => {
  if (fact.payload.kind !== fact.kind) context.addIssue({ code: z.ZodIssueCode.custom, message: "fact payload kind must match fact kind", path: ["payload", "kind"] });
  if (fact.status === "conflicted" && !fact.conflictGroupId) context.addIssue({ code: z.ZodIssueCode.custom, message: "conflicted fact requires conflictGroupId", path: ["conflictGroupId"] });
  if (fact.status !== "conflicted" && fact.conflictGroupId && fact.status === "accepted") context.addIssue({ code: z.ZodIssueCode.custom, message: "accepted fact cannot retain a conflictGroupId", path: ["conflictGroupId"] });
  if (fact.scope === "architecture" && fact.status === "accepted" && fact.sourceRole !== "user_confirmation" && fact.evidenceRefs.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "accepted architecture fact requires evidence", path: ["evidenceRefs"] });
  if (fact.sourceRole === "user_confirmation" && fact.analyzer.policy !== "user") context.addIssue({ code: z.ZodIssueCode.custom, message: "user confirmation requires user analyzer policy", path: ["analyzer", "policy"] });
});
const relationSchema: z.ZodType<FactRelation> = z.object({
  id,
  fromFactId: id,
  toFactId: id,
  kind: z.enum(["supports", "contradicts", "derives", "supersedes", "answers"]),
  createdBy: z.enum(["analyzer", "reconciler", "user"]),
}).strict();
const evidenceGraphSchema = z.object({ version: z.literal(2), facts: z.array(factSchema).max(1024), relations: z.array(relationSchema).max(2048) }).strict().superRefine((graph, context) => {
  const factIds = new Set<string>();
  for (const [index, fact] of graph.facts.entries()) {
    if (factIds.has(fact.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: "fact IDs must be unique", path: ["facts", index, "id"] });
    factIds.add(fact.id);
  }
  const relationIds = new Set<string>();
  for (const [index, relation] of graph.relations.entries()) {
    if (relationIds.has(relation.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: "relation IDs must be unique", path: ["relations", index, "id"] });
    relationIds.add(relation.id);
    for (const [field, factId] of [["fromFactId", relation.fromFactId], ["toFactId", relation.toFactId]] as const) {
      if (!factIds.has(factId)) context.addIssue({ code: z.ZodIssueCode.custom, message: `relation references unknown fact: ${factId}`, path: ["relations", index, field] });
    }
  }
});

export function parseEvidenceGraph(value: unknown): EvidenceGraph {
  return evidenceGraphSchema.parse(value) as unknown as EvidenceGraph;
}

export interface PublicEvidenceGraphSummary {
  version: 2;
  facts: Array<Pick<StructuralFact, "id" | "kind" | "subject" | "payload" | "extractionConfidence" | "decisionConfidence" | "sourceRole" | "scope" | "status" | "conflictGroupId" | "conflictKey"> & { evidenceCount: number }>;
  relations: FactRelation[];
}

export function publicEvidenceGraphSummary(value: EvidenceGraph): PublicEvidenceGraphSummary {
  const graph = parseEvidenceGraph(value);
  return {
    version: 2,
    facts: graph.facts.map(({ evidenceRefs, analyzer, ...fact }) => ({ ...fact, evidenceCount: evidenceRefs.length })),
    relations: graph.relations.map((relation) => ({ ...relation })),
  };
}
