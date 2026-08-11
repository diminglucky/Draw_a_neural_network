import { describe, expect, it } from "vitest";
import { createAuthGate } from "./auth-gate.js";

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

describe("auth gate device proof integration", () => {
  it("requests a challenge and sends the IPC signature during proof-required login", async () => {
    const requests = [];
    const device = { id: "device-1", publicKey: "pem", fingerprintHash: "fingerprint", name: "Windows", clientVersion: "1.0.0", osVersion: "Windows 11" };
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith("/api/auth/challenge")) return response({ challengeId: "challenge-1", challenge: "challenge-value", expiresAt: "2026-08-11T00:02:00.000Z" });
      if (url.endsWith("/api/auth/login")) return response({ accessToken: "access-token", session: { id: "session-1" } });
      if (url.endsWith("/api/auth/session")) return response({ user: { email: "user@example.com" }, device, session: { id: "session-1" } });
      if (url.endsWith("/api/license/status")) return response({ subscription: { plan: "trial", features: [], limits: {} } });
      throw new Error(`unexpected request ${url}`);
    };
    const provider = {
      async getOrCreateIdentity() { return device; },
      async signChallenge(challenge) { expect(challenge).toBe("challenge-value"); return "signature"; },
    };
    const gate = createAuthGate({ root: null, storage: storage(), fetchImpl, deviceProvider: provider, requireDeviceProof: true });

    await expect(gate.submit("user@example.com", "password-123")).resolves.toBe(true);

    const loginRequest = requests.find((item) => item.url.endsWith("/api/auth/login"));
    expect(JSON.parse(loginRequest.init.body)).toMatchObject({
      deviceId: "device-1",
      deviceProof: { challengeId: "challenge-1", signature: "signature" },
    });
  });
});
