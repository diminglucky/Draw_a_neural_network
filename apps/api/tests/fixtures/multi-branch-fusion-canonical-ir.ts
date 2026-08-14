import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function multiBranchFusionCanonicalIr() {
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "vision-language-fusion", title: "Vision-language cross-attention fusion", description: null },
    tensors: [
      tensor("image-tokens", "image tokens", [196, 768], "input", "vision-input", ["vision-embedding"]),
      tensor("vision-features", "vision features", [196, 768], "activation", "vision-embedding", ["cross-attention"]),
      tensor("text-tokens", "text tokens", [32, 768], "input", "text-input", ["text-embedding"]),
      tensor("text-features", "text features", [32, 768], "activation", "text-embedding", ["cross-attention"]),
      tensor("fused-tokens", "fused tokens", [32, 768], "activation", "cross-attention", ["prediction-head"]),
      tensor("logits", "prediction logits", [1000], "logits", "prediction-head", ["output"]),
    ],
    nodes: [
      node("vision-input", "input", [], ["image-tokens"], ["fact-vision-input"]),
      node("vision-embedding", "embedding", ["image-tokens"], ["vision-features"], ["fact-vision-tower"]),
      node("text-input", "input", [], ["text-tokens"], ["fact-text-input"]),
      node("text-embedding", "embedding", ["text-tokens"], ["text-features"], ["fact-text-tower"]),
      node("cross-attention", "attention", ["vision-features", "text-features"], ["fused-tokens"], ["fact-fusion"]),
      node("prediction-head", "classifier", ["fused-tokens"], ["logits"], ["fact-head"]),
      node("output", "output", ["logits"], [], ["fact-output"]),
    ],
    edges: [
      edge("edge-vision-input", "vision-input", "vision-embedding", "image-tokens", "data", "fact-vision-input"),
      edge("edge-vision-fusion", "vision-embedding", "cross-attention", "vision-features", "cross_attention", "fact-fusion"),
      edge("edge-text-input", "text-input", "text-embedding", "text-tokens", "data", "fact-text-input"),
      edge("edge-text-fusion", "text-embedding", "cross-attention", "text-features", "cross_attention", "fact-fusion"),
      edge("edge-fusion-head", "cross-attention", "prediction-head", "fused-tokens", "data", "fact-head"),
      edge("edge-head-output", "prediction-head", "output", "logits", "data", "fact-output"),
    ],
    groups: [],
    unresolved: [],
  });
}

function node(id: string, op: "input" | "output" | "embedding" | "attention" | "classifier", inputTensorIds: string[], outputTensorIds: string[], sourceEvidenceIds: string[]) {
  return { id, op, inputTensorIds, outputTensorIds, confidence: 0.95, sourceEvidenceIds, repeats: null };
}

function tensor(id: string, name: string, shape: number[], semanticRole: "input" | "activation" | "logits", producerNodeId: string, consumerNodeIds: string[]) {
  return { id, name, shape, axes: id === "logits" ? ["feature"] : ["token", "feature"], semanticRole, dtype: "float32", producerNodeId, consumerNodeIds };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, tensorId: string, relation: "data" | "cross_attention", evidenceId: string) {
  return { id, sourceNodeId, targetNodeId, relation, tensorIds: [tensorId], confidence: 0.95, evidenceIds: [evidenceId] };
}
