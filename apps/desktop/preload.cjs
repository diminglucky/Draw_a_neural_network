const CHANNELS = Object.freeze({
  getIdentity: "device-key:get-identity",
  signChallenge: "device-key:sign-challenge",
  bindDeviceId: "device-key:bind-device",
});

function exposeDeviceKeyBridge({ contextBridge, ipcRenderer } = {}) {
  if (!contextBridge || typeof contextBridge.exposeInMainWorld !== "function") throw new TypeError("contextBridge is required");
  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") throw new TypeError("ipcRenderer.invoke is required");

  const api = Object.freeze({
    getIdentity: () => ipcRenderer.invoke(CHANNELS.getIdentity),
    signChallenge: (challenge) => ipcRenderer.invoke(CHANNELS.signChallenge, challenge),
    bindDeviceId: (deviceId) => ipcRenderer.invoke(CHANNELS.bindDeviceId, deviceId),
  });
  contextBridge.exposeInMainWorld("synapseDeviceKey", api);
  return api;
}

if (typeof process !== "undefined" && process.versions?.electron) {
  const { contextBridge, ipcRenderer } = require("electron");
  exposeDeviceKeyBridge({ contextBridge, ipcRenderer });
}

module.exports = { exposeDeviceKeyBridge };
