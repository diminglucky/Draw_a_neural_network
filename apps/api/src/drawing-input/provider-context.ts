import { createHash } from "node:crypto";
import type { EvidencePack } from "./evidence-pack.js";
import { evidencePackProviderFacts } from "./evidence-pack.js";

export interface ProviderContextReference {
  contextId: string;
  runId: string;
  ownerId: string;
  deviceId: string;
  expectedRevision: number;
  evidencePackHash: string;
  allowedPurpose: "architecture_interpretation";
  expiresAt: string;
}

export interface ProviderContextPayload {
  version: 1;
  allowedPurpose: "architecture_interpretation";
  facts: readonly {
    localFactRef: `fact:f:${number}`;
    sourceKind: "static_analysis" | "typed_declaration" | "architecture_fact" | "sketch_observation";
    summary: string;
    confidence: number | null;
  }[];
  maxCharacters: number;
}

export function createProviderContextReference(input: Omit<ProviderContextReference, "contextId" | "expiresAt"> & { expiresAt?: string }): ProviderContextReference {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("Provider context revision is invalid");
  const scope = `${input.ownerId}\u0000${input.deviceId}\u0000${input.runId}\u0000${input.expectedRevision}\u0000${input.evidencePackHash}`;
  return {
    ...input,
    contextId: `context:${createHash("sha256").update(scope, "utf8").digest("hex").slice(0, 32)}`,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

export function providerContextPayload(reference: ProviderContextReference, pack: EvidencePack, maxCharacters = 8_000): ProviderContextPayload {
  if (reference.evidencePackHash !== pack.hash) throw new Error("Provider context does not match the EvidencePack");
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 256 || maxCharacters > 100_000) throw new Error("Provider context character budget is invalid");
  let used = 0;
  const facts = evidencePackProviderFacts(pack).filter((fact) => {
    const next = used + fact.summary.length;
    if (next > maxCharacters) return false;
    used = next;
    return true;
  });
  return { version: 1, allowedPurpose: "architecture_interpretation", facts, maxCharacters };
}
