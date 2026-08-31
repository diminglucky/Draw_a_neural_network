import assert from "node:assert/strict";
import test from "node:test";
import { diagramFromCode } from "./code-workflow.js";

test("code workflow preserves custom PyTorch modules as unresolved Universal IR operators", () => {
  const source = `
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.custom = CustomCrossModalBlock(64)
        self.conv = nn.Conv2d(64, 128, 3)

    def forward(self, x):
        x = self.custom(x)
        return self.conv(x)
`;
  const document = diagramFromCode(source, "pytorch");
  const custom = document.nodes.find((node) => /custom/i.test(node.label) || node.compoundKind === "unresolved");

  assert.ok(document.ir, "diagram should expose Universal IR");
  assert.ok(custom, "custom module should be retained");
  assert.equal(custom.type, "compound");
  assert.equal(custom.compoundKind, "unresolved");
  assert.ok(custom.source?.line > 0 || custom.sourceLine > 0, "source evidence should be retained");
  assert.ok(document.edges.some((edge) => edge.source === custom.id || edge.target === custom.id));
});

test("code workflow expands a same-source custom PyTorch module into evidenced internal topology", () => {
  const source = `
class WaveletEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.analysis = nn.Conv2d(3, 64, 3, padding=1)
        self.norm = nn.BatchNorm2d(64)

    def forward(self, x):
        x = self.analysis(x)
        return self.norm(x)

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.custom = WaveletEncoder()
        self.head = nn.Linear(64, 10)

    def forward(self, x):
        x = self.custom(x)
        return self.head(x)
`;
  const document = diagramFromCode(source, "pytorch");
  const custom = document.ir.nodes.find((node) => node.op === "WaveletEncoder");

  assert.ok(custom, "same-source custom module should be retained");
  assert.deepEqual(custom.attributes.internalGraph.nodes.map((node) => node.id), ["analysis", "norm"]);
  assert.deepEqual(custom.attributes.internalGraph.nodes.map((node) => node.family), ["conv", "norm"]);
  assert.ok(custom.attributes.internalGraph.edges.some((edge) => edge.source === "analysis" && edge.target === "norm"));
  assert.equal(document.nodes.find((node) => node.op === "WaveletEncoder").attributes.internalGraph.nodes.length, 2);
});

test("code workflow preserves custom Keras layers as unresolved operators", () => {
  const source = `
inputs = keras.Input((224, 224, 3))
x = layers.CustomFusion(name="fusion")(inputs)
outputs = layers.Dense(10)(x)
model = keras.Model(inputs, outputs)
`;
  const document = diagramFromCode(source, "keras");
  const custom = document.ir.nodes.find((node) => node.family === "custom");

  assert.ok(custom, "custom Keras layer should be retained in IR");
  assert.equal(custom.compoundKind, "unresolved");
  assert.match(custom.label, /CustomFusion/i);
});

test("code workflow records dynamic-control-flow uncertainty instead of fabricating a static topology", () => {
  const source = `
class Net(nn.Module):
    def forward(self, x, use_skip):
        if use_skip:
            x = self.custom(x)
        for _ in range(2):
            x = self.conv(x)
        return x
`;
  const document = diagramFromCode(source, "pytorch");

  assert.ok(document.ir.diagnostics.some((item) => item.kind === "dynamic-control-flow"));
});
