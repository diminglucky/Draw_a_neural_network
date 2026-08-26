import { createHash } from "node:crypto";
import { createSelectedPageSealedPlan } from "./visio-universal-protocol.js";
import type { PublicationVisualNativeIntent } from "./publication-visual-plan-native-intent.js";
import { SelectedPageLeaseService, type SelectedPageLeaseOwner } from "./selected-page-lease.js";
import type { TrustedSelectedPageBinding } from "./visio-session-protocol.js";

export interface SelectedPageDrawingExecutor {
  draw(input: { binding: TrustedSelectedPageBinding; sealedNativeIntent: ReturnType<typeof createSelectedPageSealedPlan>; sealedPlanSecret: string; now: Date; requestIdFactory: (suffix: "attach" | "apply" | "read-before-save" | "save" | "read-after-save" | "close") => string }): Promise<unknown>;
}

export interface SelectedPageDrawingJobOptions {
  leases: SelectedPageLeaseService;
  compileNativeIntent(input: { owner: SelectedPageLeaseOwner; graphId: string; ugsRevision: number; snapshotId: string }): Promise<PublicationVisualNativeIntent>;
  executor: SelectedPageDrawingExecutor;
  sealedPlanSecret: string;
  now?: () => Date;
  jobIdFactory: () => string;
  ownershipNamespaceFactory?: (owner: SelectedPageLeaseOwner) => string;
}

/**
 * Formal current-page draw boundary. It accepts only a server-issued page lease and a locator for
 * an already trusted GenericPlanSnapshot; raw source, PVP, COM instructions and page IDs are absent.
 */
export class SelectedPageDrawingJob {
  private readonly now: () => Date;

  constructor(private readonly options: SelectedPageDrawingJobOptions) {
    this.now = options.now ?? (() => new Date());
    if (!options.sealedPlanSecret.trim()) throw new Error("Selected-page sealing secret is required");
  }

  async draw(input: SelectedPageLeaseOwner & { leaseId: string; graphId: string; ugsRevision: number; snapshotId: string }): Promise<unknown> {
    const owner = { tenantId: input.tenantId, userId: input.userId, deviceId: input.deviceId, workflowId: input.workflowId };
    const nativeIntentTemplate = await this.options.compileNativeIntent({ owner, graphId: input.graphId, ugsRevision: input.ugsRevision, snapshotId: input.snapshotId });
    assertIntentMatchesOwner(nativeIntentTemplate, owner);
    const jobId = this.options.jobIdFactory();
    const ownershipNamespace = this.options.ownershipNamespaceFactory?.(owner) ?? stableOwnershipNamespace(owner);
    const binding = await this.options.leases.consume({ ...owner, leaseId: input.leaseId, jobId, ownershipNamespace });
    const nativeIntent = bindIntentToSelectedPage(nativeIntentTemplate, binding);
    assertIntentMatchesBinding(nativeIntent, binding);

    const now = this.now();
    const sealedNativeIntent = createSelectedPageSealedPlan({
      ...binding,
      planId: nativeIntent.planId,
      canonicalPlanBytes: Buffer.from(JSON.stringify(nativeIntent), "utf8"),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }, this.options.sealedPlanSecret);
    return this.options.executor.draw({
      binding,
      sealedNativeIntent,
      sealedPlanSecret: this.options.sealedPlanSecret,
      now,
      requestIdFactory: (suffix) => `${jobId}:${suffix}`,
    });
  }
}

function assertIntentMatchesOwner(intent: PublicationVisualNativeIntent, owner: SelectedPageLeaseOwner): void {
  const identity = intent.updateIdentity;
  if (
    identity.ownerId !== owner.userId
    || identity.deviceId !== owner.deviceId
    || identity.workflowId !== owner.workflowId
  ) throw new Error("Trusted native intent owner scope does not match this drawing request");
}

function bindIntentToSelectedPage(intent: PublicationVisualNativeIntent, binding: TrustedSelectedPageBinding): PublicationVisualNativeIntent {
  return {
    ...intent,
    updateIdentity: {
      ownerId: binding.userId,
      deviceId: binding.deviceId,
      workflowId: binding.workflowId,
      documentId: binding.documentId,
      pageId: binding.pageId,
      expectedRevision: binding.expectedRevision,
    },
  };
}

function stableOwnershipNamespace(owner: SelectedPageLeaseOwner): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([owner.tenantId, owner.userId, owner.deviceId, owner.workflowId]), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `agent:${digest}`;
}

function assertIntentMatchesBinding(intent: PublicationVisualNativeIntent, binding: TrustedSelectedPageBinding): void {
  const identity = intent.updateIdentity;
  if (
    identity.ownerId !== binding.userId
    || identity.deviceId !== binding.deviceId
    || identity.workflowId !== binding.workflowId
    || identity.documentId !== binding.documentId
    || identity.pageId !== binding.pageId
    || identity.expectedRevision !== binding.expectedRevision
  ) throw new Error("Trusted native intent update identity does not match the selected-page lease");
}
