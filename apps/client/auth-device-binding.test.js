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

function registrationRoot() {
  const registerButton = { dataset: { authMode: "register" }, classList: { toggle() {} }, addEventListener(type, callback) { this.listeners ??= {}; this.listeners[type] = callback; } };
  const loginButton = { dataset: { authMode: "login" }, classList: { toggle() {} }, addEventListener(type, callback) { this.listeners ??= {}; this.listeners[type] = callback; } };
  const submitButton = { textContent: "" };
  const root = {
    dataset: {},
    classList: { toggle() {} },
    innerHTML: "",
    querySelectorAll(selector) { return selector === "[data-auth-mode]" ? [loginButton, registerButton] : []; },
    querySelector(selector) {
      if (selector === "[data-auth-form]") return { addEventListener() {} };
      if (selector === "[data-auth-logout]") return null;
      if (selector === "[data-auth-submit]") return submitButton;
      return null;
    },
  };
  return { root, registerButton };
}

describe("auth gate device binding", () => {
  it("binds the server-issued device id before completing registration login", async () => {
    const { root, registerButton } = registrationRoot();
    const requests = [];
    const device = { publicKey: "pem", fingerprintHash: "fingerprint", name: "Windows", clientVersion: "1.0.0", osVersion: "Windows 11" };
    const registeredDevice = { id: "server-device-1", ...device };
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith("/api/auth/register")) return response({ user: { id: "user-1" }, device: registeredDevice }, true, 201);
      if (url.endsWith("/api/auth/challenge")) return response({ challengeId: "challenge-1", challenge: "challenge-value", expiresAt: "2026-08-11T00:02:00.000Z" });
      if (url.endsWith("/api/auth/login")) return response({ accessToken: "access-token", session: { id: "session-1" } });
      if (url.endsWith("/api/auth/session")) return response({ user: { email: "user@example.com" }, device: registeredDevice, session: { id: "session-1" } });
      if (url.endsWith("/api/license/status")) return response({ subscription: { plan: "trial", features: [], limits: {} } });
      throw new Error(`unexpected request ${url}`);
    };
    const provider = {
      async getOrCreateIdentity() { calls.push("identity"); return device; },
      async bindDeviceId(id) { calls.push(`bind:${id}`); },
      async signChallenge(challenge) { calls.push(`sign:${challenge}`); return "signature"; },
    };
    const gate = createAuthGate({ root, storage: storage(), fetchImpl, deviceProvider: provider, requireDeviceProof: true });
    gate.mount();
    await registerButton.listeners.click();
    await expect(gate.submit("user@example.com", "password-123")).resolves.toBe(true);

    expect(calls).toEqual(["identity", "bind:server-device-1", "sign:challenge-value"]);
    const loginRequest = requests.find((item) => item.url.endsWith("/api/auth/login"));
    expect(JSON.parse(loginRequest.init.body)).toMatchObject({
      deviceId: "server-device-1",
      deviceProof: { challengeId: "challenge-1", signature: "signature" },
    });
  });
});
