import type { PoolLike } from "../postgres-store.js";
import { parseUniversalGraphSpec, type UniversalGraphSpec } from "../universal-graph-spec.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "../publication-visual-plan.js";
import { digestDrawingArtifact, type DrawingArtifactStore } from "./drawing-artifacts.js";

const HASH = /^[a-f0-9]{64}$/i;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_BYTES = 4 * 1_048_576;

export class PostgresDrawingArtifactStore implements DrawingArtifactStore {
  constructor(private readonly pool: PoolLike) {}

  async putUgs(ownerId: string, hash: string, ugs: UniversalGraphSpec): Promise<void> {
    const parsed = parseUniversalGraphSpec(ugs);
    await this.put(ownerId, "ugs", hash, parsed, digestDrawingArtifact(parsed));
  }

  async getUgs(ownerId: string, hash: string): Promise<UniversalGraphSpec | null> {
    const value = await this.get(ownerId, "ugs", hash);
    return value === null ? null : parseUniversalGraphSpec(value);
  }

  async putPvp(ownerId: string, hash: string, pvp: PublicationVisualPlan): Promise<void> {
    const parsed = parsePublicationVisualPlan(pvp);
    await this.put(ownerId, "pvp", hash, parsed, parsed.identity.canonicalHash);
  }

  async getPvp(ownerId: string, hash: string): Promise<PublicationVisualPlan | null> {
    const value = await this.get(ownerId, "pvp", hash);
    return value === null ? null : parsePublicationVisualPlan(value);
  }

  async putQa(ownerId: string, hash: string, qa: unknown): Promise<void> {
    await this.put(ownerId, "qa", hash, qa, digestDrawingArtifact(qa));
  }

  async getQa(ownerId: string, hash: string): Promise<unknown | null> {
    return this.get(ownerId, "qa", hash);
  }

  private async put(ownerId: string, kind: string, hash: string, value: unknown, expectedHash: string): Promise<void> {
    assertOwner(ownerId);
    assertHash(hash, `${kind} hash`);
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`${kind} hash does not match its contents`);
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > MAX_BYTES) throw new Error(`${kind} artifact is too large`);
    await this.pool.query(
      `INSERT INTO drawing_artifacts (owner_id, artifact_kind, artifact_hash, artifact, created_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (owner_id, artifact_kind, artifact_hash) DO NOTHING`,
      [ownerId, kind, hash.toLowerCase(), encoded],
    );
  }

  private async get(ownerId: string, kind: string, hash: string): Promise<unknown | null> {
    assertOwner(ownerId);
    assertHash(hash, `${kind} hash`);
    const result = await this.pool.query(
      `SELECT artifact FROM drawing_artifacts WHERE owner_id = $1 AND artifact_kind = $2 AND artifact_hash = $3`,
      [ownerId, kind, hash.toLowerCase()],
    );
    if (!result.rows[0]) return null;
    const value = parseJson(result.rows[0].artifact, kind);
    const expectedHash = kind === "pvp" && value && typeof value === "object" && !Array.isArray(value) && "identity" in value
      ? (value as { identity?: { canonicalHash?: unknown } }).identity?.canonicalHash
      : digestDrawingArtifact(value);
    if (typeof expectedHash !== "string" || expectedHash.toLowerCase() !== hash.toLowerCase()) throw new Error(`Stored ${kind} hash does not match its contents`);
    return structuredClone(value);
  }
}

function parseJson(value: unknown, label: string): any {
  try { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }
  catch { throw new Error(`${label} artifact JSON is invalid`); }
}

function assertOwner(value: string): void { if (!OWNER.test(value)) throw new Error("Drawing artifact owner is invalid"); }
function assertHash(value: string, label: string): void { if (!HASH.test(value)) throw new Error(`${label} is invalid`); }
