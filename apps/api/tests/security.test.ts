import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  hashPassword,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../src/security.js";

describe("security primitives", () => {
  it("hashes and verifies passwords without storing the clear text", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("signs and verifies a short-lived access token", async () => {
    const token = await signAccessToken(
      { sub: "user-1", deviceId: "device-1", sessionId: "session-1", roles: ["user"] },
      "test-session-secret-test-session-secret",
      { ttlSeconds: 60 },
    );

    const claims = await verifyAccessToken(token, "test-session-secret-test-session-secret");
    expect(claims.sub).toBe("user-1");
    expect(claims.deviceId).toBe("device-1");
    expect(claims.sessionId).toBe("session-1");
  });

  it("rejects expired access tokens", async () => {
    const token = await signAccessToken(
      { sub: "user-1", deviceId: "device-1", sessionId: "session-1", roles: ["user"] },
      "test-session-secret-test-session-secret",
      { ttlSeconds: -1 },
    );

    await expect(verifyAccessToken(token, "test-session-secret-test-session-secret")).rejects.toThrow();
  });

  it("hashes refresh tokens deterministically without returning the token", () => {
    expect(hashRefreshToken("refresh-token")).toBe(hashRefreshToken("refresh-token"));
    expect(hashRefreshToken("refresh-token")).not.toBe("refresh-token");
  });

  it("requires an explicit session secret in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", STORAGE_DRIVER: "postgres" })).toThrow(/SESSION_SECRET/);
  });
});
