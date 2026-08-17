import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";

const code = [
  "import torch.nn as nn",
  "class TinyNet(nn.Module):",
  "    def __init__(self):",
  "        self.conv = nn.Conv2d(3, 16, 3)",
  "        self.pool = nn.MaxPool2d(2)",
  "    def forward(self, x):",
  "        x = self.conv(x)",
  "        return self.pool(x)",
].join("\n");

describe("analyzeStaticPyTorchSource", () => {
  it("recovers declared modules and ordered forward calls without executing code", () => {
    const result = analyzeStaticPyTorchSource({ sourceId: "source-tiny", sourceSha256: "a".repeat(64), code });
    expect(result.modules).toMatchObject([
      { id: "conv", constructor: "Conv2d", locator: { kind: "code", startLine: 4 } },
      { id: "pool", constructor: "MaxPool2d", locator: { kind: "code", startLine: 5 } },
    ]);
    expect(result.calls).toMatchObject([
      { id: "forward:1", moduleId: "conv", locator: { kind: "code", startLine: 7 } },
      { id: "forward:2", moduleId: "pool", locator: { kind: "code", startLine: 8 } },
    ]);
    expect(result.evidence.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining(["node_exists", "node_kind", "edge_exists"]));
    expect(result.unresolved).toEqual([]);
  });

  it("uses distinct synthetic terminals when modules are named input and output", () => {
    const collisionCode = [
      "import torch.nn as nn",
      "class TerminalNames(nn.Module):",
      "    def __init__(self):",
      "        self.input = nn.Linear(3, 3)",
      "        self.output = nn.ReLU()",
      "    def forward(self, x):",
      "        x = self.input(x)",
      "        return self.output(x)",
    ].join("\n");

    const result = analyzeStaticPyTorchSource({ sourceId: "source-terminal-names", sourceSha256: "b".repeat(64), code: collisionCode });

    expect(result.evidence.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: { kind: "node", nodeId: "input" }, payload: { kind: "node_exists", operatorKind: "module" } }),
      expect.objectContaining({ subject: { kind: "node", nodeId: "output" }, payload: { kind: "node_exists", operatorKind: "module" } }),
      expect.objectContaining({ subject: { kind: "node", nodeId: "terminal:input" }, payload: { kind: "node_exists", operatorKind: "input" } }),
      expect.objectContaining({ subject: { kind: "node", nodeId: "terminal:output" }, payload: { kind: "node_exists", operatorKind: "output" } }),
      expect.objectContaining({ subject: { kind: "edge", sourcePortId: "terminal:input:out", targetPortId: "input:in" } }),
      expect.objectContaining({ subject: { kind: "edge", sourcePortId: "input:out", targetPortId: "output:in" } }),
      expect.objectContaining({ subject: { kind: "edge", sourcePortId: "output:out", targetPortId: "terminal:output:in" } }),
    ]));
  });

  it("reports runtime metaprogramming inside forward as blocking source evidence", () => {
    const result = analyzeStaticPyTorchSource({
      sourceId: "dynamic-runtime", sourceSha256: "d".repeat(64),
      code: "class N(nn.Module):\n def forward(self,x):\n  return eval('x')",
    });

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-runtime-call", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });

  it("ignores dynamic keywords in forward comments and quoted literals", () => {
    const result = analyzeStaticPyTorchSource({
      sourceId: "static-lexical-tokens", sourceSha256: "e".repeat(64),
      code: "class N(nn.Module):\n def __init__(self):\n  self.conv = nn.Conv2d(3,16,3)\n def forward(self,x):\n  note = \"if eval only documents static behavior\"\n  return self.conv(x) # if eval appears only in a comment",
    });

    expect(result.unresolved).toEqual([]);
  });

  it("reports eval in an f-string replacement field as a blocking runtime call", () => {
    const result = analyzeStaticPyTorchSource({
      sourceId: "f-string-eval", sourceSha256: "f".repeat(64),
      code: "class N(nn.Module):\n def forward(self,x):\n  return f\"{eval('x')}\"",
    });

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-runtime-call", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });

  it("reports a conditional in an f-string replacement field as blocking control flow", () => {
    const result = analyzeStaticPyTorchSource({
      sourceId: "f-string-conditional", sourceSha256: "g".repeat(64),
      code: "class N(nn.Module):\n def forward(self,x):\n  return f\"{x if flag else y}\"",
    });

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-control-flow", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });
});
