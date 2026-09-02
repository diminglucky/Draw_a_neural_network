import assert from "node:assert/strict";
import test from "node:test";
import { analyzeArchitectureInput } from "./agent-pipeline.mjs";

test("generic source extraction preserves arbitrary PyTorch module calls and multi-branch topology", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = WaveletEncoder(64)
        self.fuse = CrossModalFusion(128)
        self.decoder = ArbitraryDecoder(3)
    def forward(self, image, text):
        visual = self.encoder(image)
        fused = self.fuse(visual, text)
        logits, aux = self.decoder(fused)
        return logits, aux
`,
  });

  const byOp = (op) => result.ir.nodes.find((node) => node.op === op);
  const encoder = byOp("WaveletEncoder");
  const fuse = byOp("CrossModalFusion");
  const decoder = byOp("ArbitraryDecoder");

  assert.ok(encoder);
  assert.ok(fuse);
  assert.ok(decoder);
  assert.deepEqual(fuse.ports.inputs, ["visual", "text"]);
  assert.deepEqual(decoder.ports.outputs, ["logits", "aux"]);
  assert.ok(result.ir.edges.some((edge) => edge.ports?.source === "visual" && edge.target === fuse.id));
  assert.ok(result.ir.edges.some((edge) => edge.ports?.source === "text" && edge.target === fuse.id));
  assert.ok(result.ir.edges.some((edge) => edge.source === fuse.id && edge.target === decoder.id));
  assert.ok(result.diagnostics.some((item) => item.kind === "unresolved-operator"));
  assert.equal(result.canvasDocument.nodes.find((node) => node.op === "WaveletEncoder").compoundKind, "unresolved");
  assert.ok(result.canvasDocument.edges.some((edge) => edge.ports?.source === "text" && edge.target === fuse.id));
  assert.equal(result.canvasDocument.layoutValidation.ok, true);
});

test("generic source extraction preserves arbitrary Keras layer names and list-valued merges", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "keras",
    source: `
inputs = keras.Input((224, 224, 3))
tokens = layers.TokenMixer(width=64)(inputs)
left, right = layers.SplitHeads(2)(tokens)
outputs = layers.CrossModalMerge()([left, right])
model = keras.Model(inputs, outputs)
`,
  });

  const split = result.ir.nodes.find((node) => node.op === "SplitHeads");
  const merge = result.ir.nodes.find((node) => node.op === "CrossModalMerge");
  assert.ok(split);
  assert.ok(merge);
  assert.deepEqual(split.ports.outputs, ["left", "right"]);
  assert.deepEqual(merge.ports.inputs, ["left", "right"]);
  assert.ok(result.ir.edges.some((edge) => edge.ports?.source === "left" && edge.target === merge.id));
  assert.ok(result.ir.edges.some((edge) => edge.ports?.source === "right" && edge.target === merge.id));
});

test("generic source extraction materializes dynamic control flow as unresolved compounds", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class DynamicNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.skip = ConditionalBlock(64)
        self.identity = IdentityRoute()
        self.loop = RecurrentUpdate(64)
    def forward(self, x, use_skip):
        if use_skip:
            x = self.skip(x)
        else:
            x = self.identity(x)
        for _ in range(2):
            x = self.loop(x)
        return x
`,
  });

  const conditional = result.ir.nodes.find((node) => node.op === "ConditionalBranch");
  const loop = result.ir.nodes.find((node) => node.op === "Loop");
  assert.ok(conditional);
  assert.ok(loop);
  assert.equal(conditional.compoundKind, "unresolved");
  assert.equal(loop.compoundKind, "unresolved");
  assert.ok(result.ir.edges.some((edge) => edge.type === "control" && edge.target.includes("conditionalblock")));
  assert.ok(result.ir.edges.some((edge) => edge.type === "control" && edge.target.includes("recurrentupdate")));
  assert.ok(result.diagnostics.some((item) => item.kind === "dynamic-control-flow"));
  assert.equal(result.status, "needs_confirmation");
});

test("generic source extraction preserves recurrent state ports and LSTM evidence", () => {
  const result = analyzeArchitectureInput({
    kind: "source",
    framework: "pytorch",
    source: `
class LSTMNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.cell = nn.LSTMCell(128, 64)
    def forward(self, x, state):
        h, c = self.cell(x, state)
        return h, c
`,
  });

  assert.equal(result.status, "ready_for_preview");
  const recurrent = result.ir.nodes.find((node) => node.family === "recurrent");
  assert.ok(recurrent);
  assert.deepEqual(recurrent.ports.inputs, ["x", "state"]);
  assert.deepEqual(recurrent.ports.outputs, ["h", "c"]);
  assert.ok(recurrent.evidence.some((item) => item.kind === "source-call" && item.operation === "LSTMCell"));
  assert.equal(result.figurePlan.nodes.find((node) => node.sourceNodeId === recurrent.id).visualRole, "recurrent-state");
});
