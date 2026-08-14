import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function resnet50CanonicalIr() {
  const repeats = [3, 4, 6, 3];
  const nodes: any[] = [
    { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-tensor"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
    { id: "stem", op: "conv2d", inputTensorIds: ["input-tensor"], outputTensorIds: ["stem-tensor"], confidence: 0.95, sourceEvidenceIds: ["fact-stem"], repeats: null },
  ];
  const tensors: any[] = [
    { id: "input-tensor", name: "input", shape: [224, 224, 3], axes: ["height", "width", "channel"], semanticRole: "input", dtype: "float32", producerNodeId: "input", consumerNodeIds: ["stem"] },
    { id: "stem-tensor", name: "stem", shape: [56, 56, 64], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "stem", consumerNodeIds: ["block-1", "add-1"] },
  ];
  const edges: any[] = [
    { id: "edge-input-stem", sourceNodeId: "input", targetNodeId: "stem", relation: "data", tensorIds: ["input-tensor"], confidence: 1, evidenceIds: ["fact-input"] },
    { id: "edge-stem-block-1", sourceNodeId: "stem", targetNodeId: "block-1", relation: "data", tensorIds: ["stem-tensor"], confidence: 0.95, evidenceIds: ["fact-stem"] },
    { id: "residual-1", sourceNodeId: "stem", targetNodeId: "add-1", relation: "residual", tensorIds: ["stem-tensor"], confidence: 0.95, evidenceIds: ["fact-residual"] },
  ];
  const groups: any[] = [];
  let previousNode = "stem";
  let previousTensor = "stem-tensor";
  for (let index = 0; index < repeats.length; index += 1) {
    const stage = index + 1;
    const block = `block-${stage}`;
    const add = `add-${stage}`;
    const mainTensor = `main-${stage}-tensor`;
    const mergedTensor = `merged-${stage}-tensor`;
    const size = 56 / (2 ** index);
    const channels = 64 * (2 ** index);
    nodes.push(
      { id: block, op: "conv2d", inputTensorIds: [previousTensor], outputTensorIds: [mainTensor], confidence: 0.95, sourceEvidenceIds: ["fact-block"], repeats: { count: repeats[index]!, unitNodeIds: [block] } },
      { id: add, op: "add", inputTensorIds: [previousTensor, mainTensor], outputTensorIds: [mergedTensor], confidence: 0.95, sourceEvidenceIds: ["fact-residual"], repeats: null },
    );
    tensors.push(
      { id: mainTensor, name: `residual main ${stage}`, shape: [size, size, channels], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: block, consumerNodeIds: [add] },
      { id: mergedTensor, name: `residual output ${stage}`, shape: [size, size, channels], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: add, consumerNodeIds: [stage === 4 ? "classifier" : `block-${stage + 1}`, stage === 4 ? undefined : `add-${stage + 1}`].filter(Boolean) },
    );
    if (stage > 1) {
      edges.push(
        { id: `edge-${previousNode}-${block}`, sourceNodeId: previousNode, targetNodeId: block, relation: "data", tensorIds: [previousTensor], confidence: 0.95, evidenceIds: ["fact-block"] },
        { id: `residual-${stage}`, sourceNodeId: previousNode, targetNodeId: add, relation: "residual", tensorIds: [previousTensor], confidence: 0.95, evidenceIds: ["fact-residual"] },
      );
    }
    edges.push({ id: `edge-${block}-${add}`, sourceNodeId: block, targetNodeId: add, relation: "data", tensorIds: [mainTensor], confidence: 0.95, evidenceIds: ["fact-residual"] });
    groups.push({ id: `stage-${stage}`, label: `Residual stage ${stage}`, nodeIds: [block, add], confidence: 0.95, sourceEvidenceIds: ["fact-block"] });
    previousNode = add;
    previousTensor = mergedTensor;
  }
  nodes.push(
    { id: "classifier", op: "classifier", inputTensorIds: [previousTensor], outputTensorIds: ["logits"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
    { id: "output", op: "output", inputTensorIds: ["logits"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
  );
  tensors.push({ id: "logits", name: "logits", shape: [1000], axes: ["feature"], semanticRole: "logits", dtype: "float32", producerNodeId: "classifier", consumerNodeIds: ["output"] });
  edges.push(
    { id: "edge-add-4-classifier", sourceNodeId: previousNode, targetNodeId: "classifier", relation: "data", tensorIds: [previousTensor], confidence: 0.95, evidenceIds: ["fact-classifier"] },
    { id: "edge-classifier-output", sourceNodeId: "classifier", targetNodeId: "output", relation: "data", tensorIds: ["logits"], confidence: 1, evidenceIds: ["fact-output"] },
  );
  return parseCanonicalNetworkIR({ version: 2, figure: { id: "resnet50", title: "ResNet-50", description: null }, tensors, nodes, edges, groups, unresolved: [] });
}
