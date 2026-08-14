import { DEVICE_KEY_BIND_DEVICE_CHANNEL, DEVICE_KEY_GET_IDENTITY_CHANNEL, DEVICE_KEY_SIGN_CHALLENGE_CHANNEL, SHELL_OPEN_PATH_CHANNEL } from "./channels.mjs";

export function exposeDeviceKeyBridge({ contextBridge, ipcRenderer } = {}) {
  if (!contextBridge || typeof contextBridge.exposeInMainWorld !== "function") throw new TypeError("contextBridge is required");
  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") throw new TypeError("ipcRenderer.invoke is required");

  const api = Object.freeze({
    getIdentity: () => ipcRenderer.invoke(DEVICE_KEY_GET_IDENTITY_CHANNEL),
    signChallenge: (challenge) => ipcRenderer.invoke(DEVICE_KEY_SIGN_CHALLENGE_CHANNEL, challenge),
    bindDeviceId: (deviceId) => ipcRenderer.invoke(DEVICE_KEY_BIND_DEVICE_CHANNEL, deviceId),
  });
  contextBridge.exposeInMainWorld("synapseDeviceKey", api);
  contextBridge.exposeInMainWorld("synapseDesktop", Object.freeze({
    openPath: (path) => ipcRenderer.invoke(SHELL_OPEN_PATH_CHANNEL, path),
  }));
  return api;
}

if (process.versions.electron) {
  const { contextBridge, ipcRenderer } = await import("electron");
  exposeDeviceKeyBridge({ contextBridge, ipcRenderer });
}
