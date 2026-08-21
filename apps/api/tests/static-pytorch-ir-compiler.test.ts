import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";
import { compileStaticPyTorchToArchitectureIR } from "../src/static-pytorch-ir-compiler.js";

function analyze(sourceId: string, code: string) {
  return analyzeStaticPyTorchSource({ sourceId, sourceSha256: createHash("sha256").update(code, "utf8").digest("hex"), code });
}

describe("compileStaticPyTorchToArchitectureIR", () => {
  it("turns supported sequential calls into evidence-backed ordered v3 nodes", () => {
    const analysis = analyze("tiny", "class N(nn.Module):\n def __init__(self):\n  self.conv = nn.Conv2d(3,16,3)\n def forward(self,x):\n  return self.conv(x)");
    const ir = compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true });
    expect(ir).toMatchObject({ version: 3, graphId: "pytorch:tiny", unresolved: [] });
    expect(ir.nodes.map((node) => node.id)).toEqual(["terminal:input", "conv", "terminal:output"]);
    expect(ir.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId])).toEqual([
      ["terminal:input", "conv"], ["conv", "terminal:output"],
    ]);
    expect(ir.nodes.flatMap((node) => node.evidenceIds)).not.toEqual([]);
    expect(ir.edges.flatMap((edge) => edge.evidenceIds)).not.toEqual([]);
    expect(Object.keys(ir.evidenceIndex)).toEqual(expect.arrayContaining(ir.nodes.flatMap((node) => node.evidenceIds)));
    expect(Object.keys(ir.evidenceIndex)).toEqual(expect.arrayContaining(ir.edges.flatMap((edge) => edge.evidenceIds)));
  });

  it("rejects duplicate accepted input terminal evidence", () => {
    const analysis = analyze("tiny-duplicate-terminal", "class N(nn.Module):\n def __init__(self):\n  self.conv = nn.Conv2d(3,16,3)\n def forward(self,x):\n  return self.conv(x)");
    const inputFact = analysis.evidence.facts.find((fact) => fact.kind === "node_exists"
      && fact.subject.kind === "node"
      && fact.subject.nodeId === "terminal:input");
    if (!inputFact) throw new Error("Expected analyzer input terminal evidence");
    analysis.evidence.facts.push({
      ...inputFact,
      id: "node-exists:terminal:input:duplicate",
      subject: { kind: "node", nodeId: "terminal:input:duplicate" },
      conflictKey: "node:terminal:input:duplicate:exists",
    });

    expect(() => compileStaticPyTorchToArchitectureIR(analysis)).toThrow(/exactly one accepted input terminal fact/i);
  });

  it("does not guess a graph for dynamic control flow", () => {
    const analysis = analyze("dynamic", "class N(nn.Module):\n def forward(self,x):\n  if x.sum() > 0:\n   return x\n  return -x");
    expect(analysis.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-control-flow", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(analysis.unresolved[0]?.evidenceRefs).toHaveLength(1);
    expect(() => compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true })).toThrow(/blocking unresolved/i);
  });

  it("preserves a supported linear alias chain in the render-ready IR", () => {
    const analysis = analyze("truncated-path", "class N(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n  self.b = nn.Linear(2,1)\n def forward(self,x):\n  x = self.a(x)\n  y = self.b(x)\n  return y");

    const ir = compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true });
    expect(ir.nodes.map((node) => node.id)).toEqual(["terminal:input", "a", "b", "terminal:output"]);
  });

  it("rejects a dynamic conditional expression in an inline forward body", () => {
    const analysis = analyze("inline-dynamic", "class N(nn.Module):\n def forward(self,x): return x if x.sum() > 0 else -x");

    expect(analysis.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-control-flow", locator: expect.objectContaining({ kind: "code", startLine: 2 }),
    }));
    expect(analysis.unresolved[0]?.evidenceRefs).toHaveLength(1);
    expect(() => compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true })).toThrow(/blocking unresolved/i);
  });
});
