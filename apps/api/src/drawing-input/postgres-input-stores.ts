import type { PoolLike } from "../postgres-store.js";
import { assertEvidencePack, type EvidencePack } from "./evidence-pack.js";
import type { EvidencePackStore } from "./intent.js";
import { digestLocalProposal, type LocalProposalStore } from "./structural-harness.js";

const HASH = /^[a-f0-9]{64}$/i;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PROPOSAL_BYTES = 1_048_576;

export class PostgresEvidencePackStore implements EvidencePackStore {
  constructor(private readonly pool: PoolLike) {}

  async put(ownerId: string, pack: EvidencePack): Promise<void> {
    assertOwner(ownerId);
    const validated = assertEvidencePack(pack);
    await this.pool.query(
      `INSERT INTO drawing_evidence_packs (owner_id, evidence_pack_hash, pack, created_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (owner_id, evidence_pack_hash) DO NOTHING`,
      [ownerId, validated.hash, JSON.stringify(validated)],
    );
  }

  async get(ownerId: string, hash: string): Promise<EvidencePack | null> {
    assertOwner(ownerId);
    assertHash(hash, "EvidencePack hash");
    const result = await this.pool.query(
      `SELECT pack FROM drawing_evidence_packs WHERE owner_id = $1 AND evidence_pack_hash = $2`,
      [ownerId, hash.toLowerCase()],
    );
    if (!result.rows[0]) return null;
    return assertEvidencePack(parseJson(result.rows[0].pack, "EvidencePack"));
  }
}

export class PostgresLocalProposalStore implements LocalProposalStore {
  constructor(private readonly pool: PoolLike) {}

  async put(ownerId: string, proposalHash: string, proposal: unknown): Promise<void> {
    assertOwner(ownerId);
    assertHash(proposalHash, "Local proposal hash");
    const encoded = JSON.stringify(proposal);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_PROPOSAL_BYTES) throw new Error("Local proposal is too large");
    if (digestLocalProposal(proposal) !== proposalHash.toLowerCase()) throw new Error("Local proposal hash does not match proposal");
    await this.pool.query(
      `INSERT INTO drawing_local_proposals (owner_id, proposal_hash, proposal, created_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (owner_id, proposal_hash) DO NOTHING`,
      [ownerId, proposalHash.toLowerCase(), encoded],
    );
  }

  async get(ownerId: string, proposalHash: string): Promise<unknown | null> {
    assertOwner(ownerId);
    assertHash(proposalHash, "Local proposal hash");
    const result = await this.pool.query(
      `SELECT proposal FROM drawing_local_proposals WHERE owner_id = $1 AND proposal_hash = $2`,
      [ownerId, proposalHash.toLowerCase()],
    );
    if (!result.rows[0]) return null;
    const proposal = parseJson(result.rows[0].proposal, "Local proposal");
    if (digestLocalProposal(proposal) !== proposalHash.toLowerCase()) throw new Error("Stored local proposal hash does not match proposal");
    return structuredClone(proposal);
  }
}

function parseJson(value: unknown, label: string): any {
  try {
    return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  } catch {
    throw new Error(`${label} JSON is invalid`);
  }
}

function assertOwner(value: string): void {
  if (!OWNER.test(value)) throw new Error("Input store owner is invalid");
}

function assertHash(value: string, label: string): void {
  if (!HASH.test(value)) throw new Error(`${label} is invalid`);
}
