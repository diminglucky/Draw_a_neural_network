import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";

function analyze(sourceId: string, code: string) {
  return analyzeStaticPyTorchSource({ sourceId, sourceSha256: createHash("sha256").update(code, "utf8").digest("hex"), code });
}

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
    const result = analyze("source-tiny", code);
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

    const result = analyze("source-terminal-names", collisionCode);

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
    const result = analyze("dynamic-runtime", "class N(nn.Module):\n def forward(self,x):\n  return eval('x')");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-runtime-call", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });

  it("ignores dynamic keywords in forward comments and quoted literals", () => {
    const result = analyze("static-lexical-tokens", "class N(nn.Module):\n def __init__(self):\n  self.conv = nn.Conv2d(3,16,3)\n def forward(self,x):\n  note = \"if eval only documents static behavior\"\n  return self.conv(x) # if eval appears only in a comment");

    expect(result.unresolved).toEqual([]);
  });

  it("reports eval in an f-string replacement field as a blocking runtime call", () => {
    const result = analyze("f-string-eval", "class N(nn.Module):\n def forward(self,x):\n  return f\"{eval('x')}\"");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-runtime-call", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });

  it("reports a conditional in an f-string replacement field as blocking control flow", () => {
    const result = analyze("f-string-conditional", "class N(nn.Module):\n def forward(self,x):\n  return f\"{x if flag else y}\"");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      severity: "blocking", code: "dynamic-control-flow", locator: expect.objectContaining({ kind: "code", startLine: 3 }),
    }));
    expect(result.unresolved[0]?.evidenceRefs).toHaveLength(1);
  });

  it("preserves a supported linear alias chain instead of truncating the path", () => {
    const result = analyze("truncated-path", "class N(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n  self.b = nn.Linear(2,1)\n def forward(self,x):\n  x = self.a(x)\n  y = self.b(x)\n  return y");

    expect(result.calls.map((call) => call.moduleId)).toEqual(["a", "b"]);
    expect(result.unresolved).toEqual([]);
  });

  it("blocks a forward body that has no explicit return", () => {
    const result = analyze("missing-return", "class N(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n def forward(self,x):\n  x = self.a(x)");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: "unsupported-forward",
      severity: "blocking",
    }));
  });

  it("blocks multiple forward definitions instead of merging their calls", () => {
    const result = analyze("multiple-forward", "class A(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n def forward(self,x):\n  return self.a(x)\nclass B(nn.Module):\n def __init__(self):\n  self.b = nn.Linear(2,1)\n def forward(self,x):\n  return self.b(x)");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: "multiple-forward-definitions",
      severity: "blocking",
      locator: expect.objectContaining({ kind: "code", startLine: 9 }),
    }));
  });

  it("blocks a module redeclaration instead of silently using the last constructor", () => {
    const result = analyze("module-redeclaration", "class N(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n  self.a = nn.ReLU()\n def forward(self,x):\n  return self.a(x)");

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: "module-redeclaration",
      severity: "blocking",
      locator: expect.objectContaining({ kind: "code", startLine: 4 }),
    }));
  });

  it("expands nested static Sequential containers and named submodule composition", () => {
    const source = [
      "import torch.nn as nn",
      "class StagedNetwork(nn.Module):",
      "    def __init__(self):",
      "        widths = [16, 32]",
      "        self.features = nn.Sequential(",
      "            nn.Conv2d(3, widths[0], 3),",
      "            nn.Sequential(nn.ReLU(), nn.Conv2d(widths[0], widths[1], 3)),",
      "        )",
      "        self.classifier = nn.Sequential(nn.Flatten(), nn.Linear(widths[1], 4))",
      "    def forward(self, x):",
      "        x = self.features(x)",
      "        return self.classifier(x)",
    ].join("\n");

    const result = analyze("nested-static-containers", source);

    expect(result.modules.map((module) => [module.id, module.constructor])).toEqual([
      ["features.0", "Conv2d"],
      ["features.1.0", "ReLU"],
      ["features.1.1", "Conv2d"],
      ["classifier.0", "Flatten"],
      ["classifier.1", "Linear"],
    ]);
    expect(result.calls.map((call) => call.moduleId)).toEqual([
      "features.0", "features.1.0", "features.1.1", "classifier.0", "classifier.1",
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("unrolls a construction loop over a constant configuration list", () => {
    const source = [
      "import torch.nn as nn",
      "class RepeatedStages(nn.Module):",
      "    def __init__(self):",
      "        widths = [8, 16, 32]",
      "        self.features = nn.Sequential()",
      "        for width in widths:",
      "            self.features.append(nn.Linear(width, width))",
      "            self.features.append(nn.ReLU())",
      "        self.classifier = nn.Sequential(nn.Linear(32, 2))",
      "    def forward(self, x):",
      "        x = self.features(x)",
      "        return self.classifier(x)",
    ].join("\n");

    const result = analyze("static-construction-loop", source);

    expect(result.modules.map((module) => [module.id, module.constructor])).toEqual([
      ["features.0", "Linear"], ["features.1", "ReLU"],
      ["features.2", "Linear"], ["features.3", "ReLU"],
      ["features.4", "Linear"], ["features.5", "ReLU"],
      ["classifier.0", "Linear"],
    ]);
    expect(result.calls.map((call) => call.moduleId)).toEqual([
      "features.0", "features.1", "features.2", "features.3", "features.4", "features.5", "classifier.0",
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("blocks a construction loop whose iteration source is not statically provable", () => {
    const source = [
      "import torch.nn as nn",
      "class RuntimeBoundStages(nn.Module):",
      "    def __init__(self):",
      "        self.features = nn.Sequential()",
      "        for index in range(runtime_depth):",
      "            self.features.append(nn.Linear(4, 4))",
      "    def forward(self, x):",
      "        return self.features(x)",
    ].join("\n");

    const result = analyze("dynamic-construction-loop", source);

    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: "unsupported-static-loop",
      severity: "blocking",
    }));
    expect(result.evidence.facts).toEqual([]);
  });

  it("unrolls a linear forward loop over a known static Sequential container", () => {
    const source = [
      "import torch.nn as nn",
      "class ContainerIteration(nn.Module):",
      "    def __init__(self):",
      "        self.features = nn.Sequential(nn.Linear(4, 4), nn.ReLU())",
      "    def forward(self, x):",
      "        for layer in self.features:",
      "            x = layer(x)",
      "        return x",
    ].join("\n");

    const result = analyze("static-forward-loop", source);

    expect(result.calls.map((call) => call.moduleId)).toEqual(["features.0", "features.1"]);
    expect(result.unresolved).toEqual([]);
  });

  it("does not treat a static-looking construction loop inside a runtime branch as unconditional topology", () => {
    const source = [
      "import torch.nn as nn",
      "class ConditionalStages(nn.Module):",
      "    def __init__(self, enabled):",
      "        widths = [8, 16]",
      "        self.features = nn.Sequential()",
      "        if enabled:",
      "            for width in widths:",
      "                self.features.append(nn.Linear(width, width))",
      "    def forward(self, x):",
      "        return self.features(x)",
    ].join("\n");

    const result = analyze("conditional-static-loop", source);

    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: "unsupported-static-loop", severity: "blocking" }));
    expect(result.evidence.facts).toEqual([]);
  });

  it("does not trust a configuration list that is declared only on a runtime branch", () => {
    const source = [
      "import torch.nn as nn",
      "class ConditionalConfiguration(nn.Module):",
      "    def __init__(self, enabled):",
      "        self.features = nn.Sequential()",
      "        if enabled:",
      "            widths = [8, 16]",
      "        for width in widths:",
      "            self.features.append(nn.Linear(width, width))",
      "    def forward(self, x):",
      "        return self.features(x)",
    ].join("\n");

    const result = analyze("conditional-static-list", source);

    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: "unsupported-static-loop", severity: "blocking" }));
    expect(result.evidence.facts).toEqual([]);
  });
});
