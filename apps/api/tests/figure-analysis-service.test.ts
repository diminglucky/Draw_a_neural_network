import { describe, expect, it } from "vitest";
import { FigureAnalysisService } from "../src/figure-analysis-service.js";
import type { SourcePack } from "../src/source-pack.js";
import { InMemoryFoundationStore } from "../src/store.js";

function source(code: string, sourceId = "source-1"): SourcePack {
  return {
    sourceId,
    name: "model.py",
    kind: "pytorch-source",
    mimeType: "text/x-python",
    sourceSha256: "a".repeat(64),
    code,
    bytes: Buffer.byteLength(code, "utf8"),
  };
}

const linearCode = [
  "class N(nn.Module):",
  " def __init__(self):",
  "  self.conv = nn.Conv2d(3,16,3)",
  "  self.pool = nn.MaxPool2d(2)",
  " def forward(self,x):",
  "  x = self.conv(x)",
  "  return self.pool(x)",
].join("\n");

describe("FigureAnalysisService", () => {
  it("stores a linear static PyTorch analysis as ready for the future preview compiler", async () => {
    const service = new FigureAnalysisService({ store: new InMemoryFoundationStore() });

    const result = await service.analyze({
      userId: "user-1",
      source: source(linearCode),
      idempotencyKey: "analysis-linear-1",
      requestHash: "request-linear-1",
    });

    expect(result).toMatchObject({ duplicate: false, record: {
      status: "ready_for_preview",
      architectureIR: { version: 3, graphId: "pytorch:source-1", unresolved: [] },
      capabilityVersion: "pytorch-static-linear-v0",
    }});
    expect(result.record.evidenceGraph.facts.length).toBeGreaterThan(0);
    expect(result.record).not.toHaveProperty("previewArtifact");
    expect(result.record).not.toHaveProperty("planSnapshot");
  });

  it("stores dynamic control flow as a candidate with one deterministic blocking question", async () => {
    const service = new FigureAnalysisService({ store: new InMemoryFoundationStore() });
    const code = [
      "class N(nn.Module):",
      " def __init__(self):",
      "  self.conv = nn.Conv2d(3,16,3)",
      " def forward(self,x):",
      "  if flag:",
      "   return self.conv(x)",
      "  return self.conv(x)",
    ].join("\n");

    const result = await service.analyze({
      userId: "user-1",
      source: source(code, "source-dynamic"),
      idempotencyKey: "analysis-dynamic-1",
      requestHash: "request-dynamic-1",
    });

    expect(result.record.status).toBe("candidate_structure");
    expect(result.record.blockingQuestion).toMatchObject({ code: "dynamic-control-flow", locator: { kind: "code", startLine: 5 } });
    expect(result.record.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dynamic-control-flow", severity: "blocking" })]));
    expect(result.record.architectureIR?.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "blocking" })]));
  });

  it("keeps repeated module calls as a bounded candidate instead of guessing reuse semantics", async () => {
    const service = new FigureAnalysisService({ store: new InMemoryFoundationStore() });
    const code = [
      "class N(nn.Module):",
      " def __init__(self):",
      "  self.conv = nn.Conv2d(3,16,3)",
      " def forward(self,x):",
      "  x = self.conv(x)",
      "  return self.conv(x)",
    ].join("\n");

    const result = await service.analyze({
      userId: "user-1",
      source: source(code, "source-reuse"),
      idempotencyKey: "analysis-reuse-1",
      requestHash: "request-reuse-1",
    });

    expect(result.record.status).toBe("candidate_structure");
    expect(result.record.blockingQuestion).toMatchObject({ code: "module-reuse" });
    expect(result.record.architectureIR?.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ conflictKey: "module-reuse" })]));
  });

  it("has no Provider dependency and performs analysis through the local static path", async () => {
    const service = new FigureAnalysisService({ store: new InMemoryFoundationStore() });

    expect(Object.keys(service)).not.toContain("provider");
    await expect(service.analyze({
      userId: "user-1",
      source: source(linearCode, "source-no-provider"),
      idempotencyKey: "analysis-no-provider-1",
      requestHash: "request-no-provider-1",
    })).resolves.toMatchObject({ record: { status: "ready_for_preview" } });
  });
});
