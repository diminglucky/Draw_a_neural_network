import { createHash } from "node:crypto";
import type { StaticPyTorchAnalysis } from "../static-pytorch-source-analyzer.js";
import { compareCodeUnits } from "../stable-string-order.js";
import { canonicalJson } from "../analysis-plan-snapshot.js";

export type EvidenceSourceKind = "static_analysis" | "typed_declaration" | "architecture_fact" | "sketch_observation";
export type EvidenceLocatorKind = "section" | "fact" | "observation" | "derived";

export interface PublicEvidenceReference {
  evidenceId: `evidence:e:${number}`;
  sourceKind: EvidenceSourceKind;
  sourceHash: string;
  locatorKind: EvidenceLocatorKind;
  locatorOrdinal: number;
  excerptDigest: string;
}

export interface EvidenceFact {
  localFactRef: `fact:f:${number}`;
  sourceKind: EvidenceSourceKind;
  summary: string;
  confidence: number | null;
  semanticKey: string;
  evidence: PublicEvidenceReference;
}

export interface EvidenceUnresolved {
  code: string;
  severity: "blocking" | "warning";
  summary: string;
  sourceKind: EvidenceSourceKind;
  sourceHash: string;
  locatorKind: EvidenceLocatorKind;
  locatorOrdinal: number;
}

export interface EvidencePack {
  version: 1;
  hash: string;
  facts: readonly EvidenceFact[];
  unresolved: readonly EvidenceUnresolved[];
}

export interface EvidenceFactInput {
  sourceKind: EvidenceSourceKind;
  sourceHash: string;
  locatorKind: EvidenceLocatorKind;
  locatorOrdinal: number;
  excerptDigest: string;
  summary: string;
  confidence: number | null;
  semanticKey: string;
}

const digestPattern = /^[a-f0-9]{64}$/i;
const unsafeText = /[\r\n]|(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:https?:\/\/)|(?:\b(?:api[_-]?key|bearer|password|token|credential|secret)\b)|(?:<\/?(?:svg|xml|script|visio)\b)|(?:\b(?:com|vba|shell|exec|eval)\b)/i;

export function createEvidencePack(input: { facts: readonly EvidenceFactInput[]; unresolved?: readonly EvidenceUnresolved[] }): EvidencePack {
  const byLocator = new Map<string, EvidenceFactInput>();
  for (const fact of input.facts) {
    validateFactInput(fact);
    const normalized = {
      ...fact,
      sourceHash: fact.sourceHash.toLowerCase(),
      excerptDigest: fact.excerptDigest.toLowerCase(),
      summary: fact.summary.trim(),
      semanticKey: fact.semanticKey.trim(),
    };
    const location = `${normalized.sourceKind}:${normalized.sourceHash}:${normalized.locatorKind}:${normalized.locatorOrdinal}`;
    const existing = byLocator.get(location);
    if (existing && (existing.excerptDigest !== normalized.excerptDigest || existing.semanticKey !== normalized.semanticKey || existing.summary !== normalized.summary || existing.confidence !== normalized.confidence)) throw new Error("EvidencePack contains conflicting facts at one source locator");
    if (!existing) byLocator.set(location, normalized);
  }
  const canonicalFacts = [...byLocator.values()].sort(compareFacts);
  const evidence = canonicalFacts.map((fact, index) => ({
    ...fact,
    localFactRef: `fact:f:${index + 1}` as `fact:f:${number}`,
    evidence: {
      evidenceId: `evidence:e:${index + 1}` as `evidence:e:${number}`,
      sourceKind: fact.sourceKind,
      sourceHash: fact.sourceHash.toLowerCase(),
      locatorKind: fact.locatorKind,
      locatorOrdinal: fact.locatorOrdinal,
      excerptDigest: fact.excerptDigest.toLowerCase(),
    },
  }));
  const unresolved = (input.unresolved ?? []).map(validateUnresolved).sort((left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right)));
  const packBody = { version: 1 as const, facts: evidence, unresolved };
  return { ...packBody, hash: createHash("sha256").update(canonicalJson(packBody), "utf8").digest("hex") };
}

export function publicEvidencePack(value: EvidencePack): { version: 1; hash: string; evidence: PublicEvidenceReference[]; blockingCount: number } {
  const pack = assertEvidencePack(value);
  return {
    version: 1,
    hash: pack.hash,
    evidence: pack.facts.map((fact) => ({ ...fact.evidence })),
    blockingCount: pack.unresolved.filter((item) => item.severity === "blocking").length,
  };
}

export function evidencePackProviderFacts(value: EvidencePack): Array<{ localFactRef: `fact:f:${number}`; sourceKind: EvidenceSourceKind; summary: string; confidence: number | null }> {
  const pack = assertEvidencePack(value);
  return pack.facts.map(({ localFactRef, sourceKind, summary, confidence }) => ({ localFactRef, sourceKind, summary, confidence }));
}

export function mergeEvidencePacks(packs: readonly EvidencePack[]): EvidencePack {
  return createEvidencePack({
    facts: packs.flatMap((pack) => pack.facts.map((fact) => ({
      sourceKind: fact.sourceKind,
      sourceHash: fact.evidence.sourceHash,
      locatorKind: fact.evidence.locatorKind,
      locatorOrdinal: fact.evidence.locatorOrdinal,
      excerptDigest: fact.evidence.excerptDigest,
      summary: fact.summary,
      confidence: fact.confidence,
      semanticKey: fact.semanticKey,
    }))),
    unresolved: packs.flatMap((pack) => pack.unresolved),
  });
}

export function evidencePackFromStaticAnalysis(analysis: StaticPyTorchAnalysis): EvidencePack {
  const structuralFacts = analysis.evidence.facts.slice().sort((left, right) => left.id.localeCompare(right.id));
  const facts = structuralFacts.flatMap((fact, index) => fact.evidenceRefs.map((reference) => ({
    sourceKind: "static_analysis" as const,
    sourceHash: reference.sourceSha256,
    locatorKind: "fact" as const,
    locatorOrdinal: reference.locator.kind === "code" ? reference.locator.startLine * 1000 + index : index + 1,
    excerptDigest: reference.excerptDigest,
    summary: structuralSummary(fact.kind, fact.subject, fact.payload),
    confidence: fact.decisionConfidence,
    semanticKey: `${fact.kind}:${JSON.stringify(fact.subject)}:${JSON.stringify(fact.payload)}`,
  })));
  const unresolved = analysis.unresolved.map((item) => ({
    code: item.code,
    severity: item.severity,
    summary: item.message,
    sourceKind: "static_analysis" as const,
    sourceHash: analysis.sourceSha256,
    locatorKind: "fact" as const,
    locatorOrdinal: item.locator.kind === "code" ? item.locator.startLine : 1,
  }));
  return createEvidencePack({ facts, unresolved });
}

export function assertEvidencePack(value: EvidencePack): EvidencePack {
  if (!value || value.version !== 1 || !digestPattern.test(value.hash) || !Array.isArray(value.facts) || !Array.isArray(value.unresolved)) throw new Error("EvidencePack is invalid");
  const facts = value.facts.map((fact) => {
    if (!/^fact:f:[0-9]+$/.test(fact.localFactRef) || !isEvidenceSourceKind(fact.sourceKind) || typeof fact.summary !== "string" || typeof fact.semanticKey !== "string") throw new Error("EvidencePack fact is invalid");
    validateFactInput({ sourceKind: fact.sourceKind, sourceHash: fact.evidence.sourceHash, locatorKind: fact.evidence.locatorKind, locatorOrdinal: fact.evidence.locatorOrdinal, excerptDigest: fact.evidence.excerptDigest, summary: fact.summary, confidence: fact.confidence, semanticKey: fact.semanticKey });
    if (fact.evidence.evidenceId !== `evidence:e:${fact.localFactRef.slice("fact:f:".length)}`) throw new Error("EvidencePack evidence identity is invalid");
    return fact;
  });
  const body = { version: 1 as const, facts, unresolved: value.unresolved.map(validateUnresolved) };
  const hash = createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
  if (hash !== value.hash) throw new Error("EvidencePack hash does not match its contents");
  const canonical = createEvidencePack({
    facts: facts.map((fact) => ({
      sourceKind: fact.sourceKind,
      sourceHash: fact.evidence.sourceHash,
      locatorKind: fact.evidence.locatorKind,
      locatorOrdinal: fact.evidence.locatorOrdinal,
      excerptDigest: fact.evidence.excerptDigest,
      summary: fact.summary,
      confidence: fact.confidence,
      semanticKey: fact.semanticKey,
    })),
    unresolved: body.unresolved,
  });
  if (canonicalJson(canonical.facts) !== canonicalJson(facts) || canonicalJson(canonical.unresolved) !== canonicalJson(body.unresolved) || canonical.hash !== value.hash) throw new Error("EvidencePack is not canonically ordered or deduplicated");
  return value;
}

function validateFactInput(fact: EvidenceFactInput): void {
  if (!digestPattern.test(fact.sourceHash) || !digestPattern.test(fact.excerptDigest) || !Number.isSafeInteger(fact.locatorOrdinal) || fact.locatorOrdinal < 1 || fact.locatorOrdinal > 1_000_000_000 || typeof fact.semanticKey !== "string" || !fact.semanticKey.trim() || fact.semanticKey.length > 512 || typeof fact.summary !== "string" || !fact.summary.trim() || fact.summary.length > 240 || unsafeText.test(fact.summary) || unsafeText.test(fact.semanticKey) || (fact.confidence !== null && (typeof fact.confidence !== "number" || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1))) throw new Error("Evidence fact is invalid or unsafe");
}

function validateUnresolved(item: EvidenceUnresolved): EvidenceUnresolved {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(item.code) || (item.severity !== "blocking" && item.severity !== "warning") || !digestPattern.test(item.sourceHash) || !Number.isSafeInteger(item.locatorOrdinal) || item.locatorOrdinal < 1 || typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > 240 || unsafeText.test(item.summary)) throw new Error("Evidence unresolved item is invalid");
  return { ...item, sourceHash: item.sourceHash.toLowerCase(), summary: item.summary.trim() };
}

function compareFacts(left: EvidenceFactInput, right: EvidenceFactInput): number {
  return compareCodeUnits(`${left.sourceKind}\u0000${left.sourceHash.toLowerCase()}\u0000${left.locatorKind}\u0000${left.locatorOrdinal}\u0000${left.excerptDigest.toLowerCase()}\u0000${left.semanticKey}`, `${right.sourceKind}\u0000${right.sourceHash.toLowerCase()}\u0000${right.locatorKind}\u0000${right.locatorOrdinal}\u0000${right.excerptDigest.toLowerCase()}\u0000${right.semanticKey}`);
}

function structuralSummary(kind: string, subject: unknown, payload: unknown): string {
  const summary = `${kind} ${JSON.stringify(subject)} ${JSON.stringify(payload)}`;
  if (summary.length > 240 || unsafeText.test(summary)) throw new Error("Static evidence summary is unsafe");
  return summary;
}

function isEvidenceSourceKind(value: unknown): value is EvidenceSourceKind {
  return value === "static_analysis" || value === "typed_declaration" || value === "architecture_fact" || value === "sketch_observation";
}
