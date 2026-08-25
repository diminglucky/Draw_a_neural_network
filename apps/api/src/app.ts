import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import { loadConfig, type AppConfig } from "./config.js";
import { AdminService } from "./admin-service.js";
import { JobService } from "./job-service.js";
import { registerRoutes, type AgentServiceContract } from "./routes.js";
import { SessionService } from "./session-service.js";
import { hashPassword } from "./security.js";
import { InMemoryFoundationStore, type FoundationStore } from "./store.js";
import { ApiErrorCode, FoundationError } from "./domain.js";
import { createFoundationStore } from "./store-factory.js";
import { createLeaseCoordinator } from "./lease-factory.js";
import type { LeaseCoordinator } from "./lease-coordinator.js";
import { createAgentServiceForConfig } from "./agent-runtime.js";
import { NotConnectedVisioExecutor, type VisioExecutor } from "./adapters.js";
import { VisioWorkerClient } from "./visio-worker-client.js";
import { VisioJobRunner } from "./visio-job-runner.js";
import { FigureDraftService } from "./figure-draft-service.js";
import { FigureDraftPreviewService } from "./figure-draft-preview-service.js";
import { UniversalFigureExportService } from "./figure-export-service.js";
import { FigureAnalysisService } from "./figure-analysis-service.js";
import { FigureAnalysisPreviewServiceImpl } from "./figure-analysis-preview-service.js";
import { InMemoryDrawingRunCoordinator, type DrawingRunCoordinator } from "./drawing-run/coordinator.js";
import { FoundationDrawingRunStoreAdapter } from "./drawing-run/store.js";
import type { DrawingWorkflowRunner } from "./drawing-run/langgraph-workflow.js";
import { InMemoryPrivateReceiptStore, type PrivateReceiptStore } from "./drawing-input/private-receipt.js";
import { createReceiptBoundDrawingWorkflow } from "./drawing-input/intent.js";
import type { EvidencePackStore } from "./drawing-input/intent.js";
import type { LocalProposalStore } from "./drawing-input/structural-harness.js";
import { createPublicationDrawingWorkflowComposer } from "./drawing-run/publication-composer.js";
import type { DrawingArtifactStore } from "./drawing-input/drawing-artifacts.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { SelectedPageDrawingJob } from "./selected-page-drawing-job.js";
import type { SelectedPageLeaseService } from "./selected-page-lease.js";
import { SelectedPageDrawingJob as DefaultSelectedPageDrawingJob } from "./selected-page-drawing-job.js";
import { InMemorySelectedPageLeaseStore, SelectedPageLeaseService as DefaultSelectedPageLeaseService } from "./selected-page-lease.js";
import { CurrentPageSelectionCapture } from "./current-page-selection-capture.js";
import { CurrentPageVisioAdapter } from "./current-page-visio-adapter.js";
import { PublicationVisualNativeIntentService } from "./publication-visual-plan-native-intent.js";
import type { GenericPlanSnapshotStore } from "./generic-plan-snapshot-store.js";
import { SelectedPagePreviewReviewService } from "./selected-page-preview-review.js";

export interface BuildAppOptions {
  config?: AppConfig;
  store?: FoundationStore;
  sessionSecret?: string;
  admin?: { email: string; passwordHash: string };
  leaseCoordinator?: LeaseCoordinator;
  agentService?: AgentServiceContract;
  figureDraftService?: FigureDraftService;
  figureDraftPreviewService?: FigureDraftPreviewService;
  visioExecutor?: VisioExecutor;
  visioJobRunner?: VisioJobRunner;
  universalFigureExportService?: UniversalFigureExportService;
  universalFigureExportRunner?: UniversalFigureExportRunnerContract;
  figureAnalysisService?: FigureAnalysisService;
  figureAnalysisPreviewService?: FigureAnalysisPreviewServiceImpl;
  drawingRunCoordinator?: DrawingRunCoordinator;
  drawingWorkflow?: DrawingWorkflowRunner;
  privateReceiptStore?: PrivateReceiptStore;
  evidencePackStore?: EvidencePackStore;
  localProposalStore?: LocalProposalStore;
  drawingArtifactStore?: DrawingArtifactStore;
  drawingWorkflowCheckpointer?: BaseCheckpointSaver;
  selectedPageLeaseService?: Pick<SelectedPageLeaseService, "capture">;
  selectedPageDrawingJob?: Pick<SelectedPageDrawingJob, "draw">;
  selectedPagePreviewReviewService?: Pick<SelectedPagePreviewReviewService, "confirm">;
  genericPlanSnapshotStore?: GenericPlanSnapshotStore;
  selectedPageWorkerClient?: Pick<VisioWorkerClient, "createSelectedPageCaptureTransport" | "createSelectedPageTransport">;
}

export interface UniversalFigureExportRunnerContract {
  submit(jobId: string): void | Promise<void>;
  cancel?(jobId: string): Promise<unknown>;
  recoverJobs?(): Promise<void>;
  close?(): Promise<void>;
}

function createVisioExecutorForConfig(config: AppConfig): VisioExecutor {
  if (!config.visioWorkerPath) return new NotConnectedVisioExecutor();
  if (!config.visioOutputRoot) throw new Error("VISIO_OUTPUT_ROOT is required when VISIO_WORKER_PATH is configured");
  return new VisioWorkerClient({
    workerPath: config.visioWorkerPath,
    outputRoot: config.visioOutputRoot,
    mode: config.visioWorkerMode,
    timeoutMs: config.visioWorkerTimeoutMs,
    visible: config.visioVisible,
    attachToRunning: config.visioAttachToRunning,
  });
}

function createSelectedPageWorkerClientForConfig(config: AppConfig): VisioWorkerClient | null {
  if (!config.visioWorkerPath || !config.visioOutputRoot) return null;
  return new VisioWorkerClient({
    workerPath: config.visioWorkerPath,
    outputRoot: config.visioOutputRoot,
    mode: config.visioWorkerMode,
    timeoutMs: config.visioWorkerTimeoutMs,
    visible: true,
    attachToRunning: true,
    selectedPageSealingSecret: config.selectedPageSealingSecret,
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig({ NODE_ENV: "test", SESSION_SECRET: options.sessionSecret ?? "test-session-secret-test-session-secret", STORAGE_DRIVER: "memory" });
  const hasInjectedSelectedPageService = Boolean(options.selectedPageLeaseService) || Boolean(options.selectedPageDrawingJob);
  if (hasInjectedSelectedPageService && (!options.selectedPageLeaseService || !options.selectedPageDrawingJob || !options.genericPlanSnapshotStore)) {
    throw new Error("Selected-page dependencies must be injected as one complete set");
  }
  if (!options.store && config.storageDriver !== "memory") {
    throw new Error("A FoundationStore must be injected when a durable storage driver is configured");
  }
  const store = options.store ?? new InMemoryFoundationStore();
  const sessionService = new SessionService({ store, leaseSeconds: 90, accessTokenTtlSeconds: 900, challengeTtlSeconds: 120, requireDeviceProof: config.requireDeviceProof, sessionSecret: options.sessionSecret ?? config.sessionSecret, leaseCoordinator: options.leaseCoordinator });
  const jobService = new JobService({ store });
  const adminService = new AdminService(store, sessionService);
  const figureDraftService = options.figureDraftService ?? new FigureDraftService({ store });
  const figureDraftPreviewService = options.figureDraftPreviewService ?? new FigureDraftPreviewService({ figureDraftService });
  const visioExecutor = options.visioExecutor ?? createVisioExecutorForConfig(config);
  const visioJobRunner = options.visioJobRunner ?? new VisioJobRunner({
    store,
    jobService,
    executor: visioExecutor,
    maxConcurrentJobs: config.visioMaxConcurrency,
  });
  const figureAnalysisService = options.figureAnalysisService ?? new FigureAnalysisService({ store });
  const figureAnalysisPreviewService = options.figureAnalysisPreviewService ?? new FigureAnalysisPreviewServiceImpl({ store });
  const drawingDependencies = [options.privateReceiptStore, options.evidencePackStore, options.localProposalStore, options.drawingArtifactStore, options.drawingWorkflowCheckpointer];
  if (drawingDependencies.some(Boolean) && drawingDependencies.some((dependency) => !dependency)) {
    throw new Error("Drawing workflow dependencies must be injected as one complete set");
  }
  if (config.storageDriver !== "memory" && !options.drawingWorkflow && drawingDependencies.some((dependency) => !dependency)) {
    throw new Error("A durable storage driver requires a durable Drawing workflow");
  }
  const drawingWorkflow = options.drawingWorkflow ?? (options.privateReceiptStore && options.evidencePackStore && options.localProposalStore && options.drawingArtifactStore && options.drawingWorkflowCheckpointer
    ? createReceiptBoundDrawingWorkflow({
      receipts: options.privateReceiptStore,
      evidencePacks: options.evidencePackStore,
      proposals: options.localProposalStore,
      artifacts: options.drawingArtifactStore,
      composer: createPublicationDrawingWorkflowComposer(options.drawingArtifactStore),
      checkpointer: options.drawingWorkflowCheckpointer,
    })
    : undefined);
  const drawingRunCoordinator = options.drawingRunCoordinator ?? new InMemoryDrawingRunCoordinator({
    store: new FoundationDrawingRunStoreAdapter(store),
    workflow: drawingWorkflow,
    leaseCoordinator: options.leaseCoordinator,
  });
  const privateReceiptStore = options.privateReceiptStore ?? new InMemoryPrivateReceiptStore();
  const selectedPagePreviewReviewService = options.selectedPagePreviewReviewService
    ?? (options.drawingArtifactStore && options.genericPlanSnapshotStore
      ? new SelectedPagePreviewReviewService({
        artifacts: options.drawingArtifactStore,
        snapshots: options.genericPlanSnapshotStore,
      })
      : undefined);
  let selectedPageLeaseService = options.selectedPageLeaseService;
  let selectedPageDrawingJob = options.selectedPageDrawingJob;
  if (!selectedPageLeaseService && !selectedPageDrawingJob && config.selectedPageSealingSecret && options.genericPlanSnapshotStore) {
    const workerClient = options.selectedPageWorkerClient ?? createSelectedPageWorkerClientForConfig(config);
    if (workerClient) {
      const leases = new DefaultSelectedPageLeaseService({
        store: new InMemorySelectedPageLeaseStore(),
        capture: {
          capture: (owner) => new CurrentPageSelectionCapture(
            workerClient.createSelectedPageCaptureTransport(),
            randomUUID,
          ).capture(owner),
        },
      });
      const nativeIntentService = new PublicationVisualNativeIntentService({ snapshotStore: options.genericPlanSnapshotStore });
      selectedPageLeaseService = leases;
      selectedPageDrawingJob = new DefaultSelectedPageDrawingJob({
        leases,
        compileNativeIntent: (input) => nativeIntentService.compile({
          owner: {
            tenantId: input.owner.tenantId,
            userId: input.owner.userId,
            deviceId: input.owner.deviceId,
          },
          graphId: input.graphId,
          ugsRevision: input.ugsRevision,
          snapshotId: input.snapshotId,
        }),
        executor: {
          draw: (input) => new CurrentPageVisioAdapter(workerClient.createSelectedPageTransport()).draw(input),
        },
        sealedPlanSecret: config.selectedPageSealingSecret,
        jobIdFactory: randomUUID,
      });
    }
  }
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  registerRoutes(app, {
    store,
    sessionService,
    jobService,
    adminService,
    sessionSecret: options.sessionSecret ?? config.sessionSecret,
    admin: options.admin ?? { email: "admin@example.com", passwordHash: "" },
    agentService: options.agentService,
    figureDraftService,
    figureDraftPreviewService,
    visioExecutor,
    visioJobRunner,
    universalFigureExportService: options.universalFigureExportService,
    universalFigureExportRunner: options.universalFigureExportRunner,
    figureAnalysisService,
    figureAnalysisPreviewService,
    drawingRunCoordinator,
    privateReceiptStore,
    selectedPageLeaseService,
    selectedPageDrawingJob,
    selectedPagePreviewReviewService,
    genericPlanSnapshotStore: options.genericPlanSnapshotStore,
  });
  app.addHook("onReady", async () => {
    await visioJobRunner.recoverJobs();
    await options.universalFigureExportRunner?.recoverJobs?.();
    await drawingRunCoordinator.recover();
  });
  app.addHook("onClose", async () => {
    await options.universalFigureExportRunner?.close?.();
    await visioJobRunner.close();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof FoundationError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id, details: error.details } });
    }
    const fastifyErrorCode = typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
    if (fastifyErrorCode?.startsWith("FST_ERR_CTP_")) {
      return reply.code(400).send({
        error: {
          code: ApiErrorCode.VALIDATION_FAILED,
          message: "Request body must be valid JSON",
          requestId: request.id,
          details: { field: "body", reason: "malformed_body" },
        },
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: request.id } });
  });
  return app;
}

export async function buildDefaultApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (config.nodeEnv === "production" && !adminPassword) {
    throw new Error("ADMIN_PASSWORD is required in production");
  }
  const storage = await createFoundationStore(config);
  try {
    const lease = await createLeaseCoordinator(config);
    try {
      const app = buildApp({
        config,
        store: storage.store,
        privateReceiptStore: storage.privateReceiptStore,
        evidencePackStore: storage.evidencePackStore,
        localProposalStore: storage.localProposalStore,
        drawingArtifactStore: storage.drawingArtifactStore,
        drawingWorkflowCheckpointer: storage.drawingWorkflowCheckpointer,
        genericPlanSnapshotStore: storage.genericPlanSnapshotStore,
        leaseCoordinator: lease.coordinator,
        admin: { email: process.env.ADMIN_EMAIL ?? "admin@example.com", passwordHash: await hashPassword(adminPassword ?? "development-admin-password-change-me") },
        agentService: createAgentServiceForConfig(config),
      });
      app.addHook("onClose", async () => {
        await lease.close();
        await storage.close();
      });
      return app;
    } catch (error) {
      await lease.close();
      throw error;
    }
  } catch (error) {
    await storage.close();
    throw error;
  }
}
