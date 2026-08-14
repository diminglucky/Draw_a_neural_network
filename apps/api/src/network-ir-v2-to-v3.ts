import type { CanonicalNetworkIR } from "./network-ir-v2.js";
import type {
  ArchitectureIRNode,
  ArchitectureIRv3,
  ArchitectureModule,
  ArchitectureEdge,
  ArchitectureNode,
  TypedPort,
  UnresolvedQuestion,
} from "./network-ir-v3.js";

const axisMap: Record<string, "B" | "C" | "H" | "W" | "D" | "T" | "N" | "F"> = {
  batch: "B", channel: "C", height: "H", width: "W", depth: "D", time: "T", token: "T", node: "N", feature: "F",
};

export function adaptCanonicalNetworkIRv2(legacy: CanonicalNetworkIR): ArchitectureIRv3 {
  const tensors = new Map(legacy.tensors.map((tensor) => [tensor.id, tensor]));
  const nodeById = new Map(legacy.nodes.map((node) => [node.id, node]));
  const unresolved: UnresolvedQuestion[] = legacy.unresolved.map((question) => ({
    id: `v2-question-${question.id}`,
    severity: question.severity,
    conflictKey: `v2:unresolved:${question.id}`,
    candidateValues: question.candidateValues,
    evidenceFactIds: question.evidenceIds,
    dependencyQuestionIds: [],
  }));

  const nodes: ArchitectureIRNode[] = legacy.nodes.map((node) => {
    const inputPorts = node.inputTensorIds.map((tensorId) => portForTensor(`in-${tensorId}`, tensors.get(tensorId), "data"));
    const outputPorts = node.outputTensorIds.map((tensorId) => portForTensor(`out-${tensorId}`, tensors.get(tensorId), node.op === "output" ? "prediction" : "data"));
    if (node.op === "output" && outputPorts.length === 0) outputPorts.push({ id: "out", representation: "vector", semanticType: "prediction" });
    const base = {
      id: node.id,
      semanticRole: node.op,
      inputPorts,
      outputPorts,
      ...(node.repeats ? { repeat: { count: node.repeats.count, unitNodeIds: node.repeats.unitNodeIds, expansionPolicy: "collapsed" as const } } : {}),
      evidenceIds: node.sourceEvidenceIds,
    };
    if (node.op === "add" || node.op === "concat") {
      unresolved.push({
        id: `v2-merge-${node.id}`,
        severity: "blocking",
        conflictKey: `v2:merge:${node.id}`,
        candidateValues: node.op === "concat" ? ["C", "H", "W", "unknown"] : ["shape-compatible", "shape-incompatible"],
        evidenceFactIds: node.sourceEvidenceIds,
        dependencyQuestionIds: [],
      });
      return {
        ...base,
        kind: "merge",
        mergeKind: node.op,
        concatAxis: null,
        inputCompatibility: Array.from({ length: Math.max(0, inputPorts.length - 1) }, () => ({
          status: "unknown" as const,
          comparedAxes: ["C", "H", "W"],
          reason: "v2 tensor graph does not prove typed merge compatibility",
          evidenceFactIds: node.sourceEvidenceIds,
        })),
      };
    }
    if (node.op === "attention") {
      const roles = ["query", "key", "value"] as const;
      const attentionPorts = inputPorts.map((port, index) => ({ ...port, semanticType: roles[index] ?? "mask" }));
      if (attentionPorts.length < 3) {
        unresolved.push({
          id: `v2-attention-${node.id}`,
          severity: "blocking",
          conflictKey: `v2:attention:${node.id}`,
          candidateValues: ["self_attention", "cross_attention"],
          evidenceFactIds: node.sourceEvidenceIds,
          dependencyQuestionIds: [],
        });
      }
      return { ...base, kind: "attention", attentionKind: "self", inputPorts: attentionPorts };
    }
    return { ...base, kind: nodeKind(node.op) };
  });

  const edges: ArchitectureEdge[] = legacy.edges.map((edge) => {
    const tensorId = edge.tensorIds[0];
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    const sourcePortId = source?.outputTensorIds.includes(tensorId) ? `out-${tensorId}` : `out-${source?.outputTensorIds[0] ?? tensorId}`;
    const targetPortId = target?.inputTensorIds.includes(tensorId) ? `in-${tensorId}` : `in-${target?.inputTensorIds[0] ?? tensorId}`;
    if (edge.relation !== "data") {
      unresolved.push({
        id: `v2-edge-${edge.id}`,
        severity: "blocking",
        conflictKey: `v2:edge:${edge.id}`,
        candidateValues: edge.relation === "residual" ? ["residual_skip", "data"] : edge.relation === "cross_attention" ? ["cross_attention", "data"] : ["feedback", "data"],
        evidenceFactIds: edge.evidenceIds,
        dependencyQuestionIds: [],
      });
    }
    return {
      id: edge.id,
      source: { nodeId: edge.sourceNodeId, portId: sourcePortId },
      target: { nodeId: edge.targetNodeId, portId: targetPortId },
      transport: edge.relation === "iteration" ? "feedback" : "data",
      evidenceIds: edge.evidenceIds,
    };
  });

  const modules: ArchitectureModule[] = legacy.groups.map((group) => ({
    id: group.id,
    label: group.label,
    parentModuleId: null,
    memberNodeIds: group.nodeIds,
    interfacePortIds: [],
    collapsedByDefault: false,
    evidenceIds: group.sourceEvidenceIds,
  }));
  const inputs = nodes.filter((node) => legacy.nodes.find((legacyNode) => legacyNode.id === node.id)?.op === "input").flatMap((node) => node.outputPorts.slice(0, 1).map((port) => ({ nodeId: node.id, portId: port.id })));
  const outputs = nodes.filter((node) => legacy.nodes.find((legacyNode) => legacyNode.id === node.id)?.op === "output").flatMap((node) => node.outputPorts.slice(0, 1).map((port) => ({ nodeId: node.id, portId: port.id })));
  return {
    version: 3,
    graphId: legacy.figure.id,
    inputs,
    outputs,
    modules,
    nodes,
    edges,
    processes: [],
    evidenceIndex: {},
    unresolved,
  };
}

function nodeKind(op: CanonicalNetworkIR["nodes"][number]["op"]): ArchitectureNode["kind"] {
  if (op === "input" || op === "output") return op;
  return "operator";
}

function portForTensor(id: string, tensor: CanonicalNetworkIR["tensors"][number] | undefined, semanticType: TypedPort["semanticType"]): TypedPort {
  const representation = tensor?.semanticRole === "state" ? "state" : tensor?.semanticRole === "logits" ? "scalar_distribution" : "vector";
  const shape = tensor ? toShape(tensor) : undefined;
  return { id, representation, ...(shape ? { shape } : {}), semanticType };
}

function toShape(tensor: CanonicalNetworkIR["tensors"][number]): TypedPort["shape"] | undefined {
  if (tensor.axes.length !== tensor.shape.length || tensor.axes.length === 0) return undefined;
  const axes = tensor.axes.map((axis) => axisMap[axis.toLowerCase()] ?? "unknown");
  if (new Set(axes).size !== axes.length) return undefined;
  return {
    axes,
    dimensions: tensor.shape.map((dimension) => typeof dimension === "number" && dimension > 0
      ? { kind: "known" as const, value: dimension }
      : typeof dimension === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/.test(dimension)
        ? { kind: "symbol" as const, name: dimension }
        : { kind: "unknown" as const }),
    batchSemantics: "unknown",
  };
}
