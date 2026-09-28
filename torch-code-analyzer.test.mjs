import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTorchSource } from "./torch-code-analyzer.mjs";

const source = `
import torch
import torch.nn as nn

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 16, 3, padding=1)
        self.bn = nn.BatchNorm2d(16)
        self.fc = nn.Linear(16, 10)

    def forward(self, x):
        x = self.conv(x)
        x = self.bn(x)
        x = torch.relu(x)
        x = torch.flatten(x, 1)
        return self.fc(x)
`;

test("PyTorch AST analyzer extracts module calls without regex model templates", async () => {
  const result = await analyzeTorchSource({ source, framework: "pytorch" });
  assert.equal(result.status, "grounded");
  assert.equal(result.ir.nodes[0].family, "input");
  assert.ok(result.ir.nodes.some((node) => node.family === "conv" && node.op === "Conv2d"));
  assert.ok(result.ir.nodes.some((node) => node.family === "norm" && node.op === "BatchNorm2d"));
  assert.ok(result.ir.nodes.some((node) => node.family === "activation" && node.op === "relu"));
  assert.ok(result.ir.nodes.some((node) => node.family === "flatten"));
  assert.ok(result.ir.nodes.some((node) => node.family === "dense"));
  assert.ok(result.ir.edges.length >= result.ir.nodes.length - 1);
});

test("PyTorch AST analyzer marks unsupported dynamic structure unresolved", async () => {
  const result = await analyzeTorchSource({
    source: `
import torch.nn as nn
class Net(nn.Module):
    def forward(self, x):
        return external_service(x)
`,
    framework: "pytorch",
  });
  assert.equal(result.status, "grounded");
  assert.ok(result.ir.nodes.some((node) => node.compoundKind === "unresolved"));
});

test("PyTorch AST analyzer expands Sequential modules without a model-name template", async () => {
  const result = await analyzeTorchSource({
    source: `
import torch.nn as nn
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
    def forward(self, x):
        return self.features(x)
`,
    framework: "pytorch",
  });

  assert.deepEqual(result.ir.nodes.map((node) => node.op), [
    "Input",
    "Conv2d",
    "ReLU",
    "MaxPool2d",
    "Output",
  ]);
});

test("PyTorch AST analyzer preserves residual add topology", async () => {
  const result = await analyzeTorchSource({
    source: `
import torch.nn as nn
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 3, 3, padding=1)
    def forward(self, x):
        identity = x
        x = self.conv(x)
        return x + identity
`,
    framework: "pytorch",
  });

  assert.ok(result.ir.nodes.some((node) => node.op === "Add" && node.family === "merge"));
  assert.ok(result.ir.edges.some((edge) => edge.type === "residual"));
});
