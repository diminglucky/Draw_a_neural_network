import { describe, expect, it } from "vitest";
import { InMemorySelectedPageLeaseStore, SelectedPageLeaseService, type SelectedPageSelectionCapture } from "../src/selected-page-lease.js";

const owner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" };
const target = {
  documentId: "document-1",
  pageId: "page-1",
  documentFingerprint: "a".repeat(64),
  pageFingerprint: "b".repeat(64),
  expectedRevision: 0,
};

describe("SelectedPageLeaseService", () => {
  it("issues a short-lived, server-side lease from a read-only current-page capture and consumes it exactly once", async () => {
    const capture = new RecordingCapture({ status: "captured", target });
    const store = new InMemorySelectedPageLeaseStore();
    const service = new SelectedPageLeaseService({ store, capture, now: () => new Date("2026-08-25T00:00:00.000Z"), idFactory: () => "lease-1", ttlMs: 60_000 });

    const issued = await service.capture(owner);
    expect(issued).toEqual({ status: "issued", leaseId: "lease-1", expiresAt: "2026-08-25T00:01:00.000Z" });
    if (issued.status !== "issued") throw new Error("expected a selected-page lease");
    expect(capture.calls).toEqual([owner]);

    const binding = await service.consume({ ...owner, leaseId: issued.leaseId, jobId: "job-1", ownershipNamespace: "agent-region-1" });
    expect(binding).toMatchObject({ ...owner, jobId: "job-1", ownershipNamespace: "agent-region-1", ...target });
    await expect(service.consume({ ...owner, leaseId: issued.leaseId, jobId: "job-2", ownershipNamespace: "agent-region-2" })).rejects.toThrow(/consumed/i);
  });

  it("reports waiting without persisting a lease when Visio has no user-selected existing page", async () => {
    const store = new InMemorySelectedPageLeaseStore();
    const service = new SelectedPageLeaseService({ store, capture: new RecordingCapture({ status: "waiting_for_selected_page" }), now: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(service.capture(owner)).resolves.toEqual({ status: "waiting_for_selected_page" });
    await expect(service.consume({ ...owner, leaseId: "missing", jobId: "job-1", ownershipNamespace: "agent-region-1" })).rejects.toThrow(/unknown/i);
  });

  it("rejects expired, cross-owner, and malformed capture targets before a drawing binding can be created", async () => {
    const store = new InMemorySelectedPageLeaseStore();
    let now = new Date("2026-08-25T00:00:00.000Z");
    const service = new SelectedPageLeaseService({ store, capture: new RecordingCapture({ status: "captured", target }), now: () => now, idFactory: () => "lease-expiring", ttlMs: 1_000 });
    const issued = await service.capture(owner);
    if (issued.status !== "issued") throw new Error("expected an expiring lease");
    now = new Date("2026-08-25T00:00:02.000Z");
    await expect(service.consume({ ...owner, leaseId: issued.leaseId, jobId: "job-1", ownershipNamespace: "agent-region-1" })).rejects.toThrow(/expired/i);

    const other = new SelectedPageLeaseService({ store: new InMemorySelectedPageLeaseStore(), capture: new RecordingCapture({ status: "captured", target }), idFactory: () => "lease-owner" });
    const otherIssued = await other.capture(owner);
    if (otherIssued.status !== "issued") throw new Error("expected an owner-bound lease");
    await expect(other.consume({ ...owner, userId: "other-user", leaseId: otherIssued.leaseId, jobId: "job-1", ownershipNamespace: "agent-region-1" })).rejects.toThrow(/owner/i);
    await expect(other.consume({ ...owner, leaseId: otherIssued.leaseId, jobId: "job-2", ownershipNamespace: "agent-region-1" })).resolves.toMatchObject({
      ...owner,
      jobId: "job-2",
    });

    const malformed = new SelectedPageLeaseService({ store: new InMemorySelectedPageLeaseStore(), capture: new RecordingCapture({ status: "captured", target: { ...target, pageFingerprint: "not-a-hash" } }) });
    await expect(malformed.capture(owner)).rejects.toThrow(/fingerprint/i);
  });
});

class RecordingCapture implements SelectedPageSelectionCapture {
  calls: Array<typeof owner> = [];
  constructor(private readonly result: Awaited<ReturnType<SelectedPageSelectionCapture["capture"]>>) {}
  async capture(input: typeof owner): Promise<Awaited<ReturnType<SelectedPageSelectionCapture["capture"]>>> {
    this.calls.push(input);
    return this.result;
  }
}
