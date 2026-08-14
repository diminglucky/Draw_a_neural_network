import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, type PreviewArtifactHash } from "./plan-snapshot.js";

export interface ViewedPlanIdentity {
  tenantId: string;
  userId: string;
  deviceId: string;
  draftId: string;
  revision: number;
  planId: string;
  planHash: string;
  previewArtifactHashes: PreviewArtifactHash[];
}
export interface PlanExportConfirmationServiceOptions {
  secret: string;
  now?: () => number;
  ttlMs?: number;
}

interface ConfirmationPayload extends ViewedPlanIdentity {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export class PlanExportConfirmationService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly issued = new Map<string, ConfirmationPayload>();

  constructor(private readonly options: PlanExportConfirmationServiceOptions) {
    if (!options.secret.trim()) throw new Error("plan confirmation secret is required");
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error("plan confirmation token ttl must be a positive safe integer");
  }

  issue(identity: ViewedPlanIdentity): string {
    validateIdentity(identity);
    const issuedAt = this.now();
    const payload: ConfirmationPayload = { ...cloneIdentity(identity), nonce: randomUUID(), issuedAt, expiresAt: issuedAt + this.ttlMs };
    this.issued.set(payload.nonce, payload);
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  inspect(token: string): ViewedPlanIdentity {
    const payload = this.parseAndVerify(token);
    const issued = this.issued.get(payload.nonce);
    if (!issued) throw new Error("plan confirmation token has been consumed or is unknown");
    if (this.now() > payload.expiresAt) {
      this.issued.delete(payload.nonce);
      throw new Error("plan confirmation token has expired");
    }
    if (canonicalJson(issued) !== canonicalJson(payload)) {
      this.issued.delete(payload.nonce);
      throw new Error("plan confirmation token state is invalid");
    }
    return cloneIdentity(payload);
  }

  consume(token: string, expected: ViewedPlanIdentity): ViewedPlanIdentity {
    validateIdentity(expected);
    const payload = this.parseAndVerify(token);
    const issued = this.issued.get(payload.nonce);
    if (!issued) throw new Error("plan confirmation token has been consumed or is unknown");
    if (this.now() > payload.expiresAt) {
      this.issued.delete(payload.nonce);
      throw new Error("plan confirmation token has expired");
    }
    if (canonicalJson(issued) !== canonicalJson(payload)) {
      this.issued.delete(payload.nonce);
      throw new Error("plan confirmation token state is invalid");
    }
    if (identityFingerprint(payload) !== identityFingerprint(expected)) throw new Error("plan confirmation token binding does not match the viewed identity");
    this.issued.delete(payload.nonce);
    return cloneIdentity(payload);
  }

  private parseAndVerify(token: string): ConfirmationPayload {
    const [encoded, signature, ...rest] = token.split(".");
    if (!encoded || !signature || rest.length !== 0 || !safeEqual(signature, this.sign(encoded))) throw new Error("plan confirmation token signature is invalid");
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      const payload = parsed as ConfirmationPayload;
      validateIdentity(payload);
      if (!isNonce(payload.nonce) || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= payload.issuedAt) throw new Error("invalid token timing");
      return payload;
    } catch {
      throw new Error("plan confirmation token payload is invalid");
    }
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.options.secret).update(encoded, "utf8").digest("base64url");
  }
}

function validateIdentity(identity: ViewedPlanIdentity): void {
  for (const value of [identity.tenantId, identity.userId, identity.deviceId, identity.draftId, identity.planId]) if (!isIdentifier(value)) throw new Error("plan confirmation identity contains an invalid identifier");
  if (!Number.isSafeInteger(identity.revision) || identity.revision <= 0 || !/^[a-f0-9]{64}$/i.test(identity.planHash)) throw new Error("plan confirmation identity is invalid");
  const panelKinds = new Set<string>();
  if (identity.previewArtifactHashes.length === 0) throw new Error("plan confirmation identity requires preview artifacts");
  for (const artifact of identity.previewArtifactHashes) {
    if (!isIdentifier(artifact.panelId) || !["svg", "png"].includes(artifact.kind) || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error("plan confirmation preview artifact is invalid");
    const key = `${artifact.panelId}:${artifact.kind}`;
    if (panelKinds.has(key)) throw new Error("plan confirmation preview artifacts must be unique");
    panelKinds.add(key);
  }
}

function cloneIdentity(identity: ViewedPlanIdentity): ViewedPlanIdentity {
  return { ...identity, previewArtifactHashes: identity.previewArtifactHashes.map((artifact) => ({ ...artifact })) };
}

function identityFingerprint(identity: ViewedPlanIdentity): string {
  return canonicalJson({
    tenantId: identity.tenantId,
    userId: identity.userId,
    deviceId: identity.deviceId,
    draftId: identity.draftId,
    revision: identity.revision,
    planId: identity.planId,
    planHash: identity.planHash,
    previewArtifactHashes: [...identity.previewArtifactHashes].sort((left, right) => `${left.panelId}:${left.kind}`.localeCompare(`${right.panelId}:${right.kind}`)),
  });
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}

function isNonce(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
