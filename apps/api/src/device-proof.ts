import { createPublicKey, verify } from "node:crypto";

const MAX_PUBLIC_KEY_LENGTH = 8192;
const MAX_SIGNATURE_LENGTH = 4096;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function verifyDeviceSignature(publicKeyPem: string, challenge: string, signatureBase64: string): boolean {
  if (!publicKeyPem || publicKeyPem.length > MAX_PUBLIC_KEY_LENGTH) return false;
  if (!signatureBase64 || signatureBase64.length > MAX_SIGNATURE_LENGTH || !BASE64_PATTERN.test(signatureBase64)) return false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(challenge, "utf8"), publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
