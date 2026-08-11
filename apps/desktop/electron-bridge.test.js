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
      bindDeviceId: vi.fn(async (id) => ({ id })),
    };

    createDeviceKeyIpc({ ipcMain, deviceKeyStore });

    expect([...handlers.keys()]).toEqual(["device-key:get-identity", "device-key:sign-challenge", "device-key:bind-device"]);
    await expect(handlers.get("device-key:get-identity")({})).resolves.toEqual({ publicKey: "public" });
    await expect(handlers.get("device-key:sign-challenge")({}, "challenge")).resolves.toBe("signature:challenge");
    await expect(handlers.get("device-key:bind-device")({}, "server-device-1")).resolves.toEqual({ id: "server-device-1" });
    expect(deviceKeyStore.signChallenge).toHaveBeenCalledWith("challenge");
    expect(deviceKeyStore.bindDeviceId).toHaveBeenCalledWith("server-device-1");
  });

  it("rejects non-string and oversized challenge IPC arguments before signing", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (channel, callback) => handlers.set(channel, callback) };
    const deviceKeyStore = { getIdentity: vi.fn(), signChallenge: vi.fn(), bindDeviceId: vi.fn() };

    createDeviceKeyIpc({ ipcMain, deviceKeyStore });

    const signHandler = handlers.get("device-key:sign-challenge");
    const bindHandler = handlers.get("device-key:bind-device");
    await expect(signHandler({}, 123)).rejects.toMatchObject({ code: "DEVICE_CHALLENGE_INVALID" });
    await expect(signHandler({}, "x".repeat(4097))).rejects.toMatchObject({ code: "DEVICE_CHALLENGE_TOO_LARGE" });
    await expect(bindHandler({}, 123)).rejects.toMatchObject({ code: "DEVICE_ID_INVALID" });
    await expect(bindHandler({}, "x".repeat(129))).rejects.toMatchObject({ code: "DEVICE_ID_TOO_LARGE" });
    expect(deviceKeyStore.signChallenge).not.toHaveBeenCalled();
    expect(deviceKeyStore.bindDeviceId).not.toHaveBeenCalled();
  });

  it("exposes only the renderer-safe identity and signing methods", async () => {
    const exposed = {};
    const ipcRenderer = { invoke: vi.fn(async (channel, value) => ({ channel, value })) };
    const contextBridge = { exposeInMainWorld: vi.fn((name, api) => { exposed[name] = api; }) };

    exposeDeviceKeyBridge({ contextBridge, ipcRenderer });

    expect(Object.keys(exposed)).toEqual(["synapseDeviceKey"]);
    expect(Object.keys(exposed.synapseDeviceKey)).toEqual(["getIdentity", "signChallenge", "bindDeviceId"]);
    await expect(exposed.synapseDeviceKey.getIdentity()).resolves.toEqual({ channel: "device-key:get-identity", value: undefined });
    await expect(exposed.synapseDeviceKey.signChallenge("challenge")).resolves.toEqual({ channel: "device-key:sign-challenge", value: "challenge" });
    await expect(exposed.synapseDeviceKey.bindDeviceId("server-device-1")).resolves.toEqual({ channel: "device-key:bind-device", value: "server-device-1" });
  });

  it("fails clearly when native DPAPI is requested outside Windows", async () => {
    const importer = vi.fn();

    await expect(loadNativeDpapi({ platformName: "linux", importer })).rejects.toMatchObject({ code: "DESKTOP_WINDOWS_REQUIRED" });
    expect(importer).not.toHaveBeenCalled();
  });
});
