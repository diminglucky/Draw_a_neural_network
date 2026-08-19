import { z } from "zod";
import { visioReadbackSchema } from "./visio-readback.js";

export const VISIO_SESSION_PROTOCOL_VERSION = 2 as const;

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const outputPath = z.string().trim().min(1).max(4096).refine((value) => value.toLowerCase().endsWith(".vsdx"), "outputPath must end with .vsdx");
const diagram = z.object({ figure: z.record(z.unknown()).optional(), nodes: z.array(z.record(z.unknown())), edges: z.array(z.record(z.unknown())) }).passthrough();
const session = z.object({ tenantId: identifier, userId: identifier, deviceId: identifier, workflowId: identifier }).strict();
const base = { protocolVersion: z.literal(VISIO_SESSION_PROTOCOL_VERSION), requestId: identifier, session };

const commandSchema = z.discriminatedUnion("command", [
  z.object({ ...base, command: z.literal("open"), outputPath }).strict(),
  z.object({ ...base, command: z.literal("apply"), operationId: identifier, diagram }).strict(),
  z.object({ ...base, command: z.literal("applyDiff"), operationId: identifier, diagram }).strict(),
  z.object({ ...base, command: z.literal("save"), outputPath }).strict(),
  z.object({ ...base, command: z.literal("close"), closeDisposition: z.literal("save") }).strict(),
]);

const responseSchema = z.object({
  requestId: identifier,
  status: z.enum(["succeeded", "failed"]),
  outputPath: outputPath.optional(),
  error: z.string().trim().min(1).max(2000).optional(),
  readback: visioReadbackSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "succeeded" && value.error) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "successful response cannot contain an error" });
  if (value.status === "failed" && !value.error) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "failed response requires an error" });
});

export interface TrustedVisioSessionIdentity { tenantId: string; userId: string; deviceId: string; workflowId: string; }
export type VisioSessionCommand = z.infer<typeof commandSchema>;
export type VisioSessionResponse = z.infer<typeof responseSchema>;

export function parseVisioSessionCommand(value: unknown): VisioSessionCommand { return parse(commandSchema, value, "request"); }
export function parseVisioSessionResponse(value: unknown): VisioSessionResponse { return parse(responseSchema, value, "response"); }

function parse<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`Invalid Visio session ${kind}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")}`);
}
