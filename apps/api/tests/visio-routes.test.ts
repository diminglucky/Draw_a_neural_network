import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ApiErrorCode } from "../src/domain.js";
import { hashPassword } from "../src/security.js";
import type { VisioExecutor } from "../src/adapters.js";

const diagram = {
  figure: { title: "CNN", stages: ["Input", "Output"] },
  nodes: [{ id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 }],
  edges: [],
};

async function createAuthorizedApp(visioExecutor?: VisioExecutor) {
  const app = buildApp({
    sessionSecret: "test-session-secret-test-session-secret",
    admin: { email: "admin@example.com", passwordHash: await hashPassword("admin-password") },
    visioExecutor,
  });
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: `visio-${Date.now()}-${Math.random()}@example.com`,
      password: "password-123",
      device: { name: "Visio PC", publicKey: "public-key", fingerprintHash: "fingerprint", clientVersion: "0.1.0", osVersion: "Windows 11" },
    },
  });
  const deviceId = registered.json().device.id;
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: registered.json().user.email, password: "password-123", deviceId } });
  return { app, authorization: `Bearer ${login.json().accessToken}` };
}

async function waitForJob(app: Awaited<ReturnType<typeof buildApp>>, authorization: string, jobId: string, expectedStatus: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { authorization } });
    if (response.json().status === expectedStatus) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${jobId} did not reach ${expectedStatus}`);
}

describe("Visio export routes", () => {
  it("returns an explicit error when the Worker is not configured", async () => {
    const { app, authorization } = await createAuthorizedApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/visio/export",
      headers: { authorization, "idempotency-key": "visio-route-1" },
      payload: { diagram },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED);
  });

  it("creates and completes a user-owned Visio export Job", async () => {
    const executor: VisioExecutor = {
      healthCheck: async () => ({ connected: true }),
      executeDiagram: async ({ jobId }) => ({ path: `C:\\exports\\${jobId}.vsdx`, readback: { valid: true, shapeCount: 1, connectorCount: 0 } }),
      readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
    };
    const { app, authorization } = await createAuthorizedApp(executor);
    const response = await app.inject({
      method: "POST",
      url: "/api/visio/export",
      headers: { authorization, "idempotency-key": "visio-route-2" },
      payload: { diagram },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ type: "visio-export", status: "queued", pollUrl: `/api/jobs/${response.json().id}` });
    await expect(waitForJob(app, authorization, response.json().id, "succeeded")).resolves.toMatchObject({ output: { readback: { valid: true, shapeCount: 1, connectorCount: 0 } } });
  });

  it("does not execute the Worker twice for a repeated key", async () => {
    let executions = 0;
    const executor: VisioExecutor = {
      healthCheck: async () => ({ connected: true }),
      executeDiagram: async ({ jobId }) => {
        executions += 1;
        return { path: `C:\\exports\\${jobId}.vsdx`, readback: { valid: true, shapeCount: 1, connectorCount: 0 } };
      },
      readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
    };
    const { app, authorization } = await createAuthorizedApp(executor);
    const headers = { authorization, "idempotency-key": "visio-repeat-1" };
    const first = await app.inject({ method: "POST", url: "/api/visio/export", headers, payload: { diagram } });
    const second = await app.inject({ method: "POST", url: "/api/visio/export", headers, payload: { diagram } });

    expect(first.statusCode).toBe(202);
    await waitForJob(app, authorization, first.json().id, "succeeded");
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(executions).toBe(1);
  });

  it("rejects reusing a key for a different diagram", async () => {
    const executor: VisioExecutor = {
      healthCheck: async () => ({ connected: true }),
      executeDiagram: async ({ jobId }) => ({ path: `C:\\exports\\${jobId}.vsdx`, readback: { valid: true, shapeCount: 1, connectorCount: 0 } }),
      readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
    };
    const { app, authorization } = await createAuthorizedApp(executor);
    const headers = { authorization, "idempotency-key": "visio-conflict-1" };
    const first = await app.inject({ method: "POST", url: "/api/visio/export", headers, payload: { diagram } });
    const second = await app.inject({ method: "POST", url: "/api/visio/export", headers, payload: { diagram: { ...diagram, figure: { title: "Different" } } } });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe(ApiErrorCode.VISIO_IDEMPOTENCY_KEY_REUSED);
    expect(second.json().error.details.requestHashMatches).toBe(false);
  });

  it("cancels a running Visio Job through the user-scoped Job route", async () => {
    const executor: VisioExecutor = {
      healthCheck: async () => ({ connected: true }),
      executeDiagram: async (_input, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: ApiErrorCode.VISIO_EXECUTION_FAILED })), { once: true });
      }),
      readback: async () => ({ valid: true, shapeCount: 1, connectorCount: 0 }),
    };
    const { app, authorization } = await createAuthorizedApp(executor);
    const request = app.inject({
      method: "POST",
      url: "/api/visio/export",
      headers: { authorization, "idempotency-key": "visio-cancel-1" },
      payload: { diagram },
    });
    const response = await request;
    expect(response.statusCode).toBe(202);
    await waitForJob(app, authorization, response.json().id, "running");

    const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${response.json().id}/cancel`, headers: { authorization } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "cancelled" });
  });
});
