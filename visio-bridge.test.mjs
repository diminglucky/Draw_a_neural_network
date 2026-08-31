import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Visio bridge uses repeat geometry, pooling prisms, and glued connector endpoints", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /repeatCount/i);
  assert.match(script, /pool-prism/i);
  assert.match(script, /GlueTo/i);
});

test("Visio plan keeps semantic connector shape references and classifier primitives", () => {
  const plan = buildVisioRenderPlan({
    grammar: { id: "tensor-flow" },
    nodes: [
      { id: "a", family: "conv", representation: "volume", x: 0, y: 0, w: 120, h: 160, repeatCount: 2 },
      { id: "b", family: "dense", representation: "classifier-prism", x: 220, y: 0, w: 100, h: 160 },
    ],
    edges: [{ id: "ab", source: "a", target: "b", route: { points: [{ x: 120, y: 80 }, { x: 220, y: 80 }] } }],
  }, { documentPath: "C:\\project\\existing.vsdx" });

  assert.equal(plan.shapes[1].shapeKind, "classifier-prism");
  assert.equal(plan.connectors[0].sourceShapeId, "outer::a");
  assert.equal(plan.connectors[0].targetShapeId, "outer::b");
});

test("legacy cleanup is opt-in and limited to an explicit shape-name prefix", () => {
  const plan = buildVisioRenderPlan(layout, {
    documentPath: "C:\\project\\existing.vsdx",
    replaceLegacyPrefix: "synapse.",
  });
  assert.equal(plan.replaceLegacyPrefix, "synapse.");
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /replaceLegacyPrefix/i);
  assert.match(script, /-like/);
});

test("Visio plan and bridge allocate a readable publication page", () => {
  const plan = buildVisioRenderPlan(layout, { documentPath: "C:\\project\\existing.vsdx" });
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.ok(plan.unitScale >= 0.006);
  assert.match(script, /PageWidth/i);
  assert.match(script, /Draw-FigureHeader/i);
  assert.match(script, /figure-title/i);
});

test("Visio bridge refreshes the existing document window after an in-place sync", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /windowActivated/);
  assert.match(script, /ViewFit/i);
  assert.match(script, /Visible\s*=\s*\$true/i);
  assert.match(script, /Activate\(\)\s*\|\s*Out-Null/);
});

test("Visio page height follows a compact publication artboard instead of a fixed letter page", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /pageHeight\s*=\s*\[Math\]::Max\(5\.5/);
});

test("Visio migration can explicitly open the existing document in an editable fresh session", () => {
  const plan = buildVisioRenderPlan(layout, {
    documentPath: "C:\\project\\existing.vsdx",
    openMode: "fresh",
  });
  assert.equal(plan.openMode, "fresh");
});

test("validateVisioReadback rejects reported connectors without glued endpoints", () => {
  const plan = buildVisioRenderPlan({
    ...layout,
    edges: [{ id: "edge-1", source: "n1", target: "n1", route: { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } }],
  }, { documentPath: "C:\\project\\existing.vsdx", renderId: "run-glue" });
  const report = validateVisioReadback(plan, {
    renderId: "run-glue",
    sourceNodeIds: ["n1"],
    edgeIds: ["outer-edge::edge-1"],
    gluedBeginEdgeIds: [],
    gluedEndEdgeIds: [],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingGluedBeginEdgeIds, ["outer-edge::edge-1"]);
  assert.deepEqual(report.missingGluedEndEdgeIds, ["outer-edge::edge-1"]);
});
