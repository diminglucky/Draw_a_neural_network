import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";

describe("foundation HTTP API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let accessToken = "";
  let userId = "";
  let sessionId = "";

  beforeAll(async () => {
    app = buildApp({
      sessionSecret: "test-session-secret-test-session-secret",
      admin: {
        email: "admin@example.com",
        passwordHash: await hashPassword("admin-password"),
      },
    });
  });

  it("locks protected access without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/session" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_TOKEN");
  });

  it("registers a user with a device and logs in", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@example.com",
        password: "password-123",
        device: {
          name: "Research PC",
          publicKey: "public-key-a",
          fingerprintHash: "fingerprint-a",
          clientVersion: "0.1.0",
          osVersion: "Windows 11",
        },
      },
    });

    expect(registered.statusCode).toBe(201);
    userId = registered.json().user.id;
    const deviceId = registered.json().device.id;

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "user@example.com", password: "password-123", deviceId },
    });

    expect(login.statusCode).toBe(200);
    accessToken = login.json().accessToken;
    sessionId = login.json().session.id;
    expect(accessToken).toEqual(expect.any(String));
  });

  it("does not trust stale client ownership fields during registration", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "fresh-device-owner@example.com",
        password: "password-123",
        device: {
          id: "stale-device-id",
          userId: "stale-user-id",
          name: "Research PC",
          publicKey: "public-key-b",
          fingerprintHash: "fingerprint-b",
          clientVersion: "0.1.0",
          osVersion: "Windows 11",
        },
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json().user.id).not.toBe("stale-user-id");
    expect(registered.json().device.userId).toBe(registered.json().user.id);
    expect(registered.json().device.id).not.toBe("stale-device-id");
  });

  it("returns the current access and creates a foundation job", async () => {
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.id).toBe(userId);

    const job = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { type: "chat", input: { message: "hello" } },
    });
    expect(job.statusCode).toBe(201);
    expect(job.json().status).toBe("queued");
  });

  it("supports heartbeat and admin force revoke", async () => {
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { sessionId },
    });
    expect(heartbeat.statusCode).toBe(200);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { email: "admin@example.com", password: "admin-password" },
    });
    expect(adminLogin.statusCode).toBe(200);
    const adminToken = adminLogin.json().accessToken;

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().users).toBeGreaterThanOrEqual(1);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/admin/sessions/${sessionId}/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: "support requested device switch" },
    });
    expect(revoked.statusCode).toBe(200);

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(afterRevoke.json().error.code).toBe("SESSION_REVOKED");
  });
});
