import type { ArchitectureIRv3, ArchitectureIRNode } from "../../src/network-ir-v3.js";
import type { EvidenceRef, PortSemanticType, TensorRepresentation } from "../../src/evidence-graph.js";

type NodeInput = Pick<ArchitectureIRNode, "id" | "kind" | "semanticRole" | "inputPorts" | "outputPorts" | "evidenceIds"> & Partial<Pick<ArchitectureIRNode, "repeat">>;

const port = (id: string, semanticType: PortSemanticType, representation: TensorRepresentation) => ({ id, representation, semanticType });

function ir(graphId: string, nodes: NodeInput[], edges: ArchitectureIRv3["edges"]): ArchitectureIRv3 {
  const evidenceIds = new Set([
    ...nodes.flatMap((node) => node.evidenceIds),
    ...edges.flatMap((edge) => edge.evidenceIds),
  ]);
  return {
    version: 3,
    graphId,
    inputs: [{ nodeId: nodes[0]!.id, portId: "out" }],
    outputs: [{ nodeId: nodes[nodes.length - 1]!.id, portId: "out" }],
    modules: [],
    nodes: nodes as ArchitectureIRv3["nodes"],
    edges,
    processes: [],
    evidenceIndex: Object.fromEntries([...evidenceIds].sort().map((id) => [id, [fixtureEvidence(id)]])),
    unresolved: [],
  };
}

function fixtureEvidence(id: string): EvidenceRef {
  return {
    sourceId: "fixture-source",
    sourceSha256: "0".repeat(64),
    locator: { kind: "code", startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    excerptDigest: "0".repeat(64),
  };
}

function edge(id: string, source: string, target: string, evidenceId = "evidence-main"): ArchitectureIRv3["edges"][number] {
  return { id, source: { nodeId: source, portId: "out" }, target: { nodeId: target, portId: "in" }, transport: "data", evidenceIds: [evidenceId] };
}

function linearNodes(kind: "spatial_feature_map" | "token_sequence" = "spatial_feature_map"): NodeInput[] {
  return [
    { id: "input", kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [port("out", "data", kind)], evidenceIds: ["evidence-input"] },
    { id: "operator", kind: "operator", semanticRole: kind === "token_sequence" ? "token_projection" : "conv2d", inputPorts: [port("in", "data", kind)], outputPorts: [port("out", "data", kind)], evidenceIds: ["evidence-main"] },
    { id: "output", kind: "output", semanticRole: "output", inputPorts: [port("in", "data", kind)], outputPorts: [port("out", "prediction", "vector")], evidenceIds: ["evidence-output"] },
  ];
}

export function cnnGoldIr(): ArchitectureIRv3 {
  return ir("gold:cnn", linearNodes(), [edge("edge-input-operator", "input", "operator"), edge("edge-operator-output", "operator", "output")]);
}

export function residualGoldIr(): ArchitectureIRv3 {
  const nodes: NodeInput[] = [
    { id: "input", kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-input"] },
    { id: "main", kind: "operator", semanticRole: "residual_block", inputPorts: [port("in", "data", "spatial_feature_map")], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-main"] },
    { id: "skip", kind: "operator", semanticRole: "identity_projection", inputPorts: [port("in", "skip", "spatial_feature_map")], outputPorts: [port("out", "skip", "spatial_feature_map")], evidenceIds: ["evidence-skip"] },
    { id: "add", kind: "merge", semanticRole: "residual_add", inputPorts: [port("main", "data", "spatial_feature_map"), port("skip", "data", "spatial_feature_map")], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-add"], mergeKind: "add", concatAxis: null, inputCompatibility: [{ status: "proven", comparedAxes: ["C", "H", "W"], reason: "matching residual shapes", evidenceFactIds: [] }] } as NodeInput,
    { id: "output", kind: "output", semanticRole: "output", inputPorts: [port("in", "data", "spatial_feature_map")], outputPorts: [port("out", "prediction", "vector")], evidenceIds: ["evidence-output"] },
  ];
  return ir("gold:residual", nodes, [edge("edge-input-main", "input", "main"), { ...edge("edge-main-add", "main", "add"), target: { nodeId: "add", portId: "main" } }, { ...edge("edge-input-skip", "input", "skip"), target: { nodeId: "skip", portId: "in" } }, { ...edge("edge-skip-add", "skip", "add"), target: { nodeId: "add", portId: "skip" } }, { ...edge("edge-add-output", "add", "output"), source: { nodeId: "add", portId: "out" } }]);
}

export function encoderDecoderGoldIr(): ArchitectureIRv3 {
  const nodes: NodeInput[] = [
    { id: "input", kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-input"] },
    { id: "encoder", kind: "operator", semanticRole: "encoder_stage", inputPorts: [port("in", "data", "spatial_feature_map")], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-encoder"] },
    { id: "decoder", kind: "operator", semanticRole: "decoder_stage", inputPorts: [port("in", "data", "spatial_feature_map")], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-decoder"] },
    { id: "concat", kind: "merge", semanticRole: "skip_concat", inputPorts: [port("decoder", "data", "spatial_feature_map"), port("skip", "data", "spatial_feature_map")], outputPorts: [port("out", "data", "spatial_feature_map")], evidenceIds: ["evidence-concat"], mergeKind: "concat", concatAxis: "C", inputCompatibility: [{ status: "proven", comparedAxes: ["H", "W"], reason: "matching spatial axes", evidenceFactIds: [] }] } as NodeInput,
    { id: "output", kind: "output", semanticRole: "output", inputPorts: [port("in", "data", "spatial_feature_map")], outputPorts: [port("out", "prediction", "vector")], evidenceIds: ["evidence-output"] },
  ];
  return ir("gold:encoder-decoder", nodes, [edge("edge-input-encoder", "input", "encoder"), edge("edge-encoder-decoder", "encoder", "decoder"), { ...edge("edge-decoder-concat", "decoder", "concat"), target: { nodeId: "concat", portId: "decoder" } }, { ...edge("edge-encoder-concat", "encoder", "concat"), target: { nodeId: "concat", portId: "skip" } }, { ...edge("edge-concat-output", "concat", "output"), source: { nodeId: "concat", portId: "out" } }]);
}

export function tokenTransformerGoldIr(): ArchitectureIRv3 {
  const nodes: NodeInput[] = [
    { id: "input", kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [port("out", "data", "token_sequence")], evidenceIds: ["evidence-input"] },
    { id: "attention", kind: "attention", semanticRole: "self_attention", inputPorts: [port("query", "query", "token_sequence"), port("key", "key", "token_sequence"), port("value", "value", "token_sequence")], outputPorts: [port("out", "data", "token_sequence")], evidenceIds: ["evidence-attention"], attentionKind: "self" } as NodeInput,
    { id: "repeat", kind: "repeat", semanticRole: "transformer_stack", inputPorts: [port("in", "data", "token_sequence")], outputPorts: [port("out", "data", "token_sequence")], evidenceIds: ["evidence-repeat"], repeat: { count: 12, unitNodeIds: ["attention"], expansionPolicy: "collapsed" } },
    { id: "output", kind: "output", semanticRole: "output", inputPorts: [port("in", "data", "token_sequence")], outputPorts: [port("out", "prediction", "vector")], evidenceIds: ["evidence-output"] },
  ];
  return ir("gold:token-transformer", nodes, [
    { id: "edge-input-query", source: { nodeId: "input", portId: "out" }, target: { nodeId: "attention", portId: "query" }, transport: "data", evidenceIds: ["evidence-attention"] },
    { id: "edge-input-key", source: { nodeId: "input", portId: "out" }, target: { nodeId: "attention", portId: "key" }, transport: "data", evidenceIds: ["evidence-attention"] },
    { id: "edge-input-value", source: { nodeId: "input", portId: "out" }, target: { nodeId: "attention", portId: "value" }, transport: "data", evidenceIds: ["evidence-attention"] },
    { id: "edge-attention-repeat", source: { nodeId: "attention", portId: "out" }, target: { nodeId: "repeat", portId: "in" }, transport: "data", evidenceIds: ["evidence-repeat"] },
    { id: "edge-repeat-output", source: { nodeId: "repeat", portId: "out" }, target: { nodeId: "output", portId: "in" }, transport: "data", evidenceIds: ["evidence-output"] },
  ]);
}
