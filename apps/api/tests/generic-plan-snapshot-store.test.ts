import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "../src/publication-visual-plan.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../src/publication-visual-plan-qa-promotion.js";
import { createGenericPlanSnapshot, type CreateGenericPlanSnapshotInput, type GenericPlanSnapshotOwner } from "../src/generic-plan-snapshot.js";
import { GenericPlanSnapshotStoreConflictError, InMemoryGenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";

const owner: GenericPlanSnapshotOwner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };

function pvp(): PublicationVisualPlan {
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: "pvp:store", canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" },
    lineage: { ugsHash: "a".repeat(64), gpgHash: "b".repeat(64), sourceHashes: ["d".repeat(64)], composerHash: "c".repeat(64), profileSetHash: "e".repeat(64) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: 1000, height: 600 }, safeMargins: { x: 10, y: 10, width: 980, height: 580 } },
    regions: [], primitiveGroups: [], primitives: [], ports: [], connectors: [], annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] }, profileApplications: [], sourceMappings: [],
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
    updateIdentity: { ownerId: "user-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  });
}

function input(overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  return { ...owner, graphId: "graph-1", ugsRevision: 1, ugsCanonicalHash: "a".repeat(64), generalPublicationGraphHash: "b".repeat(64), publicationVisualPlan: pvp(), createdAt: "2026-08-20T00:00:00.000Z", ...overrides };
}

function confirmedInput(overrides: Partial<CreateGenericPlanSnapshotInput> = {}) {
  const pending = createPublicationVisualPlan({
    ...structuredClone(pvp()),
    identity: { ...pvp().identity, canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "pending" },
  });
  const promoted = promotePublicationVisualPlanAfterTrustedReview({
    plan: pending,
    review: {
      authority: "trusted-human",
      reviewerId: "reviewer-1",
      reviewedAt: "2026-08-20T00:00:00.000Z",
      approval: "approved",
      expectedPlanHash: pending.identity.canonicalHash,
    },
  }).plan;
  return {
    pendingPreviewHash: pending.identity.canonicalHash,
    input: input({ publicationVisualPlan: promoted, ...overrides }),
  };
}

function inputWithFormalReasons(formalReasons: readonly string[], overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  const base = pvp();
  const publicationVisualPlan = createPublicationVisualPlan({
    ...structuredClone(base),
    identity: { ...base.identity, canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: [...formalReasons], blockingReasons: [], qaStatus: "passed" },
  });
  return input({ publicationVisualPlan, ...overrides });
}

describe("InMemoryGenericPlanSnapshotStore", () => {
  it("is insert-only for a deterministic owner/device/graph/revision/PVP identity", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.insert(owner, snapshot)).rejects.toBeInstanceOf(GenericPlanSnapshotStoreConflictError);
  });

  it("does not disclose PVP Snapshots across tenant, user, device, graph, or revision", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);
    await expect(store.get({ ...owner, tenantId: "tenant-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, userId: "user-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get({ ...owner, deviceId: "device-2" }, snapshot.graphId, snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
    await expect(store.get(owner, "graph-2", snapshot.ugsRevision, snapshot.snapshotId)).resolves.toBeNull();
  });

  it("resolves a confirmed PVP hash only within the exact owner and device", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const snapshot = createGenericPlanSnapshot(input());
    await store.insert(owner, snapshot);

    await expect(store.getByPublicationVisualPlanHash(owner, snapshot.publicationVisualPlanHash)).resolves.toEqual(snapshot);
    await expect(store.getByPublicationVisualPlanHash({ ...owner, tenantId: "tenant-2" }, snapshot.publicationVisualPlanHash)).resolves.toBeNull();
    await expect(store.getByPublicationVisualPlanHash({ ...owner, userId: "user-2" }, snapshot.publicationVisualPlanHash)).resolves.toBeNull();
    await expect(store.getByPublicationVisualPlanHash({ ...owner, deviceId: "device-2" }, snapshot.publicationVisualPlanHash)).resolves.toBeNull();
    await expect(store.getByPublicationVisualPlanHash(owner, "f".repeat(64))).resolves.toBeNull();
  });

  it("fails closed when an owner and device have ambiguous snapshots for one PVP hash", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const first = createGenericPlanSnapshot(input());
    const second = createGenericPlanSnapshot(input({ graphId: "graph-2", ugsRevision: 2 }));
    expect(second.publicationVisualPlanHash).toBe(first.publicationVisualPlanHash);
    await store.insert(owner, first);
    await store.insert(owner, second);

    await expect(store.getByPublicationVisualPlanHash(owner, first.publicationVisualPlanHash)).rejects.toThrow(/ambiguous/i);
  });

  it("resolves the unique promoted snapshot by its distinct confirmed pending-preview hash", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const confirmed = confirmedInput();
    const snapshot = createGenericPlanSnapshot(confirmed.input);
    expect(confirmed.pendingPreviewHash).not.toBe(snapshot.publicationVisualPlanHash);
    await store.insert(owner, snapshot);

    const resolved = await store.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash.toUpperCase());
    expect(resolved).toEqual(snapshot);
    expect(resolved).not.toBe(snapshot);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(resolved!.publicationVisualPlan).not.toBe(snapshot.publicationVisualPlan);
    await expect(store.getByConfirmedPreviewHash(owner, snapshot.publicationVisualPlanHash)).resolves.toBeNull();
    await expect(store.getByConfirmedPreviewHash(owner, "not-a-hash")).rejects.toThrow(/SHA-256/i);
  });

  it("does not disclose confirmed previews across tenant, user, or device and returns null when missing", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const confirmed = confirmedInput();
    await store.insert(owner, createGenericPlanSnapshot(confirmed.input));

    await expect(store.getByConfirmedPreviewHash({ ...owner, tenantId: "tenant-2" }, confirmed.pendingPreviewHash)).resolves.toBeNull();
    await expect(store.getByConfirmedPreviewHash({ ...owner, userId: "user-2" }, confirmed.pendingPreviewHash)).resolves.toBeNull();
    await expect(store.getByConfirmedPreviewHash({ ...owner, deviceId: "device-2" }, confirmed.pendingPreviewHash)).resolves.toBeNull();
    await expect(store.getByConfirmedPreviewHash(owner, "f".repeat(64))).resolves.toBeNull();
  });

  it("does not treat passed status, ordinary formal reasons, or the promoted PVP hash as confirmation", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const unconfirmed = createGenericPlanSnapshot(input());
    await store.insert(owner, unconfirmed);

    await expect(store.getByConfirmedPreviewHash(owner, unconfirmed.publicationVisualPlanHash)).resolves.toBeNull();
  });

  it("fails closed when two snapshots resolve to one confirmed pending-preview hash", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const confirmed = confirmedInput();
    await store.insert(owner, createGenericPlanSnapshot(confirmed.input));
    await store.insert(owner, createGenericPlanSnapshot({ ...confirmed.input, graphId: "graph-2", ugsRevision: 2 }));

    await expect(store.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash)).rejects.toThrow(/ambiguous/i);
  });

  it("fails closed when a stored snapshot contains multiple trusted promotion reasons", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const confirmed = confirmedInput();
    const promoted = confirmed.input.publicationVisualPlan;
    const multiplyPromoted = createPublicationVisualPlan({
      ...structuredClone(promoted),
      identity: { ...promoted.identity, canonicalHash: "" },
      eligibility: {
        ...promoted.eligibility,
        formalReasons: [...promoted.eligibility.formalReasons, `visual-qa:pvp-qa-1:${"f".repeat(64)}`],
      },
    });
    await store.insert(owner, createGenericPlanSnapshot({ ...confirmed.input, publicationVisualPlan: multiplyPromoted }));

    await expect(store.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash)).rejects.toThrow(/ambiguous|promotion/i);
  });

  it("does not let unrelated multiply-promoted hashes poison a unique confirmed-preview lookup", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const confirmed = confirmedInput();
    const hashB = "b".repeat(64);
    const hashC = "c".repeat(64);
    const unrelated = createGenericPlanSnapshot(inputWithFormalReasons([
      "topology-complete",
      `visual-qa:pvp-qa-1:${hashB}`,
      `visual-qa:pvp-qa-1:${hashC}`,
    ], { graphId: "graph-unrelated", ugsRevision: 2 }));
    await store.insert(owner, unrelated);
    await store.insert(owner, createGenericPlanSnapshot(confirmed.input));

    await expect(store.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash)).resolves.toEqual(createGenericPlanSnapshot(confirmed.input));
    await expect(store.getByConfirmedPreviewHash(owner, hashB)).rejects.toThrow(/ambiguous|promotion/i);
  });

  it("ignores malformed promotion reasons and accepts one valid reason alongside malformed text", async () => {
    const pendingHash = "a".repeat(64);
    const malformedReasons = [
      `visual-qa:pvp-qa-1:${"a".repeat(63)}`,
      `visual-qa:pvp-qa-1:${pendingHash.toUpperCase()}`,
      `visual-qa:pvp-qa-1:${pendingHash}:trailing`,
      `trusted-qa:pvp-qa-1:${pendingHash}`,
      `visual-qa:pvp-qa-2:${pendingHash}`,
    ];

    for (const [index, malformedReason] of malformedReasons.entries()) {
      const malformedOnlyStore = new InMemoryGenericPlanSnapshotStore();
      await malformedOnlyStore.insert(owner, createGenericPlanSnapshot(inputWithFormalReasons([
        "topology-complete",
        malformedReason,
      ], { graphId: `graph-malformed-${index + 1}`, ugsRevision: index + 1 })));
      await expect(malformedOnlyStore.getByConfirmedPreviewHash(owner, pendingHash)).resolves.toBeNull();

      const validPlusMalformedStore = new InMemoryGenericPlanSnapshotStore();
      const validPlusMalformed = createGenericPlanSnapshot(inputWithFormalReasons([
        "topology-complete",
        `visual-qa:pvp-qa-1:${pendingHash}`,
        malformedReason,
      ], { graphId: `graph-valid-${index + 1}`, ugsRevision: index + 1 }));
      await validPlusMalformedStore.insert(owner, validPlusMalformed);
      await expect(validPlusMalformedStore.getByConfirmedPreviewHash(owner, pendingHash)).resolves.toEqual(validPlusMalformed);
    }
  });

  it("rejects forged PVP metadata and retains only the canonical reconstructed Snapshot", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const canonical = createGenericPlanSnapshot(input());
    const hostile = { ...canonical };
    Object.defineProperty(hostile, "publicationVisualPlanHash", { configurable: true, enumerable: true, get() { return "f".repeat(64); } });

    await expect(store.insert(owner, hostile as never)).rejects.toThrow(/canonical|Snapshot|PVP/i);
    await expect(store.get(owner, canonical.graphId, canonical.ugsRevision, canonical.snapshotId)).resolves.toBeNull();
  });

  it("returns clone-isolated deeply frozen PVP Snapshots", async () => {
    const store = new InMemoryGenericPlanSnapshotStore();
    const inserted = await store.insert(owner, createGenericPlanSnapshot(input()));
    const fetched = await store.get(owner, inserted.graphId, inserted.ugsRevision, inserted.snapshotId);
    expect(fetched).toEqual(inserted);
    expect(fetched).not.toBe(inserted);
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched!.publicationVisualPlan)).toBe(true);
    expect(fetched!.publicationVisualPlan).not.toBe(inserted.publicationVisualPlan);
  });
});
