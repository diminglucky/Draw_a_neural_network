import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisioPowerShellCommand,
  buildVisioRenderPlan,
  validateVisioReadback,
} from "./visio-bridge.mjs";

const layout = {
  grammar: { id: "residual-graph" },
  figure: { title: "Universal fixture", subtitle: "IR" },
  nodes: [{
    id: "n1",
    label: "Custom Block",
    subtitle: "needs review",
    x: 200,
    y: 300,
    w: 320,
    h: 250,
    representation: "compound",
    semanticRole: "unresolved_operator",
    confidence: 0.42,
    evidence: [{ kind: "source-call", line: 12 }],
    inner: { kind: "unresolved", nodes: [], edges: [] },
  }],
  edges: [],
};

test("buildVisioRenderPlan targets an existing document and carries semantic Shape Data", () => {
  const plan = buildVisioRenderPlan(layout, {
    documentPath: "C:\\project\\existing.vsdx",
    pageName: "Page-1",
    renderId: "agent-run-1",
  });

  assert.equal(plan.createDocument, false);
  assert.equal(plan.preserveExisting, true);
  assert.equal(plan.documentPath, "C:\\project\\existing.vsdx");
  assert.equal(plan.shapes[0].shapeData.sourceNodeId, "n1");
  assert.equal(plan.shapes[0].shapeData.visualRole, "compound");
  assert.equal(plan.shapes[0].shapeData.grammarId, "residual-graph");
  assert.equal(plan.shapes[0].shapeData.confidence, 0.42);
  assert.equal(plan.shapes[0].shapeData.evidenceCount, 1);
});

test("buildVisioPowerShellCommand passes a plan to the existing-document bridge without create-document operations", () => {
  const plan = buildVisioRenderPlan(layout, { documentPath: "C:\\project\\existing.vsdx" });
  const command = buildVisioPowerShellCommand(plan, { scriptPath: "C:\\project\\visio-bridge.ps1" });
  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-File"));
  assert.ok(command.args.includes("C:\\project\\visio-bridge.ps1"));
  assert.ok(command.args.includes("-PlanBase64"));
  assert.equal(command.args.some((arg) => /CreateDocument|AddDocument|NewDocument/i.test(arg)), false);
});

test("buildVisioRenderPlan uses a stable agent-owned scope for repeated syncs to the same document", () => {
  const first = buildVisioRenderPlan(layout, { documentPath: "C:\\project\\existing.vsdx", pageName: "Page-1" });
  const second = buildVisioRenderPlan(layout, { documentPath: "C:\\project\\existing.vsdx", pageName: "Page-1" });
  assert.equal(first.renderId, second.renderId);
});

test("validateVisioReadback fails when a planned source node was not written", () => {
  const plan = buildVisioRenderPlan(layout, { documentPath: "C:\\project\\existing.vsdx", renderId: "run-1" });
  const report = validateVisioReadback(plan, {
    renderId: "run-1",
    sourceNodeIds: [],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingSourceNodeIds, ["n1"]);
});

test("validateVisioReadback also requires every planned connector edge to be present", () => {
  const plan = buildVisioRenderPlan({ ...layout, edges: [{ id: "edge-1", source: "n1", target: "n1", type: "signal", route: { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } }] }, {
    documentPath: "C:\\project\\existing.vsdx",
    renderId: "run-2",
  });
  const report = validateVisioReadback(plan, {
    renderId: "run-2",
    sourceNodeIds: ["n1"],
    edgeIds: [],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingEdgeIds, ["outer-edge::edge-1"]);
});
