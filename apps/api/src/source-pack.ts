import { createHash } from "node:crypto";

export const MAX_PYTORCH_SOURCE_BYTES = 200_000;
export const PYTORCH_SOURCE_MIME_TYPES = ["text/plain", "text/markdown", "text/x-python"] as const;

export type PyTorchSourceMimeType = (typeof PYTORCH_SOURCE_MIME_TYPES)[number];

export interface PyTorchSourcePackInput {
  sourceId: string;
  name: string;
  mimeType: string;
  data: string;
  sourceSha256: string;
}

export interface SourcePack {
  sourceId: string;
  name: string;
  kind: "pytorch-source";
  mimeType: PyTorchSourceMimeType;
  sourceSha256: string;
  code: string;
  bytes: number;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SOURCE_PACK_FIELDS = new Set(["sourceId", "name", "mimeType", "data", "sourceSha256"]);

export function parsePyTorchSourcePack(input: unknown): SourcePack {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("SourcePack must be an object");
  const value = input as Record<string, unknown>;
  for (const field of Object.keys(value)) {
    if (!SOURCE_PACK_FIELDS.has(field)) throw new Error(`SourcePack field ${field} is unsupported`);
  }
  if (typeof value.sourceId !== "string" || !IDENTIFIER_PATTERN.test(value.sourceId) || value.sourceId.length > 128) {
    throw new Error("SourcePack sourceId is invalid");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 256) {
    throw new Error("SourcePack name is invalid");
  }
  if (!isPyTorchSourceMimeType(value.mimeType)) throw new Error("SourcePack MIME type is unsupported");
  if (typeof value.data !== "string" || !BASE64_PATTERN.test(value.data) || value.data.length % 4 !== 0) {
    throw new Error("SourcePack data must be valid base64");
  }
  if (typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sourceSha256)) {
    throw new Error("SourcePack SHA-256 is invalid");
  }

  let code: string;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value.data, "base64");
    code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SourcePack data is not valid UTF-8 base64");
  }
  if (bytes.length === 0 || code.length === 0) throw new Error("SourcePack source is empty");
  if (bytes.length > MAX_PYTORCH_SOURCE_BYTES) {
    throw new Error(`SourcePack source exceeds ${MAX_PYTORCH_SOURCE_BYTES} UTF-8 bytes`);
  }

  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== value.sourceSha256.toLowerCase()) throw new Error("SourcePack SHA-256 hash does not match source bytes");

  return {
    sourceId: value.sourceId,
    name: value.name,
    kind: "pytorch-source",
    mimeType: value.mimeType,
    sourceSha256: value.sourceSha256,
    code,
    bytes: bytes.length,
  };
}

function isPyTorchSourceMimeType(value: unknown): value is PyTorchSourceMimeType {
  return typeof value === "string" && (PYTORCH_SOURCE_MIME_TYPES as readonly string[]).includes(value);
}
