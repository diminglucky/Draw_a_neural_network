import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeviceKeyStore } from "../apps/desktop/device-key-store.mjs";

const { app } = await import("electron");

if (process.platform !== "win32") {
  throw Object.assign(new Error("The DPAPI smoke requires Windows"), { code: "DESKTOP_WINDOWS_REQUIRED" });
}

const dpapiModule = await import("win-dpapi");
const dpapi = dpapiModule.default || dpapiModule;
const directory = await mkdtemp(join(tmpdir(), "synapse-dpapi-smoke-"));
const storagePath = join(directory, "device-key.json");

try {
  const first = createDeviceKeyStore({ storagePath, dpapi });
  const identity = await first.getIdentity();
  const challenge = "desktop-dpapi-smoke-challenge";
  const signature = await first.signChallenge(challenge);
  const signatureValid = verify(
    null,
    Buffer.from(challenge, "utf8"),
    createPublicKey(identity.publicKey),
    Buffer.from(signature, "base64"),
  );

  const second = createDeviceKeyStore({ storagePath, dpapi });
  const reloaded = await second.getIdentity();
  if (identity.publicKey !== reloaded.publicKey || !signatureValid) {
    throw new Error("DPAPI device identity reload or signature verification failed");
  }

  console.log(JSON.stringify({ status: "ok", platform: process.platform, electron: process.versions.electron, publicKeyStable: true, signatureValid: true }));
} finally {
  await rm(directory, { recursive: true, force: true });
  app.exit(0);
}
