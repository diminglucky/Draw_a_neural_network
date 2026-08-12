import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("storage configuration", () => {
  it("requires DATABASE_URL whenever PostgreSQL storage is selected", () => {
    expect(() => loadConfig({ NODE_ENV: "development", STORAGE_DRIVER: "postgres", SESSION_SECRET: "development-secret-development-secret" })).toThrow(/DATABASE_URL/);
  });

  it("enables device proof when explicitly requested", () => {
    expect(loadConfig({ NODE_ENV: "development", STORAGE_DRIVER: "memory", REQUIRE_DEVICE_PROOF: "true", SESSION_SECRET: "development-secret-development-secret" }).requireDeviceProof).toBe(true);
  });

  it("loads the standalone Visio Worker configuration", () => {
    expect(loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      SESSION_SECRET: "development-secret-development-secret",
      VISIO_WORKER_PATH: "C:\\tools\\visio-worker.exe",
      VISIO_OUTPUT_ROOT: "C:\\exports",
      VISIO_WORKER_MODE: "live",
      VISIO_WORKER_TIMEOUT_MS: "45000",
    })).toMatchObject({
      visioWorkerPath: "C:\\tools\\visio-worker.exe",
      visioOutputRoot: "C:\\exports",
      visioWorkerMode: "live",
      visioWorkerTimeoutMs: 45000,
    });
  });

  it("defaults Visio execution to mock mode with a bounded timeout", () => {
    expect(loadConfig({ NODE_ENV: "test", STORAGE_DRIVER: "memory", SESSION_SECRET: "development-secret-development-secret" })).toMatchObject({
      visioWorkerMode: "mock",
      visioWorkerTimeoutMs: 120000,
    });
  });
});
