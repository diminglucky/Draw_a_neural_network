import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { InMemoryDrawingRunCoordinator } from "../src/drawing-run/coordinator.js";
import type { DrawingRunCoordinator } from "../src/drawing-run/coordinator.js";
import type { DrawingRun } from "../src/drawing-run/contracts.js";
import { FoundationDrawingRunStoreAdapter } from "../src/drawing-run/store.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";

const SESSION_SECRET = "selected-page-route-test-session-secret";

function selectedPageTestDigest(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

function confirmedSnapshotStore(workflowId = "run-page-bound", overrides: { documentId?: string; pageId?: string; expectedRevision?: number } = {}) {
  const resolve = async (snapshotOwner: { tenantId: string; userId: string; deviceId: string }, pendingPreviewHash: string) => ({
    tenantId: snapshotOwner.tenantId,
    userId: snapshotOwner.userId,
    deviceId: snapshotOwner.deviceId,
    publicationVisualPlanHash: "d".repeat(64),
    graphId: "graph-1",
    ugsRevision: 7,
    ugsCanonicalHash: "4".repeat(64),
    snapshotId: "snapshot-1",
    publicationVisualPlan: {
      updateIdentity: {
        ownerId: snapshotOwner.userId,
        deviceId: snapshotOwner.deviceId,
        workflowId,
        documentId: overrides.documentId ?? "browser-preview",
        pageId: overrides.pageId ?? "browser-preview",
        expectedRevision: overrides.expectedRevision ?? 7,
      },
      eligibility: { formalReasons: [`visual-qa:pvp-qa-1:${pendingPreviewHash}`] },
    },
  });
  return {
    insert: async () => { throw new Error("unused"); },
    get: async () => null,
    getByPublicationVisualPlanHash: vi.fn(resolve),
    getByConfirmedPreviewHash: vi.fn(resolve),
  };
}

type SelectedPageRouteOptions = {
  selectedPageLeaseService: {
    capture(input: { tenantId: string; userId: string; deviceId: string; workflowId: string }): Promise<unknown>;
  };
  selectedPageDrawingJob: {
    draw(input: {
      tenantId: string;
      userId: string;
      deviceId: string;
      workflowId: string;
      leaseId: string;
      graphId: string;
      ugsRevision: number;
      snapshotId: string;
    }): Promise<unknown>;
  };
  selectedPagePreviewReviewService?: {
    confirm(input: {
      owner: { tenantId: string; userId: string; deviceId: string };
      workflowId: string;
      expectedUgsHash: string;
      pendingPreviewHash: string;
    }): Promise<unknown>;
  };
};

function previewReadyCoordinator() {
  const discoverPageTarget = vi.fn(async () => ({
    runId: "run-page-bound",
    revision: 8,
    status: "awaiting_page_binding" as const,
    errorCategory: "none" as const,
    allowedActions: ["bind_page", "cancel"] as const,
    clarification: null,
    preview: { artifactId: `preview:${"a".repeat(64)}`, hash: "a".repeat(64) },
  }));
  const bindExistingPage = vi.fn(async () => ({
    runId: "run-page-bound",
    revision: 9,
    status: "page_bound" as const,
    errorCategory: "none" as const,
    allowedActions: ["request_apply", "cancel"] as const,
    clarification: null,
    preview: { artifactId: `preview:${"a".repeat(64)}`, hash: "a".repeat(64) },
  }));
  return {
    coordinator: {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 7,
        status: "preview_ready" as const,
        errorCategory: "none" as const,
        allowedActions: ["discover_page_target", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"a".repeat(64)}`, hash: "a".repeat(64) },
      })),
      discoverPageTarget,
      bindExistingPage,
    } as unknown as DrawingRunCoordinator,
    discoverPageTarget,
    bindExistingPage,
  };
}

function persistedRunFromProjection(
  run: Awaited<ReturnType<DrawingRunCoordinator["get"]>> extends infer T ? Exclude<T, null> : never,
  ownerId: string,
  deviceId: string,
): DrawingRun {
  const artifactCount = ({ preview_ready: 6, awaiting_page_binding: 7, page_bound: 8, applying: 9, readback_verified: 10 } as Record<string, number>)[run.status] ?? 6;
  const formalUgsHash = "4".repeat(64);
  const artifactHashes = Array.from({ length: artifactCount }, (_value, index) => ((index + 1) % 10).toString().repeat(64));
  artifactHashes[3] = formalUgsHash;
  return {
    runId: run.runId,
    ownerId,
    deviceId,
    status: run.status,
    revision: run.revision,
    intent: { action: "create_figure", requestedDetail: "architecture", target: "existing_visio_page", sourceKinds: ["pytorch_source"] },
    artifactHashes,
    privateReceiptIds: ["receipt-1"],
    startIdempotencyKey: "start-1",
    startRequestHash: "6".repeat(64),
    createdAt: "2026-08-25T07:00:00.000Z",
    updatedAt: "2026-08-25T07:01:00.000Z",
    clarification: null,
    preview: run.preview,
    errorCategory: run.errorCategory,
    formalUgsHash,
  };
}

async function authorizedApp(
  selectedPage?: SelectedPageRouteOptions,
  coordinatorOverride?: DrawingRunCoordinator,
  extraOptions: Record<string, unknown> = {},
) {
  const store = new InMemoryFoundationStore();
  const drawingRunCoordinator = coordinatorOverride ?? new InMemoryDrawingRunCoordinator({
    store: new FoundationDrawingRunStoreAdapter(store),
  });
  const app = buildApp({
    sessionSecret: SESSION_SECRET,
    store,
    drawingRunCoordinator,
    genericPlanSnapshotStore: confirmedSnapshotStore(),
    ...extraOptions,
    ...(selectedPage ?? {}),
  } as unknown as BuildAppOptions & SelectedPageRouteOptions);
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: "selected-page@example.com",
      password: "password-123",
      device: {
        name: "Selected-page workstation",
        publicKey: "public-key-selected-page",
        fingerprintHash: "fingerprint-selected-page",
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  expect(registered.statusCode).toBe(201);
  const userId = registered.json().user.id as string;
  const deviceId = registered.json().device.id as string;
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "selected-page@example.com", password: "password-123", deviceId },
  });
  expect(login.statusCode).toBe(200);
  const headers = { authorization: `Bearer ${login.json().accessToken as string}` };
  const runId = coordinatorOverride
    ? "run-page-bound"
    : (await drawingRunCoordinator.start({
      ownerId: userId,
      deviceId,
      idempotencyKey: "selected-page-run-start",
      intent: {
        action: "create_figure",
        requestedDetail: "architecture",
        target: "existing_visio_page",
        sourceKinds: ["pytorch_source"],
      },
    })).runId;
  const getDrawingRun = coordinatorOverride
    ? vi.spyOn(store, "getDrawingRun").mockImplementation(async (ownerId, requestedRunId) => {
      const projected = await drawingRunCoordinator.get(ownerId, requestedRunId, deviceId);
      return projected ? persistedRunFromProjection(projected, ownerId, deviceId) : null;
    })
    : null;
  if (coordinatorOverride && !selectedPage?.selectedPagePreviewReviewService) {
    const projected = await drawingRunCoordinator.get(userId, runId, deviceId);
    if (projected?.preview) {
      const formalUgsHash = "4".repeat(64);
      await store.createAuditRecord({
        id: `selected-page-confirmed-${selectedPageTestDigest([userId, deviceId, runId, projected.preview.hash]).slice(0, 48)}`,
        actorType: "user",
        actorId: userId,
        action: "drawing-run.selected-page-preview.confirmed",
        targetType: "drawing-run",
        targetId: runId,
        reason: null,
        metadata: {
          requestHash: "9".repeat(64),
          runId,
          revision: projected.revision,
          pendingPreviewHash: projected.preview.hash,
          expectedUgsHash: formalUgsHash,
          promotedPlanHash: "d".repeat(64),
          snapshotLocator: { graphId: "graph-1", ugsRevision: 7, snapshotId: "snapshot-1" },
          replayed: false,
          reviewerId: userId,
          reviewedAt: "2026-08-25T08:00:00.000Z",
          idempotencyDigest: "8".repeat(64),
        },
        createdAt: "2026-08-25T08:00:00.000Z",
      });
    }
  }
  return { app, store, getDrawingRun, drawingRunCoordinator, headers, runId, userId, deviceId };
}

describe("selected current-page Drawing Run routes", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("confirms only the server-derived current preview and returns a minimal response", async () => {
    const pendingPreviewHash = "a".repeat(64);
    const formalUgsHash = "4".repeat(64);
    const promotedPlanHash = "d".repeat(64);
    const confirmation = {
      snapshot: {
        snapshotId: "snapshot-1",
        graphId: "graph-1",
        ugsRevision: 7,
        publicationVisualPlanHash: promotedPlanHash,
      },
      decision: {
        reviewerId: "server-derived",
        reviewedAt: "2026-08-25T08:00:00.000Z",
      },
      replayed: false,
    };
    const confirm = vi.fn(async () => confirmation);
    const fixture = previewReadyCoordinator();
    const { app, store, getDrawingRun, headers, runId, userId, deviceId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw: vi.fn() },
      selectedPagePreviewReviewService: { confirm },
    }, fixture.coordinator);
    apps.add(app);
    const persistedRun: DrawingRun = {
      runId,
      ownerId: userId,
      deviceId,
      status: "preview_ready",
      revision: 7,
      intent: {
        action: "create_figure",
        requestedDetail: "architecture",
        target: "existing_visio_page",
        sourceKinds: ["pytorch_source"],
      },
      artifactHashes: ["1".repeat(64), "2".repeat(64), "3".repeat(64), formalUgsHash, pendingPreviewHash, "5".repeat(64)],
      privateReceiptIds: ["receipt-1"],
      startIdempotencyKey: "start-1",
      startRequestHash: "6".repeat(64),
      createdAt: "2026-08-25T07:00:00.000Z",
      updatedAt: "2026-08-25T07:01:00.000Z",
      clarification: null,
      preview: { artifactId: `preview:${pendingPreviewHash}`, hash: pendingPreviewHash },
      errorCategory: "none",
      formalUgsHash,
    };
    getDrawingRun!.mockResolvedValue(persistedRun);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/confirm-selected-page-preview`,
      headers: { ...headers, "idempotency-key": "confirm-selected-page-preview-1" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ status: "confirmed", runId, revision: 7 });
    expect(confirm).toHaveBeenCalledWith({
      owner: { tenantId: `tenant-${userId}`, userId, deviceId },
      workflowId: runId,
      expectedUgsHash: formalUgsHash,
      pendingPreviewHash,
    });
    const audit = (await store.listAuditRecords()).find((record) => record.action === "drawing-run.selected-page-preview.confirmed");
    expect(audit).toMatchObject({
      actorType: "user",
      actorId: userId,
      targetType: "drawing-run",
      targetId: runId,
      metadata: {
        runId,
        revision: 7,
        pendingPreviewHash,
        promotedPlanHash,
        snapshotLocator: {
          graphId: "graph-1",
          ugsRevision: 7,
          snapshotId: "snapshot-1",
        },
        replayed: false,
      },
    });
    expect(Object.keys(audit!.metadata).sort()).toEqual([
      "expectedUgsHash",
      "idempotencyDigest",
      "pendingPreviewHash",
      "promotedPlanHash",
      "replayed",
      "requestHash",
      "reviewedAt",
      "reviewerId",
      "revision",
      "runId",
      "snapshotLocator",
    ]);
    expect(audit!.metadata.idempotencyDigest).toMatch(/^[a-f0-9]{64}$/);

    confirm.mockResolvedValueOnce({ ...confirmation, replayed: true });
    const replay = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/confirm-selected-page-preview`,
      headers: { ...headers, "idempotency-key": "confirm-selected-page-preview-replay" },
      payload: { expectedRevision: 7 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ status: "confirmed", runId, revision: 7 });
    expect((await store.listAuditRecords()).filter((record) => record.action === "drawing-run.selected-page-preview.confirmed")).toHaveLength(1);

    getDrawingRun!.mockResolvedValue({
      ...persistedRun,
      revision: 8,
      updatedAt: "2026-08-25T07:02:00.000Z",
      artifactHashes: [...persistedRun.artifactHashes.slice(0, -2), "e".repeat(64), "f".repeat(64)],
      preview: { artifactId: `preview:${"e".repeat(64)}`, hash: "e".repeat(64) },
    });
    const conflictingReplay = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/confirm-selected-page-preview`,
      headers: { ...headers, "idempotency-key": "confirm-selected-page-preview-1" },
      payload: { expectedRevision: 8 },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(confirm).toHaveBeenCalledTimes(1);

    const forged = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/confirm-selected-page-preview`,
      headers: { ...headers, "idempotency-key": "confirm-selected-page-preview-forged" },
      payload: { expectedRevision: 7, reviewerId: "browser-reviewer", expectedPreviewHash: pendingPreviewHash },
    });
    expect(forged.statusCode).toBe(400);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("requires lease capture and drawing job dependencies to be configured together", () => {
    expect(() => buildApp({
      sessionSecret: SESSION_SECRET,
      selectedPageLeaseService: { capture: vi.fn() } as never,
    })).toThrow(/selected-page.*complete set/i);

    expect(() => buildApp({
      sessionSecret: SESSION_SECRET,
      selectedPageLeaseService: { capture: vi.fn() } as never,
      selectedPageDrawingJob: { draw: vi.fn() } as never,
    })).toThrow(/selected-page.*complete set/i);
  });

  it("builds one app-scoped selected-page chain from a Worker client, secret, and snapshot store", async () => {
    const captureCommands: Array<Record<string, unknown>> = [];
    const workerClient = {
      createSelectedPageCaptureTransport: () => ({
        execute: async (command: Record<string, unknown>) => {
          captureCommands.push(command);
          return {
            protocolVersion: 3,
            requestId: command.requestId,
            status: "succeeded",
            capturedTarget: {
              documentId: "document-1",
              pageId: "page-1",
              documentFingerprint: "a".repeat(64),
              pageFingerprint: "b".repeat(64),
              expectedRevision: 1,
            },
          };
        },
        close: async () => undefined,
      }),
      createSelectedPageTransport: () => ({
        execute: async () => { throw new Error("draw transport is unused in this test"); },
        close: async () => undefined,
      }),
    };
    const config = loadConfig({
      NODE_ENV: "test",
      STORAGE_DRIVER: "memory",
      SESSION_SECRET,
      VISIO_WORKER_PATH: "C:\\tools\\visio-worker.exe",
      VISIO_OUTPUT_ROOT: "C:\\exports",
      VISIO_WORKER_MODE: "mock",
      SYNAPSE_SELECTED_PAGE_SEALING_SECRET: "selected-page-sealing-secret-at-least-32",
    });
    const state = previewReadyCoordinator();
    const { app, headers, runId } = await authorizedApp(undefined, state.coordinator, {
      config,
      genericPlanSnapshotStore: confirmedSnapshotStore(),
      selectedPageWorkerClient: workerClient,
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-default" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "issued" });
    expect(captureCommands).toHaveLength(1);
    expect(captureCommands[0]).toMatchObject({ protocolVersion: 3, command: "captureSelectedPage" });
    expect(state.discoverPageTarget).toHaveBeenCalledOnce();
    expect(state.bindExistingPage).toHaveBeenCalledOnce();
  });

  it("issues an opaque lease for the authenticated run without accepting page identity", async () => {
    const capture = vi.fn(async () => ({
      status: "issued" as const,
      leaseId: "lease-1",
      expiresAt: "2026-08-25T04:00:00.000Z",
    }));
    const selectedPageDrawingJob = { draw: vi.fn() };
    const state = previewReadyCoordinator();
    const { app, headers, runId, userId, deviceId } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob,
    }, state.coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-1" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      status: "issued",
      leaseId: "lease-1",
      expiresAt: "2026-08-25T04:00:00.000Z",
      run: expect.objectContaining({ status: "page_bound", revision: 9 }),
    });
    expect(capture).toHaveBeenCalledWith({
      tenantId: `tenant-${userId}`,
      userId,
      deviceId,
      workflowId: runId,
    });

    const forged = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-forged" },
      payload: { expectedRevision: 7, documentId: "document-forged", pageFingerprint: "a".repeat(64) },
    });
    expect(forged.statusCode).toBe(400);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(state.discoverPageTarget).toHaveBeenCalledOnce();
    expect(state.bindExistingPage).toHaveBeenCalledOnce();
  });

  it("returns a revision conflict before capturing a selected page for a stale lease request", async () => {
    const capture = vi.fn();
    const state = previewReadyCoordinator();
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob: { draw: vi.fn() },
    }, state.coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-stale" },
      payload: { expectedRevision: 6 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "DRAWING_RUN_REVISION_CONFLICT" } });
    expect(capture).not.toHaveBeenCalled();
    expect(state.discoverPageTarget).not.toHaveBeenCalled();
    expect(state.bindExistingPage).not.toHaveBeenCalled();
  });

  it("does not capture or issue a selected-page lease before the current preview is confirmed", async () => {
    const capture = vi.fn();
    const state = previewReadyCoordinator();
    const missingConfirmationStore = {
      ...confirmedSnapshotStore(),
      getByConfirmedPreviewHash: vi.fn(async () => null),
    };
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob: { draw: vi.fn() },
    }, state.coordinator, { genericPlanSnapshotStore: missingConfirmationStore });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-unconfirmed" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(409);
    expect(capture).not.toHaveBeenCalled();
    expect(state.discoverPageTarget).not.toHaveBeenCalled();
    expect(state.bindExistingPage).not.toHaveBeenCalled();
  });

  it("does not capture from a confirmed snapshot whose source target is not the browser preview", async () => {
    const capture = vi.fn();
    const state = previewReadyCoordinator();
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob: { draw: vi.fn() },
    }, state.coordinator, {
      genericPlanSnapshotStore: confirmedSnapshotStore("run-page-bound", { documentId: "document-forged" }),
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-wrong-source-target" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(409);
    expect(capture).not.toHaveBeenCalled();
    expect(state.discoverPageTarget).not.toHaveBeenCalled();
  });

  it("returns waiting status when Visio has no existing selected page", async () => {
    const capture = vi.fn(async () => ({ status: "waiting_for_selected_page" as const }));
    const state = previewReadyCoordinator();
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob: { draw: vi.fn() },
    }, state.coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/selected-page-lease`,
      headers: { ...headers, "idempotency-key": "selected-page-capture-waiting" },
      payload: { expectedRevision: 7 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "waiting_for_selected_page" });
    expect(state.discoverPageTarget).not.toHaveBeenCalled();
    expect(state.bindExistingPage).not.toHaveBeenCalled();
  });

  it("retires browser-supplied page handles and the state-only apply route", async () => {
    const state = previewReadyCoordinator();
    const requestApply = vi.fn();
    (state.coordinator as unknown as { requestApply: typeof requestApply }).requestApply = requestApply;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw: vi.fn() },
    }, state.coordinator);
    apps.add(app);

    const binding = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/page-binding`,
      headers: { ...headers, "idempotency-key": "legacy-page-binding" },
      payload: { expectedRevision: 7, pageTargetHandle: "browser-page", ownedRegionId: "browser-region" },
    });
    const apply = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply`,
      headers: { ...headers, "idempotency-key": "legacy-apply" },
      payload: { expectedRevision: 7, confirmationNonce: "browser-only" },
    });

    expect(binding.statusCode).toBe(400);
    expect(apply.statusCode).toBe(400);
    expect(state.bindExistingPage).not.toHaveBeenCalled();
    expect(requestApply).not.toHaveBeenCalled();
  });

  it("draws only from an opaque lease and a server-resolved confirmed snapshot and returns a redacted readback", async () => {
    const draw = vi.fn(async () => ({
      status: "succeeded" as const,
      readback: {
        valid: true as const,
        documentId: "document-1",
        pageId: "page-1",
        documentFingerprint: "a".repeat(64),
        pageFingerprint: "b".repeat(64),
        expectedRevision: 7,
        ownershipNamespace: "agent:private-namespace",
        userOwnedShapeCount: 2,
        agentOwnedShapes: [
          {
            nativeShapeId: "shape-1",
            ownershipNamespace: "agent:private-namespace",
            sourceMappingSemanticIds: ["conv-1"],
          },
        ],
        unclassifiedShapeCount: 0 as const,
      },
    }));
    const requestApply = vi.fn(async (_input: { confirmationNonce: string }) => ({
      replayed: false,
      run: {
        runId: "run-page-bound",
        revision: 9,
        status: "applying" as const,
        errorCategory: "none" as const,
        allowedActions: ["verify_readback", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      },
    }));
    const verifyReadback = vi.fn(async () => ({
      runId: "run-page-bound",
      revision: 10,
      status: "readback_verified" as const,
      errorCategory: "none" as const,
      allowedActions: [] as const,
      clarification: null,
      preview: null,
    }));
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 8,
        status: "page_bound" as const,
        errorCategory: "none" as const,
        allowedActions: ["request_apply", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      })),
      requestApply,
      verifyReadback,
    } as unknown as DrawingRunCoordinator;
    const snapshotStore = confirmedSnapshotStore();
    const { app, headers, runId, userId, deviceId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw },
    }, coordinator, { genericPlanSnapshotStore: snapshotStore });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-apply-1" },
      payload: {
        expectedRevision: 8,
        confirmationNonce: "confirmed-by-user",
        leaseId: "lease-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(snapshotStore.getByConfirmedPreviewHash).toHaveBeenCalledWith({
      tenantId: `tenant-${userId}`,
      userId,
      deviceId,
    }, "c".repeat(64));
    expect(snapshotStore.getByPublicationVisualPlanHash).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledWith({
      tenantId: `tenant-${userId}`,
      userId,
      deviceId,
      workflowId: runId,
      leaseId: "lease-1",
      graphId: "graph-1",
      ugsRevision: 7,
      snapshotId: "snapshot-1",
    });
    expect(requestApply).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: userId,
      deviceId,
      runId,
      expectedRevision: 8,
      idempotencyKey: "selected-page-apply-1",
      confirmationNonce: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(requestApply.mock.calls[0][0].confirmationNonce).not.toBe("confirmed-by-user");
    expect(verifyReadback).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: userId,
      deviceId,
      runId,
      expectedRevision: 9,
    }));
    expect(response.json()).toEqual({
      status: "succeeded",
      run: expect.objectContaining({ status: "readback_verified", revision: 10 }),
      readback: {
        valid: true,
        userOwnedShapeCount: 2,
        agentOwnedShapeCount: 1,
        sourceMappingSemanticIds: ["conv-1"],
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("Fingerprint");
    expect(JSON.stringify(response.json())).not.toContain("ownershipNamespace");

    const forged = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-apply-forged" },
      payload: {
        expectedRevision: 8,
        confirmationNonce: "confirmed-by-user",
        leaseId: "lease-2",
        graphId: "browser-must-not-select-snapshot",
        nativeIntent: { command: "arbitrary-com" },
      },
    });
    expect(forged.statusCode).toBe(400);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("does not invoke selected-page services for an unknown Drawing Run", async () => {
    const capture = vi.fn();
    const draw = vi.fn();
    const { app, headers } = await authorizedApp({
      selectedPageLeaseService: { capture },
      selectedPageDrawingJob: { draw },
    });
    apps.add(app);

    const lease = await app.inject({
      method: "POST",
      url: "/api/drawing-runs/unknown-run/selected-page-lease",
      headers,
      payload: {},
    });
    const apply = await app.inject({
      method: "POST",
      url: "/api/drawing-runs/unknown-run/apply-selected-page",
      headers,
      payload: { leaseId: "lease-1" },
    });

    expect(lease.statusCode).toBe(404);
    expect(apply.statusCode).toBe(404);
    expect(capture).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("records a controlled Worker failure after the Run enters applying", async () => {
    const fail = vi.fn(async () => ({
      runId: "run-page-bound",
      revision: 10,
      status: "failed" as const,
      errorCategory: "worker" as const,
      allowedActions: [] as const,
      clarification: null,
      preview: null,
    }));
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 8,
        status: "page_bound" as const,
        errorCategory: "none" as const,
        allowedActions: ["request_apply", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      })),
      requestApply: vi.fn(async () => ({
        replayed: false,
        run: {
          runId: "run-page-bound",
          revision: 9,
          status: "applying" as const,
          errorCategory: "none" as const,
          allowedActions: ["verify_readback", "cancel"] as const,
          clarification: null,
          preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
        },
      })),
      verifyReadback: vi.fn(),
      fail,
    } as unknown as DrawingRunCoordinator;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw: vi.fn(async () => ({ status: "failed", error: "C:\\secret\\worker.log" })) },
    }, coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-failure-1" },
      payload: {
        expectedRevision: 8,
        confirmationNonce: "confirmed-by-user",
        leaseId: "lease-1",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(JSON.stringify(response.json())).not.toContain("secret");
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      expectedRevision: 9,
      errorCategory: "worker",
    }));
  });

  it.each([
    { status: "applying" as const, revision: 10 },
    { status: "readback_verified" as const, revision: 11 },
  ])("does not report success for an invalid readback transition: $status at revision $revision", async ({ status, revision }) => {
    const draw = vi.fn(async () => ({
      status: "succeeded" as const,
      readback: {
        valid: true as const,
        documentId: "document-1",
        pageId: "page-1",
        documentFingerprint: "a".repeat(64),
        pageFingerprint: "b".repeat(64),
        expectedRevision: 7,
        ownershipNamespace: "agent:private-namespace",
        userOwnedShapeCount: 1,
        agentOwnedShapes: [{
          nativeShapeId: "shape-1",
          ownershipNamespace: "agent:private-namespace",
          sourceMappingSemanticIds: ["conv-1"],
        }],
        unclassifiedShapeCount: 0 as const,
      },
    }));
    const fail = vi.fn(async () => ({
      runId: "run-page-bound",
      revision: 9,
      status: "failed" as const,
      errorCategory: "worker" as const,
      allowedActions: [] as const,
      clarification: null,
      preview: null,
    }));
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 8,
        status: "page_bound" as const,
        errorCategory: "none" as const,
        allowedActions: ["request_apply", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      })),
      requestApply: vi.fn(async () => ({
        replayed: false,
        run: {
          runId: "run-page-bound",
          revision: 9,
          status: "applying" as const,
          errorCategory: "none" as const,
          allowedActions: ["verify_readback", "cancel"] as const,
          clarification: null,
          preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
        },
      })),
      verifyReadback: vi.fn(async () => ({
        runId: "run-page-bound",
        revision,
        status,
        errorCategory: "none" as const,
        allowedActions: [] as const,
        clarification: null,
        preview: null,
      })),
      fail,
    } as unknown as DrawingRunCoordinator;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw },
    }, coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": `selected-page-invalid-readback-${status}-${revision}` },
      payload: { expectedRevision: 8, confirmationNonce: "confirmed", leaseId: "lease-1" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "DRAWING_RUN_REVISION_CONFLICT" } });
    expect(draw).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledOnce();
  });

  it("rejects a snapshot that is not the exact preview confirmed by the Drawing Run", async () => {
    const requestApply = vi.fn();
    const draw = vi.fn();
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 8,
        status: "page_bound" as const,
        errorCategory: "none" as const,
        allowedActions: ["request_apply", "cancel"] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      })),
      requestApply,
    } as unknown as DrawingRunCoordinator;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw },
    }, coordinator, { genericPlanSnapshotStore: confirmedSnapshotStore("different-run") });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-mismatch" },
      payload: { expectedRevision: 8, confirmationNonce: "confirmed", leaseId: "lease-1" },
    });

    expect(response.statusCode).toBe(409);
    expect(requestApply).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("rejects a terminal idempotency replay before it can draw again", async () => {
    const requestApply = vi.fn();
    const draw = vi.fn();
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        runId: "run-page-bound",
        revision: 9,
        status: "readback_verified" as const,
        errorCategory: "none" as const,
        allowedActions: [] as const,
        clarification: null,
        preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
      })),
      requestApply,
    } as unknown as DrawingRunCoordinator;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw },
    }, coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-apply-1" },
      payload: { expectedRevision: 7, confirmationNonce: "confirmed-by-user", leaseId: "lease-2" },
    });

    expect(response.statusCode).toBe(409);
    expect(requestApply).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("does not invoke Visio again for an in-flight idempotent apply replay", async () => {
    const draw = vi.fn();
    const applyingRun = {
      runId: "run-page-bound",
      revision: 9,
      status: "applying" as const,
      errorCategory: "none" as const,
      allowedActions: ["verify_readback", "cancel"] as const,
      clarification: null,
      preview: { artifactId: `preview:${"c".repeat(64)}`, hash: "c".repeat(64) },
    };
    const coordinator = {
      recover: vi.fn(async () => undefined),
      get: vi.fn(async () => ({ ...applyingRun, revision: 8, status: "page_bound" as const, allowedActions: ["request_apply", "cancel"] as const })),
      requestApply: vi.fn(async () => ({ run: applyingRun, replayed: true })),
    } as unknown as DrawingRunCoordinator;
    const { app, headers, runId } = await authorizedApp({
      selectedPageLeaseService: { capture: vi.fn() },
      selectedPageDrawingJob: { draw },
    }, coordinator);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/apply-selected-page`,
      headers: { ...headers, "idempotency-key": "selected-page-apply-in-flight" },
      payload: { expectedRevision: 8, confirmationNonce: "confirmed-by-user", leaseId: "lease-1" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "applying", run: applyingRun });
    expect(draw).not.toHaveBeenCalled();
  });
});
