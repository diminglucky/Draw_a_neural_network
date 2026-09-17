import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyzeArchitectureInput, extractArchitectureEvidence, normalizeArchitectureEvidence, planArchitectureFigure } from "./agent-pipeline.mjs";
import onnxProto from "onnx-proto";

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
  assert.equal(result.visioDiagramPlan.scene.version, "laid-out-neural-scene/v1");
  assert.equal(result.visioDiagramPlan.scene.units, "layout-unit");
  assert.ok(result.visioDiagramPlan.scene.primitives.every((primitive) => primitive.bounds));
  assert.equal(result.visioDiagramPlanValidation.ok, true);
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "cell").shapeKind, "cell");
  assert.equal(result.visioDiagramPlan.edges.find((edge) => edge.sourceEdgeId === "loop").type, "loop");
  assert.ok(result.visioDiagramPlan.edges.find((edge) => edge.sourceEdgeId === "loop").route.points.length > 1);
});

test("agent pipeline preserves explicit architecture groups in IR while producing a valid Scene plan", () => {
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
  assert.equal(result.visioDiagramPlan.scene.version, "laid-out-neural-scene/v1");
  assert.equal(result.visioDiagramPlanValidation.ok, true);
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

test("agent pipeline routes source code through Universal IR and returns a Visio-ready Diagram Plan", () => {
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
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
  assert.ok(result.visioDiagramPlan);
  assert.equal(result.figureLayout, undefined);
  assert.equal(result.visioDiagramPlan.scene.version, "laid-out-neural-scene/v1");
  assert.equal(result.visioDiagramPlanValidation.ok, true);
});

test("production build exposes only the Scene-backed Visio Diagram Plan", () => {
  const result = planArchitectureFigure(normalizeArchitectureEvidence({
    kind: "ir",
    rawIR: {
      nodes: [
        { id: "input", family: "input", op: "Input", stage: 0 },
        { id: "output", family: "output", op: "Output", stage: 1 },
      ],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
    input: { kind: "ir" },
  }));

  assert.equal(result.figureLayout, undefined);
  assert.equal(result.visioDiagramPlan.scene.version, "laid-out-neural-scene/v1");
  assert.equal(result.visioDiagramPlan.validation.ok, true);
  assert.equal(result.visioDiagramPlanValidation.ok, true);
});

test("production pipeline blocks a hard Scene layout issue while a normal Scene remains renderable", () => {
  const normal = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "input", family: "input", op: "Input", stage: 0 },
        { id: "output", family: "output", op: "Output", stage: 1 },
      ],
      edges: [{ id: "flow", source: "input", target: "output" }],
    },
  });
  const invalidLayout = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "n0", family: "input", op: "Input", stage: 0 },
        { id: "n1", family: "conv", op: "Conv", stage: 1 },
        { id: "n2", family: "conv", op: "Conv", stage: 2 },
        { id: "n3", family: "output", op: "Output", stage: 3 },
      ],
      edges: [
        { id: "e0", source: "n0", target: "n1" },
        { id: "e1", source: "n0", target: "n2" },
        { id: "e2", source: "n0", target: "n3" },
        { id: "e4", source: "n1", target: "n2" },
        { id: "e6", source: "n2", target: "n0" },
      ],
    },
  });

  assert.equal(normal.status, "ready_for_visio");
  assert.equal(normal.readyForVisio, true);
  assert.ok(normal.visioDiagramPlan);
  assert.equal(invalidLayout.status, "invalid_input");
  assert.equal(invalidLayout.readyForVisio, false);
  assert.equal(invalidLayout.visioDiagramPlan, undefined);
  assert.ok(invalidLayout.diagnostics.some((item) => (
    item.kind === "layout-issue"
    && item.issueCode === "connector-body-intersection"
  )));
});

test("production Scene preserves finite nested container bounds", () => {
  const result = analyzeArchitectureInput({
    kind: "ir",
    ir: {
      nodes: [
        { id: "left", family: "conv", containerId: "encoder" },
        { id: "right", family: "output", containerId: "decoder" },
      ],
      edges: [{ id: "flow", source: "left", target: "right" }],
      containers: [
        { id: "model", children: ["encoder", "decoder"] },
        { id: "encoder", parentId: "model", children: ["left"] },
        { id: "decoder", parentId: "model", children: ["right"] },
      ],
    },
  });

  assert.equal(result.readyForVisio, true);
  const groups = new Map(result.visioDiagramPlan.scene.groups.map((group) => [group.id, group]));
  assert.ok(["model", "encoder", "decoder"].every((id) => Object.values(groups.get(id).bounds).every(Number.isFinite)));
  assert.ok(groups.get("encoder").bounds.x + groups.get("encoder").bounds.w <= groups.get("decoder").bounds.x);
  assert.equal(result.visioDiagramPlanValidation.ok, true);
});

test("agent pipeline has no production dependency on layoutUniversalFigure", () => {
  const source = readFileSync(new URL("./agent-pipeline.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\blayoutUniversalFigure\b/);
  assert.doesNotMatch(source, /["']\.\/universal-figure\.mjs["']/);
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
  assert.equal(result.figureLayout, undefined);
  assert.equal(result.visioDiagramPlanValidation.ok, true);
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
  assert.equal(result.visioDiagramPlan.nodes.find((node) => node.sourceNodeId === "loop").shapeKind, "cell");
  assert.equal(result.visioDiagramPlanValidation.ok, true);
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

test("prompt-only architecture aliases stop at resolver candidates without fabricated topology", async () => {
  const evidence = await extractArchitectureEvidence({ kind: "prompt", prompt: "draw detector" }, { resolver: { registry: [
    { id: "v1", names: ["Detector One", "detector"], repository: "https://example.test/model", revision: "a".repeat(40) },
    { id: "v2", names: ["Detector Two", "detector"], repository: "https://example.test/model", revision: "b".repeat(40) },
  ] } });
  assert.equal(evidence.version, "architecture-evidence-package/v1");
  assert.equal(evidence.status, "needs_resolution");
  assert.equal(evidence.graph.nodes.length, 0);
  assert.equal(evidence.unresolvedQuestions.length, 1);
});

test("pinned config input becomes an Evidence Package and reaches Universal IR", async () => {
  const evidence = await extractArchitectureEvidence({ kind: "config", config: { pipeline: [
    [-1, 1, "ArbitraryStem", { width: 32 }],
    [-1, 2, "ArbitraryBlock", { width: 64 }],
  ] }, revision: "abc1234", sourceId: "cfg-1", metadata: { uri: "file:///model.yaml", authority: 4 } });
  const normalized = normalizeArchitectureEvidence(evidence);
  assert.equal(evidence.version, "architecture-evidence-package/v1");
  assert.deepEqual(normalized.ir.nodes.map((node) => node.op), ["ArbitraryStem", "ArbitraryBlock"]);
  assert.equal(normalized.evidencePackage.version, "architecture-evidence-package/v1");
});

test("pinned ONNX artifact reaches Universal IR without executing model code", async () => {
  const { onnx } = onnxProto;
  const data = onnx.ModelProto.encode(onnx.ModelProto.create({ graph: { node: [
    { name: "custom", opType: "UserDefinedOperator", input: ["x"], output: ["y"] },
  ], input: [{ name: "x" }], output: [{ name: "y" }] } })).finish();
  const evidence = await extractArchitectureEvidence({ kind: "artifact", artifact: { format: "onnx", data }, revision: "abc1234", sourceId: "onnx-1", metadata: { uri: "file:///model.onnx", authority: 5 } });
  const normalized = normalizeArchitectureEvidence(evidence);
  assert.equal(evidence.status, "grounded");
  assert.equal(normalized.ir.nodes[0].op, "UserDefinedOperator");
  assert.equal(normalized.evidencePackage.sources[0].id, "onnx-1");
});

test("pinned repository configuration is acquired and normalized through the injected fetcher", async () => {
  const evidence = await extractArchitectureEvidence({
    kind: "repository",
    repository: "https://github.com/example/network",
    revision: "a".repeat(40),
    entryPoint: "models/network.yaml",
    sourceId: "repo-config",
  }, { resolver: {
    fetchRepository: async () => ({ content: "pipeline:\n  - [-1, 1, RepoDefinedBlock, {width: 48}]", license: "MIT" }),
  } });
  const normalized = normalizeArchitectureEvidence(evidence);
  assert.equal(evidence.status, "grounded");
  assert.equal(evidence.identity.revision, "a".repeat(40));
  assert.equal(normalized.ir.nodes[0].op, "RepoDefinedBlock");
  assert.equal(normalized.evidencePackage.sources[0].license, "MIT");
});
