import { canonicalJson, type PlanSnapshot, type PreviewArtifactHash } from "./plan-snapshot.js";

export interface OwnerScope { tenantId: string; userId: string; }
export interface ViewedPreviewInput extends OwnerScope {
  deviceId: string;
  draftId: string;
  revision: number;
  planId: string;
  planHash: string;
  previewArtifactHashes: PreviewArtifactHash[];
  viewedAt: string;
}
export interface ViewedPreviewRecord extends ViewedPreviewInput {}
export interface PlanSnapshotStore {
  insert(owner: OwnerScope, snapshot: PlanSnapshot): Promise<PlanSnapshot>;
  getForRevision(owner: OwnerScope, draftId: string, revision: number, planId: string): Promise<PlanSnapshot | null>;
  recordViewedPreview(input: ViewedPreviewInput): Promise<void>;
  getViewedPreview(input: Omit<ViewedPreviewInput, "viewedAt" | "previewArtifactHashes">): Promise<ViewedPreviewRecord | null>;
}

export class InMemoryPlanSnapshotStore implements PlanSnapshotStore {
  private readonly snapshots = new Map<string, PlanSnapshot>();
  private readonly views = new Map<string, ViewedPreviewRecord>();

  async insert(owner: OwnerScope, snapshot: PlanSnapshot): Promise<PlanSnapshot> {
    assertOwner(owner);
    if (!snapshot.immutable) throw new Error("PlanSnapshot must be immutable");
    const key = snapshotKey(owner, snapshot.draftId, snapshot.revision, snapshot.planId);
    if (this.snapshots.has(key)) throw new Error("immutable PlanSnapshot already exists");
    this.snapshots.set(key, snapshot);
    return snapshot;
  }

  async getForRevision(owner: OwnerScope, draftId: string, revision: number, planId: string): Promise<PlanSnapshot | null> {
    assertOwner(owner);
    return this.snapshots.get(snapshotKey(owner, draftId, revision, planId)) ?? null;
  }

  async recordViewedPreview(input: ViewedPreviewInput): Promise<void> {
    assertOwner(input);
    if (!isIdentifier(input.deviceId) || !Number.isSafeInteger(input.revision) || input.revision <= 0 || !Number.isFinite(Date.parse(input.viewedAt))) throw new Error("invalid viewed preview identity");
    const snapshot = await this.getForRevision(input, input.draftId, input.revision, input.planId);
    if (!snapshot) throw new Error("PlanSnapshot was not found for this owner and revision");
    if (snapshot.canonicalPlanBytesSha256 !== input.planHash) throw new Error("viewed preview must use the exact PlanSnapshot hash");
    if (artifactFingerprint(snapshot.previewArtifactHashes) !== artifactFingerprint(input.previewArtifactHashes)) throw new Error("viewed preview must use the exact preview artifact set");
    this.views.set(viewKey(input), { ...input, previewArtifactHashes: structuredClone(input.previewArtifactHashes) });
  }

  async getViewedPreview(input: Omit<ViewedPreviewInput, "viewedAt" | "previewArtifactHashes">): Promise<ViewedPreviewRecord | null> {
    assertOwner(input);
    return this.views.get(viewKey(input)) ?? null;
  }
}

function snapshotKey(owner: OwnerScope, draftId: string, revision: number, planId: string): string {
  return `${owner.tenantId}:${owner.userId}:${draftId}:${revision}:${planId}`;
}

function viewKey(input: Pick<ViewedPreviewInput, "tenantId" | "userId" | "deviceId" | "draftId" | "revision" | "planId">): string {
  return `${snapshotKey(input, input.draftId, input.revision, input.planId)}:${input.deviceId}`;
}

function artifactFingerprint(artifacts: PreviewArtifactHash[]): string {
  return canonicalJson([...artifacts].sort((left, right) => `${left.panelId}:${left.kind}`.localeCompare(`${right.panelId}:${right.kind}`)));
}

function assertOwner(owner: OwnerScope): void {
  if (!isIdentifier(owner.tenantId) || !isIdentifier(owner.userId)) throw new Error("owner scope is invalid");
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}
