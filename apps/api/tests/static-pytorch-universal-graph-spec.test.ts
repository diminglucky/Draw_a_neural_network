import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "../src/static-pytorch-universal-graph-spec.js";
import { getUniversalGraphEligibility } from "../src/universal-graph-spec.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compile(code: string, sourceId = "static-ugs-source", sourceSha256 = sha256(code)) {
  return compileStaticPyTorchSourceToUniversalGraphSpec({ sourceId, sourceSha256, code });
}

describe("compileStaticPyTorchSourceToUniversalGraphSpec", () => {
  it("projects a provable static source path into an evidence-backed UGS", () => {
    const code = [
      "class Tiny(nn.Module):",
      " def __init__(self):",
      "  self.conv = nn.Conv2d(3, 16, 3)",
      " def forward(self, x):",
      "  return self.conv(x)",
    ].join("\n");
    const sourceSha256 = sha256(code);
    const ugs = compile(code, "tiny-static-source", sourceSha256);

    expect(ugs).toMatchObject({
      version: 1,
      graphId: "pytorch:tiny-static-source",
      sourceIds: ["tiny-static-source"],
      sourceHashes: [sourceSha256],
      unresolved: [],
    });
    expect(ugs.nodes.map((node) => node.nodeId)).toEqual(["terminal:input", "conv", "terminal:output"]);
    expect(ugs.edges.map((edge) => [edge.sourcePortId, edge.targetPortId])).toEqual([
      ["terminal:input:out", "conv:in"],
      ["conv:out", "terminal:output:in"],
    ]);
    expect(ugs.evidence.every((item) => item.sourceHash === sourceSha256)).toBe(true);
  });

  it("preserves a provable unknown static module as a custom operator", () => {
    const ugs = compile([
      "class Experimental(nn.Module):",
      " def __init__(self):",
      "  self.spectral = nn.SpectralMixer(64)",
      " def forward(self, x):",
      "  return self.spectral(x)",
    ].join("\n"));

    expect(ugs.nodes.find((node) => node.nodeId === "spectral")).toMatchObject({
      kind: "custom_operator",
      label: "SpectralMixer",
      operationKnowledge: "custom",
    });
  });

  it("returns a blocking candidate UGS rather than guessing dynamic control flow", () => {
    const code = [
      "class Dynamic(nn.Module):",
      " def forward(self, x):",
      "  if x.sum() > 0:",
      "   return x",
      "  return -x",
    ].join("\n");
    const sourceSha256 = sha256(code);
    const ugs = compile(code, "dynamic-static-source", sourceSha256);

    const operationUnresolved = ugs.unresolved.find((item) => item.scope === "operation" && item.severity === "blocking");
    const topologyUnresolved = ugs.unresolved.find((item) => item.scope === "topology" && item.severity === "blocking");

    expect(operationUnresolved).toBeDefined();
    expect(topologyUnresolved?.evidenceIds).toEqual(operationUnresolved?.evidenceIds);
    expect(topologyUnresolved?.evidenceIds.every((evidenceId) => ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId))).toBe(true);
    expect(ugs.sourceIds).toContain("dynamic-static-source");
    expect(ugs.sourceHashes).toContain(sourceSha256);
    expect(ugs.evidence.some((item) => item.sourceId === "dynamic-static-source" && item.sourceHash === sourceSha256)).toBe(true);
    expect(ugs.edges).toEqual([]);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
  });

  it("preserves every blocking static-analysis fact as independently evidenced topology uncertainty", () => {
    const code = [
      "class Dynamic(nn.Module):",
      " def forward(self, x):",
      "  if x.sum() > 0:",
      "   return x",
      "  while x.sum() > 0:",
      "   return x",
      "  return -x",
    ].join("\n");
    const analyzerBlockers = analyzeStaticPyTorchSource({
      sourceId: "multiple-dynamic-static-source",
      sourceSha256: sha256(code),
      code,
    }).unresolved.filter((item) => item.severity === "blocking");
    const ugs = compile(code, "multiple-dynamic-static-source");
    const operationUnresolved = ugs.unresolved.filter((item) => item.scope === "operation" && item.severity === "blocking");
    const topologyUnresolved = ugs.unresolved.filter((item) => item.scope === "topology" && item.severity === "blocking");

    expect(analyzerBlockers.length).toBeGreaterThan(1);
    expect(operationUnresolved).toHaveLength(analyzerBlockers.length);
    expect(topologyUnresolved).toHaveLength(analyzerBlockers.length);
    expect(topologyUnresolved.map((item) => item.evidenceIds)).toEqual(operationUnresolved.map((item) => item.evidenceIds));
    expect(topologyUnresolved.every((item) => item.evidenceIds.every((evidenceId) => ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId)))).toBe(true);
  });

  it("returns a blocking candidate UGS rather than guessing an undeclared module call", () => {
    const ugs = compile([
      "class UnknownCall(nn.Module):",
      " def forward(self, x):",
      "  return self.not_declared(x)",
    ].join("\n"));

    const operationUnresolved = ugs.unresolved.find((item) => item.scope === "operation" && item.severity === "blocking");
    const topologyUnresolved = ugs.unresolved.find((item) => item.scope === "topology" && item.severity === "blocking");

    expect(operationUnresolved).toBeDefined();
    expect(topologyUnresolved?.evidenceIds).toEqual(operationUnresolved?.evidenceIds);
    expect(topologyUnresolved?.evidenceIds.every((evidenceId) => ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId))).toBe(true);
    expect(ugs.edges).toEqual([]);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
  });

  it("is deterministic for the same safe analysis", () => {
    const code = [
      "class Stable(nn.Module):",
      " def __init__(self):",
      "  self.linear = nn.Linear(3, 1)",
      " def forward(self, x):",
      "  return self.linear(x)",
    ].join("\n");
    const input = {
      sourceId: "static-ugs-source",
      sourceSha256: sha256(code),
      code,
    };

    expect(compileStaticPyTorchSourceToUniversalGraphSpec(input)).toEqual(compileStaticPyTorchSourceToUniversalGraphSpec(input));
  });

  it("rejects a source digest that does not identify the submitted static bytes", () => {
    expect(() => compile(
      "class N(nn.Module):\n def forward(self,x):\n  return x",
      "mismatched-static-source",
      "a".repeat(64),
    )).toThrow();
  });

  it("does not execute source-like content while projecting analyzer output", () => {
    const sideEffectKey = "__staticPytorchUniversalGraphSpecExecuted";
    const globals = globalThis as Record<string, unknown>;
    globals[sideEffectKey] = false;

    try {
      compile([
        "globalThis.__staticPytorchUniversalGraphSpecExecuted = true",
        "class Passive(nn.Module):",
        " def __init__(self):",
        "  self.linear = nn.Linear(3, 1)",
        " def forward(self, x):",
        "  return self.linear(x)",
      ].join("\n"));

      expect(globals[sideEffectKey]).toBe(false);
    } finally {
      delete globals[sideEffectKey];
    }
  });
});
