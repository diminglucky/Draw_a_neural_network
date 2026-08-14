import { describe, expect, it } from "vitest";
import { PlanExportConfirmationService } from "../src/plan-export-confirmation.js";
import { createPlanSnapshot } from "../src/plan-snapshot.js";
import { InMemoryPlanSnapshotStore } from "../src/plan-snapshot-store.js";
import { InMemoryUniversalFigureExportJobStore, UniversalFigureExportService } from "../src/figure-export-service.js";
import { verifySealedPlan } from "../src/visio-universal-protocol.js";

const owner = { tenantId: "tenant-1", userId: "user-1" };
const deviceId = "device-1";
const sealedPlanSecret = "sealed-plan-secret";

function snapshot() {
  return createPlanSnapshot({
    draftId: "draft-1",
    revision: 1,
    figureSet: {
      version: 1,
      figureSetId: "figure-set-1",
      draftId: "draft-1",
      revision: 1,
      intentHash: "f".repeat(64),
      panels: [{ panelId: "overview", title: "Overview", primitives: [{ id: "node-1", kind: "shape", semanticIds: ["node-1"] }] }],
      crossPanelMappings: [],
    },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "a".repeat(64) }],
    compilerManifest: {
      canonicalization: "RFC-8785-JCS",
      architectureIrHash: "b".repeat(64),
      figureIntentHash: "f".repeat(64),
      componentCompilerVersion: "1",
      layoutCompilerVersion: "1",
      styleTokenVersion: "1",
      layoutSeed: "seed",
    },
    visualQa: { status: "pass", checks: [] },
    createdAt: "2026-08-14T00:00:00.000Z",
  });
}

async function viewedFixture() {
  const snapshotStore = new InMemoryPlanSnapshotStore();
  const plan = snapshot();
  await snapshotStore.insert(owner, plan);
  await snapshotStore.recordViewedPreview({
    ...owner,
    deviceId,
    draftId: plan.draftId,
    revision: plan.revision,
    planId: plan.planId,
    planHash: plan.canonicalPlanBytesSha256,
    previewArtifactHashes: plan.previewArtifactHashes,
    viewedAt: "2026-08-14T00:01:00.000Z",
  });
  const confirmations = new PlanExportConfirmationService({ secret: "confirmation-secret", now: () => 1_000 });
  const jobs = new InMemoryUniversalFigureExportJobStore();
  const service = new UniversalFigureExportService({
    snapshotStore,
    confirmationService: confirmations,
    jobStore: jobs,
    sealedPlanSecret,
    now: () => new Date("2026-08-14T00:02:00.000Z"),
  });
  const identity = {
    ...owner,
    deviceId,
    draftId: plan.draftId,
    revision: plan.revision,
    planId: plan.planId,
    planHash: plan.canonicalPlanBytesSha256,
    previewArtifactHashes: plan.previewArtifactHashes,
  };
  return { plan, confirmations, jobs, service, identity };
}

describe("UniversalFigureExportService", () => {
  it("creates a queued universal export from the exact viewed immutable snapshot", async () => {
    const { plan, confirmations, service, identity } = await viewedFixture();
    const token = confirmations.issue(identity);

    const result = await service.create({
      owner,
      deviceId,
      draftId: plan.draftId,
      revision: plan.revision,
      confirmationToken: token,
      idempotencyKey: "export-1",
    });

    expect(result.duplicate).toBe(false);
    expect(result.job).toMatchObject({
      type: "universal-figure-export",
      status: "queued",
      draftId: plan.draftId,
      revision: plan.revision,
      planId: plan.planId,
      planHash: plan.canonicalPlanBytesSha256,
    });
    expect(result.job.input).not.toHaveProperty("diagram");
    expect(result.job.input).not.toHaveProperty("outputPath");
    const bytes = verifySealedPlan(result.job.input.sealedPlan, {
      jobId: result.job.id,
      tenantId: owner.tenantId,
      userId: owner.userId,
      deviceId,
      planId: plan.planId,
    }, sealedPlanSecret, new Date("2026-08-14T00:03:00.000Z"));
    expect(JSON.parse(bytes.toString("utf8"))).toEqual({ figureSet: plan.figureSet, compilerManifest: plan.compilerManifest });
  });

  it("refuses to export a snapshot that was not viewed by the requesting device", async () => {
    const { plan, confirmations, service, identity } = await viewedFixture();
    const token = confirmations.issue(identity);

    await expect(service.create({
      owner,
      deviceId: "device-2",
      draftId: plan.draftId,
      revision: plan.revision,
      confirmationToken: token,
      idempotencyKey: "export-1",
    })).rejects.toThrow(/viewed|device|found|belong/i);
  });

  it("returns an existing idempotent job without consuming a new confirmation token", async () => {
    const { plan, confirmations, service, identity } = await viewedFixture();
    const firstToken = confirmations.issue(identity);
    const first = await service.create({ owner, deviceId, draftId: plan.draftId, revision: plan.revision, confirmationToken: firstToken, idempotencyKey: "export-1" });
    const retainedToken = confirmations.issue(identity);

    const duplicate = await service.create({ owner, deviceId, draftId: plan.draftId, revision: plan.revision, confirmationToken: retainedToken, idempotencyKey: "export-1" });
    expect(duplicate).toMatchObject({ duplicate: true, job: { id: first.job.id } });

    await expect(service.create({ owner, deviceId, draftId: plan.draftId, revision: plan.revision, confirmationToken: retainedToken, idempotencyKey: "export-2" })).resolves.toMatchObject({ duplicate: false });
  });

  it("rejects an idempotency key reused for a different immutable plan identity", async () => {
    const { plan, confirmations, service, identity } = await viewedFixture();
    await service.create({ owner, deviceId, draftId: plan.draftId, revision: plan.revision, confirmationToken: confirmations.issue(identity), idempotencyKey: "export-1" });

    await expect(service.create({ owner, deviceId, draftId: plan.draftId, revision: 2, confirmationToken: "unused", idempotencyKey: "export-1" })).rejects.toThrow(/idempotency|different/i);
  });
});
