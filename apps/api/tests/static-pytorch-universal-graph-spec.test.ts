import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "../src/static-pytorch-universal-graph-spec.js";
import type { ArchitectureIRv3 } from "../src/network-ir-v3.js";
import { projectArchitectureIrV3ToUniversalGraphSpec } from "../src/universal-graph-spec-adapter.js";
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
    expect(ugs.nodes.every((node) => node.tensorFacts === null)).toBe(true);
  });

  it("projects one source-backed ArchitectureIR port shape without inferring from labels", () => {
    const ugs = projectArchitectureIrV3ToUniversalGraphSpec({
      version: 3,
      graphId: "proved-spatial-facts",
      inputs: [{ nodeId: "input", portId: "out" }],
      outputs: [{ nodeId: "output", portId: "in" }],
      modules: [],
      nodes: [
        { id: "input", kind: "input", semanticRole: "image input", inputPorts: [], outputPorts: [{ id: "out", representation: "spatial_feature_map", semanticType: "data" }], evidenceIds: ["e-input"] },
        {
          id: "stage",
          kind: "operator",
          semanticRole: "pool up down decoder",
          inputPorts: [{ id: "in", representation: "spatial_feature_map", semanticType: "data" }],
          outputPorts: [{
            id: "out",
            representation: "spatial_feature_map",
            semanticType: "data",
            shape: {
              axes: ["B", "C", "H", "W"],
              dimensions: [{ kind: "known", value: 1 }, { kind: "known", value: 48 }, { kind: "known", value: 32 }, { kind: "known", value: 32 }],
              batchSemantics: "independent",
            },
          }],
          evidenceIds: ["e-stage-shape"],
        },
        { id: "output", kind: "output", semanticRole: "result", inputPorts: [{ id: "in", representation: "spatial_feature_map", semanticType: "prediction" }], outputPorts: [], evidenceIds: ["e-output"] },
      ],
      edges: [
        { id: "input-stage", source: { nodeId: "input", portId: "out" }, target: { nodeId: "stage", portId: "in" }, transport: "data", evidenceIds: ["e-stage-shape"] },
        { id: "stage-output", source: { nodeId: "stage", portId: "out" }, target: { nodeId: "output", portId: "in" }, transport: "data", evidenceIds: ["e-stage-shape"] },
      ],
      processes: [],
      evidenceIndex: {
        "e-input": [evidence("input")],
        "e-stage-shape": [evidence("stage-shape")],
        "e-output": [evidence("output")],
      },
      unresolved: [],
    });

    const stage = ugs.nodes.find((node) => node.nodeId === "stage");

    expect(stage?.tensorFacts).toEqual({
      axes: ["batch", "channels", "height", "width"],
      dimensions: { batch: 1, channels: 48, height: 32, width: 32 },
      evidenceIds: expect.arrayContaining([expect.any(String)]),
    });
    expect(stage?.tensorFacts?.evidenceIds.every((id) => ugs.evidence.some((item) => item.evidenceId === id))).toBe(true);
    expect(ugs.nodes.find((node) => node.nodeId === "input")?.tensorFacts).toBeNull();
  });

  it("fails closed when ArchitectureIR ports expose competing shapes", () => {
    const ir = architectureIrWithCompetingShapes();

    expect(projectArchitectureIrV3ToUniversalGraphSpec(ir).nodes.find((node) => node.nodeId === "stage")?.tensorFacts).toBeNull();
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

  it("returns a blocking candidate UGS rather than treating a conditional module declaration as unconditional topology", () => {
    const ugs = compile([
      "class Conditional(nn.Module):",
      " def __init__(self, enabled):",
      "  if enabled:",
      "   self.conv = nn.Conv2d(3, 16, 3)",
      " def forward(self, x):",
      "  return self.conv(x)",
    ].join("\n"));

    expect(ugs.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "operation", severity: "blocking" }),
      expect.objectContaining({ scope: "topology", severity: "blocking" }),
    ]));
    expect(ugs.edges).toEqual([]);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
  });

  it.each([
    ["else", ["  if enabled:", "   pass", "  else:"]],
    ["elif", ["  if enabled:", "   pass", "  elif fallback:"]],
    ["except", ["  try:", "   pass", "  except Exception:"]],
  ])("returns a blocking candidate UGS when a module declaration is inside an %s clause", (_clause, branch) => {
    const ugs = compile([
      "class Conditional(nn.Module):",
      " def __init__(self, enabled, fallback):",
      ...branch,
      "   self.conv = nn.Conv2d(3, 16, 3)",
      " def forward(self, x):",
      "  return self.conv(x)",
    ].join("\n"));

    expect(ugs.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "operation", severity: "blocking" }),
      expect.objectContaining({ scope: "topology", severity: "blocking" }),
    ]));
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

  it("rejects a direct analyzer call whose source digest does not identify the submitted static bytes", () => {
    const code = "class N(nn.Module):\n def forward(self, x):\n  return x";
    expect(() => analyzeStaticPyTorchSource({
      sourceId: "mismatched-analyzer-source",
      sourceSha256: "a".repeat(64),
      code,
    })).toThrow(/digest.*submitted bytes/i);
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

function evidence(locator: string) {
  return {
    sourceId: "static-shape-source",
    sourceSha256: "a".repeat(64),
    locator: { kind: "code" as const, startLine: 1, startColumn: 1, endLine: 1, endColumn: locator.length + 1 },
    excerptDigest: "b".repeat(64),
  };
}

function architectureIrWithCompetingShapes(): ArchitectureIRv3 {
  return {
    version: 3,
    graphId: "competing-spatial-facts",
    inputs: [{ nodeId: "stage", portId: "in" }],
    outputs: [{ nodeId: "stage", portId: "out" }],
    modules: [],
    nodes: [{
      id: "stage",
      kind: "operator",
      semanticRole: "pool up down",
      inputPorts: [{ id: "in", representation: "spatial_feature_map", semanticType: "data", shape: { axes: ["C", "H", "W"], dimensions: [{ kind: "known", value: 16 }, { kind: "known", value: 64 }, { kind: "known", value: 64 }], batchSemantics: "independent" } }],
      outputPorts: [{ id: "out", representation: "spatial_feature_map", semanticType: "data", shape: { axes: ["C", "H", "W"], dimensions: [{ kind: "known", value: 32 }, { kind: "known", value: 32 }, { kind: "known", value: 32 }], batchSemantics: "independent" } }],
      evidenceIds: ["e-stage-shape"],
    }],
    edges: [],
    processes: [],
    evidenceIndex: { "e-stage-shape": [evidence("stage-shape")] },
    unresolved: [],
  };
}
