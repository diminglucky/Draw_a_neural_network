import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4180),
  SESSION_SECRET: z.string().min(32).optional(),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  LEASE_DRIVER: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  REQUIRE_DEVICE_PROOF: z.enum(["true", "false"]).optional(),
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

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    sessionSecret: parsed.SESSION_SECRET || "development-only-session-secret-change-me-32",
    storageDriver: parsed.STORAGE_DRIVER,
    leaseDriver: parsed.LEASE_DRIVER,
    redisUrl: parsed.REDIS_URL,
    databaseUrl: parsed.DATABASE_URL,
    requireDeviceProof: parsed.NODE_ENV === "production" || parsed.REQUIRE_DEVICE_PROOF === "true",
  };
}
