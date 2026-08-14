import Fastify, { type FastifyInstance } from "fastify";
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

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig({ NODE_ENV: "test", SESSION_SECRET: options.sessionSecret ?? "test-session-secret-test-session-secret", STORAGE_DRIVER: "memory" });
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
  const visioJobRunner = options.visioJobRunner ?? new VisioJobRunner({ store, jobService, executor: visioExecutor, maxConcurrentJobs: config.visioMaxConcurrency });
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
  });
  app.addHook("onReady", async () => { await visioJobRunner.recoverJobs(); });
  app.addHook("onClose", async () => { await visioJobRunner.close(); });
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
