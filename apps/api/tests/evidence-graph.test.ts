import { describe, expect, it } from "vitest";
import { parseEvidenceGraph, publicEvidenceGraphSummary } from "../src/evidence-graph.js";

function mergeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "fact-merge-1",
    kind: "merge_kind",
    subject: { kind: "node", nodeId: "merge-1" },
    payload: { kind: "merge_kind", mergeKind: "concat", concatAxis: "C" },
    evidenceRefs: [{
      sourceId: "source-code-1",
      sourceSha256: "a".repeat(64),
      locator: { kind: "code", startLine: 12, startColumn: 1, endLine: 12, endColumn: 44 },
      excerptDigest: "b".repeat(64),
    }],
    extractionConfidence: 0.94,
    decisionConfidence: 0.91,
    sourceRole: "code",
    scope: "architecture",
    status: "accepted",
    analyzer: { id: "pytorch-static", version: "1.0.0", policy: "static" },
    conflictGroupId: null,
    conflictKey: "node:merge-1:merge_kind",
    ...overrides,
  };
}

describe("EvidenceGraph v2", () => {
  it("accepts a closed merge fact with a typed code locator", () => {
    const graph = parseEvidenceGraph({ version: 2, facts: [mergeFact()], relations: [] });
    expect(graph.facts).toHaveLength(1);
    expect(graph.facts[0]).toMatchObject({ kind: "merge_kind", payload: { concatAxis: "C" } });
  });

  it("rejects free-form fact values and payload kinds that do not match the fact", () => {
    expect(() => parseEvidenceGraph({ version: 2, facts: [mergeFact({ value: "concat" })], relations: [] })).toThrow(/unrecognized|value/i);
    expect(() => parseEvidenceGraph({
      version: 2,
      facts: [mergeFact({ payload: { kind: "node_kind", semanticRole: "merge" } })],
      relations: [],
    })).toThrow(/payload|merge_kind|node_kind/i);
  });

  it("rejects invalid typed locator ranges", () => {
    expect(() => parseEvidenceGraph({
      version: 2,
      facts: [mergeFact({ evidenceRefs: [{
        sourceId: "source-image-1",
        sourceSha256: "c".repeat(64),
        locator: { kind: "image", normalizedBounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 }, imageWidth: 1280, imageHeight: 720 },
        excerptDigest: "d".repeat(64),
      }] })],
      relations: [],
    })).toThrow(/normalizedBounds|width/i);

    expect(() => parseEvidenceGraph({
      version: 2,
      facts: [mergeFact({ evidenceRefs: [{
        sourceId: "source-text-1",
        sourceSha256: "c".repeat(64),
        locator: { kind: "text", startOffset: 20, endOffset: 20 },
        excerptDigest: "d".repeat(64),
      }] })],
      relations: [],
    })).toThrow(/endOffset|locator/i);
  });

  it("rejects relations that reference facts outside the graph", () => {
    expect(() => parseEvidenceGraph({
      version: 2,
      facts: [mergeFact()],
      relations: [{ id: "relation-1", fromFactId: "fact-merge-1", toFactId: "missing", kind: "supports", createdBy: "analyzer" }],
    })).toThrow(/unknown fact|relation/i);
  });

  it("keeps private locator and digest fields out of the public summary", () => {
    const graph = parseEvidenceGraph({ version: 2, facts: [mergeFact()], relations: [] });
    const serialized = JSON.stringify(publicEvidenceGraphSummary(graph));

    expect(serialized).toContain("merge_kind");
    expect(serialized).not.toContain("source-code-1");
    expect(serialized).not.toContain("startLine");
    expect(serialized).not.toContain("sourceSha256");
    expect(serialized).not.toContain("excerptDigest");
  });
});
