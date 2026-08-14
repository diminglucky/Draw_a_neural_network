import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function unetCanonicalIr() {
  const nodes: any[] = [
    { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
    { id: "enc-1", op: "conv2d", inputTensorIds: ["input-tensor"], outputTensorIds: ["enc-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"], repeats: null },
    { id: "pool-1", op: "pool", inputTensorIds: ["enc-1-tensor"], outputTensorIds: ["pool-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-downsample"], repeats: null },
    { id: "enc-2", op: "conv2d", inputTensorIds: ["pool-1-tensor"], outputTensorIds: ["enc-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"], repeats: null },
    { id: "pool-2", op: "pool", inputTensorIds: ["enc-2-tensor"], outputTensorIds: ["pool-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-downsample"], repeats: null },
    { id: "bottleneck", op: "conv2d", inputTensorIds: ["pool-2-tensor"], outputTensorIds: ["bottleneck-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-bottleneck"], repeats: null },
    { id: "up-2", op: "upsample", inputTensorIds: ["bottleneck-tensor"], outputTensorIds: ["up-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-upsample"], repeats: null },
    { id: "concat-2", op: "concat", inputTensorIds: ["enc-2-tensor", "up-2-tensor"], outputTensorIds: ["concat-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-concat-2"], repeats: null },
    { id: "dec-2", op: "conv2d", inputTensorIds: ["concat-2-tensor"], outputTensorIds: ["dec-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-decoder"], repeats: null },
    { id: "up-1", op: "upsample", inputTensorIds: ["dec-2-tensor"], outputTensorIds: ["up-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-upsample"], repeats: null },
    { id: "concat-1", op: "concat", inputTensorIds: ["enc-1-tensor", "up-1-tensor"], outputTensorIds: ["concat-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-concat-1"], repeats: null },
    { id: "dec-1", op: "conv2d", inputTensorIds: ["concat-1-tensor"], outputTensorIds: ["dec-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-decoder"], repeats: null },
    { id: "output", op: "output", inputTensorIds: ["dec-1-tensor"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
  ];
  const tensors: any[] = [
    tensor("input-tensor", "input", [256, 256, 3], "input", "input", ["enc-1"]),
    tensor("enc-1-tensor", "encoder level 1", [256, 256, 64], "activation", "enc-1", ["pool-1", "concat-1"]),
    tensor("pool-1-tensor", "pooled encoder level 1", [128, 128, 64], "activation", "pool-1", ["enc-2"]),
    tensor("enc-2-tensor", "encoder level 2", [128, 128, 128], "activation", "enc-2", ["pool-2", "concat-2"]),
    tensor("pool-2-tensor", "pooled encoder level 2", [64, 64, 128], "activation", "pool-2", ["bottleneck"]),
    tensor("bottleneck-tensor", "bottleneck", [64, 64, 256], "activation", "bottleneck", ["up-2"]),
    tensor("up-2-tensor", "upsampled decoder level 2", [128, 128, 256], "activation", "up-2", ["concat-2"]),
    tensor("concat-2-tensor", "decoder merge level 2", [128, 128, 384], "activation", "concat-2", ["dec-2"]),
    tensor("dec-2-tensor", "decoder level 2", [128, 128, 128], "activation", "dec-2", ["up-1"]),
    tensor("up-1-tensor", "upsampled decoder level 1", [256, 256, 128], "activation", "up-1", ["concat-1"]),
    tensor("concat-1-tensor", "decoder merge level 1", [256, 256, 192], "activation", "concat-1", ["dec-1"]),
    tensor("dec-1-tensor", "decoder level 1", [256, 256, 64], "output", "dec-1", ["output"]),
  ];
  const edges: any[] = [
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
  ];

  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "unet", title: "U-Net encoder-decoder", description: null },
    tensors,
    nodes,
    edges,
    groups: [
      { id: "encoder", label: "Encoder", nodeIds: ["enc-1", "pool-1", "enc-2", "pool-2"], confidence: 0.95, sourceEvidenceIds: ["fact-encoder"] },
      { id: "decoder", label: "Decoder", nodeIds: ["up-2", "concat-2", "dec-2", "up-1", "concat-1", "dec-1"], confidence: 0.95, sourceEvidenceIds: ["fact-decoder"] },
    ],
    unresolved: [],
  });
}

function tensor(id: string, name: string, shape: number[], semanticRole: "input" | "activation" | "output", producerNodeId: string, consumerNodeIds: string[]) {
  return { id, name, shape, axes: ["height", "width", "channel"], semanticRole, dtype: "float32", producerNodeId, consumerNodeIds };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, tensorId: string, evidenceId: string) {
  return { id, sourceNodeId, targetNodeId, relation: "data" as const, tensorIds: [tensorId], confidence: 0.95, evidenceIds: [evidenceId] };
}
