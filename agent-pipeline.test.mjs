import assert from "node:assert/strict";
import test from "node:test";
import { analyzeArchitectureInput } from "./agent-pipeline.mjs";

test("agent pipeline routes source code through Universal IR and returns a previewable canvas", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.custom = CustomBlock(64)
    def forward(self, x):
        return self.custom(x)
`,
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForPreview, true);
  assert.ok(result.ir.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.ok(result.canvasDocument.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.equal(result.figureLayout.grammar.id, "generic-dag");
  assert.ok(result.figureLayout.nodes.some((node) => node.representation === "compound"));
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
});

test("agent pipeline keeps specific Sequential layer evidence instead of replacing it with a container", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class VGG16(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 64, 3), nn.ReLU(),
            nn.Conv2d(64, 64, 3), nn.MaxPool2d(2, 2)
        )
        self.classifier = nn.Sequential(nn.Linear(64, 10))
    def forward(self, x):
        x = self.features(x)
        return self.classifier(x)
`,
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.ir.nodes.some((node) => node.op === "Sequential"), false);
  assert.ok(result.ir.nodes.some((node) => node.family === "conv"));
  assert.ok(result.ir.nodes.some((node) => node.family === "pool"));
  assert.ok(result.ir.nodes.some((node) => node.family === "dense"));
});

test("agent pipeline does not let an example input call override a specific PyTorch graph", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class VGG16(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 64, 3), nn.MaxPool2d(2, 2),
            nn.Conv2d(64, 128, 3), nn.MaxPool2d(2, 2)
        )
        self.classifier = nn.Sequential(nn.Linear(128, 10))
    def forward(self, x):
        x = self.features(x)
        x = torch.flatten(x, 1)
        return self.classifier(x)

example = torch.randn(1, 3, 224, 224)
`,
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.ir.nodes.some((node) => node.op === "Sequential"), false);
  assert.equal(result.ir.nodes.some((node) => node.op === "randn"), false);
  assert.ok(result.ir.nodes.some((node) => node.family === "conv"));
  assert.ok(result.ir.nodes.some((node) => node.family === "pool"));
  assert.ok(result.ir.nodes.some((node) => node.family === "dense"));
  assert.equal(result.ir.nodes.find((node) => node.family === "input").subtitle, "224 x 224 x 3");
  assert.equal(result.figureLayout.grammar.id, "tensor-flow");
});

test("agent pipeline validates IR input without requiring a model template", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", op: "Input", family: "input", stage: 0 },
        { id: "loop", op: "CustomRecurrentCell", family: "recurrent", stage: 1, confidence: 0.8 },
      ],
      edges: [{ source: "input", target: "loop", type: "signal" }],
    },
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.readyForPreview, true);
  assert.equal(result.validation.ok, true);
  assert.equal(result.canvasDocument.nodes.find((node) => node.id === "loop").compoundKind, "operator");
});

test("agent pipeline refuses to invent a diagram from an image without a vision analyzer", () => {
  const result = analyzeArchitectureInput({ kind: "image", images: [{ name: "paper.png" }] });

  assert.equal(result.status, "needs_external_vision");
  assert.equal(result.readyForPreview, false);
  assert.ok(result.diagnostics.some((item) => item.kind === "vision-analyzer-required"));
});

test("agent pipeline does not turn unrecognized source into a fixed CNN scaffold", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: "class UnknownModel: pass",
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForPreview, true);
  assert.equal(result.summary.unresolvedNodeCount, 1);
  assert.equal(result.ir.nodes.length, 1);
  assert.equal(result.ir.nodes[0].compoundKind, "unresolved");
  assert.equal(result.ir.nodes[0].op, "UnresolvedSourceGraph");
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
});

test("agent pipeline keeps prompt-only architecture requests as low-confidence hypotheses", () => {
  const result = analyzeArchitectureInput({ kind: "prompt", prompt: "A multimodal recurrent encoder with cross attention" });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForPreview, true);
  assert.equal(result.ir.nodes[0].confidence, 0.2);
  assert.ok(result.diagnostics.some((item) => item.kind === "prompt-topology-unresolved"));
});
