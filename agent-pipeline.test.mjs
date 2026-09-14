import assert from "node:assert/strict";
import test from "node:test";

import { analyzeArchitectureInput } from "./agent-pipeline.mjs";

test("agent pipeline returns a Visio Diagram Plan for direct IR", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input", stage: 0 },
        { id: "cell", family: "recurrent", op: "LSTMCell", stage: 1 },
      ],
      edges: [
        { id: "flow", source: "input", target: "cell", type: "signal" },
        { id: "loop", source: "cell", target: "cell", type: "loop" },
      ],
    },
  });

  assert.equal(result.visioDiagramPlan.version, "visio-diagram-plan/v1");
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "cell").compoundKind, "operator");
  assert.equal(result.visioDiagramPlan.edges.find((edge) => edge.sourceEdgeId === "loop").route.kind, "loop");
});

test("agent pipeline preserves explicit architecture groups into Visio layout", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "a", family: "conv", op: "Conv", stage: 0 },
        { id: "b", family: "output", op: "Head", stage: 1 },
      ],
      edges: [{ id: "ab", source: "a", target: "b" }],
      groups: [
        { id: "backbone", label: "Backbone", kind: "backbone", nodeIds: ["a"] },
        { id: "head", label: "Head", kind: "head", nodeIds: ["b"] },
      ],
    },
  });

  assert.equal(result.ir.groups.length, 2);
  assert.deepEqual(result.figureLayout.groups.map((group) => group.id), ["backbone", "head"]);
  assert.equal(result.visioDiagramPlan.groups.length, 2);
});

test("agent pipeline preserves nested containers and scale lanes into Visio layout", () => {
  const result = analyzeArchitectureInput({ kind: "ir", ir: {
    nodes: [
      { id: "p3", family: "conv", op: "Conv", containerId: "backbone", laneId: "p3", stage: 0 },
      { id: "f3", family: "merge", op: "Concat", containerId: "neck", laneId: "p3", stage: 1 },
      { id: "h3", family: "output", op: "Detect", containerId: "head", laneId: "p3", stage: 2 },
    ],
    edges: [{ id: "p3-f3", source: "p3", target: "f3" }, { id: "f3-h3", source: "f3", target: "h3" }],
    containers: [
      { id: "root", direction: "horizontal", children: ["backbone", "neck", "head"] },
      { id: "backbone", parentId: "root", direction: "vertical", children: ["p3"] },
      { id: "neck", parentId: "root", direction: "vertical", children: ["f3"] },
      { id: "head", parentId: "root", direction: "vertical", children: ["h3"] },
    ],
    lanes: [{ id: "p3", key: "p3", label: "P3", kind: "spatial-scale", order: 0 }],
  } });

  assert.equal(result.ir.containers.length, 4);
  assert.equal(result.ir.lanes.length, 1);
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "f3").containerId, "neck");
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "f3").laneId, "p3");
});

test("agent pipeline routes source code through Universal IR and returns a Visio-ready Figure Plan", () => {
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
  assert.equal(result.readyForVisio, true);
  assert.ok(result.ir.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.ok(result.visioDiagramPlan.nodes.some((node) => node.compoundKind === "unresolved"));
  assert.equal(result.figureLayout.grammar.id, "generic-dag");
  assert.ok(result.figureLayout.nodes.some((node) => node.representation === "compound"));
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
  assert.ok(result.visioDiagramPlan);
  assert.deepEqual(
    result.visioDiagramPlan.nodes.map((node) => node.sourceNodeId),
    result.figureLayout.nodes.map((node) => node.sourceNodeId),
  );
});

test("production analysis exposes one Visio Diagram Plan for direct IR", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input", stage: 0 },
        { id: "cell", family: "recurrent", op: "LSTMCell", stage: 1 },
      ],
      edges: [{ id: "state-loop", source: "cell", target: "cell", type: "loop" }, { id: "flow", source: "input", target: "cell" }],
    },
  });

  assert.ok(result.visioDiagramPlan);
  assert.equal(result.visioDiagramPlan.edges.find((edge) => edge.sourceEdgeId === "state-loop").type, "loop");
  assert.deepEqual(result.visioDiagramPlan.nodes.map((node) => node.sourceNodeId), ["input", "cell"]);
  assert.equal(result.visioDiagramPlan.validation.ok, true);
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

  assert.equal(result.status, "ready_for_visio");
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

  assert.equal(result.status, "ready_for_visio");
  assert.equal(result.ir.nodes.some((node) => node.op === "Sequential"), false);
  assert.equal(result.ir.nodes.some((node) => node.op === "randn"), false);
  assert.ok(result.ir.nodes.some((node) => node.family === "conv"));
  assert.ok(result.ir.nodes.some((node) => node.family === "pool"));
  assert.ok(result.ir.nodes.some((node) => node.family === "dense"));
  assert.equal(result.ir.nodes.find((node) => node.family === "input").subtitle, "source tensor");
  assert.equal(result.figureLayout.grammar.id, "tensor-flow");
});

test("agent pipeline validates IR input without requiring a model registry", () => {
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

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForVisio, true);
  assert.equal(result.validation.ok, true);
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "loop").compoundKind, "operator");
});

test("agent pipeline refuses to invent a diagram from an image without a vision analyzer", () => {
  const result = analyzeArchitectureInput({ kind: "image", images: [{ name: "paper.png" }] });

  assert.equal(result.status, "needs_external_vision");
  assert.equal(result.readyForVisio, false);
  assert.ok(result.diagnostics.some((item) => item.kind === "vision-analyzer-required"));
});

test("agent pipeline does not turn unrecognized source into a fixed CNN scaffold", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: "class UnknownModel: pass",
  });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForVisio, true);
  assert.equal(result.summary.unresolvedNodeCount, 1);
  assert.equal(result.ir.nodes.length, 1);
  assert.equal(result.ir.nodes[0].compoundKind, "unresolved");
  assert.equal(result.ir.nodes[0].op, "UnresolvedSourceGraph");
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
});

test("agent pipeline keeps prompt-only architecture requests as low-confidence hypotheses", () => {
  const result = analyzeArchitectureInput({ kind: "prompt", prompt: "A multimodal recurrent encoder with cross attention" });

  assert.equal(result.status, "needs_confirmation");
  assert.equal(result.readyForVisio, true);
  assert.equal(result.ir.nodes[0].confidence, 0.2);
  assert.ok(result.diagnostics.some((item) => item.kind === "prompt-topology-unresolved"));
});

test("named modules (compoundKind module) are not counted as unresolved", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input", stage: 0 },
        { id: "c2f", family: "custom", compoundKind: "module", label: "C2f", stage: 1 },
        { id: "output", family: "output", op: "Output", stage: 2 },
      ],
      edges: [
        { id: "e1", source: "input", target: "c2f" },
        { id: "e2", source: "c2f", target: "output" },
      ],
    },
  });

  assert.equal(result.summary.unresolvedNodeCount, 0);
  assert.notEqual(result.status, "needs_confirmation");
});
