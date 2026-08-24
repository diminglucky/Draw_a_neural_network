import { createHash } from "node:crypto";
import { parseUniversalGraphSpec, type UniversalGraphSpec } from "../universal-graph-spec.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "../publication-visual-plan.js";

export type DrawingArtifactKind = "ugs" | "pvp" | "qa";

export interface DrawingArtifactStore {
  putUgs(ownerId: string, hash: string, ugs: UniversalGraphSpec): Promise<void>;
  getUgs(ownerId: string, hash: string): Promise<UniversalGraphSpec | null>;
  putPvp(ownerId: string, hash: string, pvp: PublicationVisualPlan): Promise<void>;
  getPvp(ownerId: string, hash: string): Promise<PublicationVisualPlan | null>;
  putQa(ownerId: string, hash: string, qa: unknown): Promise<void>;
  getQa(ownerId: string, hash: string): Promise<unknown | null>;
}

export class InMemoryDrawingArtifactStore implements DrawingArtifactStore {
  private readonly artifacts = new Map<string, unknown>();

  async putUgs(ownerId: string, hash: string, ugs: UniversalGraphSpec): Promise<void> {
    this.put(ownerId, "ugs", hash, parseUniversalGraphSpec(ugs), digestJson(ugs));
  }

  async getUgs(ownerId: string, hash: string): Promise<UniversalGraphSpec | null> {
    const value = this.get(ownerId, "ugs", hash);
    return value === null ? null : parseUniversalGraphSpec(value);
  }

  async putPvp(ownerId: string, hash: string, pvp: PublicationVisualPlan): Promise<void> {
    const parsed = parsePublicationVisualPlan(pvp);
    this.put(ownerId, "pvp", hash, parsed, parsed.identity.canonicalHash);
  }

  async getPvp(ownerId: string, hash: string): Promise<PublicationVisualPlan | null> {
    const value = this.get(ownerId, "pvp", hash);
    return value === null ? null : parsePublicationVisualPlan(value);
  }

  async putQa(ownerId: string, hash: string, qa: unknown): Promise<void> {
    this.put(ownerId, "qa", hash, qa, digestJson(qa));
  }

  async getQa(ownerId: string, hash: string): Promise<unknown | null> {
    const value = this.get(ownerId, "qa", hash);
    return value === null ? null : structuredClone(value);
  }

  private put(ownerId: string, kind: DrawingArtifactKind, hash: string, value: unknown, expectedHash: string): void {
    assertOwner(ownerId);
    assertHash(hash, `${kind} hash`);
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`${kind} hash does not match its contents`);
    this.artifacts.set(key(ownerId, kind, hash), structuredClone(value));
  }

  private get(ownerId: string, kind: DrawingArtifactKind, hash: string): unknown | null {
    assertOwner(ownerId);
    assertHash(hash, `${kind} hash`);
    const value = this.artifacts.get(key(ownerId, kind, hash));
    return value === undefined ? null : structuredClone(value);
  }
}

export function digestDrawingArtifact(value: unknown): string {
  return digestJson(value);
}

function key(ownerId: string, kind: DrawingArtifactKind, hash: string): string {
  return `${ownerId}\u0000${kind}\u0000${hash.toLowerCase()}`;
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Drawing artifacts do not permit non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Drawing artifacts require plain JSON values");
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function assertOwner(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Drawing artifact owner is invalid");
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} is invalid`);
}
