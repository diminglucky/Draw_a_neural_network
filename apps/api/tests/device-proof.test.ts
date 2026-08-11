import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { verifyDeviceSignature } from "../src/device-proof.js";

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("device proof verifier", () => {
  it("accepts a valid Ed25519 signature for the exact challenge", () => {
    const { privateKey, publicKey } = keyMaterial();
    const challenge = "synapse-device-challenge";
    const signature = sign(null, Buffer.from(challenge, "utf8"), privateKey).toString("base64");

    expect(verifyDeviceSignature(publicKey, challenge, signature)).toBe(true);
    expect(verifyDeviceSignature(publicKey, `${challenge}-changed`, signature)).toBe(false);
  });

  it("rejects malformed keys and oversized signatures without throwing", () => {
    expect(verifyDeviceSignature("not-a-public-key", "challenge", "AA==")).toBe(false);
    expect(verifyDeviceSignature("not-a-public-key", "challenge", "A".repeat(4097))).toBe(false);
  });

  it("exports stable device-proof error codes", () => {
    expect(ApiErrorCode.DEVICE_PROOF_REQUIRED).toBe("DEVICE_PROOF_REQUIRED");
    expect(ApiErrorCode.DEVICE_PROOF_INVALID).toBe("DEVICE_PROOF_INVALID");
    expect(ApiErrorCode.DEVICE_CHALLENGE_INVALID).toBe("DEVICE_CHALLENGE_INVALID");
  });
});
