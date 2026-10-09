import assert from "node:assert/strict";
import test from "node:test";

import {
  NEURAL_BLOCK_IR_VERSION,
  deriveNeuralBlocks,
  normalizeNeuralBlocks,
  upgradeNeuralBlocks,
  validateNeuralBlocks,
} from "./neural-block-ir.mjs";

function ir(nodes, edges) {
  return { version: "universal-neural-ir/v1", nodes, edges };
}

test("derives convolution blocks from conv-norm-activation runs", () => {
  const source = ir(
    [
      { id: "input", family: "input", op: "Input" },
      { id: "conv", family: "conv", op: "Conv2d" },
      { id: "bn", family: "norm", op: "BatchNorm2d" },
      { id: "relu", family: "activation", op: "ReLU" },
      { id: "output", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "input", target: "conv" },
      { id: "e2", source: "conv", target: "bn" },
      { id: "e3", source: "bn", target: "relu" },
      { id: "e4", source: "relu", target: "output" },
    ],
  );
  const blocks = deriveNeuralBlocks(source);
  const conv = blocks.blocks.find((block) => block.kind === "conv-block");
  assert.deepEqual(conv.nodeIds, ["conv", "bn", "relu"]);
  assert.equal(validateNeuralBlocks(blocks, source).ok, true);
});

test("derives residual blocks from merge topology without model-name rules", () => {
  const source = ir(
    [
      { id: "input", family: "input", op: "Input" },
      { id: "conv", family: "conv", op: "Conv2d" },
      { id: "bn", family: "norm", op: "BatchNorm2d" },
      { id: "add", family: "merge", op: "Add" },
      { id: "output", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "input", target: "conv" },
      { id: "e2", source: "conv", target: "bn" },
      { id: "e3", source: "bn", target: "add" },
      { id: "e4", source: "input", target: "add", type: "residual" },
      { id: "e5", source: "add", target: "output" },
    ],
  );
  const blocks = deriveNeuralBlocks(source);
  const residual = blocks.blocks.find((block) => block.kind === "residual-block");
  assert.deepEqual(residual.nodeIds, ["conv", "bn", "add"]);
  assert.equal(residual.edgeIds.includes("e4"), false);
  assert.deepEqual(residual.entryNodeIds, ["conv"]);
  assert.deepEqual(residual.exitNodeIds, ["add"]);
});

test("derives attention and feed-forward blocks", () => {
  const source = ir(
    [
      { id: "input", family: "input", op: "Input" },
      { id: "attn", family: "attention", op: "MultiheadAttention" },
      { id: "norm", family: "norm", op: "LayerNorm" },
      { id: "dense1", family: "dense", op: "Linear" },
      { id: "gelu", family: "activation", op: "GELU" },
      { id: "dense2", family: "dense", op: "Linear" },
      { id: "output", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "input", target: "attn" },
      { id: "e2", source: "attn", target: "norm" },
      { id: "e3", source: "norm", target: "dense1" },
      { id: "e4", source: "dense1", target: "gelu" },
      { id: "e5", source: "gelu", target: "dense2" },
      { id: "e6", source: "dense2", target: "output" },
    ],
  );
  const blocks = deriveNeuralBlocks(source);
  assert.ok(blocks.blocks.some((block) => block.kind === "attention-block" && block.nodeIds.includes("attn")));
  assert.ok(blocks.blocks.some((block) => block.kind === "ffn-block" && block.nodeIds.includes("dense1")));
});

test("derives encoder, decoder, detection, recurrent, and multi-scale blocks with ports", () => {
  const source = ir(
    [
      { id: "input", family: "input", op: "Input", ports: { inputs: [], outputs: ["image"] } },
      { id: "enc-conv", family: "conv", op: "Conv2d", ports: { inputs: ["image"], outputs: ["p1"] } },
      { id: "pool", family: "pool", op: "MaxPool2d", ports: { inputs: ["p1"], outputs: ["p1"] } },
      { id: "cell", family: "recurrent", op: "LSTMCell", ports: { inputs: ["p2"], outputs: ["state"] } },
      { id: "up", family: "upsample", op: "Upsample" },
      { id: "dec-conv", family: "conv", op: "Conv2d" },
      { id: "cat", family: "merge", op: "Concat" },
      { id: "head", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "input", target: "enc-conv" },
      { id: "e2", source: "enc-conv", target: "pool" },
      { id: "e3", source: "pool", target: "cell" },
      { id: "e4", source: "cell", target: "up", type: "state" },
      { id: "e5", source: "up", target: "dec-conv" },
      { id: "e6", source: "dec-conv", target: "cat" },
      { id: "e7", source: "pool", target: "cat", type: "cross-scale" },
      { id: "e8", source: "cat", target: "head" },
    ],
  );
  const facts = {
    nodeFacts: {
      input: { ports: { value: { inputs: [], outputs: ["image"] } } },
      "enc-conv": { ports: { value: { inputs: ["image"], outputs: ["p1"] } } },
      pool: { ports: { value: { inputs: ["p1"], outputs: ["p1"] } } },
    },
    motifs: { motifs: [{ id: "m1", kind: "multi-scale-fusion", nodeIds: ["pool", "cell", "cat"] }] },
  };
  const blocks = deriveNeuralBlocks(source, facts);
  assert.ok(blocks.blocks.some((block) => block.kind === "encoder-stage" && block.nodeIds.includes("pool")));
  assert.ok(blocks.blocks.some((block) => block.kind === "decoder-stage" && block.nodeIds.includes("dec-conv")));
  assert.ok(blocks.blocks.some((block) => block.kind === "multi-scale-fusion" && block.nodeIds.includes("cat")));
  assert.ok(blocks.blocks.some((block) => block.kind === "detection-head" && block.nodeIds.includes("head")));
  assert.ok(blocks.blocks.some((block) => block.kind === "recurrent-cell" && block.nodeIds.includes("cell")));
  const encoder = blocks.blocks.find((block) => block.kind === "encoder-stage");
  assert.deepEqual(encoder.entryNodeIds, ["enc-conv"]);
  assert.deepEqual(encoder.exitNodeIds, ["pool"]);
  assert.deepEqual(encoder.entryPorts, ["image"]);
  assert.deepEqual(encoder.exitPorts, ["p1"]);
  assert.deepEqual(encoder.entryPortMappings[0], {
    edgeId: "e1",
    nodeId: "enc-conv",
    sourceNodeId: "input",
    portId: "",
  });
  assert.equal(encoder.exitPortMappings.length, 2);
});

test("derives repeat blocks for consecutive identical operators", () => {
  const source = ir(
    [
      { id: "input", family: "input", op: "Input" },
      { id: "block1", family: "conv", op: "Conv2d" },
      { id: "block2", family: "conv", op: "Conv2d" },
      { id: "block3", family: "conv", op: "Conv2d" },
      { id: "output", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "input", target: "block1" },
      { id: "e2", source: "block1", target: "block2" },
      { id: "e3", source: "block2", target: "block3" },
      { id: "e4", source: "block3", target: "output" },
    ],
  );
  const blocks = deriveNeuralBlocks(source);
  const repeat = blocks.blocks.find((block) => block.kind === "repeat-block");
  assert.deepEqual(repeat.nodeIds, ["block1", "block2", "block3"]);
  assert.equal(repeat.repeatCount, 3);
});

test("upgrades legacy Block IR snapshots to the current schema", () => {
  const legacy = {
    version: "neural-block-ir/v0",
    irVersion: "universal-neural-ir/v1",
    blocks: [{ kind: "conv-block", nodeIds: ["conv"], edgeIds: [] }],
  };
  const upgraded = upgradeNeuralBlocks(legacy);
  assert.equal(upgraded.version, NEURAL_BLOCK_IR_VERSION);
  assert.equal(upgraded.blocks[0].id, "block:conv-block:conv");
  assert.deepEqual(upgraded.blocks[0].nodeIds, ["conv"]);
  assert.equal(upgraded.blocks[0].blockBadge, "conv");
  assert.ok(upgraded.blocks[0].layoutHint);
  assert.deepEqual(upgraded.nodeToBlock, { conv: ["block:conv-block:conv"] });
  assert.ok(upgraded.diagnostics.some((item) => item.code === "neural-block-ir-migrated"));
  assert.equal(validateNeuralBlocks(upgraded, ir([{ id: "conv", family: "conv" }], [])).ok, true);
});

test("upgrades v1 Block IR and normalizes legacy snapshots through one boundary", () => {
  const legacy = {
    version: "neural-block-ir/v1",
    irVersion: "universal-neural-ir/v1",
    blocks: [{ id: "block:v1", kind: "attention-block", nodeIds: ["attn"], nodeToBlock: {} }],
    nodeToBlock: {},
  };
  const normalized = normalizeNeuralBlocks(legacy, ir([{ id: "attn", family: "attention" }], []));
  assert.equal(normalized.version, NEURAL_BLOCK_IR_VERSION);
  assert.equal(normalized.blocks[0].blockBadge, "attention");
  assert.deepEqual(normalized.nodeToBlock.attn, ["block:v1"]);
});

test("derives graph blocks from graph-domain motifs", () => {
  const source = ir(
    [
      { id: "nodes", family: "input", op: "GraphInput", attributes: { dataDomain: "graph" } },
      { id: "gcn", family: "graph", op: "GCNConv" },
      { id: "gat", family: "graph", op: "GATConv" },
      { id: "output", family: "output", op: "Output" },
    ],
    [
      { id: "e1", source: "nodes", target: "gcn" },
      { id: "e2", source: "gcn", target: "gat" },
      { id: "e3", source: "gat", target: "output" },
    ],
  );
  const facts = {
    nodeFacts: {},
    motifs: { motifs: [{ id: "g1", kind: "graph-message-passing", nodeIds: ["gcn", "gat"] }] },
  };
  const blocks = deriveNeuralBlocks(source, facts);
  const graphBlock = blocks.blocks.find((block) => block.kind === "graph-block");
  assert.deepEqual(graphBlock.nodeIds, ["gcn", "gat"]);
  assert.equal(graphBlock.blockBadge, "GNN");
  assert.equal(graphBlock.layoutHint.messagePassing, true);
  assert.equal(validateNeuralBlocks(blocks, source).ok, true);
});

test("only labels routed fan-in as MoE", () => {
  const generic = ir(
    [
      { id: "input", family: "input" },
      { id: "a", family: "dense", op: "Linear" },
      { id: "b", family: "dense", op: "Linear" },
      { id: "c", family: "dense", op: "Linear" },
      { id: "merge", family: "merge", op: "Concat" },
    ],
    [
      { id: "e1", source: "input", target: "a" },
      { id: "e2", source: "input", target: "b" },
      { id: "e3", source: "input", target: "c" },
      { id: "e4", source: "a", target: "merge" },
      { id: "e5", source: "b", target: "merge" },
      { id: "e6", source: "c", target: "merge" },
    ],
  );
  const routed = {
    ...generic,
    edges: generic.edges.map((edge) => edge.target === "merge" ? { ...edge, type: "expert" } : edge),
  };
  assert.equal(deriveNeuralBlocks(generic).blocks.some((block) => block.kind === "moe-block"), false);
  assert.equal(deriveNeuralBlocks(routed).blocks.some((block) => block.kind === "moe-block"), true);
});
