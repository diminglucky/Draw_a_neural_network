import { beforeEach, describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { SessionService } from "../src/session-service.js";

describe("session service", () => {
  let store: InMemoryFoundationStore;
  let service: SessionService;
  let now: Date;

  beforeEach(() => {
    now = new Date("2026-08-11T00:00:00.000Z");
    store = new InMemoryFoundationStore();
    service = new SessionService({
      store,
      now: () => new Date(now),
      leaseSeconds: 90,
      accessTokenTtlSeconds: 300,
      sessionSecret: "test-session-secret-test-session-secret",
    });
  });

  it("registers a user and rejects duplicate email addresses", async () => {
    const first = await service.registerUser({ email: "user@example.com", password: "password-123" });

    expect(first.email).toBe("user@example.com");
    await expect(service.registerUser({ email: "USER@example.com", password: "password-456" })).rejects.toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
    });
  });

  it("creates a device and starts the first active session", async () => {
    const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
    const device = await service.registerDevice({
      userId: user.id,
      name: "Research PC",
      publicKey: "public-key-a",
      fingerprintHash: "fingerprint-a",
      clientVersion: "0.1.0",
      osVersion: "Windows 11",
    });

    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });

    expect(access.session.status).toBe("active");
    expect(access.session.deviceId).toBe(device.id);
    expect(access.accessToken).toEqual(expect.any(String));
  });

  it("rejects a second device while the first device lease is active", async () => {
    const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
    const firstDevice = await service.registerDevice({
      userId: user.id,
      name: "First PC",
      publicKey: "public-key-a",
      fingerprintHash: "fingerprint-a",
      clientVersion: "0.1.0",
      osVersion: "Windows 11",
    });
    const secondDevice = await service.registerDevice({
      userId: user.id,
      name: "Second PC",
      publicKey: "public-key-b",
      fingerprintHash: "fingerprint-b",
      clientVersion: "0.1.0",
      osVersion: "Windows 11",
    });

    await service.login({ email: user.email, password: "password-123", deviceId: firstDevice.id });
    await expect(service.login({ email: user.email, password: "password-123", deviceId: secondDevice.id })).rejects.toMatchObject({
      code: ApiErrorCode.ACCOUNT_ALREADY_IN_USE,
    });
  });

  it("renews a lease with heartbeat and expires an abandoned session", async () => {
    const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
    const device = await service.registerDevice({
      userId: user.id,
      name: "Research PC",
      publicKey: "public-key-a",
      fingerprintHash: "fingerprint-a",
      clientVersion: "0.1.0",
      osVersion: "Windows 11",
    });
    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });
    const initialExpiry = access.session.leaseExpiresAt;

    now = new Date("2026-08-11T00:00:30.000Z");
    const renewed = await service.heartbeat({ sessionId: access.session.id, accessToken: access.accessToken });
    expect(renewed.leaseExpiresAt).not.toBe(initialExpiry);

    now = new Date("2026-08-11T00:03:00.000Z");
    await expect(service.heartbeat({ sessionId: access.session.id, accessToken: access.accessToken })).rejects.toMatchObject({
      code: ApiErrorCode.SESSION_EXPIRED,
    });
  });

  it("revokes a session and records the administrative action", async () => {
    const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
    const device = await service.registerDevice({
      userId: user.id,
      name: "Research PC",
      publicKey: "public-key-a",
      fingerprintHash: "fingerprint-a",
      clientVersion: "0.1.0",
      osVersion: "Windows 11",
    });
    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });

    await service.revokeSession({ sessionId: access.session.id, actorId: "admin-1", reason: "User requested device switch" });
    await expect(service.getCurrentAccess(access.accessToken)).rejects.toMatchObject({ code: ApiErrorCode.SESSION_REVOKED });
    expect((await store.listAuditRecords()).some((item) => item.action === "session.revoked")).toBe(true);
  });
});
