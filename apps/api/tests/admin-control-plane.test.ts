import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";
import { InMemoryFoundationStore } from "../src/store.js";

describe("admin control plane", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken: string;
  let store: InMemoryFoundationStore;

  beforeEach(async () => {
    store = new InMemoryFoundationStore();
    app = buildApp({
      store,
      sessionSecret: "admin-control-plane-test-secret-admin-control-plane-test-secret",
      admin: {
        email: "admin@example.com",
        passwordHash: await hashPassword("admin-password"),
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { email: "admin@example.com", password: "admin-password" },
    });
    expect(login.statusCode).toBe(200);
    adminToken = login.json().accessToken;
  });

  async function registerAndLogin(email: string, deviceName = "Windows PC") {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        password: "password-123",
        device: {
          name: deviceName,
          publicKey: `${email}-public-key`,
          fingerprintHash: `${email}-fingerprint`,
          clientVersion: "0.1.0",
          osVersion: "Windows 11",
        },
      },
    });
    expect(registered.statusCode).toBe(201);

    const deviceId = registered.json().device.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password-123", deviceId },
    });
    expect(login.statusCode).toBe(200);
    return {
      userId: registered.json().user.id as string,
      deviceId,
      accessToken: login.json().accessToken as string,
      sessionId: login.json().session.id as string,
    };
  }

  function adminHeaders() {
    return { authorization: `Bearer ${adminToken}` };
  }

  it("disables a user, revokes its active session, and audits the action", async () => {
    const account = await registerAndLogin("disabled-user@example.com");

    const response = await app.inject({
      method: "POST",
      url: `/api/admin/users/${account.userId}/status`,
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "fraud review requested account hold" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.status).toBe("disabled");

    const sessions = await app.inject({ method: "GET", url: "/api/admin/sessions", headers: adminHeaders() });
    expect(sessions.json().sessions.find((session: { id: string }) => session.id === account.sessionId).status).toBe("revoked");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(current.statusCode).toBe(401);
    expect(current.json().error.code).toBe("SESSION_REVOKED");

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      headers: { authorization: `Bearer ${account.accessToken}` },
      payload: { sessionId: account.sessionId },
    });
    expect(heartbeat.statusCode).toBe(401);
    expect(heartbeat.json().error.code).toBe("SESSION_REVOKED");

    const audits = await app.inject({ method: "GET", url: "/api/admin/audit-logs", headers: adminHeaders() });
    expect(audits.json().records).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "user.disabled", targetId: account.userId, reason: "fraud review requested account hold" }),
      expect.objectContaining({ action: "session.revoked", targetId: account.sessionId }),
    ]));
  });

  it("disables a device and revokes only sessions using that device", async () => {
    const first = await registerAndLogin("first-device@example.com", "First PC");
    const second = await registerAndLogin("second-device@example.com", "Second PC");

    const response = await app.inject({
      method: "POST",
      url: `/api/admin/devices/${first.deviceId}/status`,
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "device reported lost" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().device.status).toBe("disabled");

    const sessions = await app.inject({ method: "GET", url: "/api/admin/sessions", headers: adminHeaders() });
    const sessionById = new Map<string, { id: string; status: string }>(sessions.json().sessions.map((session: { id: string; status: string }) => [session.id, session] as [string, { id: string; status: string }]));
    expect(sessionById.get(first.sessionId)?.status).toBe("revoked");
    expect(sessionById.get(second.sessionId)?.status).toBe("active");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "first-device@example.com", password: "password-123", deviceId: first.deviceId },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe("DEVICE_NOT_AUTHORIZED");

    const secondCurrent = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(secondCurrent.statusCode).toBe(200);
  });

  it("rejects blank or unsupported status changes without changing state", async () => {
    const account = await registerAndLogin("validation@example.com");

    const blankReason = await app.inject({
      method: "POST",
      url: `/api/admin/users/${account.userId}/status`,
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "  " },
    });
    expect(blankReason.statusCode).toBe(400);
    expect(blankReason.json().error.code).toBe("VALIDATION_FAILED");

    const unsupportedStatus = await app.inject({
      method: "POST",
      url: `/api/admin/users/${account.userId}/status`,
      headers: adminHeaders(),
      payload: { status: "suspended", reason: "policy review" },
    });
    expect(unsupportedStatus.statusCode).toBe(400);
    expect(unsupportedStatus.json().error.code).toBe("VALIDATION_FAILED");

    const missingUser = await app.inject({
      method: "POST",
      url: "/api/admin/users/missing-user/status",
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "manual review" },
    });
    expect(missingUser.statusCode).toBe(404);
    expect(missingUser.json().error.code).toBe("USER_NOT_FOUND");

    const missingDevice = await app.inject({
      method: "POST",
      url: "/api/admin/devices/missing-device/status",
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "manual review" },
    });
    expect(missingDevice.statusCode).toBe(404);
    expect(missingDevice.json().error.code).toBe("DEVICE_NOT_FOUND");

    const users = await app.inject({ method: "GET", url: "/api/admin/users", headers: adminHeaders() });
    expect(users.json().users.find((user: { id: string }) => user.id === account.userId).status).toBe("active");
  });

  it("re-enables a user without issuing an access token and requires a fresh login", async () => {
    const account = await registerAndLogin("reenable@example.com");

    const disabled = await app.inject({
      method: "POST",
      url: `/api/admin/users/${account.userId}/status`,
      headers: adminHeaders(),
      payload: { status: "disabled", reason: "temporary account hold" },
    });
    expect(disabled.statusCode).toBe(200);

    const blockedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reenable@example.com", password: "password-123", deviceId: account.deviceId },
    });
    expect(blockedLogin.statusCode).toBe(403);
    expect(blockedLogin.json().error.code).toBe("USER_DISABLED");

    const enabled = await app.inject({
      method: "POST",
      url: `/api/admin/users/${account.userId}/status`,
      headers: adminHeaders(),
      payload: { status: "active", reason: "account hold cleared" },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().user.status).toBe("active");
    expect(enabled.json()).not.toHaveProperty("accessToken");

    const freshLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reenable@example.com", password: "password-123", deviceId: account.deviceId },
    });
    expect(freshLogin.statusCode).toBe(200);
    expect(freshLogin.json().accessToken).toEqual(expect.any(String));
  });

  it("rejects active sessions when the backing user or device becomes disabled", async () => {
    const userAccount = await registerAndLogin("boundary-user@example.com");
    const user = await store.getUser(userAccount.userId);
    expect(user).not.toBeNull();
    await store.updateUser({ ...user!, status: "disabled" });

    const disabledUserSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${userAccount.accessToken}` },
    });
    expect(disabledUserSession.statusCode).toBe(403);
    expect(disabledUserSession.json().error.code).toBe("USER_DISABLED");

    const userHeartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      headers: { authorization: `Bearer ${userAccount.accessToken}` },
      payload: { sessionId: userAccount.sessionId },
    });
    expect(userHeartbeat.statusCode).toBe(403);
    expect(userHeartbeat.json().error.code).toBe("USER_DISABLED");

    const deviceAccount = await registerAndLogin("boundary-device@example.com");
    const device = await store.getDevice(deviceAccount.deviceId);
    expect(device).not.toBeNull();
    await store.updateDevice({ ...device!, status: "disabled" });

    const disabledDeviceSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${deviceAccount.accessToken}` },
    });
    expect(disabledDeviceSession.statusCode).toBe(403);
    expect(disabledDeviceSession.json().error.code).toBe("DEVICE_NOT_AUTHORIZED");

    const deviceHeartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      headers: { authorization: `Bearer ${deviceAccount.accessToken}` },
      payload: { sessionId: deviceAccount.sessionId },
    });
    expect(deviceHeartbeat.statusCode).toBe(403);
    expect(deviceHeartbeat.json().error.code).toBe("DEVICE_NOT_AUTHORIZED");
  });
});
