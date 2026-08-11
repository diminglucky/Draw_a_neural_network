import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MAX_DEVICE_CHALLENGE_BYTES, MAX_DEVICE_ID_LENGTH, createDeviceKeyStore } from "./device-key-store.mjs";
import { DEVICE_KEY_BIND_DEVICE_CHANNEL, DEVICE_KEY_GET_IDENTITY_CHANNEL, DEVICE_KEY_SIGN_CHALLENGE_CHANNEL } from "./channels.mjs";

export { DEVICE_KEY_BIND_DEVICE_CHANNEL, DEVICE_KEY_GET_IDENTITY_CHANNEL, DEVICE_KEY_SIGN_CHALLENGE_CHANNEL } from "./channels.mjs";
export const DEFAULT_FOUNDATION_UI_URL = "http://127.0.0.1:4173";

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function loadNativeDpapi({ platformName = process.platform, importer = (specifier) => import(specifier) } = {}) {
  if (platformName !== "win32") throw bridgeError("DESKTOP_WINDOWS_REQUIRED", "The commercial desktop client requires Windows DPAPI");
  try {
    const module = await importer("win-dpapi");
    return module.default || module;
  } catch (error) {
    throw bridgeError("DEVICE_DPAPI_UNAVAILABLE", "The Windows DPAPI native module is unavailable; rebuild it for this Electron version", error);
  }
}

export function createDeviceKeyIpc({ ipcMain, deviceKeyStore } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain.handle is required");
  if (!deviceKeyStore || typeof deviceKeyStore.getIdentity !== "function" || typeof deviceKeyStore.signChallenge !== "function") {
    throw new TypeError("deviceKeyStore identity and signing methods are required");
  }

  ipcMain.handle(DEVICE_KEY_GET_IDENTITY_CHANNEL, async () => deviceKeyStore.getIdentity());
  ipcMain.handle(DEVICE_KEY_SIGN_CHALLENGE_CHANNEL, async (_event, challenge) => {
    if (typeof challenge !== "string") throw bridgeError("DEVICE_CHALLENGE_INVALID", "The device challenge must be a string");
    if (Buffer.byteLength(challenge, "utf8") > MAX_DEVICE_CHALLENGE_BYTES) {
      throw bridgeError("DEVICE_CHALLENGE_TOO_LARGE", `The device challenge must be at most ${MAX_DEVICE_CHALLENGE_BYTES} bytes`);
    }
    return deviceKeyStore.signChallenge(challenge);
  });
  ipcMain.handle(DEVICE_KEY_BIND_DEVICE_CHANNEL, async (_event, deviceId) => {
    if (typeof deviceId !== "string") throw bridgeError("DEVICE_ID_INVALID", "The server device id must be a string");
    if (Buffer.byteLength(deviceId, "utf8") > MAX_DEVICE_ID_LENGTH) throw bridgeError("DEVICE_ID_TOO_LARGE", `The server device id must be at most ${MAX_DEVICE_ID_LENGTH} bytes`);
    return deviceKeyStore.bindDeviceId(deviceId);
  });

  return Object.freeze({
    channels: Object.freeze([DEVICE_KEY_GET_IDENTITY_CHANNEL, DEVICE_KEY_SIGN_CHALLENGE_CHANNEL, DEVICE_KEY_BIND_DEVICE_CHANNEL]),
  });
}

export async function startDesktopApp({ electron, dpapi, uiUrl = process.env.FOUNDATION_UI_URL || DEFAULT_FOUNDATION_UI_URL, userDataPath, keyStoreFactory = createDeviceKeyStore } = {}) {
  if (!electron?.app || !electron?.BrowserWindow || !electron?.ipcMain) throw new TypeError("Electron app, BrowserWindow, and ipcMain are required");
  if (!dpapi) throw new TypeError("Windows DPAPI implementation is required");

  const { app, BrowserWindow, ipcMain } = electron;
  await app.whenReady();
  const storageRoot = userDataPath || app.getPath("userData");
  const deviceKeyStore = keyStoreFactory({
    storagePath: join(storageRoot, "device-key.json"),
    dpapi,
  });
  createDeviceKeyIpc({ ipcMain, deviceKeyStore });

  const window = new BrowserWindow({
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(uiUrl);
  app.on?.("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  return Object.freeze({ window, deviceKeyStore });
}

async function startFromElectron() {
  if (!process.versions.electron) return;
  const electron = await import("electron");
  const dpapi = await loadNativeDpapi();
  await startDesktopApp({ electron, dpapi });
}

await startFromElectron();
