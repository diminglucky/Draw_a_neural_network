import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function structuralTokenAttentionCanonicalIr() {
  const node = (id: string, op: "input" | "output" | "embedding" | "transformer_block" | "classifier", inputTensorIds: string[], outputTensorIds: string[], sourceEvidenceIds: string[]) => ({ id, op, inputTensorIds, outputTensorIds, confidence: 0.95, sourceEvidenceIds, repeats: null });
  const tensor = (id: string, name: string, shape: number[], axes: string[], semanticRole: "input" | "activation" | "logits", producerNodeId: string, consumerNodeIds: string[]) => ({ id, name, shape, axes, semanticRole, dtype: "float32", producerNodeId, consumerNodeIds });
  const edge = (id: string, sourceNodeId: string, targetNodeId: string, tensorId: string, evidenceId: string) => ({ id, sourceNodeId, targetNodeId, relation: "data" as const, tensorIds: [tensorId], confidence: 0.95, evidenceIds: [evidenceId] });
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "structural-token-attention", title: "Token attention topology", description: null },
    tensors: [
      tensor("image", "image", [128, 128, 3], ["height", "width", "channel"], "input", "input", ["patch-embedding"]),
      tensor("patch-tokens", "patch tokens", [64, 256], ["token", "feature"], "activation", "patch-embedding", ["position-embedding"]),
      tensor("tokens", "positioned tokens", [65, 256], ["token", "feature"], "activation", "position-embedding", ["transformer-encoder"]),
      tensor("encoded-tokens", "encoded tokens", [65, 256], ["token", "feature"], "activation", "transformer-encoder", ["classifier"]),
      tensor("logits", "logits", [8], ["feature"], "logits", "classifier", ["output"]),
    ],
    nodes: [
      node("input", "input", [], ["image"], ["fact-input"]),
      node("patch-embedding", "embedding", ["image"], ["patch-tokens"], ["fact-embedding"]),
      node("position-embedding", "embedding", ["patch-tokens"], ["tokens"], ["fact-embedding"]),
      { ...node("transformer-encoder", "transformer_block", ["tokens"], ["encoded-tokens"], ["fact-attention"]), repeats: { count: 6, unitNodeIds: ["transformer-encoder"] } },
      node("classifier", "classifier", ["encoded-tokens"], ["logits"], ["fact-classifier"]),
      node("output", "output", ["logits"], [], ["fact-output"]),
    ],
    edges: [
      edge("edge-input-embedding", "input", "patch-embedding", "image", "fact-input"),
      edge("edge-patch-position", "patch-embedding", "position-embedding", "patch-tokens", "fact-embedding"),
      edge("edge-position-transformer", "position-embedding", "transformer-encoder", "tokens", "fact-attention"),
      edge("edge-transformer-classifier", "transformer-encoder", "classifier", "encoded-tokens", "fact-classifier"),
      edge("edge-classifier-output", "classifier", "output", "logits", "fact-output"),
    ],
    groups: [{ id: "attention-stack", label: "attention block", nodeIds: ["transformer-encoder"], confidence: 0.95, sourceEvidenceIds: ["fact-attention"] }],
    unresolved: [],
  });
}
