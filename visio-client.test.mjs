import assert from "node:assert/strict";
import test from "node:test";
import { buildVisioRenderRequest, mergeCanvasStateIntoUniversalIR } from "./visio-client.mjs";

test("buildVisioRenderRequest sends the current Universal IR to an existing Visio document", () => {
  const request = buildVisioRenderRequest({
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    ir: { nodes: [{ id: "input" }], edges: [] },
  });
  assert.equal(request.url, "/api/render-visio");
  assert.equal(request.body.documentPath, "C:\\project\\existing.vsdx");
  assert.equal(request.body.pageName, "Page-1");
  assert.deepEqual(request.body.ir.nodes, [{ id: "input" }]);
});

test("buildVisioRenderRequest fails before sending when no existing document is selected", () => {
  assert.throws(() => buildVisioRenderRequest({ ir: { nodes: [], edges: [] } }), /documentPath/i);
});

test("mergeCanvasStateIntoUniversalIR makes the current editable canvas authoritative", () => {
  const ir = mergeCanvasStateIntoUniversalIR({
    stateIR: {
      source: { kind: "source" },
      nodes: [{ id: "old", op: "Custom", family: "custom", label: "Old", confidence: 0.4, evidence: [{ line: 2 }] }],
      edges: [],
    },
    figure: { title: "Edited" },
    nodes: [
      { id: "old", type: "compound", label: "Edited", x: 500, y: 600, stage: 1 },
      { id: "new", type: "volume", label: "Added", x: 800, y: 600, stage: 2 },
    ],
    edges: [{ id: "current-edge", source: "old", target: "new", type: "signal" }],
  });

  assert.equal(ir.figure.title, "Edited");
  assert.deepEqual(ir.nodes.map((node) => node.id), ["old", "new"]);
  assert.equal(ir.nodes[0].label, "Edited");
  assert.equal(ir.nodes[0].confidence, 0.4);
  assert.deepEqual(ir.nodes[0].evidence, [{ line: 2 }]);
  assert.equal(ir.nodes[1].family, "volume");
  assert.deepEqual(ir.edges.map((edge) => edge.id), ["current-edge"]);
});
