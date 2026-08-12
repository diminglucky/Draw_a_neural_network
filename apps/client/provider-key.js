export const PROVIDER_API_KEY_STORAGE_KEY = "synapse.relayProviderApiKey";
export const MAX_PROVIDER_API_KEY_LENGTH = 512;

function defaultStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

export function readProviderApiKey(storage = defaultStorage()) {
  try { return String(storage?.getItem(PROVIDER_API_KEY_STORAGE_KEY) || "").trim(); } catch { return ""; }
}

export function saveProviderApiKey(value, storage = defaultStorage()) {
  const key = String(value ?? "").trim();
  if (key.length > MAX_PROVIDER_API_KEY_LENGTH) throw new Error("API Key 过长");
  if (!storage) return false;
  if (!key) {
    clearProviderApiKey(storage);
    return true;
  }
  storage.setItem(PROVIDER_API_KEY_STORAGE_KEY, key);
  return true;
}

export function clearProviderApiKey(storage = defaultStorage()) {
  try { storage?.removeItem(PROVIDER_API_KEY_STORAGE_KEY); } catch { /* storage may be unavailable */ }
}

export function maskProviderApiKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return "未配置";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}••••••••${key.slice(-5)}`;
}
