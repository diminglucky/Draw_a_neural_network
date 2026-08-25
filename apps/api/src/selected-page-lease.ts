import { randomUUID } from "node:crypto";
import type { TrustedSelectedPageBinding } from "./visio-session-protocol.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fingerprint = /^[a-f0-9]{64}$/i;

export interface SelectedPageLeaseOwner {
  tenantId: string;
  userId: string;
  deviceId: string;
  workflowId: string;
}

export interface SelectedPageLeaseTarget {
  documentId: string;
  pageId: string;
  documentFingerprint: string;
  pageFingerprint: string;
  expectedRevision: number;
}

export type SelectedPageCaptureResult =
  | { status: "waiting_for_selected_page" }
  | { status: "captured"; target: SelectedPageLeaseTarget };

/** A Worker-only, read-only capability. It cannot request a document or page by path or ID. */
export interface SelectedPageSelectionCapture {
  capture(owner: SelectedPageLeaseOwner): Promise<SelectedPageCaptureResult>;
}

interface StoredSelectedPageLease {
  leaseId: string;
  owner: SelectedPageLeaseOwner;
  target: SelectedPageLeaseTarget;
  expiresAt: string;
  consumedAt: string | null;
}

export interface SelectedPageLeaseStore {
  create(lease: StoredSelectedPageLease): Promise<void>;
  take(input: {
    leaseId: string;
    owner: SelectedPageLeaseOwner;
    consumedAt: string;
  }): Promise<StoredSelectedPageLease | "unknown" | "consumed" | "owner_mismatch" | "expired">;
}

/** In-process store for local development. Production wiring may replace it with a transactional durable store. */
export class InMemorySelectedPageLeaseStore implements SelectedPageLeaseStore {
  private readonly leases = new Map<string, StoredSelectedPageLease>();

  async create(lease: StoredSelectedPageLease): Promise<void> {
    if (this.leases.has(lease.leaseId)) throw new Error("Selected-page lease identifier already exists");
    this.leases.set(lease.leaseId, structuredClone(lease));
  }

  async take(input: {
    leaseId: string;
    owner: SelectedPageLeaseOwner;
    consumedAt: string;
  }): Promise<StoredSelectedPageLease | "unknown" | "consumed" | "owner_mismatch" | "expired"> {
    const lease = this.leases.get(input.leaseId);
    if (!lease) return "unknown";
    if (!sameOwner(lease.owner, input.owner)) return "owner_mismatch";
    if (Date.parse(lease.expiresAt) <= Date.parse(input.consumedAt)) return "expired";
    if (lease.consumedAt) return "consumed";
    lease.consumedAt = input.consumedAt;
    return structuredClone(lease);
  }
}

export interface SelectedPageLeaseServiceOptions {
  store: SelectedPageLeaseStore;
  capture: SelectedPageSelectionCapture;
  now?: () => Date;
  idFactory?: () => string;
  ttlMs?: number;
}

export type SelectedPageLeaseIssueResult =
  | { status: "waiting_for_selected_page" }
  | { status: "issued"; leaseId: string; expiresAt: string };

export interface ConsumeSelectedPageLeaseInput extends SelectedPageLeaseOwner {
  leaseId: string;
  jobId: string;
  ownershipNamespace: string;
}

/**
 * Mints an opaque, one-use server-side lease from the actual currently selected Visio page.
 * The browser never supplies document/page fingerprints and cannot turn a stale lease into a draw binding.
 */
export class SelectedPageLeaseService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly ttlMs: number;

  constructor(private readonly options: SelectedPageLeaseServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.ttlMs = options.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > 5 * 60_000) {
      throw new Error("Selected-page lease TTL must be between 1ms and five minutes");
    }
  }

  async capture(owner: SelectedPageLeaseOwner): Promise<SelectedPageLeaseIssueResult> {
    validateOwner(owner);
    const result = await this.options.capture.capture({ ...owner });
    if (result.status === "waiting_for_selected_page") return result;
    validateTarget(result.target);

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs).toISOString();
    const leaseId = this.idFactory();
    validateIdentifier(leaseId, "leaseId");
    await this.options.store.create({ leaseId, owner: { ...owner }, target: { ...result.target }, expiresAt, consumedAt: null });
    return { status: "issued", leaseId, expiresAt };
  }

  async consume(input: ConsumeSelectedPageLeaseInput): Promise<TrustedSelectedPageBinding> {
    validateOwner(input);
    validateIdentifier(input.leaseId, "leaseId");
    validateIdentifier(input.jobId, "jobId");
    validateIdentifier(input.ownershipNamespace, "ownershipNamespace");
    const consumedAt = this.now().toISOString();
    const result = await this.options.store.take({
      leaseId: input.leaseId,
      owner: {
        tenantId: input.tenantId,
        userId: input.userId,
        deviceId: input.deviceId,
        workflowId: input.workflowId,
      },
      consumedAt,
    });
    if (result === "unknown") throw new Error("Selected-page lease is unknown");
    if (result === "consumed") throw new Error("Selected-page lease has already been consumed");
    if (result === "owner_mismatch") throw new Error("Selected-page lease owner does not match this drawing request");
    if (result === "expired") throw new Error("Selected-page lease has expired");
    return {
      jobId: input.jobId,
      tenantId: input.tenantId,
      userId: input.userId,
      deviceId: input.deviceId,
      workflowId: input.workflowId,
      documentId: result.target.documentId,
      pageId: result.target.pageId,
      documentFingerprint: result.target.documentFingerprint,
      pageFingerprint: result.target.pageFingerprint,
      expectedRevision: result.target.expectedRevision,
      ownershipNamespace: input.ownershipNamespace,
    };
  }
}

function validateOwner(owner: SelectedPageLeaseOwner): void {
  validateIdentifier(owner.tenantId, "tenantId");
  validateIdentifier(owner.userId, "userId");
  validateIdentifier(owner.deviceId, "deviceId");
  validateIdentifier(owner.workflowId, "workflowId");
}

function validateTarget(target: SelectedPageLeaseTarget): void {
  validateIdentifier(target.documentId, "documentId");
  validateIdentifier(target.pageId, "pageId");
  if (!fingerprint.test(target.documentFingerprint) || !fingerprint.test(target.pageFingerprint)) throw new Error("Selected-page capture fingerprint is invalid");
  if (!Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 0) throw new Error("Selected-page capture revision is invalid");
}

function validateIdentifier(value: string, name: string): void {
  if (!identifier.test(value)) throw new Error(`Selected-page ${name} is invalid`);
}

function sameOwner(lease: SelectedPageLeaseOwner, request: SelectedPageLeaseOwner): boolean {
  return lease.tenantId === request.tenantId && lease.userId === request.userId && lease.deviceId === request.deviceId && lease.workflowId === request.workflowId;
}
