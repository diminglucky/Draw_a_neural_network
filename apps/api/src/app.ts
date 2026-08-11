import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadConfig, type AppConfig } from "./config.js";
import { AdminService } from "./admin-service.js";
import { JobService } from "./job-service.js";
import { registerRoutes } from "./routes.js";
import { SessionService } from "./session-service.js";
import { hashPassword } from "./security.js";
import { InMemoryFoundationStore, type FoundationStore } from "./store.js";
import { FoundationError } from "./domain.js";
import { createFoundationStore } from "./store-factory.js";

export interface BuildAppOptions {
  config?: AppConfig;
  store?: FoundationStore;
  sessionSecret?: string;
  admin?: { email: string; passwordHash: string };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig({ NODE_ENV: "test", SESSION_SECRET: options.sessionSecret ?? "test-session-secret-test-session-secret", STORAGE_DRIVER: "memory" });
  if (!options.store && config.storageDriver !== "memory") {
    throw new Error("A FoundationStore must be injected when a durable storage driver is configured");
  }
  const store = options.store ?? new InMemoryFoundationStore();
  const sessionService = new SessionService({ store, leaseSeconds: 90, accessTokenTtlSeconds: 900, sessionSecret: options.sessionSecret ?? config.sessionSecret });
  const jobService = new JobService({ store });
  const adminService = new AdminService(store, sessionService);
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  registerRoutes(app, {
    sessionService,
    jobService,
    adminService,
    sessionSecret: options.sessionSecret ?? config.sessionSecret,
    admin: options.admin ?? { email: "admin@example.com", passwordHash: "" },
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof FoundationError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id, details: error.details } });
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
  const app = buildApp({
    config,
    store: storage.store,
    admin: { email: process.env.ADMIN_EMAIL ?? "admin@example.com", passwordHash: await hashPassword(adminPassword ?? "development-admin-password-change-me") },
  });
  app.addHook("onClose", async () => storage.close());
  return app;
}
