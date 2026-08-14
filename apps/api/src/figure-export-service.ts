import { createHash, randomUUID } from "node:crypto";
import { PlanExportConfirmationService, type ViewedPlanIdentity } from "./plan-export-confirmation.js";
import { canonicalJson, type PlanSnapshot, type PreviewArtifactHash } from "./plan-snapshot.js";
import type { OwnerScope, PlanSnapshotStore } from "./plan-snapshot-store.js";
import { createSealedPlan, type SealedPlanEnvelope } from "./visio-universal-protocol.js";

export interface UniversalFigureExportJobInput {
  planId: string;
  planHash: string;
  sealedPlan: SealedPlanEnvelope;
}

export interface UniversalFigureExportJob extends OwnerScope {
  id: string;
  deviceId: string;
  type: "universal-figure-export";
  status: "queued";
  draftId: string;
  revision: number;
  planId: string;
  planHash: string;
  input: UniversalFigureExportJobInput;
  createdAt: string;
}

export interface UniversalFigureExportJobCreationResult {
  job: UniversalFigureExportJob;
  duplicate: boolean;
}

export interface UniversalFigureExportJobStore {
  findByIdempotency(input: { owner: OwnerScope; deviceId: string; idempotencyKey: string }): Promise<{ job: UniversalFigureExportJob; requestScopeHash: string } | null>;
  createIdempotent(input: { job: UniversalFigureExportJob; idempotencyKey: string; requestScopeHash: string }): Promise<UniversalFigureExportJobCreationResult>;
}

export interface UniversalFigureExportServiceOptions {
  snapshotStore: PlanSnapshotStore;
  confirmationService: PlanExportConfirmationService;
  jobStore: UniversalFigureExportJobStore;
  sealedPlanSecret: string;
  now?: () => Date;
  sealedPlanTtlMs?: number;
}

export interface CreateUniversalFigureExportInput {
  owner: OwnerScope;
  deviceId: string;
  draftId: string;
  revision: number;
  confirmationToken: string;
  idempotencyKey: string;
}

const DEFAULT_SEALED_PLAN_TTL_MS = 15 * 60 * 1000;

export class UniversalFigureExportService {
  private readonly now: () => Date;
  private readonly sealedPlanTtlMs: number;

  constructor(private readonly options: UniversalFigureExportServiceOptions) {
    if (!options.sealedPlanSecret.trim()) throw new Error("universal figure export requires a sealed plan secret");
    this.now = options.now ?? (() => new Date());
    this.sealedPlanTtlMs = options.sealedPlanTtlMs ?? DEFAULT_SEALED_PLAN_TTL_MS;
    if (!Number.isSafeInteger(this.sealedPlanTtlMs) || this.sealedPlanTtlMs <= 0) throw new Error("sealed plan ttl must be a positive safe integer");
  }

  async create(input: CreateUniversalFigureExportInput): Promise<UniversalFigureExportJobCreationResult> {
    assertRequest(input);
    const requestScopeHash = hashRequestScope(input);
    const existing = await this.options.jobStore.findByIdempotency({ owner: input.owner, deviceId: input.deviceId, idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (existing.requestScopeHash !== requestScopeHash) throw new Error("idempotency key was already used for a different universal export request");
      return { job: cloneJob(existing.job), duplicate: true };
    }

    const tokenIdentity = this.options.confirmationService.inspect(input.confirmationToken);
    assertRequestMatchesToken(input, tokenIdentity);
    const snapshot = await this.options.snapshotStore.getForRevision(input.owner, input.draftId, input.revision, tokenIdentity.planId);
    if (!snapshot) throw new Error("immutable PlanSnapshot was not found for this export request");
    const viewed = await this.options.snapshotStore.getViewedPreview({
      ...input.owner,
      deviceId: input.deviceId,
      draftId: input.draftId,
      revision: input.revision,
      planId: tokenIdentity.planId,
      planHash: tokenIdentity.planHash,
    });
    if (!viewed) throw new Error("the exact publication preview was not viewed by this device");
    const expectedIdentity = identityForSnapshot(input.owner, input.deviceId, snapshot);
    if (identityFingerprint(viewed) !== identityFingerprint(expectedIdentity)) throw new Error("viewed preview does not match the immutable PlanSnapshot");
    this.options.confirmationService.consume(input.confirmationToken, expectedIdentity);

    const createdAt = this.now();
    const jobId = `job-${randomUUID()}`;
    const canonicalPlanBytes = Buffer.from(canonicalJson({ figureSet: snapshot.figureSet, compilerManifest: snapshot.compilerManifest }), "utf8");
    const sealedPlan = createSealedPlan({
      jobId,
      tenantId: input.owner.tenantId,
      userId: input.owner.userId,
      deviceId: input.deviceId,
      planId: snapshot.planId,
      canonicalPlanBytes,
      expiresAt: new Date(createdAt.getTime() + this.sealedPlanTtlMs).toISOString(),
    }, this.options.sealedPlanSecret);
    if (sealedPlan.planHash !== snapshot.canonicalPlanBytesSha256) throw new Error("immutable PlanSnapshot canonical hash did not match sealed plan bytes");
    const job: UniversalFigureExportJob = {
      id: jobId,
      ...input.owner,
      deviceId: input.deviceId,
      type: "universal-figure-export",
      status: "queued",
      draftId: input.draftId,
      revision: input.revision,
      planId: snapshot.planId,
      planHash: snapshot.canonicalPlanBytesSha256,
      input: { planId: snapshot.planId, planHash: snapshot.canonicalPlanBytesSha256, sealedPlan },
      createdAt: createdAt.toISOString(),
    };
    return this.options.jobStore.createIdempotent({ job, idempotencyKey: input.idempotencyKey, requestScopeHash });
  }
}

export class InMemoryUniversalFigureExportJobStore implements UniversalFigureExportJobStore {
  private readonly jobsByIdempotency = new Map<string, { job: UniversalFigureExportJob; requestScopeHash: string }>();

  async findByIdempotency(input: { owner: OwnerScope; deviceId: string; idempotencyKey: string }): Promise<{ job: UniversalFigureExportJob; requestScopeHash: string } | null> {
    assertStoreKey(input.owner, input.deviceId, input.idempotencyKey);
    const existing = this.jobsByIdempotency.get(storeKey(input.owner, input.deviceId, input.idempotencyKey));
    return existing ? { job: cloneJob(existing.job), requestScopeHash: existing.requestScopeHash } : null;
  }

  async createIdempotent(input: { job: UniversalFigureExportJob; idempotencyKey: string; requestScopeHash: string }): Promise<UniversalFigureExportJobCreationResult> {
    assertStoreKey(input.job, input.job.deviceId, input.idempotencyKey);
    const key = storeKey(input.job, input.job.deviceId, input.idempotencyKey);
    const existing = this.jobsByIdempotency.get(key);
    if (existing) {
      if (existing.requestScopeHash !== input.requestScopeHash) throw new Error("idempotency key was already used for a different universal export request");
      return { job: cloneJob(existing.job), duplicate: true };
    }
    const stored = cloneJob(input.job);
    this.jobsByIdempotency.set(key, { job: stored, requestScopeHash: input.requestScopeHash });
    return { job: cloneJob(stored), duplicate: false };
  }
}

function identityForSnapshot(owner: OwnerScope, deviceId: string, snapshot: PlanSnapshot): ViewedPlanIdentity {
  return {
    ...owner,
    deviceId,
    draftId: snapshot.draftId,
    revision: snapshot.revision,
    planId: snapshot.planId,
    planHash: snapshot.canonicalPlanBytesSha256,
    previewArtifactHashes: snapshot.previewArtifactHashes.map((artifact) => ({ ...artifact })),
  };
}

function assertRequest(input: CreateUniversalFigureExportInput): void {
  assertStoreKey(input.owner, input.deviceId, input.idempotencyKey);
  if (!isIdentifier(input.draftId) || !Number.isSafeInteger(input.revision) || input.revision <= 0) throw new Error("universal export request identity is invalid");
  if (!input.confirmationToken.trim()) throw new Error("universal export requires a confirmation token");
}

function assertRequestMatchesToken(input: CreateUniversalFigureExportInput, identity: ViewedPlanIdentity): void {
  if (identity.tenantId !== input.owner.tenantId || identity.userId !== input.owner.userId || identity.deviceId !== input.deviceId || identity.draftId !== input.draftId || identity.revision !== input.revision) {
    throw new Error("plan confirmation token does not belong to this universal export request");
  }
}

function hashRequestScope(input: Pick<CreateUniversalFigureExportInput, "owner" | "deviceId" | "draftId" | "revision">): string {
  return createHash("sha256").update(canonicalJson({ ...input.owner, deviceId: input.deviceId, draftId: input.draftId, revision: input.revision }), "utf8").digest("hex");
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

function storeKey(owner: OwnerScope, deviceId: string, idempotencyKey: string): string {
  return `${owner.tenantId}:${owner.userId}:${deviceId}:${idempotencyKey}`;
}

function assertStoreKey(owner: OwnerScope, deviceId: string, idempotencyKey: string): void {
  if (![owner.tenantId, owner.userId, deviceId].every(isIdentifier) || !isOpaqueKey(idempotencyKey)) throw new Error("universal export idempotency scope is invalid");
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}

function isOpaqueKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}

function cloneJob(job: UniversalFigureExportJob): UniversalFigureExportJob {
  return structuredClone(job);
}
