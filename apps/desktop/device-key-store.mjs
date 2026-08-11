import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { hostname, platform, release } from "node:os";
import * as defaultFs from "node:fs/promises";

export const DEVICE_KEY_FILE_VERSION = 1;
export const DEVICE_KEY_ENTROPY = Buffer.from("Synapse Studio/device-key/v1", "utf8");
export const MAX_DEVICE_CHALLENGE_BYTES = 4096;

function deviceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function identityDefaults() {
  const machine = `${hostname()}|${platform()}|${release()}`;
  return {
    name: `${hostname()} desktop`,
    clientVersion: process.env.SYNAPSE_CLIENT_VERSION || "synapse-studio-desktop/0.1.0",
    osVersion: `${platform()} ${release()}`,
    fingerprintHash: createHash("sha256").update(machine, "utf8").digest("hex"),
  };
}

function assertKeyDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("key document is not an object");
  if (document.version !== DEVICE_KEY_FILE_VERSION) throw new Error("unsupported key document version");
  if (typeof document.publicKey !== "string" || !document.publicKey.includes("BEGIN PUBLIC KEY")) throw new Error("public key is invalid");
  if (typeof document.encryptedPrivateKey !== "string" || !document.encryptedPrivateKey) throw new Error("encrypted private key is invalid");
  if (typeof document.createdAt !== "string" || !document.createdAt) throw new Error("createdAt is invalid");
}

function publicKeyPem(key) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

function createIdentity(document) {
  const defaults = identityDefaults();
  return Object.freeze({
    publicKey: document.publicKey,
    fingerprintHash: defaults.fingerprintHash,
    name: defaults.name,
    clientVersion: defaults.clientVersion,
    osVersion: defaults.osVersion,
  });
}

export function createDeviceKeyStore({ storagePath, dpapi, fsImpl = defaultFs, now = () => new Date() } = {}) {
  if (!storagePath) throw new TypeError("storagePath is required");
  if (!dpapi || typeof dpapi.protectData !== "function" || typeof dpapi.unprotectData !== "function") {
    throw new TypeError("dpapi protectData and unprotectData methods are required");
  }

  let loaded;

  async function readDocument() {
    let raw;
    try {
      raw = await fsImpl.readFile(storagePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw deviceError("DEVICE_KEY_STORE_READ_FAILED", "Unable to read the device key store", error);
    }

    try {
      const document = JSON.parse(String(raw));
      assertKeyDocument(document);
      return document;
    } catch (error) {
      if (error?.code === "DEVICE_KEY_STORE_CORRUPT") throw error;
      throw deviceError("DEVICE_KEY_STORE_CORRUPT", "The device key store is malformed or unsupported", error);
    }
  }

  async function writeDocument(document) {
    const temporaryPath = `${storagePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    try {
      await fsImpl.writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fsImpl.rename(temporaryPath, storagePath);
    } catch (error) {
      throw deviceError("DEVICE_KEY_STORE_WRITE_FAILED", "Unable to persist the device key store", error);
    } finally {
      try { await fsImpl.unlink?.(temporaryPath); } catch { /* the rename already removed it */ }
    }
  }

  async function generateDocument() {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateBytes = privateKey.export({ type: "pkcs8", format: "der" });
    let encryptedPrivateKey;
    try {
      encryptedPrivateKey = Buffer.from(dpapi.protectData(privateBytes, DEVICE_KEY_ENTROPY, "CurrentUser")).toString("base64");
    } catch (error) {
      throw deviceError("DEVICE_KEY_PROTECTION_FAILED", "Unable to protect the device private key", error);
    }
    const document = {
      version: DEVICE_KEY_FILE_VERSION,
      publicKey: publicKeyPem(publicKey),
      encryptedPrivateKey,
      createdAt: now().toISOString(),
    };
    await writeDocument(document);
    return { document, privateKey };
  }

  async function load() {
    if (loaded) return loaded;
    const document = await readDocument();
    if (!document) {
      loaded = await generateDocument();
      return loaded;
    }

    let privateKey;
    try {
      const privateBytes = dpapi.unprotectData(Buffer.from(document.encryptedPrivateKey, "base64"), DEVICE_KEY_ENTROPY, "CurrentUser");
      privateKey = createPrivateKey({ key: Buffer.from(privateBytes), type: "pkcs8", format: "der" });
      if (publicKeyPem(privateKey) !== document.publicKey) throw new Error("public key does not match private key");
    } catch (error) {
      throw deviceError("DEVICE_KEY_STORE_CORRUPT", "The device key store cannot be decrypted or does not match", error);
    }
    loaded = { document, privateKey };
    return loaded;
  }

  return {
    async getIdentity() {
      const { document } = await load();
      return createIdentity(document);
    },

    async signChallenge(challenge) {
      if (typeof challenge !== "string") throw deviceError("DEVICE_CHALLENGE_INVALID", "The device challenge must be a string");
      const challengeBytes = Buffer.from(challenge, "utf8");
      if (challengeBytes.byteLength > MAX_DEVICE_CHALLENGE_BYTES) {
        throw deviceError("DEVICE_CHALLENGE_TOO_LARGE", `The device challenge must be at most ${MAX_DEVICE_CHALLENGE_BYTES} bytes`);
      }
      const { privateKey } = await load();
      return sign(null, challengeBytes, privateKey).toString("base64");
    },
  };
}
