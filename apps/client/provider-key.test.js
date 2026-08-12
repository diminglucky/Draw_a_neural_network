import { describe, expect, it } from "vitest";
import { clearProviderApiKey, maskProviderApiKey, readProviderApiKey, saveProviderApiKey } from "./provider-key.js";

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

describe("desktop relay API key settings", () => {
  it("stores and reads only the trimmed provider key from the session store", () => {
    const session = storage();
    expect(saveProviderApiKey("  sk-user-relay  ", session)).toBe(true);
    expect(readProviderApiKey(session)).toBe("sk-user-relay");
    expect(maskProviderApiKey(readProviderApiKey(session))).toBe("sk-••••••••relay");
  });

  it("clears the key and rejects oversized values", () => {
    const session = storage();
    expect(() => saveProviderApiKey("x".repeat(513), session)).toThrow("API Key 过长");
    saveProviderApiKey("sk-user-relay", session);
    clearProviderApiKey(session);
    expect(readProviderApiKey(session)).toBe("");
  });
});
