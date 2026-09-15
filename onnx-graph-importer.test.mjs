import assert from "node:assert/strict";
import test from "node:test";
import onnxProto from "onnx-proto";
import { importOnnxGraph } from "./onnx-graph-importer.mjs";

const { onnx } = onnxProto;

function tensorInfo(name, dimensions) {
  return { name, type: { tensorType: { elemType: 1, shape: { dim: dimensions.map((dimValue) => ({ dimValue })) } } } };
}

function modelBuffer() {
  return onnx.ModelProto.encode(onnx.ModelProto.create({
    irVersion: 8,
    graph: {
      name: "branching",
      input: [tensorInfo("image", [1, 3, 224, 224])],
      output: [tensorInfo("prediction", [1, 10])],
      valueInfo: [tensorInfo("features", [1, 16, 112, 112])],
      node: [
        { name: "stem", opType: "CustomStem", input: ["image"], output: ["features"], attribute: [{ name: "stride", type: 2, i: 2 }] },
        { name: "head", opType: "UnknownHead", input: ["features"], output: ["prediction"], attribute: [{ name: "labels", type: 8, strings: [Buffer.from("a"), Buffer.from("b")] }] },
      ],
    },
  })).finish();
}

test("decodes ONNX nodes, tensor shapes, attributes, ports, and producer-consumer edges", () => {
  const result = importOnnxGraph(modelBuffer(), { uri: "file:///model.onnx", revision: "abc1234", authority: 5 });
  assert.equal(result.status, "grounded");
  assert.deepEqual(result.graph.nodes.map((node) => node.operator), ["CustomStem", "UnknownHead"]);
  assert.equal(result.graph.nodes[0].attributes.stride, 2);
  assert.deepEqual(result.graph.nodes[1].attributes.labels, ["a", "b"]);
  assert.deepEqual(result.graph.tensors.find((tensor) => tensor.id === "features").shape, [1, 16, 112, 112]);
  assert.deepEqual(result.graph.edges.map((edge) => [edge.source, edge.target, edge.tensorId]), [["stem", "head", "features"]]);
  assert.ok(result.graph.ports.some((port) => port.nodeId === "stem" && port.tensorId === "image" && port.direction === "input"));
});

test("rejects pickle artifacts with an isolated-trace diagnostic", () => {
  const result = importOnnxGraph(Buffer.from([0x80, 0x04, 0x95, 0x00]), { format: "pickle", uri: "file:///model.pkl" });
  assert.equal(result.status, "rejected");
  assert.equal(result.diagnostics[0].code, "unsafe-pickle-artifact");
  assert.match(result.diagnostics[0].message, /isolated/i);
});

test("assigns stable unique identities when ONNX node names are missing or duplicated", () => {
  const buffer = onnx.ModelProto.encode(onnx.ModelProto.create({ graph: { node: [
    { name: "block", opType: "A", output: ["a"] },
    { name: "block", opType: "B", input: ["a"], output: ["b"] },
    { opType: "C", input: ["b"], output: ["c"] },
  ] } })).finish();
  const result = importOnnxGraph(buffer, { uri: "file:///duplicates.onnx", revision: "abc1234", authority: 4 });
  assert.deepEqual(result.graph.nodes.map((node) => node.id), ["block", "block-2", "onnx-node-3"]);
  assert.deepEqual(result.graph.edges.map((edge) => [edge.source, edge.target]), [["block", "block-2"], ["block-2", "onnx-node-3"]]);
});
