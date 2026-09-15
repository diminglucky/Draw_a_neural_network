import { createHash } from "node:crypto";
import onnxProto from "onnx-proto";

const { onnx } = onnxProto;
const PICKLE_PROTOCOL = 0x80;

export function importOnnxGraph(buffer, context = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (String(context.format || "").toLowerCase().includes("pickle") || bytes[0] === PICKLE_PROTOCOL) {
    return { status: "rejected", graph: emptyGraph(), claims: [], diagnostics: [{ code: "unsafe-pickle-artifact", message: "Pickle artifacts must be inspected by an isolated trace process and cannot be loaded in the Agent process." }] };
  }
  let model;
  try {
    model = onnx.ModelProto.decode(bytes);
  } catch (error) {
    return { status: "invalid", graph: emptyGraph(), claims: [], diagnostics: [{ code: "invalid-onnx", message: error.message }] };
  }
  if (!model.graph) return { status: "invalid", graph: emptyGraph(), claims: [], diagnostics: [{ code: "missing-onnx-graph" }] };

  const nodeIds = allocateNodeIds(model.graph.node);
  const nodes = model.graph.node.map((node, index) => ({
    id: nodeIds[index],
    operator: String(node.opType || ""),
    domain: String(node.domain || ""),
    attributes: Object.fromEntries(node.attribute.map((attribute) => [attribute.name, attributeValue(attribute)])),
  }));
  const tensors = collectTensors(model.graph);
  const producerByTensor = new Map();
  const ports = [];
  for (let index = 0; index < model.graph.node.length; index += 1) {
    const raw = model.graph.node[index];
    for (const tensorId of raw.input) ports.push({ id: `${nodes[index].id}:in:${tensorId}`, nodeId: nodes[index].id, tensorId, direction: "input" });
    for (const tensorId of raw.output) {
      ports.push({ id: `${nodes[index].id}:out:${tensorId}`, nodeId: nodes[index].id, tensorId, direction: "output" });
      producerByTensor.set(tensorId, nodes[index].id);
    }
  }
  const edges = [];
  for (let index = 0; index < model.graph.node.length; index += 1) {
    for (const tensorId of model.graph.node[index].input) {
      const source = producerByTensor.get(tensorId);
      if (source) edges.push({ id: `onnx-edge-${edges.length + 1}`, source, target: nodes[index].id, tensorId, status: "grounded" });
    }
  }
  const sourceId = String(context.sourceId || "onnx-source");
  const claims = nodes.map((node) => ({ id: `${node.id}:operator`, subjectId: node.id, predicate: "operator", value: node.operator, sourceIds: [sourceId], confidence: 1, status: "grounded" }));
  return {
    status: "grounded",
    sources: [{ id: sourceId, kind: "artifact", format: "onnx", uri: context.uri || "", revision: context.revision || "", sha256: createHash("sha256").update(bytes).digest("hex"), authority: Number(context.authority || 0) }],
    graph: { nodes, edges, ports, tensors, containers: [] },
    claims,
    diagnostics: [],
  };
}

function collectTensors(graph) {
  const byId = new Map();
  for (const value of [...graph.input, ...graph.valueInfo, ...graph.output]) {
    byId.set(value.name, { id: value.name, shape: tensorShape(value), elementType: Number(value.type?.tensorType?.elemType || 0), graphInput: graph.input.includes(value), graphOutput: graph.output.includes(value) });
  }
  for (const tensor of graph.initializer) {
    byId.set(tensor.name, { id: tensor.name, shape: tensor.dims.map(toNumber), elementType: Number(tensor.dataType || 0), initializer: true });
  }
  return [...byId.values()];
}

function tensorShape(value) {
  return (value.type?.tensorType?.shape?.dim || []).map((dimension) => dimension.dimParam || toNumber(dimension.dimValue));
}

function attributeValue(attribute) {
  switch (Number(attribute.type)) {
    case 1: return attribute.f;
    case 2: return toNumber(attribute.i);
    case 3: return Buffer.from(attribute.s).toString("utf8");
    case 6: return [...attribute.floats];
    case 7: return attribute.ints.map(toNumber);
    case 8: return attribute.strings.map((value) => Buffer.from(value).toString("utf8"));
    default: return { type: Number(attribute.type), unsupported: true };
  }
}

function allocateNodeIds(nodes) {
  const used = new Set();
  return nodes.map((node, index) => {
    const base = String(node.name || `onnx-node-${index + 1}`);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return id;
  });
}
function toNumber(value) { return typeof value?.toNumber === "function" ? value.toNumber() : Number(value); }
function emptyGraph() { return { nodes: [], edges: [], ports: [], tensors: [], containers: [] }; }
