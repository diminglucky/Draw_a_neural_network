import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function vgg16CanonicalIr() {
  const stages = [
    { name: "conv-1", repeat: 2, shape: [224, 224, 64] },
    { name: "conv-2", repeat: 2, shape: [112, 112, 128] },
    { name: "conv-3", repeat: 3, shape: [56, 56, 256] },
    { name: "conv-4", repeat: 3, shape: [28, 28, 512] },
    { name: "conv-5", repeat: 3, shape: [14, 14, 512] },
  ];
  const nodes: any[] = [{ id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null }];
  const tensors: any[] = [{ id: "input-tensor", name: "input", shape: [224, 224, 3], axes: ["height", "width", "channel"], semanticRole: "input", dtype: "float32", producerNodeId: "input", consumerNodeIds: ["conv-1"] }];
  const edges: any[] = [{ id: "edge-input", sourceNodeId: "input", targetNodeId: "conv-1", relation: "data", tensorIds: ["input-tensor"], confidence: 1, evidenceIds: ["fact-input"] }];
  const groups: any[] = [];
  let previousNode = "input";
  let previousTensor = "input-tensor";
  for (const [index, stage] of stages.entries()) {
    const convTensor = `${stage.name}-tensor`;
    const poolTensor = `${stage.name}-pool-tensor`;
    const poolId = `pool-${index + 1}`;
    nodes.push({ id: stage.name, op: "conv2d", inputTensorIds: [previousTensor], outputTensorIds: [convTensor], confidence: 0.95, sourceEvidenceIds: ["fact-conv"], repeats: { count: stage.repeat, unitNodeIds: [stage.name] } });
    nodes.push({ id: poolId, op: "pool", inputTensorIds: [convTensor], outputTensorIds: [poolTensor], confidence: 0.95, sourceEvidenceIds: ["fact-pool"], repeats: null });
    tensors.push({ id: convTensor, name: `${stage.name} activation`, shape: stage.shape, axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: stage.name, consumerNodeIds: [poolId] });
    tensors.push({ id: poolTensor, name: `${stage.name} pooled`, shape: [Math.max(7, stage.shape[0] / 2), Math.max(7, stage.shape[1] / 2), stage.shape[2]], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: poolId, consumerNodeIds: [index === stages.length - 1 ? "flatten" : stages[index + 1]!.name] });
    edges.push({ id: `edge-${previousNode}-${stage.name}`, sourceNodeId: previousNode, targetNodeId: stage.name, relation: "data", tensorIds: [previousTensor], confidence: 0.95, evidenceIds: ["fact-conv"] });
    edges.push({ id: `edge-${stage.name}-${poolId}`, sourceNodeId: stage.name, targetNodeId: poolId, relation: "data", tensorIds: [convTensor], confidence: 0.95, evidenceIds: ["fact-pool"] });
    groups.push({ id: `group-${stage.name}`, label: `Block ${index + 1}`, nodeIds: [stage.name, poolId], confidence: 0.95, sourceEvidenceIds: ["fact-conv"] });
    previousNode = poolId;
    previousTensor = poolTensor;
  }
  nodes.push(
    { id: "flatten", op: "flatten", inputTensorIds: [previousTensor], outputTensorIds: ["flat-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
    { id: "fc-1", op: "dense", inputTensorIds: ["flat-tensor"], outputTensorIds: ["fc-1-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
    { id: "fc-2", op: "dense", inputTensorIds: ["fc-1-tensor"], outputTensorIds: ["fc-2-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
    { id: "classifier", op: "classifier", inputTensorIds: ["fc-2-tensor"], outputTensorIds: ["logits"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
    { id: "output", op: "output", inputTensorIds: ["logits"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
  );
  tensors.push(
    { id: "flat-tensor", name: "flattened", shape: [25088], axes: ["feature"], semanticRole: "activation", dtype: "float32", producerNodeId: "flatten", consumerNodeIds: ["fc-1"] },
    { id: "fc-1-tensor", name: "fc1", shape: [4096], axes: ["feature"], semanticRole: "activation", dtype: "float32", producerNodeId: "fc-1", consumerNodeIds: ["fc-2"] },
    { id: "fc-2-tensor", name: "fc2", shape: [4096], axes: ["feature"], semanticRole: "activation", dtype: "float32", producerNodeId: "fc-2", consumerNodeIds: ["classifier"] },
    { id: "logits", name: "logits", shape: [1000], axes: ["feature"], semanticRole: "logits", dtype: "float32", producerNodeId: "classifier", consumerNodeIds: ["output"] },
  );
  edges.push(
    { id: "edge-pool-5-flatten", sourceNodeId: previousNode, targetNodeId: "flatten", relation: "data", tensorIds: [previousTensor], confidence: 0.95, evidenceIds: ["fact-classifier"] },
    { id: "edge-flatten-fc-1", sourceNodeId: "flatten", targetNodeId: "fc-1", relation: "data", tensorIds: ["flat-tensor"], confidence: 0.95, evidenceIds: ["fact-classifier"] },
    { id: "edge-fc-1-fc-2", sourceNodeId: "fc-1", targetNodeId: "fc-2", relation: "data", tensorIds: ["fc-1-tensor"], confidence: 0.95, evidenceIds: ["fact-classifier"] },
    { id: "edge-fc-2-classifier", sourceNodeId: "fc-2", targetNodeId: "classifier", relation: "data", tensorIds: ["fc-2-tensor"], confidence: 0.95, evidenceIds: ["fact-classifier"] },
    { id: "edge-classifier-output", sourceNodeId: "classifier", targetNodeId: "output", relation: "data", tensorIds: ["logits"], confidence: 1, evidenceIds: ["fact-output"] },
  );
  return parseCanonicalNetworkIR({ version: 2, figure: { id: "vgg16", title: "VGG16", description: null }, tensors, nodes, edges, groups, unresolved: [] });
}
