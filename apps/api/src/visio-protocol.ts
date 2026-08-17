import { z } from "zod";
import { visioReadbackSchema } from "./visio-readback.js";

export const VISIO_PROTOCOL_VERSION = 1 as const;

const identifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const diagramNodeSchema = z.record(z.unknown());
const diagramEdgeSchema = z.record(z.unknown());
const diagramSchema = z.object({
  figure: z.record(z.unknown()).optional(),
  nodes: z.array(diagramNodeSchema),
  edges: z.array(diagramEdgeSchema),
}).passthrough();
const outputPathSchema = z.string().trim().min(1).refine((value) => value.toLowerCase().endsWith(".vsdx"), {
  message: "outputPath must end with .vsdx",
});

const visioWorkerRequestSchema = z.object({
  protocolVersion: z.literal(VISIO_PROTOCOL_VERSION),
  requestId: identifierSchema,
  jobId: identifierSchema,
  mode: z.enum(["mock", "live"]),
  outputPath: outputPathSchema,
  diagram: diagramSchema,
}).strict();

const workerErrorSchema = z.object({
  code: identifierSchema,
  message: z.string().trim().min(1).max(2000),
}).strict();

const visioWorkerResponseSchema = z.object({
  protocolVersion: z.literal(VISIO_PROTOCOL_VERSION),
  requestId: identifierSchema,
  jobId: identifierSchema,
  status: z.enum(["succeeded", "failed"]),
  path: outputPathSchema.nullable().optional(),
  readback: visioReadbackSchema.nullable().optional(),
  error: workerErrorSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "succeeded") {
    if (!value.path) context.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: "successful response requires a path" });
    if (!value.readback) context.addIssue({ code: z.ZodIssueCode.custom, path: ["readback"], message: "successful response requires readback" });
    if (value.error != null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "successful response cannot contain an error" });
  } else if (!value.error) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "failed response requires an error" });
  }
});

export type VisioWorkerRequest = z.infer<typeof visioWorkerRequestSchema>;
export type VisioWorkerResponse = z.infer<typeof visioWorkerResponseSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
  throw new Error(`Invalid Visio Worker ${kind}: ${detail}`);
}

export function parseVisioWorkerRequest(value: unknown): VisioWorkerRequest {
  return parse(visioWorkerRequestSchema, value, "request");
}

export function parseVisioWorkerResponse(value: unknown): VisioWorkerResponse {
  return parse(visioWorkerResponseSchema, value, "response");
}
