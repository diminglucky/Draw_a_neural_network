import assert from "node:assert/strict";
import test from "node:test";
import { buildVisioRenderRequest } from "./visio-client.mjs";

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

test("buildVisioRenderRequest rejects a client-supplied Figure Plan", () => {
  const figurePlan = { version: "figure-plan/v1", nodes: [], edges: [] };
  assert.throws(
    () => buildVisioRenderRequest({ documentPath: "C:\\Temp\\existing.vsdx", figurePlan }),
    /client-supplied Figure Plans/i,
  );
});
