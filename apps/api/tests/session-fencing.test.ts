import { describe, expect, it } from "vitest";
import type { LeaseCoordinator, LeaseResult } from "../src/lease-coordinator.js";
import { ApiErrorCode } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { SessionService } from "../src/session-service.js";

class ScriptedLeaseCoordinator implements LeaseCoordinator {
  claimResult: LeaseResult = { acquired: true, fencingToken: 11 };
  renewResult: LeaseResult = { acquired: true, fencingToken: 11 };
  readonly claims: Array<{ key: string; owner: string; ttlSeconds: number }> = [];
  readonly renewals: Array<{ key: string; owner: string; fencingToken: number; ttlSeconds: number }> = [];
  readonly releases: Array<{ key: string; owner: string; fencingToken: number }> = [];

  async claim(key: string, owner: string, ttlSeconds: number): Promise<LeaseResult> {
    this.claims.push({ key, owner, ttlSeconds });
    return this.claimResult;
  }

  async renew(key: string, owner: string, fencingToken: number, ttlSeconds: number): Promise<LeaseResult> {
    this.renewals.push({ key, owner, fencingToken, ttlSeconds });
    return this.renewResult;
  }

  async release(key: string, owner: string, fencingToken: number): Promise<void> {
    this.releases.push({ key, owner, fencingToken });
  }
}

async function setup(coordinator: ScriptedLeaseCoordinator) {
  const store = new InMemoryFoundationStore();
  const service = new SessionService({
    store,
    leaseCoordinator: coordinator,
    leaseSeconds: 90,
    accessTokenTtlSeconds: 300,
    sessionSecret: "test-session-secret-test-session-secret",
  });
  const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
  const device = await service.registerDevice({
    userId: user.id,
    name: "Research PC",
    publicKey: "public-key-a",
    fingerprintHash: "fingerprint-a",
    clientVersion: "0.1.0",
    osVersion: "Windows 11",
  });
  return { store, service, user, device };
}

describe("SessionService distributed fencing", () => {
  it("claims the account lease and persists the returned fencing token", async () => {
    const coordinator = new ScriptedLeaseCoordinator();
    const { service, user, device } = await setup(coordinator);

    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });

    expect(access.session.leaseFencingToken).toBe(11);
    expect(coordinator.claims).toEqual([{ key: `account:${user.id}`, owner: access.session.id, ttlSeconds: 90 }]);
  });

  it("releases a provisional lease when the durable session claim is denied", async () => {
    const coordinator = new ScriptedLeaseCoordinator();
    const { service, user, device } = await setup(coordinator);
    await service.login({ email: user.email, password: "password-123", deviceId: device.id });

    await expect(service.login({ email: user.email, password: "password-123", deviceId: device.id })).rejects.toMatchObject({
      code: ApiErrorCode.ACCOUNT_ALREADY_IN_USE,
    });
    expect(coordinator.releases).toHaveLength(1);
  });

  it("renews Redis before updating a heartbeat", async () => {
    const coordinator = new ScriptedLeaseCoordinator();
    const { service, user, device } = await setup(coordinator);
    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });

    await service.heartbeat({ sessionId: access.session.id, accessToken: access.accessToken });

    expect(coordinator.renewals).toEqual([{ key: `account:${user.id}`, owner: access.session.id, fencingToken: 11, ttlSeconds: 90 }]);
  });

  it("expires the session when Redis rejects a stale fencing token", async () => {
    const coordinator = new ScriptedLeaseCoordinator();
    const { service, user, device } = await setup(coordinator);
    const access = await service.login({ email: user.email, password: "password-123", deviceId: device.id });
    coordinator.renewResult = { acquired: false, fencingToken: null };

    await expect(service.heartbeat({ sessionId: access.session.id, accessToken: access.accessToken })).rejects.toMatchObject({
      code: ApiErrorCode.SESSION_EXPIRED,
    });
  });
});
