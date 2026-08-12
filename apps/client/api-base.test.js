import { describe, expect, it } from "vitest";
import { FIXED_FOUNDATION_API_URL, resolveFoundationApiBase } from "./api-base.js";

describe("fixed foundation relay boundary", () => {
  it("uses the compiled foundation relay when no explicit test dependency is supplied", () => {
    const previous = globalThis.SYNAPSE_API_BASE;
    globalThis.SYNAPSE_API_BASE = "https://attacker.example";
    try {
      expect(resolveFoundationApiBase()).toBe(FIXED_FOUNDATION_API_URL);
    } finally {
      if (previous === undefined) delete globalThis.SYNAPSE_API_BASE;
      else globalThis.SYNAPSE_API_BASE = previous;
    }
  });

  it("allows an explicit dependency override for isolated tests only", () => {
    expect(resolveFoundationApiBase({ apiBase: "http://127.0.0.1:4180/" })).toBe("http://127.0.0.1:4180");
  });

  it("rejects an empty explicit dependency override instead of falling back silently", () => {
    expect(() => resolveFoundationApiBase({ apiBase: "   " })).toThrow("Foundation API base is invalid");
  });
});
