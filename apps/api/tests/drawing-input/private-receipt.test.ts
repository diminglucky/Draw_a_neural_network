import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryPrivateReceiptStore, PRIVATE_RECEIPT_MAX_BYTES } from "../../src/drawing-input/private-receipt.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("private input receipts", () => {
  it("validates kind, MIME, size, and digest before retaining bytes", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from("class N(nn.Module):\n", "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes, sha256: digest(bytes), retention: "owner_revision" });

    expect(receipt).toMatchObject({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", byteLength: bytes.length, retention: "owner_revision" });
    expect(JSON.stringify(receipt)).not.toContain("class N");
    await expect(store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "image/png", bytes, sha256: digest(bytes) })).rejects.toThrow(/MIME/i);
    await expect(store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes, sha256: "0".repeat(64) })).rejects.toThrow(/SHA/i);
    await expect(store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes: new Uint8Array(PRIVATE_RECEIPT_MAX_BYTES.pytorch_source + 1), sha256: "0".repeat(64) })).rejects.toThrow(/size/i);
  });

  it("enforces ephemeral and owner-revision retention", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from("private", "utf8");
    const ephemeral = await store.ingest({ ownerId: "owner-1", kind: "typed_text", mimeType: "text/plain", bytes, sha256: digest(bytes), retention: "ephemeral" });
    expect(Array.from(await store.read("owner-1", ephemeral.receiptId) ?? [])).toEqual(Array.from(bytes));
    expect(await store.read("owner-1", ephemeral.receiptId)).toBeNull();

    const retained = await store.ingest({ ownerId: "owner-1", kind: "typed_text", mimeType: "text/plain", bytes, sha256: digest(bytes), retention: "owner_revision" });
    expect(Array.from(await store.read("owner-1", retained.receiptId) ?? [])).toEqual(Array.from(bytes));
    expect(Array.from(await store.read("owner-1", retained.receiptId) ?? [])).toEqual(Array.from(bytes));
    await store.releaseOwnerRevision("owner-1", retained.receiptId);
    expect(await store.get("owner-1", retained.receiptId)).toBeNull();
  });
});
