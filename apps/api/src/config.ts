import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVisioWorkerPath } from "./visio-discovery.js";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4180),
  SESSION_SECRET: z.string().min(32).optional(),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  LEASE_DRIVER: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  REQUIRE_DEVICE_PROOF: z.enum(["true", "false"]).optional(),
  VISIO_WORKER_PATH: z.string().trim().min(1).optional(),
  VISIO_OUTPUT_ROOT: z.string().trim().min(1).optional(),
  VISIO_WORKER_MODE: z.enum(["mock", "live"]).optional(),
  VISIO_VISIBLE: z.enum(["true", "false"]).optional(),
  VISIO_ATTACH_TO_RUNNING: z.enum(["true", "false"]).optional(),
  VISIO_WORKER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
  VISIO_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  SYNAPSE_SELECTED_PAGE_SEALING_SECRET: z.string().min(32).optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  sessionSecret: string;
  storageDriver: "memory" | "postgres";
  leaseDriver: "memory" | "redis";
  redisUrl?: string;
  databaseUrl?: string;
  requireDeviceProof: boolean;
  visioWorkerPath?: string;
  visioOutputRoot?: string;
  visioWorkerMode: "mock" | "live";
  visioVisible: boolean;
  visioAttachToRunning: boolean;
  visioWorkerTimeoutMs: number;
  visioMaxConcurrency: number;
  selectedPageSealingSecret?: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  if (parsed.NODE_ENV === "production" && !parsed.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production");
  }
  if (parsed.NODE_ENV === "production" && parsed.STORAGE_DRIVER === "memory") {
    throw new Error("STORAGE_DRIVER=memory is development-only");
  }
  if (parsed.STORAGE_DRIVER === "postgres" && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  if (parsed.LEASE_DRIVER === "redis" && !parsed.REDIS_URL) {
    throw new Error("REDIS_URL is required when LEASE_DRIVER=redis");
  }

  const autoWorkerPath = parsed.NODE_ENV === "test" ? undefined : resolveVisioWorkerPath({
    explicitPath: parsed.VISIO_WORKER_PATH,
    cwd: process.cwd(),
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  });
  const visioWorkerPath = parsed.VISIO_WORKER_PATH?.trim() || autoWorkerPath;
  const visioWorkerMode = parsed.VISIO_WORKER_MODE || (parsed.NODE_ENV === "test" ? "mock" : visioWorkerPath ? "live" : "mock");
  const visioOutputRoot = parsed.VISIO_OUTPUT_ROOT?.trim() || (autoWorkerPath ? join(tmpdir(), "synapse-studio-visio") : undefined);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    sessionSecret: parsed.SESSION_SECRET || "development-only-session-secret-change-me-32",
    storageDriver: parsed.STORAGE_DRIVER,
    leaseDriver: parsed.LEASE_DRIVER,
    redisUrl: parsed.REDIS_URL,
    databaseUrl: parsed.DATABASE_URL,
    requireDeviceProof: parsed.NODE_ENV === "production" || parsed.REQUIRE_DEVICE_PROOF === "true",
    visioWorkerPath,
    visioOutputRoot,
    visioWorkerMode,
    visioVisible: parsed.VISIO_VISIBLE ? parsed.VISIO_VISIBLE === "true" : visioWorkerMode === "live",
    visioAttachToRunning: parsed.VISIO_ATTACH_TO_RUNNING === "true",
    visioWorkerTimeoutMs: parsed.VISIO_WORKER_TIMEOUT_MS,
    visioMaxConcurrency: parsed.VISIO_MAX_CONCURRENCY,
    selectedPageSealingSecret: parsed.SYNAPSE_SELECTED_PAGE_SEALING_SECRET,
  };
}
