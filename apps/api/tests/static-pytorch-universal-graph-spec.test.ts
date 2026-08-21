import { describe, expect, it } from "vitest";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "../src/static-pytorch-universal-graph-spec.js";
import { getUniversalGraphEligibility } from "../src/universal-graph-spec.js";

function compile(code: string, sourceId = "static-ugs-source", sourceSha256 = "a".repeat(64)) {
  return compileStaticPyTorchSourceToUniversalGraphSpec({ sourceId, sourceSha256, code });
}

describe("compileStaticPyTorchSourceToUniversalGraphSpec", () => {
  it("projects a provable static source path into an evidence-backed UGS", () => {
    const ugs = compile([
      "class Tiny(nn.Module):",
      " def __init__(self):",
      "  self.conv = nn.Conv2d(3, 16, 3)",
      " def forward(self, x):",
      "  return self.conv(x)",
    ].join("\n"), "tiny-static-source", "b".repeat(64));

    expect(ugs).toMatchObject({
      version: 1,
      graphId: "pytorch:tiny-static-source",
      sourceIds: ["tiny-static-source"],
      sourceHashes: ["b".repeat(64)],
      unresolved: [],
    });
    expect(ugs.nodes.map((node) => node.nodeId)).toEqual(["terminal:input", "conv", "terminal:output"]);
    expect(ugs.edges.map((edge) => [edge.sourcePortId, edge.targetPortId])).toEqual([
      ["terminal:input:out", "conv:in"],
      ["conv:out", "terminal:output:in"],
    ]);
    expect(ugs.evidence.every((item) => item.sourceHash === "b".repeat(64))).toBe(true);
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
    const ugs = compile([
      "class Dynamic(nn.Module):",
      " def forward(self, x):",
      "  if x.sum() > 0:",
      "   return x",
      "  return -x",
    ].join("\n"));

    const operationUnresolved = ugs.unresolved.find((item) => item.scope === "operation" && item.severity === "blocking");
    const topologyUnresolved = ugs.unresolved.find((item) => item.scope === "topology" && item.severity === "blocking");

    expect(operationUnresolved).toBeDefined();
    expect(topologyUnresolved?.evidenceIds).toEqual(operationUnresolved?.evidenceIds);
    expect(topologyUnresolved?.evidenceIds.every((evidenceId) => ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId))).toBe(true);
    expect(ugs.edges).toEqual([]);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
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
    const input = {
      sourceId: "static-ugs-source",
      sourceSha256: "a".repeat(64),
      code: [
        "class Stable(nn.Module):",
        " def __init__(self):",
        "  self.linear = nn.Linear(3, 1)",
        " def forward(self, x):",
        "  return self.linear(x)",
      ].join("\n"),
    };

    expect(compileStaticPyTorchSourceToUniversalGraphSpec(input)).toEqual(compileStaticPyTorchSourceToUniversalGraphSpec(input));
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
