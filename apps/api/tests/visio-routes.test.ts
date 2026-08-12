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

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ type: "visio-export", status: "succeeded", output: { readback: { valid: true, shapeCount: 1, connectorCount: 0 } } });
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

    expect(first.statusCode).toBe(201);
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

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe(ApiErrorCode.VISIO_IDEMPOTENCY_KEY_REUSED);
    expect(second.json().error.details.requestHashMatches).toBe(false);
  });
});
