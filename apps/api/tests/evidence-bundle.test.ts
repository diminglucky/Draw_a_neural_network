import { describe, expect, it } from "vitest";
import { parseEvidenceBundle, publicEvidenceSummary } from "../src/evidence-bundle.js";

describe("evidence bundle", () => {
  it("accepts bounded facts linked to known source IDs", () => {
    const bundle = parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-code-1", kind: "code", name: "model.py" }],
      facts: [{
        id: "fact-conv", subject: "block-1", predicate: "op", value: "conv2d", confidence: 0.96,
        source: { sourceId: "source-code-1", kind: "code", locator: "line:12", excerpt: "self.conv = nn.Conv2d(3, 64, 3)" },
      }],
    });
    expect(bundle.facts).toHaveLength(1);
  });

  it("rejects a fact that references an unknown attachment source", () => {
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [],
      facts: [{ id: "f", subject: "x", predicate: "op", value: "conv2d", confidence: 0.9, source: { sourceId: "missing", kind: "code", locator: null, excerpt: null } }],
    })).toThrow(/unknown source/i);
  });

  it("does not expose excerpts or locators in the public summary", () => {
    const bundle = parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-code-1", kind: "code", name: "private.py" }],
      facts: [{ id: "f", subject: "x", predicate: "op", value: "conv2d", confidence: 0.9, source: { sourceId: "source-code-1", kind: "code", locator: "line:99", excerpt: "secret source line" } }],
    });
    expect(JSON.stringify(publicEvidenceSummary(bundle))).not.toContain("secret source line");
    expect(JSON.stringify(publicEvidenceSummary(bundle))).not.toContain("line:99");
  });

  it("rejects a fact whose source kind does not match", () => {
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "model.py" }],
      facts: [{ id: "f", subject: "x", predicate: "op", value: "conv2d", confidence: 0.9, source: { sourceId: "source-1", kind: "text", locator: null, excerpt: null } }],
    })).toThrow(/source kind/i);
  });

  it("rejects confidence outside the bounded range", () => {
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "model.py" }],
      facts: [{ id: "f", subject: "x", predicate: "op", value: "conv2d", confidence: 1.01, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } }],
    })).toThrow(/confidence/i);
  });

  it("validates bounded unresolved candidates and fact references", () => {
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [],
      facts: [],
      unresolved: [{ id: "u", question: "merge?", severity: "blocking", candidateValues: ["add", "add"], evidenceIds: ["missing"] }],
    })).toThrow(/unique|unknown evidence/i);

    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [],
      facts: [],
      unresolved: [{ id: "u", question: "merge?", severity: "blocking", candidateValues: ["add"], evidenceIds: [] }],
    })).toThrow(/2–8|candidate/i);
  });

  it("rejects collections beyond their schema limits", () => {
    expect(() => parseEvidenceBundle({ version: 1, sources: Array.from({ length: 7 }, (_, index) => ({ id: `s-${index}`, kind: "code", name: "model.py" })), facts: [] })).toThrow();
    expect(() => parseEvidenceBundle({ version: 1, sources: [], facts: [{ id: "f", subject: "x", predicate: "p", value: "v", confidence: 0, source: { sourceId: "missing", kind: "code", locator: "x".repeat(257), excerpt: null } }] })).toThrow();
  });

  it("rejects oversized and sensitive fact values before storage", () => {
    const source = [{ id: "source-1", kind: "code", name: "model.py" }];
    const fact = (value: unknown) => ({ version: 1, sources: source, facts: [{ id: "f", subject: "x", predicate: "value", value, confidence: 0.9, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } }] });

    expect(() => parseEvidenceBundle(fact("x".repeat(513)))).toThrow();
    expect(() => parseEvidenceBundle(fact(Array.from({ length: 33 }, () => "x")))).toThrow();
    expect(() => parseEvidenceBundle(fact(["x".repeat(129)]))).toThrow();

    for (const value of [
      "data:text/plain,secret",
      "data:image/png;base64,AAAA",
      "-----BEGIN PRIVATE KEY-----",
      "sk-proj-123456",
      "apiKey=secret",
      "{\"apiKey\":\"secret\"}",
      "<svg><path /></svg>",
      "<?xml version=\"1.0\"?>",
      "<VisioDocument><Shape /></VisioDocument>",
      "VBA Shell(\"cmd.exe\")",
      "Visio COM Documents.Add",
      "python os.system('whoami')",
      "javascript:alert(1)",
      "geometry command: MoveTo(10, 20)",
    ]) {
      expect(() => parseEvidenceBundle(fact(value)), value).toThrow();
    }
  });

  it("accepts ordinary structural fact values", () => {
    const source = [{ id: "source-1", kind: "code", name: "model.py" }];
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: source,
      facts: [
        { id: "f1", subject: "block-1", predicate: "shape", value: "tensor dimensions [3, 224, 224]", confidence: 0.9, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } },
        { id: "f2", subject: "classifier", predicate: "class_count", value: 1000, confidence: 0.9, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } },
      ],
    })).not.toThrow();
  });

  it("rejects duplicate and oversized unresolved evidence IDs", () => {
    const duplicateIds = Array.from({ length: 256 }, (_, index) => `fact-${index}`);
    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "model.py" }],
      facts: [{ id: "same", subject: "x", predicate: "op", value: "conv2d", confidence: 0.9, source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null } }],
      unresolved: [{ id: "u", question: "which?", severity: "warning", candidateValues: [], evidenceIds: ["same", "same"] }],
    })).toThrow(/unique/i);

    expect(() => parseEvidenceBundle({
      version: 1,
      sources: [],
      facts: [],
      unresolved: [{ id: "u", question: "which?", severity: "warning", candidateValues: [], evidenceIds: [...duplicateIds, "fact-256"] }],
    })).toThrow(/256|evidence/i);
  });

  it("keeps private evidence fields and transport payloads out of serialized summaries", () => {
    const bundle = parseEvidenceBundle({
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "private.py" }],
      facts: [{ id: "f", subject: "block-1", predicate: "op", value: "conv2d", confidence: 0.9, source: { sourceId: "source-1", kind: "code", locator: "line:99", excerpt: "secret source line" } }],
    });
    const serialized = JSON.stringify(publicEvidenceSummary(bundle));
    expect(serialized).toContain("conv2d");
    expect(serialized).not.toContain("secret source line");
    expect(serialized).not.toContain("line:99");
    expect(serialized).not.toMatch(/data:|base64|private key|apiKey|accessToken|<svg|<xml|visio|com|vba|shell|python|javascript|geometry/i);
  });

  it("rejects a type-cast unsafe bundle at the public summary boundary", () => {
    const unsafeBundle = {
      version: 1,
      sources: [{ id: "source-1", kind: "code", name: "model.py" }],
      facts: [{
        id: "f",
        subject: "block-1",
        predicate: "credential",
        value: "{\"accessToken\":\"sk-proj-secret\"}",
        confidence: 0.9,
        source: { sourceId: "source-1", kind: "code", locator: null, excerpt: null },
      }],
      unresolved: [],
    } as never;

    expect(() => publicEvidenceSummary(unsafeBundle)).toThrow(/forbidden|payload|accessToken/i);
  });
});
