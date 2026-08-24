import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEvidencePack, type EvidencePack } from "../../src/drawing-input/evidence-pack.js";
import { PostgresEvidencePackStore, PostgresLocalProposalStore } from "../../src/drawing-input/postgres-input-stores.js";
import { digestLocalProposal } from "../../src/drawing-input/structural-harness.js";
import type { PoolLike, QueryResult } from "../../src/postgres-store.js";

class FakeInputArtifactPool implements PoolLike {
  readonly packs = new Map<string, EvidencePack>();
  readonly proposals = new Map<string, unknown>();

  async connect(): Promise<never> { throw new Error("Transactions are not expected for input artifacts"); }
  async end(): Promise<void> {}

  async query(text: string, values: readonly unknown[] = []): Promise<QueryResult<any>> {
    if (text.includes("INSERT INTO drawing_evidence_packs")) {
      const key = `${values[0]}:${values[1]}`;
      if (!this.packs.has(key)) this.packs.set(key, reorderJsonKeys(JSON.parse(String(values[2])) as EvidencePack));
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SELECT pack FROM drawing_evidence_packs")) {
      const pack = this.packs.get(`${values[0]}:${values[1]}`);
      return { rows: pack ? [{ pack }] : [], rowCount: pack ? 1 : 0 };
    }
    if (text.includes("INSERT INTO drawing_local_proposals")) {
      const hash = `${String(values[0])}:${String(values[1])}`;
      if (!this.proposals.has(hash)) this.proposals.set(hash, JSON.parse(String(values[2])));
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SELECT proposal FROM drawing_local_proposals")) {
      const proposal = this.proposals.get(`${String(values[0])}:${String(values[1])}`);
      return { rows: proposal === undefined ? [] : [{ proposal }], rowCount: proposal === undefined ? 0 : 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

function reorderJsonKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderJsonKeys) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, reorderJsonKeys(child)])) as T;
  }
  return value;
}

function pack(): EvidencePack {
  const sourceHash = createHash("sha256").update("source", "utf8").digest("hex");
  return createEvidencePack({ facts: [{ sourceKind: "architecture_fact", sourceHash, locatorKind: "section", locatorOrdinal: 1, excerptDigest: sourceHash, summary: "input declaration", confidence: 1, semanticKey: "node:input" }] });
}

describe("durable drawing input artifact stores", () => {
  it("keeps EvidencePack owner-scoped and validates its canonical hash on read", async () => {
    const pool = new FakeInputArtifactPool();
    const store = new PostgresEvidencePackStore(pool);
    const value = pack();
    await store.put("owner-a", value);
    await expect(store.get("owner-b", value.hash)).resolves.toBeNull();
    await expect(store.get("owner-a", value.hash)).resolves.toEqual(value);
    pool.packs.set(`owner-a:${value.hash}`, { ...value, hash: "f".repeat(64) });
    await expect(store.get("owner-a", value.hash)).rejects.toThrow(/hash/i);
  });

  it("stores and revalidates Provider-local proposal content by hash", async () => {
    const pool = new FakeInputArtifactPool();
    const store = new PostgresLocalProposalStore(pool);
    const proposal = { version: 2, nodes: [], ports: [], edges: [], unresolved: [] };
    const hash = digestLocalProposal(proposal);
    await store.put("owner-a", hash, proposal);
    await expect(store.get("owner-a", hash)).resolves.toEqual(proposal);
    pool.proposals.set(`owner-a:${hash}`, { ...proposal, version: 1 });
    await expect(store.get("owner-a", hash)).rejects.toThrow(/hash/i);
    await expect(store.put("owner-a", "a".repeat(64), proposal)).rejects.toThrow(/hash/i);
  });
});
