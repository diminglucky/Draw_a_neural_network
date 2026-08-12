import { z } from "zod";
import { ApiErrorCode, FoundationError } from "./domain.js";

const supportedNodeKinds = [
  "input",
  "output",
  "conv",
  "depthwise-conv",
  "pool",
  "upsample",
  "normalization",
  "activation",
  "residual",
  "concat",
  "add",
  "flatten",
  "dense",
  "attention",
  "transformer-block",
  "embedding",
  "token",
  "feature-map",
  "volume",
  "classifier",
  "loss",
] as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const idSchema = z.string().trim().min(1);
const nullableStringSchema = z.string().trim().min(1).nullable().optional().default(null);
const confidenceSchema = z.number().min(0).max(1);

const sourceEvidenceSchema = z
  .object({
    type: z.string().trim().min(1),
    value: z.string().trim().min(1),
    locator: nullableStringSchema,
    excerpt: nullableStringSchema,
  })
  .strict();

const tensorSchema = z
  .object({
    shape: z.array(z.union([z.number().int(), z.string().trim().min(1)])).min(1),
    dtype: nullableStringSchema,
  })
  .strict();

const figureSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1),
    description: nullableStringSchema,
  })
  .strict();

const nodeSchema = z
  .object({
    id: idSchema,
    kind: z.enum(supportedNodeKinds),
    label: z.string().trim().min(1),
    subtitle: z.string().max(512).optional().default(""),
    tensor: tensorSchema.nullable().optional().default(null),
    stage: z.number().int().nonnegative(),
    confidence: confidenceSchema.nullable().optional().default(null),
    sourceEvidence: z.array(sourceEvidenceSchema).optional().default([]),
  })
  .strict();

const edgeSchema = z
  .object({
    source: idSchema,
    target: idSchema,
    kind: z.string().trim().min(1),
    label: nullableStringSchema,
    shape: nullableStringSchema,
    skip: z.boolean().optional().default(false),
    confidence: confidenceSchema.nullable().optional().default(null),
    sourceEvidence: z.array(sourceEvidenceSchema).optional().default([]),
  })
  .strict();

const groupSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1),
    nodeIds: z.array(idSchema).default([]),
    confidence: confidenceSchema.nullable().optional().default(null),
    sourceEvidence: z.array(sourceEvidenceSchema).optional().default([]),
  })
  .strict();

const annotationSchema = z
  .object({
    id: idSchema,
    text: z.string().trim().min(1),
    targetId: nullableStringSchema,
    confidence: confidenceSchema.nullable().optional().default(null),
    sourceEvidence: z.array(sourceEvidenceSchema).optional().default([]),
    metadata: z.record(jsonValueSchema).optional().default({}),
  })
  .strict();

export const networkIRSchema = z
  .object({
    figure: figureSchema,
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema).default([]),
    groups: z.array(groupSchema).optional().default([]),
    annotations: z.array(annotationSchema).optional().default([]),
    style: z.record(jsonValueSchema).optional().default({}),
    layout: z.record(jsonValueSchema).optional().default({}),
  })
  .strict();

export type NetworkIR = z.infer<typeof networkIRSchema>;

export interface NetworkIRValidationIssue {
  code: string;
  message: string;
  path: string;
}

export interface NetworkIRValidationResult {
  valid: boolean;
  issues: NetworkIRValidationIssue[];
  ir: NetworkIR | null;
}

export function validateNetworkIR(input: unknown): NetworkIRValidationResult {
  const parsed = networkIRSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: `schema:${issue.code}`,
        message: issue.message,
        path: formatPath(issue.path),
      })),
      ir: null,
    };
  }

  const issues = validateSemantics(parsed.data);
  return {
    valid: issues.length === 0,
    issues,
    ir: parsed.data,
  };
}

export function parseNetworkIR(input: unknown): NetworkIR {
  const result = validateNetworkIR(input);
  if (!result.valid || !result.ir) {
    throw new FoundationError(
      ApiErrorCode.VALIDATION_FAILED,
      buildValidationMessage(result.issues),
      400,
      { issues: result.issues },
    );
  }

  return result.ir;
}

function validateSemantics(ir: NetworkIR): NetworkIRValidationIssue[] {
  const issues: NetworkIRValidationIssue[] = [];
  const nodeIndexById = new Map<string, number>();

  for (const [index, node] of ir.nodes.entries()) {
    if (nodeIndexById.has(node.id)) {
      issues.push({
        code: "duplicate-node-id",
        message: `Duplicate node id "${node.id}" is not allowed`,
        path: `nodes[${index}].id`,
      });
      continue;
    }

    nodeIndexById.set(node.id, index);
  }

  const adjacency = new Map<string, Set<string>>();

  for (const [index, edge] of ir.edges.entries()) {
    if (edge.source === edge.target) {
      issues.push({
        code: "illegal-self-loop",
        message: `Edge ${edge.source} → ${edge.target} cannot form a self-loop`,
        path: `edges[${index}]`,
      });
    }

    if (!nodeIndexById.has(edge.source)) {
      issues.push({
        code: "missing-edge-endpoint",
        message: `Edge source "${edge.source}" does not reference a known node`,
        path: `edges[${index}].source`,
      });
    }

    if (!nodeIndexById.has(edge.target)) {
      issues.push({
        code: "missing-edge-endpoint",
        message: `Edge target "${edge.target}" does not reference a known node`,
        path: `edges[${index}].target`,
      });
    }

    if (nodeIndexById.has(edge.source) && nodeIndexById.has(edge.target)) {
      const outgoing = adjacency.get(edge.source) ?? new Set<string>();
      outgoing.add(edge.target);
      adjacency.set(edge.source, outgoing);
    }
  }

  const reachable = new Set<string>();
  const pending = ir.nodes.filter((node) => node.kind === "input").map((node) => node.id);

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) pending.push(next);
    }
  }

  for (const [index, node] of ir.nodes.entries()) {
    if (node.kind === "output" && !reachable.has(node.id)) {
      issues.push({
        code: "unreachable-output",
        message: `Output node "${node.id}" is not reachable from any input node`,
        path: `nodes[${index}]`,
      });
    }
  }

  return issues;
}

function buildValidationMessage(issues: NetworkIRValidationIssue[]): string {
  if (issues.length === 0) {
    return "Network IR validation failed";
  }

  const [firstIssue] = issues;
  return `Network IR validation failed: ${firstIssue.message} (${firstIssue.path})`;
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "$";

  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === "number") {
      return `${accumulator}[${segment}]`;
    }

    return accumulator ? `${accumulator}.${segment}` : segment;
  }, "");
}
