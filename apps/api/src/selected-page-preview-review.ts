import { digestDrawingArtifact, type DrawingArtifactStore } from "./drawing-input/drawing-artifacts.js";
import { composeGeneralPublicationGraph, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { digestGenericPlanSnapshotValue, type GenericPlanSnapshot, type GenericPlanSnapshotOwner } from "./generic-plan-snapshot.js";
import { GenericPlanSnapshotService } from "./generic-plan-snapshot-service.js";
import { confirmedPreviewHashForSnapshot, GenericPlanSnapshotStoreConflictError, type GenericPlanSnapshotStore } from "./generic-plan-snapshot-store.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { promotePublicationVisualPlanAfterTrustedReview, type PublicationVisualPlanQaDecision } from "./publication-visual-plan-qa-promotion.js";
import { evaluatePublicationVisualPlanQa } from "./publication-visual-plan-qa.js";
import { parseUniversalGraphSpec } from "./universal-graph-spec.js";

const AUTHENTICATED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/i;
const DETAIL_LEVELS = ["overview", "architecture", "operator_detail"] as const;

export interface SelectedPagePreviewReviewerOptions {
  artifacts: Pick<DrawingArtifactStore, "getPvp" | "getUgs">;
  snapshots: GenericPlanSnapshotStore;
  now?: () => Date;
}

export class SelectedPagePreviewReviewService {
  private readonly snapshotService: GenericPlanSnapshotService;

  constructor(private readonly options: SelectedPagePreviewReviewerOptions) {
    this.snapshotService = new GenericPlanSnapshotService({ store: options.snapshots });
  }

  async confirm(input: {
    owner: GenericPlanSnapshotOwner;
    workflowId: string;
    expectedUgsHash: string;
    pendingPreviewHash: string;
  }): Promise<{
    snapshot: GenericPlanSnapshot;
    decision: PublicationVisualPlanQaDecision;
    replayed: boolean;
  }> {
    const owner = canonicalOwner(input.owner);
    const workflowId = canonicalWorkflowId(input.workflowId);
    const expectedUgsHash = canonicalDigest(input.expectedUgsHash, "expectedUgsHash");
    const pendingPreviewHash = canonicalDigest(input.pendingPreviewHash, "pendingPreviewHash");

    const existing = await this.options.snapshots.getByConfirmedPreviewHash(owner, pendingPreviewHash);
    if (existing) return replay(existing, owner, workflowId, expectedUgsHash, pendingPreviewHash);

    const pvp = await this.loadPendingPvp(owner, workflowId, pendingPreviewHash);
    const ugs = await this.loadVerifiedUgs(owner, pvp, expectedUgsHash);
    const graph = resolveCanonicalGraph(ugs, pvp);
    const reviewedAt = this.reviewedAt();
    const promoted = promotePublicationVisualPlanAfterTrustedReview({
      plan: pvp,
      review: {
        authority: "trusted-human",
        reviewerId: owner.userId,
        reviewedAt,
        approval: "approved",
        expectedPlanHash: pendingPreviewHash,
      },
    });

    try {
      const snapshot = await this.snapshotService.create({
        owner,
        ugsRevision: ugs.revision,
        ugs,
        graph,
        publicationVisualPlan: promoted.plan,
        createdAt: reviewedAt,
      });
      return { snapshot, decision: promoted.decision, replayed: false };
    } catch (error) {
      if (!(error instanceof GenericPlanSnapshotStoreConflictError)) throw error;
      const raced = await this.options.snapshots.getByConfirmedPreviewHash(owner, pendingPreviewHash);
      if (!raced) throw error;
      return replay(raced, owner, workflowId, expectedUgsHash, pendingPreviewHash);
    }
  }

  private async loadPendingPvp(owner: GenericPlanSnapshotOwner, workflowId: string, pendingPreviewHash: string): Promise<PublicationVisualPlan> {
    const artifact = await this.options.artifacts.getPvp(owner.userId, pendingPreviewHash);
    if (!artifact) throw new Error("Pending browser preview is unavailable");
    const pvp = parsePublicationVisualPlan(artifact);
    if (pvp.identity.canonicalHash !== pendingPreviewHash) throw new Error("Pending browser preview hash does not match its contents");
    if (pvp.eligibility.kind !== "formal" || pvp.eligibility.qaStatus !== "pending" || pvp.eligibility.blockingReasons.length !== 0) throw new Error("Pending browser preview is not eligible for trusted review");
    if (evaluatePublicationVisualPlanQa(pvp).status !== "passed") throw new Error("Pending browser preview failed deterministic structural QA");
    assertBrowserPreviewIdentity(pvp, owner, workflowId);
    return pvp;
  }

  private async loadVerifiedUgs(owner: GenericPlanSnapshotOwner, pvp: PublicationVisualPlan, expectedUgsHash: string) {
    const lineage = record(pvp.lineage, "PVP lineage is invalid");
    const ugsHash = canonicalDigest(lineage.ugsHash, "PVP lineage ugsHash");
    if (ugsHash !== expectedUgsHash) throw new Error("Pending browser preview does not use the Drawing Run formal UGS");
    const artifact = await this.options.artifacts.getUgs(owner.userId, ugsHash);
    if (!artifact) throw new Error("PVP lineage UGS is unavailable");
    const ugs = parseUniversalGraphSpec(artifact);
    if (digestDrawingArtifact(ugs) !== ugsHash) throw new Error("PVP lineage UGS hash does not match its contents");
    const identity = record(pvp.updateIdentity, "PVP update identity is invalid");
    if (identity.expectedRevision !== ugs.revision) throw new Error("PVP expected revision does not match its UGS");
    return ugs;
  }

  private reviewedAt(): string {
    const value = this.options.now?.() ?? new Date();
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new Error("Trusted review clock is invalid");
    return value.toISOString();
  }
}

function resolveCanonicalGraph(ugs: ReturnType<typeof parseUniversalGraphSpec>, pvp: PublicationVisualPlan): GeneralPublicationGraph {
  const lineage = record(pvp.lineage, "PVP lineage is invalid");
  const expectedHash = canonicalDigest(lineage.gpgHash, "PVP lineage gpgHash");
  const matches = DETAIL_LEVELS
    .map((detail) => composeGeneralPublicationGraph(ugs, { detail }))
    .filter((graph) => digestGenericPlanSnapshotValue(graph) === expectedHash);
  if (matches.length !== 1) throw new Error("PVP lineage does not resolve to one supported canonical GPG");
  return matches[0]!;
}

function replay(snapshot: GenericPlanSnapshot, owner: GenericPlanSnapshotOwner, workflowId: string, expectedUgsHash: string, pendingPreviewHash: string): {
  snapshot: GenericPlanSnapshot;
  decision: PublicationVisualPlanQaDecision;
  replayed: true;
} {
  if (snapshot.tenantId !== owner.tenantId || snapshot.userId !== owner.userId || snapshot.deviceId !== owner.deviceId) throw new Error("Confirmed preview snapshot owner does not match");
  if (snapshot.ugsCanonicalHash !== expectedUgsHash) throw new Error("Confirmed preview snapshot does not use the Drawing Run formal UGS");
  const plan = parsePublicationVisualPlan(snapshot.publicationVisualPlan);
  assertBrowserPreviewIdentity(plan, owner, workflowId);
  if (confirmedPreviewHashForSnapshot(snapshot) !== pendingPreviewHash) throw new Error("Confirmed preview snapshot source does not match");
  return {
    snapshot,
    decision: {
      version: 1,
      status: "passed",
      qaVersion: "pvp-qa-1",
      reviewerId: owner.userId,
      reviewedAt: snapshot.createdAt,
      sourcePlanHash: pendingPreviewHash,
      approvedPlanHash: snapshot.publicationVisualPlanHash,
    },
    replayed: true,
  };
}

function assertBrowserPreviewIdentity(plan: PublicationVisualPlan, owner: GenericPlanSnapshotOwner, workflowId: string): void {
  const identity = record(plan.updateIdentity, "PVP update identity is invalid");
  if (identity.ownerId !== owner.userId || identity.deviceId !== owner.deviceId || identity.workflowId !== workflowId) throw new Error("PVP update identity does not match the authenticated confirmation");
  if (identity.documentId !== "browser-preview" || identity.pageId !== "browser-preview") throw new Error("PVP is not a browser preview target");
  if (!Number.isSafeInteger(identity.expectedRevision) || (identity.expectedRevision as number) <= 0) throw new Error("PVP expected revision is invalid");
}

function canonicalOwner(value: GenericPlanSnapshotOwner): GenericPlanSnapshotOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Snapshot owner is invalid");
  const owner = value as unknown as Record<string, unknown>;
  if (Object.keys(owner).length !== 3 || !Object.hasOwn(owner, "tenantId") || !Object.hasOwn(owner, "userId") || !Object.hasOwn(owner, "deviceId")) throw new Error("Snapshot owner is invalid");
  return {
    tenantId: canonicalAuthenticatedId(owner.tenantId, "tenantId"),
    userId: canonicalAuthenticatedId(owner.userId, "userId"),
    deviceId: canonicalAuthenticatedId(owner.deviceId, "deviceId"),
  };
}

function canonicalWorkflowId(value: unknown): string {
  return canonicalAuthenticatedId(value, "workflowId");
}

function canonicalAuthenticatedId(value: unknown, field: string): string {
  if (typeof value !== "string" || !AUTHENTICATED_ID.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function canonicalDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message);
  return value as Record<string, unknown>;
}
