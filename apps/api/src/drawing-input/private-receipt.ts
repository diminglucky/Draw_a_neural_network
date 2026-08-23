import { createHash, randomUUID } from "node:crypto";
import { compareCodeUnits } from "../stable-string-order.js";
import type { PoolClientLike, PoolLike, QueryResult } from "../postgres-store.js";

export type PrivateReceiptKind = "typed_text" | "pytorch_source" | "architecture_description" | "sketch";
export type PrivateReceiptRetention = "ephemeral" | "owner_revision";
export type PrivateReceiptMimeType =
  | "text/plain"
  | "text/markdown"
  | "text/x-python"
  | "application/json"
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export interface PrivateInputReceipt {
  receiptId: string;
  ownerId: string;
  kind: PrivateReceiptKind;
  mimeType: PrivateReceiptMimeType;
  sha256: string;
  byteLength: number;
  retention: PrivateReceiptRetention;
  contentHandle: string;
}

export interface PrivateReceiptIngestInput {
  ownerId: string;
  kind: PrivateReceiptKind;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
  retention?: PrivateReceiptRetention;
}

export interface PrivateReceiptStore {
  ingest(input: PrivateReceiptIngestInput): Promise<PrivateInputReceipt>;
  bindBatchHash(ownerId: string, batchHash: string, receiptIds: readonly string[]): Promise<void>;
  get(ownerId: string, receiptId: string): Promise<PrivateInputReceipt | null>;
  findByBatchHash(ownerId: string, batchHash: string): Promise<PrivateInputReceipt[]>;
  read(ownerId: string, receiptId: string): Promise<Uint8Array | null>;
  releaseOwnerRevision(ownerId: string, receiptId: string): Promise<void>;
}

const textMimes = new Set<PrivateReceiptMimeType>(["text/plain", "text/markdown"]);
const pytorchMimes = new Set<PrivateReceiptMimeType>(["text/plain", "text/markdown", "text/x-python"]);
const architectureMimes = new Set<PrivateReceiptMimeType>(["text/plain", "text/markdown", "application/json"]);
const sketchMimes = new Set<PrivateReceiptMimeType>(["image/png", "image/jpeg", "image/webp"]);

export const PRIVATE_RECEIPT_MAX_BYTES: Readonly<Record<PrivateReceiptKind, number>> = {
  typed_text: 200_000,
  pytorch_source: 200_000,
  architecture_description: 200_000,
  sketch: 8 * 1024 * 1024,
};

export function validatePrivateReceiptMetadata(value: unknown): PrivateInputReceipt {
  if (!isRecord(value)) throw new Error("PrivateInputReceipt must be an object");
  assertExactKeys(value, ["receiptId", "ownerId", "kind", "mimeType", "sha256", "byteLength", "retention", "contentHandle"]);
  if (!safeIdentifier(value.receiptId) || !safeIdentifier(value.ownerId) || !safeIdentifier(value.contentHandle)) throw new Error("PrivateInputReceipt identity is invalid");
  if (!isReceiptKind(value.kind) || !isReceiptRetention(value.retention) || !isReceiptMime(value.mimeType)) throw new Error("PrivateInputReceipt metadata is invalid");
  if (!/^[a-f0-9]{64}$/i.test(String(value.sha256)) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > PRIVATE_RECEIPT_MAX_BYTES[value.kind]) throw new Error("PrivateInputReceipt digest or size is invalid");
  assertReceiptMime(value.kind, value.mimeType);
  return {
    receiptId: value.receiptId,
    ownerId: value.ownerId,
    kind: value.kind,
    mimeType: value.mimeType,
    sha256: value.sha256.toLowerCase(),
    byteLength: value.byteLength,
    retention: value.retention,
    contentHandle: value.contentHandle,
  };
}

export function assertReceiptKindAndMime(kind: PrivateReceiptKind, mimeType: string): asserts mimeType is PrivateReceiptMimeType {
  if (!isReceiptMime(mimeType)) throw new Error(`Unsupported receipt MIME type: ${mimeType}`);
  assertReceiptMime(kind, mimeType);
}

export function receiptBatchHash(receipts: readonly PrivateInputReceipt[]): string {
  const canonical = receipts
    .map(({ receiptId, ownerId, contentHandle, ...metadata }) => ({ receiptId, ownerId, contentHandle, ...metadata }))
    .sort((left, right) => compareCodeUnits(left.receiptId, right.receiptId));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export class InMemoryPrivateReceiptStore implements PrivateReceiptStore {
  private readonly records = new Map<string, { receipt: PrivateInputReceipt; bytes: Uint8Array }>();
  private readonly batches = new Map<string, string[]>();

  async ingest(input: PrivateReceiptIngestInput): Promise<PrivateInputReceipt> {
    if (!safeIdentifier(input.ownerId)) throw new Error("Receipt owner is invalid");
    if (!isReceiptKind(input.kind)) throw new Error("Receipt kind is invalid");
    assertReceiptKindAndMime(input.kind, input.mimeType);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > PRIVATE_RECEIPT_MAX_BYTES[input.kind]) throw new Error("Receipt bytes are outside the allowed size");
    const actualHash = createHash("sha256").update(input.bytes).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(input.sha256) || actualHash !== input.sha256.toLowerCase()) throw new Error("Receipt SHA-256 does not match bytes");
    const receiptId = `receipt:${randomUUID()}`;
    const receipt: PrivateInputReceipt = {
      receiptId,
      ownerId: input.ownerId,
      kind: input.kind,
      mimeType: input.mimeType as PrivateReceiptMimeType,
      sha256: actualHash,
      byteLength: input.bytes.byteLength,
      retention: input.retention ?? "ephemeral",
      contentHandle: `content:${randomUUID()}`,
    };
    this.records.set(this.key(receipt.ownerId, receipt.receiptId), { receipt, bytes: new Uint8Array(input.bytes) });
    return structuredClone(receipt);
  }

  async get(ownerId: string, receiptId: string): Promise<PrivateInputReceipt | null> {
    const record = this.records.get(this.key(ownerId, receiptId));
    return record ? structuredClone(record.receipt) : null;
  }

  async bindBatchHash(ownerId: string, batchHash: string, receiptIds: readonly string[]): Promise<void> {
    if (!/^[a-f0-9]{64}$/i.test(batchHash) || receiptIds.length === 0 || new Set(receiptIds).size !== receiptIds.length || receiptIds.some((receiptId) => !this.records.has(this.key(ownerId, receiptId)))) throw new Error("Receipt batch binding is invalid");
    const receipts = receiptIds.map((receiptId) => this.records.get(this.key(ownerId, receiptId))!.receipt);
    if (receiptBatchHash(receipts) !== batchHash.toLowerCase()) throw new Error("Receipt batch hash does not match receipts");
    this.batches.set(`${ownerId}:${batchHash.toLowerCase()}`, [...receiptIds]);
  }

  async findByBatchHash(ownerId: string, batchHash: string): Promise<PrivateInputReceipt[]> {
    const receiptIds = this.batches.get(`${ownerId}:${batchHash.toLowerCase()}`) ?? [];
    const receipts = receiptIds.map((receiptId) => this.records.get(this.key(ownerId, receiptId))?.receipt).filter((receipt): receipt is PrivateInputReceipt => Boolean(receipt));
    return receiptBatchHash(receipts) === batchHash.toLowerCase() ? receipts.map((receipt) => structuredClone(receipt)) : [];
  }

  async read(ownerId: string, receiptId: string): Promise<Uint8Array | null> {
    const key = this.key(ownerId, receiptId);
    const record = this.records.get(key);
    if (!record) return null;
    const bytes = new Uint8Array(record.bytes);
    if (record.receipt.retention === "ephemeral") this.records.delete(key);
    return bytes;
  }

  async releaseOwnerRevision(ownerId: string, receiptId: string): Promise<void> {
    const key = this.key(ownerId, receiptId);
    const record = this.records.get(key);
    if (record?.receipt.retention === "owner_revision") this.records.delete(key);
  }

  private key(ownerId: string, receiptId: string): string {
    return `${ownerId}:${receiptId}`;
  }
}

export class PostgresPrivateReceiptStore implements PrivateReceiptStore {
  constructor(private readonly pool: PoolLike) {}

  async ingest(input: PrivateReceiptIngestInput): Promise<PrivateInputReceipt> {
    const validated = validateReceiptIngestInput(input);
    const receipt: PrivateInputReceipt = {
      receiptId: `receipt:${randomUUID()}`,
      ownerId: input.ownerId,
      kind: input.kind,
      mimeType: input.mimeType as PrivateReceiptMimeType,
      sha256: validated.sha256,
      byteLength: input.bytes.byteLength,
      retention: input.retention ?? "ephemeral",
      contentHandle: `content:${randomUUID()}`,
    };
    const result = await this.pool.query(
      `INSERT INTO private_input_receipts
       (owner_id, receipt_id, kind, mime_type, sha256, byte_length, retention, content_handle, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING owner_id, receipt_id, kind, mime_type, sha256, byte_length, retention, content_handle`,
      [receipt.ownerId, receipt.receiptId, receipt.kind, receipt.mimeType, receipt.sha256, receipt.byteLength, receipt.retention, receipt.contentHandle, Buffer.from(input.bytes)],
    );
    return mapPrivateReceipt(result);
  }

  async bindBatchHash(ownerId: string, batchHash: string, receiptIds: readonly string[]): Promise<void> {
    assertReceiptOwner(ownerId);
    assertHash(batchHash, "Receipt batch hash");
    if (receiptIds.length === 0 || new Set(receiptIds).size !== receiptIds.length || receiptIds.some((receiptId) => !safeIdentifier(receiptId))) {
      throw new Error("Receipt batch binding is invalid");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const receipts = await client.query(
        `SELECT owner_id, receipt_id, kind, mime_type, sha256, byte_length, retention, content_handle
         FROM private_input_receipts
         WHERE owner_id = $1 AND receipt_id = ANY($2::text[])
         FOR UPDATE`,
        [ownerId, [...receiptIds]],
      );
      if (receipts.rows.length !== receiptIds.length) throw new Error("Receipt batch binding is invalid");
      const canonical = receipts.rows.map((row) => mapPrivateReceipt({ rows: [row], rowCount: 1 })).sort((left, right) => compareCodeUnits(left.receiptId, right.receiptId));
      if (receiptBatchHash(canonical) !== batchHash.toLowerCase()) throw new Error("Receipt batch hash does not match receipts");
      await client.query(
        `INSERT INTO private_input_receipt_batches (owner_id, batch_hash, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (owner_id, batch_hash) DO UPDATE SET created_at = private_input_receipt_batches.created_at`,
        [ownerId, batchHash.toLowerCase()],
      );
      await client.query("DELETE FROM private_input_receipt_batch_items WHERE owner_id = $1 AND batch_hash = $2", [ownerId, batchHash.toLowerCase()]);
      for (const [ordinal, receiptId] of receiptIds.entries()) {
        await client.query(
          `INSERT INTO private_input_receipt_batch_items (owner_id, batch_hash, ordinal, receipt_id)
           VALUES ($1, $2, $3, $4)`,
          [ownerId, batchHash.toLowerCase(), ordinal, receiptId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      return failReceiptTransaction(client, error);
    } finally {
      if (client) client.release();
    }
  }

  async get(ownerId: string, receiptId: string): Promise<PrivateInputReceipt | null> {
    const result = await this.pool.query(
      `SELECT owner_id, receipt_id, kind, mime_type, sha256, byte_length, retention, content_handle
       FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2`,
      [ownerId, receiptId],
    );
    return result.rows[0] ? mapPrivateReceipt(result) : null;
  }

  async findByBatchHash(ownerId: string, batchHash: string): Promise<PrivateInputReceipt[]> {
    assertReceiptOwner(ownerId);
    assertHash(batchHash, "Receipt batch hash");
    const result = await this.pool.query(
      `SELECT r.owner_id, r.receipt_id, r.kind, r.mime_type, r.sha256, r.byte_length, r.retention, r.content_handle
       FROM private_input_receipt_batches b
       JOIN private_input_receipt_batch_items i ON i.owner_id = b.owner_id AND i.batch_hash = b.batch_hash
       JOIN private_input_receipts r ON r.owner_id = i.owner_id AND r.receipt_id = i.receipt_id
       WHERE b.owner_id = $1 AND b.batch_hash = $2 ORDER BY i.ordinal ASC`,
      [ownerId, batchHash.toLowerCase()],
    );
    const receipts = result.rows.map((row) => mapPrivateReceipt({ rows: [row], rowCount: 1 }));
    return receiptBatchHash(receipts) === batchHash.toLowerCase() ? receipts : [];
  }

  async read(ownerId: string, receiptId: string): Promise<Uint8Array | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT retention, content FROM private_input_receipts
         WHERE owner_id = $1 AND receipt_id = $2 FOR UPDATE`,
        [ownerId, receiptId],
      );
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const bytes = toBytes(result.rows[0].content);
      if (result.rows[0].retention === "ephemeral") {
        await client.query("DELETE FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2", [ownerId, receiptId]);
      }
      await client.query("COMMIT");
      return bytes;
    } catch (error) {
      return failReceiptTransaction(client, error);
    } finally {
      client.release();
    }
  }

  async releaseOwnerRevision(ownerId: string, receiptId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM private_input_receipts WHERE owner_id = $1 AND receipt_id = $2 AND retention = 'owner_revision'`,
      [ownerId, receiptId],
    );
  }
}

function validateReceiptIngestInput(input: PrivateReceiptIngestInput): { sha256: string } {
  assertReceiptOwner(input.ownerId);
  if (!isReceiptKind(input.kind)) throw new Error("Receipt kind is invalid");
  assertReceiptKindAndMime(input.kind, input.mimeType);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > PRIVATE_RECEIPT_MAX_BYTES[input.kind]) throw new Error("Receipt bytes are outside the allowed size");
  const actualHash = createHash("sha256").update(input.bytes).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(input.sha256) || actualHash !== input.sha256.toLowerCase()) throw new Error("Receipt SHA-256 does not match bytes");
  if (input.retention !== undefined && !isReceiptRetention(input.retention)) throw new Error("Receipt retention is invalid");
  return { sha256: actualHash };
}

function assertReceiptOwner(ownerId: string): void {
  if (!safeIdentifier(ownerId)) throw new Error("Receipt owner is invalid");
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} is invalid`);
}

function mapPrivateReceipt(result: QueryResult): PrivateInputReceipt {
  const row = result.rows[0];
  if (!row) throw new Error("Database row is missing a private receipt");
  return validatePrivateReceiptMetadata({
    receiptId: row.receipt_id,
    ownerId: row.owner_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    retention: row.retention,
    contentHandle: row.content_handle,
  });
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new Error("Database row contains invalid receipt content");
}

async function failReceiptTransaction(client: PoolClientLike, error: unknown): Promise<never> {
  try {
    await client.query("ROLLBACK");
  } finally {
    throw error;
  }
}

function assertReceiptMime(kind: PrivateReceiptKind, mimeType: PrivateReceiptMimeType): void {
  const allowed = kind === "typed_text" ? textMimes : kind === "pytorch_source" ? pytorchMimes : kind === "architecture_description" ? architectureMimes : sketchMimes;
  if (!allowed.has(mimeType)) throw new Error(`MIME type ${mimeType} is not allowed for ${kind}`);
}

function isReceiptKind(value: unknown): value is PrivateReceiptKind {
  return value === "typed_text" || value === "pytorch_source" || value === "architecture_description" || value === "sketch";
}

function isReceiptRetention(value: unknown): value is PrivateReceiptRetention {
  return value === "ephemeral" || value === "owner_revision";
}

function isReceiptMime(value: unknown): value is PrivateReceiptMimeType {
  return typeof value === "string" && ["text/plain", "text/markdown", "text/x-python", "application/json", "image/png", "image/jpeg", "image/webp"].includes(value);
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("PrivateInputReceipt contains unsupported fields");
}
