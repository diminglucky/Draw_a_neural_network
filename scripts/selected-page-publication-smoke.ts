import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CurrentPageSelectionCapture } from "../apps/api/src/current-page-selection-capture.js";
import { CurrentPageVisioAdapter } from "../apps/api/src/current-page-visio-adapter.js";
import { composeGeneralPublicationGraph } from "../apps/api/src/general-publication-graph.js";
import { GenericPlanSnapshotService } from "../apps/api/src/generic-plan-snapshot-service.js";
import { InMemoryGenericPlanSnapshotStore } from "../apps/api/src/generic-plan-snapshot-store.js";
import { compilePublicationVisualPlan } from "../apps/api/src/publication-visual-plan-compiler.js";
import { PublicationVisualNativeIntentService } from "../apps/api/src/publication-visual-plan-native-intent.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../apps/api/src/publication-visual-plan-qa-promotion.js";
import { SelectedPageDrawingJob } from "../apps/api/src/selected-page-drawing-job.js";
import { InMemorySelectedPageLeaseStore, SelectedPageLeaseService } from "../apps/api/src/selected-page-lease.js";
import { parseUniversalGraphSpec } from "../apps/api/src/universal-graph-spec.js";
import { VisioWorkerClient } from "../apps/api/src/visio-worker-client.js";
import { unknownResidualMultiBranchUgs } from "../apps/api/tests/fixtures/universal-graph-spec.js";

const worktree = process.cwd();
const secret = randomBytes(32).toString("hex");
const owner = {
  tenantId: "local-live-test",
  userId: "local-user",
  deviceId: "local-device",
  workflowId: "generic-network-live-test",
};

async function main(): Promise<void> {
  const client = new VisioWorkerClient({
    workerPath: `${worktree}/workers/visio-worker/src/VisioWorker.Host/bin/Debug/net8.0-windows/VisioWorker.Host.exe`,
    outputRoot: resolve(tmpdir(), "DrawAgentLiveAcceptance"),
    mode: "live",
    timeoutMs: 120_000,
    visible: true,
    attachToRunning: true,
    selectedPageSealingSecret: secret,
  });
  const leases = new SelectedPageLeaseService({
    store: new InMemorySelectedPageLeaseStore(),
    capture: new CurrentPageSelectionCapture(client.createSelectedPageCaptureTransport(), randomUUID),
    idFactory: randomUUID,
  });

  const ugs = parseUniversalGraphSpec(unknownResidualMultiBranchUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pending = compilePublicationVisualPlan({
    ugs,
    graph,
    updateIdentity: {
      ownerId: owner.userId,
      deviceId: owner.deviceId,
      workflowId: owner.workflowId,
      documentId: "browser-preview",
      pageId: "browser-preview",
      expectedRevision: ugs.revision,
    },
  });
  const plan = promotePublicationVisualPlanAfterTrustedReview({
    plan: pending,
    review: {
      authority: "trusted-human",
      reviewerId: "local-visual-review",
      reviewedAt: new Date().toISOString(),
      approval: "approved",
      expectedPlanHash: pending.identity.canonicalHash,
    },
  }).plan;
  const snapshots = new InMemoryGenericPlanSnapshotStore();
  const snapshot = await new GenericPlanSnapshotService({ store: snapshots }).create({
    owner: { tenantId: owner.tenantId, userId: owner.userId, deviceId: owner.deviceId },
    ugsRevision: ugs.revision,
    ugs,
    graph,
    publicationVisualPlan: plan,
    createdAt: new Date().toISOString(),
  });
  const intentService = new PublicationVisualNativeIntentService({ snapshotStore: snapshots });
  const issued = await leases.capture(owner);
  if (issued.status !== "issued") throw new Error("Select the existing Visio test page before running the smoke test");

  const job = new SelectedPageDrawingJob({
    leases,
    compileNativeIntent: (input) => intentService.compile({
      owner: { tenantId: input.owner.tenantId, userId: input.owner.userId, deviceId: input.owner.deviceId },
      graphId: input.graphId,
      ugsRevision: input.ugsRevision,
      snapshotId: input.snapshotId,
    }),
    executor: {
      draw: (input) => new CurrentPageVisioAdapter(client.createSelectedPageTransport()).draw(input),
    },
    sealedPlanSecret: secret,
    jobIdFactory: randomUUID,
    ownershipNamespaceFactory: () => "agent:generic-network-live-test",
  });
  const result = await job.draw({
    ...owner,
    leaseId: issued.leaseId,
    graphId: snapshot.graphId,
    ugsRevision: snapshot.ugsRevision,
    snapshotId: snapshot.snapshotId,
  });
  process.stdout.write(`${JSON.stringify({ graphId: ugs.graphId, planId: plan.identity.planId, result }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
