import { describe, expect, it } from "vitest";
import { createDeviceKeyProvider } from "./device-key-provider.js";

describe("device key provider", () => {
  it("delegates identity and challenge signing to the injected IPC bridge", async () => {
    const calls = [];
    const provider = createDeviceKeyProvider({
      bridge: {
        async getIdentity() { calls.push("identity"); return { id: "device-1", publicKey: "pem" }; },
        async signChallenge(challenge) { calls.push(challenge); return "signature"; },
      },
      production: true,
    });

    await expect(provider.getOrCreateIdentity()).resolves.toEqual({ id: "device-1", publicKey: "pem" });
    await expect(provider.signChallenge("challenge-1")).resolves.toBe("signature");
    expect(calls).toEqual(["identity", "challenge-1"]);
  });

  it("rejects a missing bridge in production", async () => {
    const provider = createDeviceKeyProvider({ production: true });

    await expect(provider.getOrCreateIdentity()).rejects.toMatchObject({ code: "DEVICE_KEY_BRIDGE_REQUIRED" });
    await expect(provider.signChallenge("challenge-1")).rejects.toMatchObject({ code: "DEVICE_KEY_BRIDGE_REQUIRED" });
  });

  it("allows an explicit development fallback without pretending it is production proof", async () => {
    const provider = createDeviceKeyProvider({
      production: false,
      fallbackIdentity: () => ({ id: "browser-device", publicKey: "browser-bootstrap-key" }),
    });

    await expect(provider.getOrCreateIdentity()).resolves.toMatchObject({ id: "browser-device" });
    await expect(provider.signChallenge("challenge-1")).rejects.toMatchObject({ code: "DEVICE_KEY_BRIDGE_REQUIRED" });
  });
});
