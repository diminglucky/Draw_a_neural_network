import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresPrivateReceiptStore, receiptBatchHash, type PrivateInputReceipt } from "../../src/drawing-input/private-receipt.js";
import type { PoolClientLike, PoolLike, QueryResult } from "../../src/postgres-store.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function receipt(ownerId: string, receiptId: string, retention: "ephemeral" | "owner_revision" = "ephemeral"): PrivateInputReceipt {
  return { receiptId, ownerId, kind: "typed_text", mimeType: "text/plain", sha256: "a".repeat(64), byteLength: 3, retention, contentHandle: `content:${receiptId}` };
}

function dbRow(value: PrivateInputReceipt): Record<string, unknown> {
  return {
    owner_id: value.ownerId,
    receipt_id: value.receiptId,
    kind: value.kind,
    mime_type: value.mimeType,
    sha256: value.sha256,
    byte_length: value.byteLength,
    retention: value.retention,
    content_handle: value.contentHandle,
  };
}

class FakeReceiptPool implements PoolLike {
  readonly queries: string[] = [];
  readonly records = new Map<string, { receipt: PrivateInputReceipt; content: Buffer }>();
  readonly batches = new Map<string, string[]>();
  private readonly client: PoolClientLike = {
    query: (text, values) => this.query(text, values),
    release: () => {},
  };

  async connect(): Promise<PoolClientLike> { return this.client; }
  async query(text: string, values: readonly unknown[] = []): Promise<QueryResult<any>> {
    this.queries.push(text.replace(/\s+/g, " ").trim());
    if (text.includes("INSERT INTO private_input_receipts")) {
      const [ownerId, receiptId, kind, mimeType, sha256, byteLength, retention, contentHandle, content] = values;
      const value = { receipt: { receiptId: String(receiptId), ownerId: String(ownerId), kind: kind as PrivateInputReceipt["kind"], mimeType: mimeType as PrivateInputReceipt["mimeType"], sha256: String(sha256), byteLength: Number(byteLength), retention: retention as PrivateInputReceipt["retention"], contentHandle: String(contentHandle) }, content: Buffer.from(content as Uint8Array) };
      this.records.set(`${ownerId}:${receiptId}`, value);
      return { rows: [dbRow(value.receipt)], rowCount: 1 };
    }
    if (text.includes("SELECT owner_id, receipt_id, kind")) {
      const key = `${values[0]}:${values[1]}`;
      const value = this.records.get(key);
      return { rows: value ? [dbRow(value.receipt)] : [], rowCount: value ? 1 : 0 };
    }
    if (text.includes("SELECT retention, content")) {
      const value = this.records.get(`${values[0]}:${values[1]}`);
      return { rows: value ? [{ retention: value.receipt.retention, content: value.content }] : [], rowCount: value ? 1 : 0 };
    }
    if (text.includes("DELETE FROM private_input_receipts")) {
      const key = `${values[0]}:${values[1]}`;
      const value = this.records.get(key);
      if (!text.includes("retention = 'owner_revision'") || value?.receipt.retention === "owner_revision") this.records.delete(key);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SELECT r.owner_id")) {
      const ids = this.batches.get(`${values[0]}:${values[1]}`) ?? [];
      return { rows: ids.flatMap((id) => { const value = this.records.get(`${values[0]}:${id}`)?.receipt; return value ? [dbRow(value)] : []; }), rowCount: ids.length };
    }
    if (text.includes("SELECT owner_id, receipt_id, kind, mime_type") && text.includes("ANY")) {
      const ownerId = String(values[0]);
      const ids = values[1] as string[];
      return { rows: ids.flatMap((id) => { const value = this.records.get(`${ownerId}:${id}`)?.receipt; return value ? [dbRow(value)] : []; }), rowCount: ids.length };
    }
    if (text.includes("INSERT INTO private_input_receipt_batches")) {
      this.batches.set(`${values[0]}:${values[1]}`, []);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO private_input_receipt_batch_items")) {
      const key = `${values[0]}:${values[1]}`;
      this.batches.set(key, [...(this.batches.get(key) ?? []), String(values[3])]);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("DELETE FROM private_input_receipt_batch_items")) {
      this.batches.set(`${values[0]}:${values[1]}`, []);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  async end(): Promise<void> {}
}

describe("PostgresPrivateReceiptStore", () => {
  it("round-trips metadata/content and consumes ephemeral content atomically", async () => {
    const pool = new FakeReceiptPool();
    const store = new PostgresPrivateReceiptStore(pool);
    const bytes = new TextEncoder().encode("abc");
    const created = await store.ingest({ ownerId: "owner-a", kind: "typed_text", mimeType: "text/plain", bytes, sha256: digest(bytes) });
    expect(await store.get("owner-b", created.receiptId)).toBeNull();
    expect(await store.get("owner-a", created.receiptId)).toEqual(created);
    expect(await store.read("owner-a", created.receiptId)).toEqual(bytes);
    expect(await store.read("owner-a", created.receiptId)).toBeNull();
    expect(pool.queries.some((query) => query === "BEGIN")).toBe(true);
    expect(pool.queries.some((query) => query.includes("FOR UPDATE"))).toBe(true);
  });

  it("keeps owner_revision content until explicit release and binds verified batches", async () => {
    const pool = new FakeReceiptPool();
    const store = new PostgresPrivateReceiptStore(pool);
    const bytes = new TextEncoder().encode("abc");
    const created = await store.ingest({ ownerId: "owner-a", kind: "typed_text", mimeType: "text/plain", bytes, sha256: digest(bytes), retention: "owner_revision" });
    const batchHash = receiptBatchHash([created]);
    await store.bindBatchHash("owner-a", batchHash, [created.receiptId]);
    expect(await store.findByBatchHash("owner-a", batchHash)).toEqual([created]);
    expect(await store.read("owner-a", created.receiptId)).toEqual(bytes);
    expect(await store.get("owner-a", created.receiptId)).toEqual(created);
    await store.releaseOwnerRevision("owner-a", created.receiptId);
    expect(await store.get("owner-a", created.receiptId)).toBeNull();
  });

  it("rejects a batch hash that does not match the owner-scoped receipts", async () => {
    const pool = new FakeReceiptPool();
    const store = new PostgresPrivateReceiptStore(pool);
    const bytes = new TextEncoder().encode("abc");
    const created = await store.ingest({ ownerId: "owner-a", kind: "typed_text", mimeType: "text/plain", bytes, sha256: digest(bytes) });
    await expect(store.bindBatchHash("owner-a", "b".repeat(64), [created.receiptId])).rejects.toThrow(/batch hash/i);
  });
});
