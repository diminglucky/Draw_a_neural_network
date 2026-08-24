import { z } from "zod";
import { selectedPageVisioReadbackSchema, visioReadbackSchema } from "./visio-readback.js";

export const VISIO_SESSION_PROTOCOL_VERSION = 2 as const;
export const SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION = 3 as const;

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const outputPath = z.string().trim().min(1).max(4096).refine((value) => value.toLowerCase().endsWith(".vsdx"), "outputPath must end with .vsdx");
const diagram = z.object({ figure: z.record(z.unknown()).optional(), nodes: z.array(z.record(z.unknown())), edges: z.array(z.record(z.unknown())) }).passthrough();
const session = z.object({ tenantId: identifier, userId: identifier, deviceId: identifier, workflowId: identifier }).strict();
const base = { protocolVersion: z.literal(VISIO_SESSION_PROTOCOL_VERSION), requestId: identifier, session };
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);
const expectedRevision = z.number().int().nonnegative();
const selectedPageBindingSchema = z.object({
  tenantId: identifier,
  userId: identifier,
  deviceId: identifier,
  workflowId: identifier,
  documentId: identifier,
  pageId: identifier,
  documentFingerprint: fingerprint,
  pageFingerprint: fingerprint,
  expectedRevision,
  ownershipNamespace: identifier,
}).strict();
const sealedNativeIntentSchema = z.object({
  intentId: identifier,
  planId: identifier,
  planHash: fingerprint,
  documentId: identifier,
  pageId: identifier,
  expectedRevision,
  ownershipNamespace: identifier,
  signature: z.string().trim().min(1).max(512),
}).strict();
const selectedPageBase = {
  protocolVersion: z.literal(SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION),
  requestId: identifier,
  binding: selectedPageBindingSchema,
};

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

const selectedPageCommandSchema = z.discriminatedUnion("command", [
  z.object({ ...selectedPageBase, command: z.literal("attachSelectedPage") }).strict(),
  z.object({ ...selectedPageBase, command: z.literal("applyOwnedRegion"), ownershipNamespace: identifier, sealedNativeIntent: sealedNativeIntentSchema }).strict(),
  z.object({ ...selectedPageBase, command: z.literal("saveSelectedDocument") }).strict(),
  z.object({ ...selectedPageBase, command: z.literal("readSelectedPage") }).strict(),
  z.object({ ...selectedPageBase, command: z.literal("closeSession") }).strict(),
]).superRefine((command, context) => {
  if (command.command !== "applyOwnedRegion") return;
  const { binding, sealedNativeIntent } = command;
  if (command.ownershipNamespace !== binding.ownershipNamespace || sealedNativeIntent.ownershipNamespace !== binding.ownershipNamespace) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ownershipNamespace"], message: "ownershipNamespace must match the selected-page binding" });
  }
  for (const field of ["documentId", "pageId", "expectedRevision"] as const) {
    if (sealedNativeIntent[field] !== binding[field]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sealedNativeIntent", field], message: `sealed native intent ${field} must match the selected-page binding` });
    }
  }
});

const selectedPageResponseSchema = z.object({
  protocolVersion: z.literal(SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION),
  requestId: identifier,
  status: z.enum(["succeeded", "failed"]),
  selectedPage: selectedPageBindingSchema.optional(),
  readback: selectedPageVisioReadbackSchema.optional(),
  error: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "succeeded" && (!value.selectedPage || value.error)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "successful selected-page response requires selectedPage and no error" });
  }
  if (value.status === "failed" && !value.error) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "failed selected-page response requires an error" });
  }
});

export interface TrustedVisioSessionIdentity { tenantId: string; userId: string; deviceId: string; workflowId: string; }
export type TrustedSelectedPageBinding = z.infer<typeof selectedPageBindingSchema>;
export type SealedSelectedPageNativeIntent = z.infer<typeof sealedNativeIntentSchema>;
export type VisioSessionCommand = z.infer<typeof commandSchema>;
export type VisioSessionResponse = z.infer<typeof responseSchema>;
export type SelectedPageVisioSessionCommand = z.infer<typeof selectedPageCommandSchema>;
export type SelectedPageVisioSessionResponse = z.infer<typeof selectedPageResponseSchema>;

export function parseVisioSessionCommand(value: unknown): VisioSessionCommand { return parse(commandSchema, value, "request"); }
export function parseVisioSessionResponse(value: unknown): VisioSessionResponse { return parse(responseSchema, value, "response"); }
export function parseSelectedPageVisioSessionCommand(value: unknown): SelectedPageVisioSessionCommand { return parse(selectedPageCommandSchema, value, "selected-page request"); }
export function parseSelectedPageVisioSessionResponse(value: unknown, expected?: TrustedSelectedPageBinding): SelectedPageVisioSessionResponse {
  const response = parse(selectedPageResponseSchema, value, "selected-page response");
  if (expected && response.selectedPage && !sameBinding(response.selectedPage, expected)) throw new Error("Invalid Visio selected-page response: selected page binding does not match the trusted request");
  if (expected && response.readback && !sameReadbackTarget(response.readback, expected)) throw new Error("Invalid Visio selected-page response: readback binding does not match the trusted request");
  return response;
}

function sameBinding(value: Pick<TrustedSelectedPageBinding, "tenantId" | "userId" | "deviceId" | "workflowId" | "documentId" | "pageId" | "documentFingerprint" | "pageFingerprint" | "expectedRevision" | "ownershipNamespace">, expected: TrustedSelectedPageBinding): boolean {
  return value.tenantId === expected.tenantId && value.userId === expected.userId && value.deviceId === expected.deviceId && value.workflowId === expected.workflowId && value.documentId === expected.documentId && value.pageId === expected.pageId && value.documentFingerprint === expected.documentFingerprint && value.pageFingerprint === expected.pageFingerprint && value.expectedRevision === expected.expectedRevision && value.ownershipNamespace === expected.ownershipNamespace;
}

function sameReadbackTarget(value: Pick<TrustedSelectedPageBinding, "documentId" | "pageId" | "documentFingerprint" | "pageFingerprint" | "expectedRevision" | "ownershipNamespace">, expected: TrustedSelectedPageBinding): boolean {
  return value.documentId === expected.documentId && value.pageId === expected.pageId && value.documentFingerprint === expected.documentFingerprint && value.pageFingerprint === expected.pageFingerprint && value.expectedRevision === expected.expectedRevision && value.ownershipNamespace === expected.ownershipNamespace;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`Invalid Visio session ${kind}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")}`);
}
