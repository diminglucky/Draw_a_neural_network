import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ApiErrorCode } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { SessionService } from "../src/session-service.js";

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function setupService() {
  const keys = keyMaterial();
  const store = new InMemoryFoundationStore();
  const service = new SessionService({
    store,
    leaseSeconds: 90,
    accessTokenTtlSeconds: 300,
    challengeTtlSeconds: 120,
    requireDeviceProof: true,
    sessionSecret: "test-session-secret-test-session-secret",
  });
  const user = await service.registerUser({ email: "user@example.com", password: "password-123" });
  const device = await service.registerDevice({
    userId: user.id,
    name: "Research PC",
    publicKey: keys.publicKey,
    fingerprintHash: "fingerprint-a",
    clientVersion: "0.1.0",
    osVersion: "Windows 11",
  });
  return { keys, service, user, device };
}

describe("device proof flow", () => {
  it("exposes a password-and-device bound challenge endpoint", async () => {
    const app = buildApp();
    const keys = keyMaterial();
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "challenge@example.com",
        password: "password-123",
        device: { name: "Research PC", publicKey: keys.publicKey, fingerprintHash: "fingerprint", clientVersion: "0.1.0", osVersion: "Windows 11" },
      },
    });
    const deviceId = registered.json().device.id;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      payload: { email: "challenge@example.com", password: "password-123", deviceId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ challengeId: expect.any(String), challenge: expect.any(String), expiresAt: expect.any(String) });
  });

  it("issues a challenge, accepts a signature, and rejects replay", async () => {
    const { keys, service, user, device } = await setupService();
    const challenge = await service.createLoginChallenge({ email: user.email, password: "password-123", deviceId: device.id });
    const signature = sign(null, Buffer.from(challenge.challenge, "utf8"), keys.privateKey).toString("base64");

    await expect(service.login({
      email: user.email,
      password: "password-123",
      deviceId: device.id,
      deviceProof: { challengeId: challenge.challengeId, signature },
    })).resolves.toMatchObject({ session: { status: "active" } });

    await expect(service.login({
      email: user.email,
      password: "password-123",
      deviceId: device.id,
      deviceProof: { challengeId: challenge.challengeId, signature },
    })).rejects.toMatchObject({ code: ApiErrorCode.DEVICE_CHALLENGE_INVALID });
  });

  it("rejects a production-style login without a device proof", async () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      REQUIRE_DEVICE_PROOF: "true",
      SESSION_SECRET: "test-session-secret-test-session-secret",
    });
    const app = buildApp({ config });
    const keys = keyMaterial();
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "proof@example.com",
        password: "password-123",
        device: { name: "Research PC", publicKey: keys.publicKey, fingerprintHash: "fingerprint", clientVersion: "0.1.0", osVersion: "Windows 11" },
      },
    });
    const deviceId = registered.json().device.id;

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "proof@example.com", password: "password-123", deviceId },
    });

    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe(ApiErrorCode.DEVICE_PROOF_REQUIRED);
  });

  it("consumes an invalid proof and prevents a valid signature from replaying it", async () => {
    const { keys, service, user, device } = await setupService();
    const challenge = await service.createLoginChallenge({ email: user.email, password: "password-123", deviceId: device.id });

    await expect(service.login({
      email: user.email,
      password: "password-123",
      deviceId: device.id,
      deviceProof: { challengeId: challenge.challengeId, signature: "AA==" },
    })).rejects.toMatchObject({ code: ApiErrorCode.DEVICE_PROOF_INVALID });

    const validSignature = sign(null, Buffer.from(challenge.challenge, "utf8"), keys.privateKey).toString("base64");
    await expect(service.login({
      email: user.email,
      password: "password-123",
      deviceId: device.id,
      deviceProof: { challengeId: challenge.challengeId, signature: validSignature },
    })).rejects.toMatchObject({ code: ApiErrorCode.DEVICE_CHALLENGE_INVALID });
  });
});
