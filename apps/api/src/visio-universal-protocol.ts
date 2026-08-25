import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./plan-snapshot.js";

export const UNIVERSAL_VISIO_PROTOCOL_VERSION = 1 as const;
export const SELECTED_PAGE_UNIVERSAL_VISIO_PROTOCOL_VERSION = 2 as const;

export interface SealedPlanEnvelope {
  version: 1;
  jobId: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  planId: string;
  planHash: string;
  expiresAt: string;
  canonicalPlanBase64: string;
  signature: string;
}
export interface CreateSealedPlanInput {
  jobId: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  planId: string;
  canonicalPlanBytes: Buffer;
  expiresAt: string;
}
export interface UniversalVisioWorkerRequest {
  protocolVersion: 1;
  requestId: string;
  jobId: string;
  mode: "mock" | "live";
  sealedPlan: SealedPlanEnvelope;
}
export interface UniversalVisioArtifact {
  format: "vsdx" | "pdf" | "png";
  sha256: string;
  bytes: number;
}
export interface UniversalNativeShapeReadback {
  semanticId: string;
  nativeShapeId: string;
  shapeKind: string;
}
export interface UniversalConnectorEndpointReadback {
  semanticId: string;
  sourceNativeShapeId: string;
  targetNativeShapeId: string;
}
export interface UniversalVisioReadback {
  valid: true;
  shapeCount: number;
  connectorCount: number;
  nativeShapes: UniversalNativeShapeReadback[];
  connectorEndpoints: UniversalConnectorEndpointReadback[];
}
export interface UniversalRendererQaCheck { passed: boolean; detail: string; }
export interface UniversalRendererQa {
  pageFit: UniversalRendererQaCheck;
  textOverflow: UniversalRendererQaCheck;
  fontFallback: UniversalRendererQaCheck;
  connectorEndpoints: UniversalRendererQaCheck;
  ocrReadability: UniversalRendererQaCheck;
  geometryTolerance: UniversalRendererQaCheck;
  officeContentSafety: UniversalRendererQaCheck;
}
export interface UniversalVisioWorkerSuccessResponse {
  protocolVersion: 1;
  requestId: string;
  jobId: string;
  status: "succeeded";
  artifacts: UniversalVisioArtifact[];
  readback: UniversalVisioReadback;
  rendererQa: UniversalRendererQa;
}
export interface UniversalVisioWorkerFailureResponse {
  protocolVersion: 1;
  requestId: string;
  jobId: string;
  status: "failed";
  error: { code: string; message: string };
}
export type UniversalVisioWorkerResponse = UniversalVisioWorkerSuccessResponse | UniversalVisioWorkerFailureResponse;
export interface SealedPlanBinding { jobId: string; tenantId: string; userId: string; deviceId: string; planId: string; }
export interface SelectedPageSealedPlanEnvelope {
  version: 2;
  jobId: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  workflowId: string;
  documentId: string;
  pageId: string;
  documentFingerprint: string;
  pageFingerprint: string;
  expectedRevision: number;
  ownershipNamespace: string;
  planId: string;
  planHash: string;
  expiresAt: string;
  canonicalPlanBase64: string;
  signature: string;
}
export interface CreateSelectedPageSealedPlanInput extends Omit<SelectedPageSealedPlanEnvelope, "version" | "planHash" | "canonicalPlanBase64" | "signature"> {
  canonicalPlanBytes: Buffer;
}
export interface SelectedPageSealedPlanBinding {
  jobId: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  workflowId: string;
  documentId: string;
  pageId: string;
  documentFingerprint: string;
  pageFingerprint: string;
  expectedRevision: number;
  ownershipNamespace: string;
  planId: string;
}
export interface SelectedPageUniversalVisioWorkerRequest {
  protocolVersion: 2;
  requestId: string;
  jobId: string;
  mode: "mock" | "live";
  sealedPlan: SelectedPageSealedPlanEnvelope;
}

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().nonnegative();
const sealedPlanSchema = z.object({
  version: z.literal(1),
  jobId: identifier,
  tenantId: identifier,
  userId: identifier,
  deviceId: identifier,
  planId: identifier,
  planHash: hash,
  expiresAt: z.string().datetime({ offset: true }),
  canonicalPlanBase64: z.string().min(1).max(2_000_000).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const universalVisioWorkerRequestSchema = z.object({
  protocolVersion: z.literal(UNIVERSAL_VISIO_PROTOCOL_VERSION),
  requestId: identifier,
  jobId: identifier,
  mode: z.enum(["mock", "live"]),
  sealedPlan: sealedPlanSchema,
}).strict().superRefine((request, context) => {
  if (request.jobId !== request.sealedPlan.jobId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Worker request jobId must match sealed plan jobId", path: ["sealedPlan", "jobId"] });
});
const selectedPageSealedPlanSchema = z.object({
  version: z.literal(2),
  jobId: identifier,
  tenantId: identifier,
  userId: identifier,
  deviceId: identifier,
  workflowId: identifier,
  documentId: identifier,
  pageId: identifier,
  documentFingerprint: hash,
  pageFingerprint: hash,
  expectedRevision: revision,
  ownershipNamespace: identifier,
  planId: identifier,
  planHash: hash,
  expiresAt: z.string().datetime({ offset: true }),
  canonicalPlanBase64: z.string().min(1).max(2_000_000).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const selectedPageUniversalVisioWorkerRequestSchema = z.object({
  protocolVersion: z.literal(SELECTED_PAGE_UNIVERSAL_VISIO_PROTOCOL_VERSION),
  requestId: identifier,
  jobId: identifier,
  mode: z.enum(["mock", "live"]),
  sealedPlan: selectedPageSealedPlanSchema,
}).strict().superRefine((request, context) => {
  if (request.jobId !== request.sealedPlan.jobId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sealedPlan", "jobId"], message: "Selected-page Worker request jobId must match sealed plan jobId" });
});
const universalArtifactSchema = z.object({
  format: z.enum(["vsdx", "pdf", "png"]),
  sha256: hash,
  bytes: z.number().int().positive(),
}).strict();
const universalQaCheckSchema = z.object({
  passed: z.boolean(),
  detail: z.string().trim().min(1).max(2_000),
}).strict();
const universalReadbackSchema = z.object({
  valid: z.literal(true),
  shapeCount: z.number().int().nonnegative(),
  connectorCount: z.number().int().nonnegative(),
  nativeShapes: z.array(z.object({ semanticId: identifier, nativeShapeId: identifier, shapeKind: z.string().trim().min(1).max(128) }).strict()),
  connectorEndpoints: z.array(z.object({ semanticId: identifier, sourceNativeShapeId: identifier, targetNativeShapeId: identifier }).strict()),
}).strict();
const universalRendererQaSchema = z.object({
  pageFit: universalQaCheckSchema,
  textOverflow: universalQaCheckSchema,
  fontFallback: universalQaCheckSchema,
  connectorEndpoints: universalQaCheckSchema,
  ocrReadability: universalQaCheckSchema,
  geometryTolerance: universalQaCheckSchema,
  officeContentSafety: universalQaCheckSchema,
}).strict();
const universalVisioWorkerResponseSchema = z.object({
  protocolVersion: z.literal(UNIVERSAL_VISIO_PROTOCOL_VERSION),
  requestId: identifier,
  jobId: identifier,
  status: z.enum(["succeeded", "failed"]),
  artifacts: z.array(universalArtifactSchema).optional(),
  readback: universalReadbackSchema.optional(),
  rendererQa: universalRendererQaSchema.optional(),
  error: z.object({ code: identifier, message: z.string().trim().min(1).max(2_000) }).strict().optional(),
}).strict().superRefine((response, context) => {
  if (response.status === "failed") {
    if (!response.error) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "failed response requires an error" });
    if (response.artifacts || response.readback || response.rendererQa) context.addIssue({ code: z.ZodIssueCode.custom, message: "failed response cannot include output evidence" });
    return;
  }
  if (response.error) context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "successful response cannot include an error" });
  if (!response.artifacts || !response.readback || !response.rendererQa) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "successful response requires artifacts, readback, and renderer QA" });
    return;
  }
  const formats = response.artifacts.map((artifact) => artifact.format).sort().join(",");
  if (formats !== "pdf,png,vsdx") context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifacts"], message: "successful response requires exactly one VSDX, PDF, and PNG artifact" });
});

export function createSealedPlan(input: CreateSealedPlanInput, secret: string): SealedPlanEnvelope {
  if (!secret.trim()) throw new Error("sealed plan secret is required");
  validateBinding(input);
  if (!(input.canonicalPlanBytes instanceof Buffer) || input.canonicalPlanBytes.length === 0) throw new Error("sealed plan requires canonical plan bytes");
  if (!Number.isFinite(Date.parse(input.expiresAt))) throw new Error("sealed plan expiration is invalid");
  const unsigned = {
    version: 1 as const,
    jobId: input.jobId,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    planId: input.planId,
    planHash: sha256(input.canonicalPlanBytes),
    expiresAt: input.expiresAt,
    canonicalPlanBase64: input.canonicalPlanBytes.toString("base64url"),
  };
  return { ...unsigned, signature: sign(unsigned, secret) };
}

export function createSelectedPageSealedPlan(input: CreateSelectedPageSealedPlanInput, secret: string): SelectedPageSealedPlanEnvelope {
  if (!secret.trim()) throw new Error("selected-page sealed plan secret is required");
  validateSelectedPageBinding(input);
  if (!(input.canonicalPlanBytes instanceof Buffer) || input.canonicalPlanBytes.length === 0) throw new Error("selected-page sealed plan requires canonical plan bytes");
  if (!Number.isFinite(Date.parse(input.expiresAt))) throw new Error("selected-page sealed plan expiration is invalid");
  const unsigned = {
    version: 2 as const,
    jobId: input.jobId,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    workflowId: input.workflowId,
    documentId: input.documentId,
    pageId: input.pageId,
    documentFingerprint: input.documentFingerprint,
    pageFingerprint: input.pageFingerprint,
    expectedRevision: input.expectedRevision,
    ownershipNamespace: input.ownershipNamespace,
    planId: input.planId,
    planHash: sha256(input.canonicalPlanBytes),
    expiresAt: input.expiresAt,
    canonicalPlanBase64: input.canonicalPlanBytes.toString("base64url"),
  };
  return { ...unsigned, signature: sign(unsigned, secret) };
}

export function parseUniversalVisioWorkerRequest(value: unknown): UniversalVisioWorkerRequest {
  return universalVisioWorkerRequestSchema.parse(value);
}

export function parseSelectedPageUniversalVisioWorkerRequest(value: unknown): SelectedPageUniversalVisioWorkerRequest {
  return selectedPageUniversalVisioWorkerRequestSchema.parse(value);
}

export function parseAndVerifyUniversalVisioWorkerRequest(
  value: unknown,
  expected: SealedPlanBinding,
  secret: string,
  now = new Date(),
): { request: UniversalVisioWorkerRequest; canonicalPlanBytes: Buffer } {
  const request = parseUniversalVisioWorkerRequest(value);
  if (request.jobId !== expected.jobId) throw new Error("Worker request jobId does not match the expected binding");
  return { request, canonicalPlanBytes: verifySealedPlan(request.sealedPlan, expected, secret, now) };
}

export function parseAndVerifySelectedPageUniversalVisioWorkerRequest(
  value: unknown,
  expected: SelectedPageSealedPlanBinding,
  secret: string,
  now = new Date(),
): { request: SelectedPageUniversalVisioWorkerRequest; canonicalPlanBytes: Buffer } {
  const request = parseSelectedPageUniversalVisioWorkerRequest(value);
  if (request.jobId !== expected.jobId) throw new Error("Selected-page Worker request jobId does not match the expected binding");
  return { request, canonicalPlanBytes: verifySelectedPageSealedPlan(request.sealedPlan, expected, secret, now) };
}

export function parseUniversalVisioWorkerResponse(value: unknown): UniversalVisioWorkerResponse {
  return universalVisioWorkerResponseSchema.parse(value) as UniversalVisioWorkerResponse;
}

export function verifySealedPlan(envelope: SealedPlanEnvelope, expected: SealedPlanBinding, secret: string, now = new Date()): Buffer {
  if (!secret.trim()) throw new Error("sealed plan secret is required");
  const parsed = sealedPlanSchema.parse(envelope);
  validateBinding(expected);
  const { signature, ...unsigned } = parsed;
  if (!safeEqual(signature, sign(unsigned, secret))) throw new Error("sealed plan signature is invalid");
  if (parsed.jobId !== expected.jobId || parsed.tenantId !== expected.tenantId || parsed.userId !== expected.userId || parsed.deviceId !== expected.deviceId || parsed.planId !== expected.planId) throw new Error("sealed plan binding does not match the Worker job");
  if (Date.parse(parsed.expiresAt) <= now.getTime()) throw new Error("sealed plan has expired");
  const bytes = Buffer.from(parsed.canonicalPlanBase64, "base64url");
  if (bytes.length === 0 || sha256(bytes) !== parsed.planHash) throw new Error("sealed plan hash does not match canonical bytes");
  return bytes;
}

export function verifySelectedPageSealedPlan(envelope: SelectedPageSealedPlanEnvelope, expected: SelectedPageSealedPlanBinding, secret: string, now = new Date()): Buffer {
  if (!secret.trim()) throw new Error("selected-page sealed plan secret is required");
  const parsed = selectedPageSealedPlanSchema.parse(envelope);
  validateSelectedPageBinding(expected);
  const { signature, ...unsigned } = parsed;
  if (!safeEqual(signature, sign(unsigned, secret))) throw new Error("selected-page sealed plan signature is invalid");
  for (const field of ["jobId", "tenantId", "userId", "deviceId", "workflowId", "documentId", "pageId", "documentFingerprint", "pageFingerprint", "expectedRevision", "ownershipNamespace", "planId"] as const) {
    if (parsed[field] !== expected[field]) throw new Error("selected-page sealed plan binding does not match the Worker job");
  }
  if (Date.parse(parsed.expiresAt) <= now.getTime()) throw new Error("selected-page sealed plan has expired");
  const bytes = Buffer.from(parsed.canonicalPlanBase64, "base64url");
  if (bytes.length === 0 || sha256(bytes) !== parsed.planHash) throw new Error("selected-page sealed plan hash does not match canonical bytes");
  return bytes;
}

function sign(unsigned: Record<string, unknown>, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest("base64url");
}

function validateBinding(binding: SealedPlanBinding): void {
  for (const value of [binding.jobId, binding.tenantId, binding.userId, binding.deviceId, binding.planId]) if (!identifier.safeParse(value).success) throw new Error("sealed plan binding contains an invalid identifier");
}

function validateSelectedPageBinding(binding: SelectedPageSealedPlanBinding): void {
  for (const value of [binding.jobId, binding.tenantId, binding.userId, binding.deviceId, binding.workflowId, binding.documentId, binding.pageId, binding.ownershipNamespace, binding.planId]) {
    if (!identifier.safeParse(value).success) throw new Error("selected-page sealed plan binding contains an invalid identifier");
  }
  if (!hash.safeParse(binding.documentFingerprint).success || !hash.safeParse(binding.pageFingerprint).success) throw new Error("selected-page sealed plan binding contains an invalid fingerprint");
  if (!revision.safeParse(binding.expectedRevision).success) throw new Error("selected-page sealed plan binding contains an invalid expected revision");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
