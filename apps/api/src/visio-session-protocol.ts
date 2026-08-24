import { z } from "zod";
import { selectedPageVisioReadbackSchema, visioReadbackSchema } from "./visio-readback.js";
import { verifySelectedPageSealedPlan, type SelectedPageSealedPlanEnvelope } from "./visio-universal-protocol.js";

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
  jobId: identifier,
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
  version: z.literal(2),
  jobId: identifier,
  tenantId: identifier,
  userId: identifier,
  deviceId: identifier,
  workflowId: identifier,
  planId: identifier,
  planHash: fingerprint,
  documentId: identifier,
  pageId: identifier,
  documentFingerprint: fingerprint,
  pageFingerprint: fingerprint,
  expectedRevision,
  ownershipNamespace: identifier,
  expiresAt: z.string().datetime({ offset: true }),
  canonicalPlanBase64: z.string().min(1).max(2_000_000).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
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
export type SealedSelectedPageNativeIntent = SelectedPageSealedPlanEnvelope;
export interface TrustedSelectedPageCommandVerification {
  binding: TrustedSelectedPageBinding;
  sealedPlanSecret: string;
  now?: Date;
}
export type VisioSessionCommand = z.infer<typeof commandSchema>;
export type VisioSessionResponse = z.infer<typeof responseSchema>;
export type SelectedPageVisioSessionCommand = z.infer<typeof selectedPageCommandSchema>;
export type SelectedPageVisioSessionResponse = z.infer<typeof selectedPageResponseSchema>;

export function parseVisioSessionCommand(value: unknown): VisioSessionCommand { return parse(commandSchema, value, "request"); }
export function parseVisioSessionResponse(value: unknown): VisioSessionResponse { return parse(responseSchema, value, "response"); }
export function parseSelectedPageVisioSessionCommand(value: unknown, verification?: TrustedSelectedPageCommandVerification): SelectedPageVisioSessionCommand {
  const command = parse(selectedPageCommandSchema, value, "selected-page request");
  if (command.command !== "applyOwnedRegion") return command;
  if (!verification) throw new Error("Invalid Visio session selected-page request: applyOwnedRegion requires trusted sealed-intent verification");
  if (!sameBinding(command.binding, verification.binding)) throw new Error("Invalid Visio session selected-page request: selected page binding does not match trusted request");
  verifySelectedPageSealedPlan(command.sealedNativeIntent, { ...command.binding, planId: command.sealedNativeIntent.planId }, verification.sealedPlanSecret, verification.now);
  return command;
}
export function parseSelectedPageVisioSessionResponse(value: unknown, expected: TrustedSelectedPageBinding, expectedCommand: SelectedPageVisioSessionCommand): SelectedPageVisioSessionResponse {
  const response = parse(selectedPageResponseSchema, value, "selected-page response");
  if (!sameBinding(expectedCommand.binding, expected)) throw new Error("Invalid Visio selected-page response: expected command binding does not match the trusted request");
  if (response.requestId !== expectedCommand.requestId) throw new Error("Invalid Visio selected-page response: request ID does not match the expected command");
  if (response.selectedPage && !sameBinding(response.selectedPage, expected)) throw new Error("Invalid Visio selected-page response: selected page binding does not match the trusted request");
  if (response.readback && !sameReadbackTarget(response.readback, expected)) throw new Error("Invalid Visio selected-page response: readback binding does not match the trusted request");
  if (response.status === "succeeded" && expectedCommand.command === "readSelectedPage" && !response.readback) throw new Error("Invalid Visio selected-page response: successful readSelectedPage requires readback evidence");
  return response;
}

function sameBinding(value: Pick<TrustedSelectedPageBinding, "jobId" | "tenantId" | "userId" | "deviceId" | "workflowId" | "documentId" | "pageId" | "documentFingerprint" | "pageFingerprint" | "expectedRevision" | "ownershipNamespace">, expected: TrustedSelectedPageBinding): boolean {
  return value.jobId === expected.jobId && value.tenantId === expected.tenantId && value.userId === expected.userId && value.deviceId === expected.deviceId && value.workflowId === expected.workflowId && value.documentId === expected.documentId && value.pageId === expected.pageId && value.documentFingerprint === expected.documentFingerprint && value.pageFingerprint === expected.pageFingerprint && value.expectedRevision === expected.expectedRevision && value.ownershipNamespace === expected.ownershipNamespace;
}

function sameReadbackTarget(value: Pick<TrustedSelectedPageBinding, "documentId" | "pageId" | "documentFingerprint" | "pageFingerprint" | "expectedRevision" | "ownershipNamespace">, expected: TrustedSelectedPageBinding): boolean {
  return value.documentId === expected.documentId && value.pageId === expected.pageId && value.documentFingerprint === expected.documentFingerprint && value.pageFingerprint === expected.pageFingerprint && value.expectedRevision === expected.expectedRevision && value.ownershipNamespace === expected.ownershipNamespace;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`Invalid Visio session ${kind}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")}`);
}
