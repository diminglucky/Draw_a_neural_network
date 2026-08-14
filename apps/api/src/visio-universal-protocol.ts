import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./plan-snapshot.js";

export const UNIVERSAL_VISIO_PROTOCOL_VERSION = 1 as const;

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
export interface SealedPlanBinding { jobId: string; tenantId: string; userId: string; deviceId: string; planId: string; }

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
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

export function parseUniversalVisioWorkerRequest(value: unknown): UniversalVisioWorkerRequest {
  return universalVisioWorkerRequestSchema.parse(value);
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

function sign(unsigned: Omit<SealedPlanEnvelope, "signature">, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(unsigned), "utf8").digest("base64url");
}

function validateBinding(binding: SealedPlanBinding): void {
  for (const value of [binding.jobId, binding.tenantId, binding.userId, binding.deviceId, binding.planId]) if (!identifier.safeParse(value).success) throw new Error("sealed plan binding contains an invalid identifier");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
