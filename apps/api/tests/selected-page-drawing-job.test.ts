import { describe, expect, it } from "vitest";
import { InMemorySelectedPageLeaseStore, SelectedPageLeaseService } from "../src/selected-page-lease.js";
import { SelectedPageDrawingJob } from "../src/selected-page-drawing-job.js";

const owner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" };
const target = { documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64), expectedRevision: 1 };

describe("SelectedPageDrawingJob", () => {
  it("binds a trusted target-neutral native intent to the one-use selected-page lease", async () => {
    const leases = new SelectedPageLeaseService({ store: new InMemorySelectedPageLeaseStore(), capture: { capture: async () => ({ status: "captured" as const, target }) }, idFactory: () => "lease-1", now: () => new Date("2026-08-25T00:00:00.000Z") });
    const issued = await leases.capture(owner);
    if (issued.status !== "issued") throw new Error("expected lease");
    const executor = new RecordingExecutor();
    const job = new SelectedPageDrawingJob({ leases, compileNativeIntent: async () => nativeIntent({ documentId: "browser-preview", pageId: "browser-preview", expectedRevision: 99 }), executor, sealedPlanSecret: "selected-page-job-test-secret", jobIdFactory: () => "job-1", ownershipNamespaceFactory: () => "agent-region-1", now: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(job.draw({ ...owner, leaseId: issued.leaseId, graphId: "graph-1", ugsRevision: 1, snapshotId: "snapshot-1" })).resolves.toEqual({ status: "succeeded", readback: { valid: true } });
    expect(executor.inputs).toHaveLength(1);
    expect(executor.inputs[0].binding).toMatchObject({ ...owner, ...target, jobId: "job-1", ownershipNamespace: "agent-region-1" });
    const decoded = JSON.parse(Buffer.from(executor.inputs[0].sealedNativeIntent.canonicalPlanBase64, "base64").toString("utf8"));
    expect(decoded.updateIdentity).toEqual({ ownerId: owner.userId, deviceId: owner.deviceId, workflowId: owner.workflowId, documentId: target.documentId, pageId: target.pageId, expectedRevision: target.expectedRevision });
    expect(JSON.stringify(decoded)).not.toContain("browser-preview");
  });

  it("fails before consuming the lease if a trusted snapshot belongs to a different owner scope", async () => {
    const leases = new SelectedPageLeaseService({ store: new InMemorySelectedPageLeaseStore(), capture: { capture: async () => ({ status: "captured" as const, target }) }, idFactory: () => "lease-2" });
    const issued = await leases.capture(owner);
    if (issued.status !== "issued") throw new Error("expected lease");
    const executor = new RecordingExecutor();
    const job = new SelectedPageDrawingJob({ leases, compileNativeIntent: async () => ({ ...nativeIntent(target), updateIdentity: { ...nativeIntent(target).updateIdentity, ownerId: "other-user" } }), executor, sealedPlanSecret: "selected-page-job-test-secret", jobIdFactory: () => "job-2", ownershipNamespaceFactory: () => "agent-region-2" });

    await expect(job.draw({ ...owner, leaseId: issued.leaseId, graphId: "graph-1", ugsRevision: 1, snapshotId: "snapshot-1" })).rejects.toThrow(/does not match/i);
    expect(executor.inputs).toEqual([]);
    await expect(leases.consume({ ...owner, leaseId: issued.leaseId, jobId: "job-after-rejection", ownershipNamespace: "agent-region-2" })).resolves.toMatchObject(target);
  });

  it("derives a stable owner and workflow namespace so reapply replaces the same Agent region", async () => {
    let leaseIndex = 0;
    let jobIndex = 0;
    const leases = new SelectedPageLeaseService({
      store: new InMemorySelectedPageLeaseStore(),
      capture: { capture: async () => ({ status: "captured" as const, target }) },
      idFactory: () => `lease-${++leaseIndex}`,
    });
    const first = await leases.capture(owner);
    const second = await leases.capture(owner);
    if (first.status !== "issued" || second.status !== "issued") throw new Error("expected leases");
    const executor = new RecordingExecutor();
    const job = new SelectedPageDrawingJob({
      leases,
      compileNativeIntent: async () => nativeIntent(target),
      executor,
      sealedPlanSecret: "selected-page-job-test-secret",
      jobIdFactory: () => `job-${++jobIndex}`,
    });

    await job.draw({ ...owner, leaseId: first.leaseId, graphId: "graph-1", ugsRevision: 1, snapshotId: "snapshot-1" });
    await job.draw({ ...owner, leaseId: second.leaseId, graphId: "graph-1", ugsRevision: 1, snapshotId: "snapshot-1" });

    expect(executor.inputs).toHaveLength(2);
    expect(executor.inputs[0].binding.ownershipNamespace).toMatch(/^agent:[a-f0-9]{32}$/);
    expect(executor.inputs[1].binding.ownershipNamespace).toBe(executor.inputs[0].binding.ownershipNamespace);
    expect(executor.inputs[1].binding.jobId).not.toBe(executor.inputs[0].binding.jobId);
  });
});

function nativeIntent(value: Pick<typeof target, "documentId" | "pageId" | "expectedRevision">) {
  return { protocolVersion: "pvp-native-intent-1" as const, planId: "plan-1", planHash: "c".repeat(64), updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: owner.workflowId, documentId: value.documentId, pageId: value.pageId, expectedRevision: value.expectedRevision }, coordinateSpace: { id: "pvp-du-1" as const, unit: "du" as const, duPerInch: 1000 as const, page: { x: 0, y: 0, width: 1000, height: 1000 } }, primitives: [], connectors: [] };
}

class RecordingExecutor {
  inputs: Array<any> = [];
  async draw(input: any) { this.inputs.push(input); return { status: "succeeded" as const, readback: { valid: true } }; }
}
