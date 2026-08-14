import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { UniversalFigureExportService, InMemoryUniversalFigureExportJobStore } from "../src/figure-export-service.js";
import { PlanExportConfirmationService } from "../src/plan-export-confirmation.js";
import { createPlanSnapshot } from "../src/plan-snapshot.js";
import { InMemoryPlanSnapshotStore } from "../src/plan-snapshot-store.js";
import { InMemoryFoundationStore } from "../src/store.js";

const SESSION_SECRET = "universal-figure-export-route-session-secret";
const SEALED_PLAN_SECRET = "universal-figure-export-route-sealed-secret";

async function registerAndLogin(app: ReturnType<typeof buildApp>) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: "universal-export@example.com",
      password: "password-123",
      device: {
        name: "Research PC",
        publicKey: "universal-export-public-key",
        fingerprintHash: "universal-export-fingerprint",
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  expect(registered.statusCode).toBe(201);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: registered.json().user.email, password: "password-123", deviceId: registered.json().device.id },
  });
  expect(login.statusCode).toBe(200);
  return {
    userId: registered.json().user.id as string,
    deviceId: registered.json().device.id as string,
    headers: { authorization: `Bearer ${login.json().accessToken as string}` },
  };
}

function createSnapshot() {
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

describe("universal figure export route", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("creates only a version-3 plan-only job for the exact preview viewed by the current device", async () => {
    const store = new InMemoryFoundationStore();
    const snapshots = new InMemoryPlanSnapshotStore();
    const confirmations = new PlanExportConfirmationService({ secret: "universal-export-confirmation-secret", now: () => 1_000 });
    const exports = new UniversalFigureExportService({
      snapshotStore: snapshots,
      confirmationService: confirmations,
      jobStore: new InMemoryUniversalFigureExportJobStore(),
      sealedPlanSecret: SEALED_PLAN_SECRET,
      now: () => new Date("2026-08-14T00:02:00.000Z"),
    });
    const runner = { submit: (_jobId: string) => undefined };
    const app = buildApp({
      sessionSecret: SESSION_SECRET,
      store,
      universalFigureExportService: exports,
      universalFigureExportRunner: runner,
    } as never);
    apps.add(app);
    const access = await registerAndLogin(app);
    const owner = { tenantId: `tenant-${access.userId}`, userId: access.userId };
    const snapshot = createSnapshot();
    await snapshots.insert(owner, snapshot);
    await snapshots.recordViewedPreview({
      ...owner,
      deviceId: access.deviceId,
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      planId: snapshot.planId,
      planHash: snapshot.canonicalPlanBytesSha256,
      previewArtifactHashes: snapshot.previewArtifactHashes,
      viewedAt: "2026-08-14T00:01:00.000Z",
    });
    const token = confirmations.issue({
      ...owner,
      deviceId: access.deviceId,
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      planId: snapshot.planId,
      planHash: snapshot.canonicalPlanBytesSha256,
      previewArtifactHashes: snapshot.previewArtifactHashes,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-1/revisions/1/exports",
      headers: {
        ...access.headers,
        "accept-figure-version": "3",
        "idempotency-key": "universal-export-1",
      },
      payload: { confirmationToken: token, idempotencyKey: "universal-export-1" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["figure-version"]).toBe("3");
    expect(response.json()).toMatchObject({
      type: "universal-figure-export",
      status: "queued",
      draftId: "draft-1",
      revision: 1,
      planId: snapshot.planId,
      pollUrl: expect.stringMatching(/^\/api\/jobs\//),
    });
    expect(JSON.stringify(response.json())).not.toMatch(/diagram|figurePlan|coordinates|outputPath|planUrl|planPath|storageKey/i);

    const polled = await app.inject({
      method: "GET",
      url: response.json().pollUrl,
      headers: access.headers,
    });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({ id: response.json().id, type: "universal-figure-export", status: "queued" });
    expect(JSON.stringify(polled.json())).not.toMatch(/sealedPlan|canonicalPlanBase64|signature|figureSet|compilerManifest/i);

    const bypass = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: access.headers,
      payload: { type: "universal-figure-export", input: { planId: "attacker-plan" } },
    });
    expect(bypass.statusCode).toBe(400);
  });

  it("projects completed Universal Worker output to a path-free public DTO", async () => {
    const store = new InMemoryFoundationStore();
    const snapshots = new InMemoryPlanSnapshotStore();
    const confirmations = new PlanExportConfirmationService({ secret: "universal-export-confirmation-secret", now: () => 1_000 });
    const exports = new UniversalFigureExportService({ snapshotStore: snapshots, confirmationService: confirmations, jobStore: new InMemoryUniversalFigureExportJobStore(), sealedPlanSecret: SEALED_PLAN_SECRET, now: () => new Date("2026-08-14T00:02:00.000Z") });
    const app = buildApp({ sessionSecret: SESSION_SECRET, store, universalFigureExportService: exports, universalFigureExportRunner: { submit: () => undefined } } as never);
    apps.add(app);
    const access = await registerAndLogin(app);
    const owner = { tenantId: `tenant-${access.userId}`, userId: access.userId };
    const snapshot = createSnapshot();
    await snapshots.insert(owner, snapshot);
    await snapshots.recordViewedPreview({ ...owner, deviceId: access.deviceId, draftId: snapshot.draftId, revision: snapshot.revision, planId: snapshot.planId, planHash: snapshot.canonicalPlanBytesSha256, previewArtifactHashes: snapshot.previewArtifactHashes, viewedAt: "2026-08-14T00:01:00.000Z" });
    const token = confirmations.issue({ ...owner, deviceId: access.deviceId, draftId: snapshot.draftId, revision: snapshot.revision, planId: snapshot.planId, planHash: snapshot.canonicalPlanBytesSha256, previewArtifactHashes: snapshot.previewArtifactHashes });
    const created = await app.inject({ method: "POST", url: "/api/figure-drafts/draft-1/revisions/1/exports", headers: { ...access.headers, "accept-figure-version": "3", "idempotency-key": "universal-export-projection-1" }, payload: { confirmationToken: token, idempotencyKey: "universal-export-projection-1" } });
    const queued = await store.getJob(created.json().id);
    if (!queued) throw new Error("expected queued universal export Job");
    await store.updateJob({
      ...queued,
      status: "succeeded",
      completedAt: "2026-08-14T00:03:00.000Z",
      output: {
        artifacts: [{ format: "vsdx", sha256: "a".repeat(64), bytes: 10 }],
        readback: { valid: true, shapeCount: 1, connectorCount: 0, nativeShapes: [{ nativeShapeId: "C:\\secret\\shape", semanticId: "node-1" }] },
        rendererQa: { pageFit: { passed: true, detail: "C:\\secret\\worker.log" } },
        sealedPlan: { canonicalPlanBase64: "secret-plan" },
        outputPath: "C:\\secret\\figure.vsdx",
      },
      errorCode: "VISIO_EXECUTION_FAILED",
      errorMessage: "C:\\secret\\worker-error.log",
    });

    const polled = await app.inject({ method: "GET", url: created.json().pollUrl, headers: access.headers });

    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({ status: "succeeded", artifacts: [{ format: "vsdx", sha256: "a".repeat(64), bytes: 10 }], readback: { valid: true, shapeCount: 1, connectorCount: 0 } });
    expect(JSON.stringify(polled.json())).not.toMatch(/secret|canonicalPlan|sealedPlan|outputPath|errorMessage|nativeShape/i);
  });
});
