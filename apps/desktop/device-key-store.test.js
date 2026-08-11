import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createDeviceKeyStore } from "./device-key-store.mjs";

const entropy = Buffer.from("Synapse Studio/device-key/v1");
const tempDirectories = [];

const dpapi = {
  protectData(data, optionalEntropy, scope) {
    expect(Buffer.from(optionalEntropy)).toEqual(entropy);
    expect(scope).toBe("CurrentUser");
    return Buffer.concat([Buffer.from("protected:"), Buffer.from(data)]);
  },
  unprotectData(data, optionalEntropy, scope) {
    expect(Buffer.from(optionalEntropy)).toEqual(entropy);
    expect(scope).toBe("CurrentUser");
    const value = Buffer.from(data);
    if (!value.subarray(0, 10).equals(Buffer.from("protected:"))) throw new Error("not protected");
    return value.subarray(10);
  },
};

async function storagePath() {
  const directory = await mkdtemp(join(tmpdir(), "synapse-device-key-"));
  tempDirectories.push(directory);
  return join(directory, "device-key.json");
}

afterEach(async () => {
  while (tempDirectories.length) await rm(tempDirectories.pop(), { recursive: true, force: true });
});

describe("DPAPI device key store", () => {
  it("generates an Ed25519 identity, persists it, reloads it, and signs challenges", async () => {
    const file = await storagePath();
    const first = createDeviceKeyStore({ storagePath: file, dpapi });
    const identity = await first.getIdentity();
    const signature = await first.signChallenge("challenge-1");

    expect(identity.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(signature).toEqual(expect.any(String));
    expect(verify(null, Buffer.from("challenge-1"), createPublicKey(identity.publicKey), Buffer.from(signature, "base64"))).toBe(true);

    const second = createDeviceKeyStore({ storagePath: file, dpapi });
    await expect(second.getIdentity()).resolves.toMatchObject({ publicKey: identity.publicKey });
    await expect(readFile(file, "utf8")).resolves.toContain("encryptedPrivateKey");
  });

  it("rejects a malformed key file instead of silently replacing the device identity", async () => {
    const file = await storagePath();
    await writeFile(file, "not-json", "utf8");
    const store = createDeviceKeyStore({ storagePath: file, dpapi });

    await expect(store.getIdentity()).rejects.toMatchObject({ code: "DEVICE_KEY_STORE_CORRUPT" });
  });

  it("rejects an oversized challenge before signing", async () => {
    const file = await storagePath();
    const store = createDeviceKeyStore({ storagePath: file, dpapi });

    await expect(store.signChallenge("x".repeat(4097))).rejects.toMatchObject({ code: "DEVICE_CHALLENGE_TOO_LARGE" });
  });

  it("writes the encrypted key through a same-directory temporary file before rename", async () => {
    const file = await storagePath();
    const writes = [];
    const renames = [];
    const fsImpl = {
      readFile,
      writeFile: async (path, data, options) => {
        writes.push(String(path));
        return writeFile(path, data, options);
      },
      rename: async (from, to) => {
        renames.push([String(from), String(to)]);
        return (await import("node:fs/promises")).rename(from, to);
      },
      unlink: rm,
    };

    await createDeviceKeyStore({ storagePath: file, dpapi, fsImpl }).getIdentity();

    expect(writes).toHaveLength(1);
    expect(renames).toHaveLength(1);
    expect(writes[0]).not.toBe(file);
    expect(writes[0]).toContain(`${file}.tmp-`);
    expect(renames[0][0]).toBe(writes[0]);
    expect(renames[0][1]).toBe(file);
  });
});
