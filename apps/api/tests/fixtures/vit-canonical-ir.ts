import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function vitCanonicalIr() {
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "vit-base", title: "Vision Transformer", description: null },
    tensors: [
      tensor("image", "image", [224, 224, 3], ["height", "width", "channel"], "input", "input", ["patch-embedding"]),
      tensor("patch-tokens", "patch tokens", [196, 768], ["token", "feature"], "activation", "patch-embedding", ["position-embedding"]),
      tensor("tokens", "positioned tokens", [197, 768], ["token", "feature"], "activation", "position-embedding", ["transformer-encoder"]),
      tensor("encoded-tokens", "encoded tokens", [197, 768], ["token", "feature"], "activation", "transformer-encoder", ["classifier"]),
      tensor("logits", "logits", [1000], ["feature"], "logits", "classifier", ["output"]),
    ],
    nodes: [
      node("input", "input", [], ["image"], ["fact-input"]),
      node("patch-embedding", "embedding", ["image"], ["patch-tokens"], ["fact-embedding"]),
      node("position-embedding", "embedding", ["patch-tokens"], ["tokens"], ["fact-embedding"]),
      { ...node("transformer-encoder", "transformer_block", ["tokens"], ["encoded-tokens"], ["fact-transformer"]), repeats: { count: 12, unitNodeIds: ["transformer-encoder"] } },
      node("classifier", "classifier", ["encoded-tokens"], ["logits"], ["fact-classifier"]),
      node("output", "output", ["logits"], [], ["fact-output"]),
    ],
    edges: [
      edge("edge-input-embedding", "input", "patch-embedding", "image", "fact-input"),
      edge("edge-patch-position", "patch-embedding", "position-embedding", "patch-tokens", "fact-embedding"),
      edge("edge-position-transformer", "position-embedding", "transformer-encoder", "tokens", "fact-transformer"),
      edge("edge-transformer-classifier", "transformer-encoder", "classifier", "encoded-tokens", "fact-classifier"),
      edge("edge-classifier-output", "classifier", "output", "logits", "fact-output"),
    ],
    groups: [{ id: "transformer-stack", label: "Transformer encoder", nodeIds: ["transformer-encoder"], confidence: 0.95, sourceEvidenceIds: ["fact-transformer"] }],
    unresolved: [],
  });
}

function node(id: string, op: "input" | "output" | "embedding" | "transformer_block" | "classifier", inputTensorIds: string[], outputTensorIds: string[], sourceEvidenceIds: string[]) {
  return { id, op, inputTensorIds, outputTensorIds, confidence: 0.95, sourceEvidenceIds, repeats: null };
}

function tensor(id: string, name: string, shape: number[], axes: string[], semanticRole: "input" | "activation" | "logits", producerNodeId: string, consumerNodeIds: string[]) {
  return { id, name, shape, axes, semanticRole, dtype: "float32", producerNodeId, consumerNodeIds };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, tensorId: string, evidenceId: string) {
  return { id, sourceNodeId, targetNodeId, relation: "data" as const, tensorIds: [tensorId], confidence: 0.95, evidenceIds: [evidenceId] };
}
