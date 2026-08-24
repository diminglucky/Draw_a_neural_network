import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function structuralEncoderDecoderCanonicalIr() {
  const node = (id: string, op: string, inputs: string[], outputs: string[], evidence: string) => ({ id, op, inputTensorIds: inputs, outputTensorIds: outputs, confidence: 0.95, sourceEvidenceIds: [evidence], repeats: null });
  const tensor = (id: string, name: string, shape: number[], role: "input" | "activation" | "output", producer: string, consumers: string[]) => ({ id, name, shape, axes: ["height", "width", "channel"], semanticRole: role, dtype: "float32", producerNodeId: producer, consumerNodeIds: consumers });
  const edge = (id: string, sourceNodeId: string, targetNodeId: string, tensorId: string, evidenceId: string) => ({ id, sourceNodeId, targetNodeId, relation: "data" as const, tensorIds: [tensorId], confidence: 0.95, evidenceIds: [evidenceId] });
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "structural-encoder-decoder", title: "Encoder decoder fusion topology", description: null },
    nodes: [
      node("input", "input", [], ["input-tensor"], "fact-input"),
      node("enc-1", "conv2d", ["input-tensor"], ["enc-1-tensor"], "fact-encoder"),
      node("pool-1", "pool", ["enc-1-tensor"], ["pool-1-tensor"], "fact-downsample"),
      node("enc-2", "conv2d", ["pool-1-tensor"], ["enc-2-tensor"], "fact-encoder"),
      node("pool-2", "pool", ["enc-2-tensor"], ["pool-2-tensor"], "fact-downsample"),
      node("bottleneck", "conv2d", ["pool-2-tensor"], ["bottleneck-tensor"], "fact-bottleneck"),
      node("up-2", "upsample", ["bottleneck-tensor"], ["up-2-tensor"], "fact-upsample"),
      node("concat-2", "concat", ["enc-2-tensor", "up-2-tensor"], ["concat-2-tensor"], "fact-concat-2"),
      node("dec-2", "conv2d", ["concat-2-tensor"], ["dec-2-tensor"], "fact-decoder"),
      node("up-1", "upsample", ["dec-2-tensor"], ["up-1-tensor"], "fact-upsample"),
      node("concat-1", "concat", ["enc-1-tensor", "up-1-tensor"], ["concat-1-tensor"], "fact-concat-1"),
      node("dec-1", "conv2d", ["concat-1-tensor"], ["dec-1-tensor"], "fact-decoder"),
      { id: "output", op: "output", inputTensorIds: ["dec-1-tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
    ],
    tensors: [
      tensor("input-tensor", "input", [128, 128, 3], "input", "input", ["enc-1"]),
      tensor("enc-1-tensor", "encoder level 1", [128, 128, 24], "activation", "enc-1", ["pool-1", "concat-1"]),
      tensor("pool-1-tensor", "reduced encoder level 1", [64, 64, 24], "activation", "pool-1", ["enc-2"]),
      tensor("enc-2-tensor", "encoder level 2", [64, 64, 48], "activation", "enc-2", ["pool-2", "concat-2"]),
      tensor("pool-2-tensor", "reduced encoder level 2", [32, 32, 48], "activation", "pool-2", ["bottleneck"]),
      tensor("bottleneck-tensor", "bottleneck", [32, 32, 96], "activation", "bottleneck", ["up-2"]),
      tensor("up-2-tensor", "expanded decoder level 2", [64, 64, 96], "activation", "up-2", ["concat-2"]),
      tensor("concat-2-tensor", "fused decoder level 2", [64, 64, 144], "activation", "concat-2", ["dec-2"]),
      tensor("dec-2-tensor", "decoder level 2", [64, 64, 48], "activation", "dec-2", ["up-1"]),
      tensor("up-1-tensor", "expanded decoder level 1", [128, 128, 48], "activation", "up-1", ["concat-1"]),
      tensor("concat-1-tensor", "fused decoder level 1", [128, 128, 72], "activation", "concat-1", ["dec-1"]),
      tensor("dec-1-tensor", "decoder level 1", [128, 128, 24], "output", "dec-1", ["output"]),
    ],
    edges: [
      edge("edge-input-enc-1", "input", "enc-1", "input-tensor", "fact-input"),
      edge("edge-enc-1-pool-1", "enc-1", "pool-1", "enc-1-tensor", "fact-downsample"),
      edge("edge-pool-1-enc-2", "pool-1", "enc-2", "pool-1-tensor", "fact-encoder"),
      edge("edge-enc-2-pool-2", "enc-2", "pool-2", "enc-2-tensor", "fact-downsample"),
      edge("edge-pool-2-bottleneck", "pool-2", "bottleneck", "pool-2-tensor", "fact-bottleneck"),
      edge("edge-bottleneck-up-2", "bottleneck", "up-2", "bottleneck-tensor", "fact-upsample"),
      edge("edge-enc-2-concat-2", "enc-2", "concat-2", "enc-2-tensor", "fact-concat-2"),
      edge("edge-up-2-concat-2", "up-2", "concat-2", "up-2-tensor", "fact-concat-2"),
      edge("edge-concat-2-dec-2", "concat-2", "dec-2", "concat-2-tensor", "fact-decoder"),
      edge("edge-dec-2-up-1", "dec-2", "up-1", "dec-2-tensor", "fact-upsample"),
      edge("edge-enc-1-concat-1", "enc-1", "concat-1", "enc-1-tensor", "fact-concat-1"),
      edge("edge-up-1-concat-1", "up-1", "concat-1", "up-1-tensor", "fact-concat-1"),
      edge("edge-concat-1-dec-1", "concat-1", "dec-1", "concat-1-tensor", "fact-decoder"),
      edge("edge-dec-1-output", "dec-1", "output", "dec-1-tensor", "fact-output"),
    ],
    groups: [
      { id: "encoder", label: "Encoder", nodeIds: ["enc-1", "pool-1", "enc-2", "pool-2"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"] },
      { id: "decoder", label: "Decoder", nodeIds: ["up-2", "concat-2", "dec-2", "up-1", "concat-1", "dec-1"], confidence: 0.95, sourceEvidenceIds: ["fact-decoder"] },
    ],
    unresolved: [],
  });
}
