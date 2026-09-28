import assert from "node:assert/strict";
import test from "node:test";
import { collectAutomaticEvidenceSources, fuseAutomaticEvidence } from "./automatic-evidence.mjs";

test("collects explicit IR, source, and config evidence with authority ordering", async () => {
  const sources = await collectAutomaticEvidenceSources({
    source: `
import torch.nn as nn
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 8, 3)
    def forward(self, x):
        return self.conv(x)
`,
    framework: "pytorch",
    ir: {
      version: "universal-neural-ir/v1",
      nodes: [{ id: "input", family: "input", op: "Input" }, { id: "output", family: "output", op: "Output" }],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
    config: { pipeline: [[-1, 1, "InputAdapter", {}], [-1, 1, "NovelOperator", {}]] },
  });

  assert.equal(sources.some((source) => source.id === "explicit-ir" && source.authority === 10), true);
  assert.equal(sources.some((source) => source.id === "torch-ast-source"), true);
  assert.equal(sources.some((source) => source.id === "config-source"), true);
});

test("automatic evidence fusion blocks conflicting explicit and config topology", async () => {
  const fused = await fuseAutomaticEvidence({
    ir: {
      version: "universal-neural-ir/v1",
      nodes: [{ id: "input", family: "input" }, { id: "output", family: "output" }],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
    config: { pipeline: [[-1, 1, "InputAdapter", {}], [-1, 1, "NovelOperator", {}]] },
  });

  assert.equal(fused.blocked, true);
  assert.ok(fused.conflicts.length > 0);
});

test("automatic evidence fusion aligns matching explicit and config topology", async () => {
  const fused = await fuseAutomaticEvidence({
    ir: {
      version: "universal-neural-ir/v1",
      nodes: [
        { id: "input", op: "Input", family: "input" },
        { id: "conv", op: "Conv2d", family: "conv" },
        { id: "output", op: "Output", family: "output" },
      ],
      edges: [
        { id: "flow-a", source: "input", target: "conv" },
        { id: "flow-b", source: "conv", target: "output" },
      ],
    },
    config: {
      pipeline: [
        [-1, 1, "Input", {}],
        [-1, 1, "Conv2d", {}],
        [-1, 1, "Output", {}],
      ],
    },
  });

  assert.equal(fused.blocked, false, JSON.stringify(fused.conflicts));
  assert.deepEqual(fused.ir.nodes.map((node) => node.id), ["input", "conv", "output"]);
  assert.equal(fused.provenance.nodes.conv.some((item) => item.id === "config-source"), true);
});

test("collects pinned repository configuration without weakening provenance", async () => {
  const sources = await collectAutomaticEvidenceSources({
    repository: "https://github.com/example/network",
    revision: "a".repeat(40),
    entryPoint: "models/network.yaml",
    sourceId: "repo-config",
  }, {
    resolver: {
      fetchRepository: async () => ({ content: "pipeline:\n  - [-1, 1, RepoDefinedBlock, {width: 48}]", license: "MIT" }),
    },
  });

  const repository = sources.find((source) => source.id === "repo-config");
  assert.ok(repository);
  assert.equal(repository.analyzer, "repository-config");
  assert.equal(repository.ir.nodes[0].op, "RepoDefinedBlock");
  assert.deepEqual(repository.ir.nodes[0].sourceLocation, { path: ["pipeline", "0"], index: 0 });
});

test("collects pinned repository Python through the injected code analyzer", async () => {
  const sources = await collectAutomaticEvidenceSources({
    repository: "https://github.com/example/network",
    revision: "b".repeat(40),
    entryPoint: "models/network.py",
    sourceId: "repo-code",
    framework: "pytorch",
  }, {
    resolver: {
      fetchRepository: async () => ({ content: "class Net(nn.Module):\n    pass", license: "MIT" }),
    },
    torchAnalyzer: async () => ({
      status: "grounded",
      ir: {
        source: { kind: "source", analyzer: "test-ast" },
        nodes: [{ id: "conv", op: "Conv2d", family: "conv", sourceLine: 5, evidence: [{ kind: "source" }] }],
        edges: [],
      },
      diagnostics: [],
    }),
  });

  const repository = sources.find((source) => source.id === "repo-code-torch-ast-source");
  assert.ok(repository);
  assert.equal(repository.ir.nodes[0].op, "Conv2d");
  assert.deepEqual(repository.ir.nodes[0].sourceLocation, { line: 5 });
});
