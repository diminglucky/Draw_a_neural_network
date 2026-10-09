const mixed = {
  name: "mixed",
  capabilities: ["sequential-cnn", "repeat", "xN-collapse", "detection-head"],
  expectedKinds: ["conv-block", "repeat-block", "detection-head"],
  ir: {
    figure: { title: "Block Acceptance", subtitle: "Sequential, repeat, head" },
    nodes: [
      { id: "input", family: "input", op: "Input", ports: { inputs: [], outputs: ["image"] } },
      { id: "enc", family: "conv", op: "Conv2d", ports: { inputs: ["image"], outputs: ["p1"] } },
      { id: "b1", family: "conv", op: "ResidualConv" },
      { id: "b2", family: "conv", op: "ResidualConv" },
      { id: "b3", family: "conv", op: "ResidualConv" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "enc" },
      { id: "e2", source: "enc", target: "b1" },
      { id: "e3", source: "b1", target: "b2" },
      { id: "e4", source: "b2", target: "b3" },
      { id: "e5", source: "b3", target: "output" },
    ],
  },
};

const residual = {
  name: "residual",
  capabilities: ["residual-cnn", "skip-connection"],
  expectedKinds: ["residual-block"],
  ir: {
    figure: { title: "Residual Acceptance", subtitle: "Skip connection" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "conv", family: "conv", op: "Conv2d" },
      { id: "bn", family: "norm", op: "BatchNorm2d" },
      { id: "add", family: "merge", op: "Add" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "conv" },
      { id: "e2", source: "conv", target: "bn" },
      { id: "e3", source: "bn", target: "add" },
      { id: "e4", source: "input", target: "add", type: "residual" },
      { id: "e5", source: "add", target: "output" },
    ],
  },
};

const repeat = {
  name: "repeat",
  capabilities: ["repeated-operators", "xN-collapse"],
  expectedKinds: ["repeat-block"],
  ir: {
    figure: { title: "Repeat Acceptance", subtitle: "Repeated operators" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "b1", family: "conv", op: "Conv2d" },
      { id: "b2", family: "conv", op: "Conv2d" },
      { id: "b3", family: "conv", op: "Conv2d" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "b1" },
      { id: "e2", source: "b1", target: "b2" },
      { id: "e3", source: "b2", target: "b3" },
      { id: "e4", source: "b3", target: "output" },
    ],
  },
};

const transformer = {
  name: "transformer",
  capabilities: ["transformer", "attention", "feed-forward"],
  expectedKinds: ["attention-block", "ffn-block"],
  ir: {
    figure: { title: "Transformer Acceptance", subtitle: "Attention and feed-forward" },
    nodes: [
      { id: "tokens", family: "input", op: "Input", attributes: { dataDomain: "sequence" } },
      { id: "attn", family: "attention", op: "MultiheadAttention" },
      { id: "norm", family: "norm", op: "LayerNorm" },
      { id: "dense1", family: "dense", op: "Linear" },
      { id: "gelu", family: "activation", op: "GELU" },
      { id: "dense2", family: "dense", op: "Linear" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "tokens", target: "attn" },
      { id: "e2", source: "attn", target: "norm" },
      { id: "e3", source: "norm", target: "dense1" },
      { id: "e4", source: "dense1", target: "gelu" },
      { id: "e5", source: "gelu", target: "dense2" },
      { id: "e6", source: "dense2", target: "output" },
    ],
  },
};

const encoderDecoder = {
  name: "encoder-decoder",
  capabilities: ["u-net", "encoder", "decoder", "skip-connection"],
  expectedKinds: ["encoder-stage", "decoder-stage"],
  ir: {
    figure: { title: "Encoder Decoder Acceptance", subtitle: "U-shaped layout" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "enc", family: "conv", op: "Conv2d", ports: { inputs: ["image"], outputs: ["p1"] } },
      { id: "pool", family: "pool", op: "MaxPool2d", ports: { inputs: ["p1"], outputs: ["p1"] } },
      { id: "bottleneck", family: "conv", op: "Conv2d" },
      { id: "up", family: "upsample", op: "Upsample" },
      { id: "dec", family: "conv", op: "Conv2d" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "enc" },
      { id: "e2", source: "enc", target: "pool" },
      { id: "e3", source: "pool", target: "bottleneck" },
      { id: "e4", source: "bottleneck", target: "up" },
      { id: "e5", source: "up", target: "dec" },
      { id: "e6", source: "enc", target: "dec", type: "skip" },
      { id: "e7", source: "dec", target: "output" },
    ],
  },
};

const recurrent = {
  name: "recurrent",
  capabilities: ["rnn", "lstm", "gru", "state-feedback"],
  expectedKinds: ["recurrent-cell"],
  ir: {
    figure: { title: "Recurrent Acceptance", subtitle: "State feedback" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "cell", family: "recurrent", op: "LSTMCell", ports: { inputs: ["x", "state"], outputs: ["state"] } },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "cell" },
      { id: "e2", source: "cell", target: "cell", type: "state" },
      { id: "e3", source: "cell", target: "output" },
    ],
  },
};

const moe = {
  name: "moe",
  capabilities: ["mixture-of-experts", "router", "expert-branches"],
  expectedKinds: ["moe-block"],
  ir: {
    figure: { title: "MoE Acceptance", subtitle: "Router and expert branches" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "expert1", family: "dense", op: "ExpertLinear" },
      { id: "expert2", family: "dense", op: "ExpertLinear" },
      { id: "expert3", family: "dense", op: "ExpertLinear" },
      { id: "merge", family: "merge", op: "WeightedAdd" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "expert1", type: "route" },
      { id: "e2", source: "input", target: "expert2", type: "route" },
      { id: "e3", source: "input", target: "expert3", type: "route" },
      { id: "e4", source: "expert1", target: "merge", type: "expert" },
      { id: "e5", source: "expert2", target: "merge", type: "expert" },
      { id: "e6", source: "expert3", target: "merge", type: "expert" },
      { id: "e7", source: "merge", target: "output" },
    ],
  },
};

const graph = {
  name: "graph",
  capabilities: ["gnn", "message-passing", "graph-domain"],
  expectedKinds: ["graph-block"],
  ir: {
    figure: { title: "Graph Acceptance", subtitle: "Message passing" },
    nodes: [
      { id: "nodes", family: "input", op: "GraphInput", attributes: { dataDomain: "graph" } },
      { id: "gcn", family: "graph", op: "GCNConv", attributes: { dataDomain: "graph" } },
      { id: "gat", family: "graph", op: "GATConv", attributes: { dataDomain: "graph" } },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "nodes", target: "gcn" },
      { id: "e2", source: "gcn", target: "gat" },
      { id: "e3", source: "gat", target: "output" },
    ],
  },
};

const vit = {
  name: "vit",
  capabilities: ["vision-transformer", "patch-embedding", "attention", "feed-forward"],
  expectedKinds: ["conv-block", "attention-block", "ffn-block", "detection-head"],
  ir: {
    figure: { title: "ViT Acceptance", subtitle: "Patch embedding, attention, FFN" },
    nodes: [
      { id: "image", family: "input", op: "ImageInput", attributes: { dataDomain: "spatial" } },
      { id: "patch", family: "conv", op: "PatchEmbedding" },
      { id: "tokens", family: "flatten", op: "TokenFlatten" },
      { id: "attn", family: "attention", op: "MultiheadAttention", attributes: { dataDomain: "sequence" } },
      { id: "attn-norm", family: "norm", op: "LayerNorm" },
      { id: "dense1", family: "dense", op: "Linear" },
      { id: "gelu", family: "activation", op: "GELU" },
      { id: "dense2", family: "dense", op: "Linear" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "image", target: "patch" },
      { id: "e2", source: "patch", target: "tokens" },
      { id: "e3", source: "tokens", target: "attn" },
      { id: "e4", source: "attn", target: "attn-norm" },
      { id: "e5", source: "attn-norm", target: "dense1" },
      { id: "e6", source: "dense1", target: "gelu" },
      { id: "e7", source: "gelu", target: "dense2" },
      { id: "e8", source: "dense2", target: "output" },
    ],
  },
};

const multimodal = {
  name: "multimodal",
  capabilities: ["multi-input", "vision-language", "cross-attention", "feed-forward"],
  expectedKinds: ["conv-block", "attention-block", "ffn-block", "detection-head"],
  ir: {
    figure: { title: "Multimodal Acceptance", subtitle: "Image and text streams" },
    nodes: [
      { id: "image", family: "input", op: "ImageInput", attributes: { dataDomain: "spatial" } },
      { id: "text", family: "input", op: "TextInput", attributes: { dataDomain: "sequence" } },
      { id: "vision", family: "conv", op: "VisionEncoder" },
      { id: "language", family: "dense", op: "TextEmbedding" },
      { id: "cross", family: "attention", op: "CrossAttention" },
      { id: "dense1", family: "dense", op: "Linear" },
      { id: "gelu", family: "activation", op: "GELU" },
      { id: "dense2", family: "dense", op: "Linear" },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "image", target: "vision" },
      { id: "e2", source: "text", target: "language" },
      { id: "e3", source: "vision", target: "cross" },
      { id: "e4", source: "language", target: "cross" },
      { id: "e5", source: "cross", target: "dense1" },
      { id: "e6", source: "dense1", target: "gelu" },
      { id: "e7", source: "gelu", target: "dense2" },
      { id: "e8", source: "dense2", target: "output" },
    ],
  },
};

const dualHead = {
  name: "dual-head",
  capabilities: ["gan", "autoencoder-style-branching", "multi-head", "detection-head"],
  expectedKinds: ["detection-head"],
  ir: {
    figure: { title: "Dual Head Acceptance", subtitle: "Generator and discriminator heads" },
    nodes: [
      { id: "input", family: "input", op: "Input" },
      { id: "shared", family: "dense", op: "SharedProjection" },
      { id: "generator", family: "dense", op: "GeneratorHead" },
      { id: "discriminator", family: "dense", op: "DiscriminatorHead" },
      { id: "generated", family: "output", op: "GeneratedOutput" },
      { id: "score", family: "output", op: "ScoreOutput" },
    ],
    edges: [
      { id: "e1", source: "input", target: "shared" },
      { id: "e2", source: "shared", target: "generator" },
      { id: "e3", source: "shared", target: "discriminator" },
      { id: "e4", source: "generator", target: "generated" },
      { id: "e5", source: "discriminator", target: "score" },
    ],
  },
};

export const blockAcceptanceFixtures = Object.freeze([
  mixed,
  residual,
  repeat,
  transformer,
  encoderDecoder,
  recurrent,
  moe,
  graph,
  vit,
  multimodal,
  dualHead,
]);

export function fixtureNames() {
  return blockAcceptanceFixtures.map((fixture) => fixture.name);
}

export function findBlockAcceptanceFixture(name) {
  return blockAcceptanceFixtures.find((fixture) => fixture.name === name) || null;
}
