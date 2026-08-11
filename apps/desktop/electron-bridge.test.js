import { describe, expect, it, vi } from "vitest";
import { createDeviceKeyIpc, loadNativeDpapi } from "./main.mjs";
import { exposeDeviceKeyBridge } from "./preload.mjs";

describe("Electron device-key bridge", () => {
  it("registers only fixed identity and signing IPC handlers", async () => {
    const handlers = new Map();
    const ipcMain = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    };
    const deviceKeyStore = {
      getIdentity: vi.fn(async () => ({ publicKey: "public" })),
      signChallenge: vi.fn(async (challenge) => `signature:${challenge}`),
    };

    createDeviceKeyIpc({ ipcMain, deviceKeyStore });

    expect([...handlers.keys()]).toEqual(["device-key:get-identity", "device-key:sign-challenge"]);
    await expect(handlers.get("device-key:get-identity")({})).resolves.toEqual({ publicKey: "public" });
    await expect(handlers.get("device-key:sign-challenge")({}, "challenge")).resolves.toBe("signature:challenge");
    expect(deviceKeyStore.signChallenge).toHaveBeenCalledWith("challenge");
  });

  it("rejects non-string and oversized challenge IPC arguments before signing", async () => {
    const handler = vi.fn();
    const ipcMain = { handle: (_channel, callback) => handler.mockImplementation(callback) };
    const deviceKeyStore = { getIdentity: vi.fn(), signChallenge: vi.fn() };

    createDeviceKeyIpc({ ipcMain, deviceKeyStore });

    await expect(handler({}, 123)).rejects.toMatchObject({ code: "DEVICE_CHALLENGE_INVALID" });
    await expect(handler({}, "x".repeat(4097))).rejects.toMatchObject({ code: "DEVICE_CHALLENGE_TOO_LARGE" });
    expect(deviceKeyStore.signChallenge).not.toHaveBeenCalled();
  });

  it("exposes only the renderer-safe identity and signing methods", async () => {
    const exposed = {};
    const ipcRenderer = { invoke: vi.fn(async (channel, value) => ({ channel, value })) };
    const contextBridge = { exposeInMainWorld: vi.fn((name, api) => { exposed[name] = api; }) };

    exposeDeviceKeyBridge({ contextBridge, ipcRenderer });

    expect(Object.keys(exposed)).toEqual(["synapseDeviceKey"]);
    expect(Object.keys(exposed.synapseDeviceKey)).toEqual(["getIdentity", "signChallenge"]);
    await expect(exposed.synapseDeviceKey.getIdentity()).resolves.toEqual({ channel: "device-key:get-identity", value: undefined });
    await expect(exposed.synapseDeviceKey.signChallenge("challenge")).resolves.toEqual({ channel: "device-key:sign-challenge", value: "challenge" });
  });

  it("fails clearly when native DPAPI is requested outside Windows", async () => {
    const importer = vi.fn();

    await expect(loadNativeDpapi({ platformName: "linux", importer })).rejects.toMatchObject({ code: "DESKTOP_WINDOWS_REQUIRED" });
    expect(importer).not.toHaveBeenCalled();
  });
});
