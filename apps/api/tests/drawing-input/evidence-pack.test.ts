import { describe, expect, it } from "vitest";
import { createEvidencePack, publicEvidencePack } from "../../src/drawing-input/evidence-pack.js";

const base = { sourceKind: "typed_declaration" as const, sourceHash: "a".repeat(64), locatorKind: "section" as const, locatorOrdinal: 1, excerptDigest: "b".repeat(64), summary: "node input", confidence: 1, semanticKey: "node:input" };

describe("EvidencePack", () => {
  it("deduplicates equivalent facts and produces stable canonical identities", () => {
    const first = createEvidencePack({ facts: [base, { ...base }, { ...base, locatorOrdinal: 2, summary: "node output", semanticKey: "node:output" }] });
    const second = createEvidencePack({ facts: [{ ...base, locatorOrdinal: 2, summary: "node output", semanticKey: "node:output" }, base] });
    expect(first.hash).toBe(second.hash);
    expect(first.facts).toHaveLength(2);
    expect(publicEvidencePack(first)).not.toHaveProperty("facts");
    expect(JSON.stringify(publicEvidencePack(first))).not.toContain("node input");
  });

  it("rejects conflicting semantics at one verified source locator", () => {
    expect(() => createEvidencePack({ facts: [base, { ...base, summary: "node output", semanticKey: "node:output" }] })).toThrow(/conflicting/i);
    expect(() => createEvidencePack({ facts: [base, { ...base, excerptDigest: "c".repeat(64) }] })).toThrow(/conflicting/i);
    expect(() => createEvidencePack({ facts: [base, { ...base, confidence: 0.5 }] })).toThrow(/conflicting/i);
    expect(() => createEvidencePack({ facts: [{ ...base, summary: "C:\\private\\model.py" }] })).toThrow(/unsafe/i);
  });

  it("canonicalizes digest casing before deduplication", () => {
    const upper = { ...base, sourceHash: base.sourceHash.toUpperCase(), excerptDigest: base.excerptDigest.toUpperCase() };
    const result = createEvidencePack({ facts: [base, upper] });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.evidence.sourceHash).toBe(base.sourceHash);
  });
});
