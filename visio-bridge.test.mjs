import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildVisioPowerShellCommand,
  buildVisioRenderPlan,
  renderUniversalFigureToVisio,
  validateVisioReadback,
} from "./visio-bridge.mjs";

function scenePlan(overrides = {}) {
  return {
    version: "visio-diagram-plan/v1",
    figure: { title: "Scene Fixture", subtitle: "Bridge" },
    grammar: { id: "scene-flow" },
    scene: {
      version: "laid-out-neural-scene/v1",
      units: "layout-unit",
      primitives: [
        {
          id: "primitive-input",
          form: "plane",
          role: "body",
          category: "data",
          projectionId: "projection-input",
          sourceNodeIds: ["source-input"],
          sourceEdgeIds: [],
          semanticTags: ["input", "spatial"],
          labels: ["Input"],
          ports: { inputs: [], outputs: [{ id: "out" }] },
          data: { scale: "s1" },
          bounds: { x: 40, y: 40, w: 100, h: 80 },
          anchors: { inputs: [], outputs: [{ id: "out", x: 140, y: 80 }] },
          zIndex: 10,
        },
        {
          id: "primitive-output",
          form: "band",
          role: "body",
          category: "operator",
          projectionId: "projection-output",
          sourceNodeIds: ["source-output"],
          sourceEdgeIds: [],
          semanticTags: ["operator"],
          labels: ["Output"],
          ports: { inputs: [{ id: "in" }], outputs: [] },
          data: {},
          bounds: { x: 260, y: 40, w: 100, h: 80 },
          anchors: { inputs: [{ id: "in", x: 260, y: 80 }], outputs: [] },
          zIndex: 11,
        },
      ],
      connectors: [{
        id: "scene-edge",
        sourcePrimitiveId: "primitive-input",
        targetPrimitiveId: "primitive-output",
        sourcePortId: "out",
        targetPortId: "in",
        sourceEdgeIds: ["edge-input-output"],
        relationTags: ["data"],
        routeClass: "main-flow",
        points: [{ x: 140, y: 80 }, { x: 260, y: 80 }],
      }],
      groups: [],
      page: { x: 0, y: 0, width: 420, height: 180 },
      diagnostics: [],
      ...overrides.scene,
    },
  };
}

test("render retries transient Visio COM server faults", async () => {
  let calls = 0;
  const result = await renderUniversalFigureToVisio(scenePlan(), {
    documentPath: "C:\\project\\existing.vsdx",
    runner: async (command) => {
      calls += 1;
      if (calls === 1) throw new Error("Visio bridge failed: HRESULT:0x80010105 (RPC_E_SERVERFAULT)");
      const plan = JSON.parse(Buffer.from(command.stdin, "base64").toString("utf8"));
      return {
        status: "rendered",
        readback: {
          renderId: plan.renderId,
          sourceNodeIds: ["source-input", "source-output"],
          edgeIds: ["scene-edge"],
          gluedBeginEdgeIds: ["scene-edge"],
          gluedEndEdgeIds: ["scene-edge"],
          connectorEndpoints: {
            "edge-input-output": {
              sourceEdgeId: "edge-input-output",
              sourceEndpointId: "out",
              targetEndpointId: "in",
            },
          },
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, "rendered");
  assert.equal(result.readbackValidation.ok, true);
});

test("buildVisioRenderPlan rejects input without a laid-out scene", () => {
  assert.throws(
    () => buildVisioRenderPlan({ version: "visio-diagram-plan/v1", nodes: [], edges: [] }, { documentPath: "C:\\project\\existing.vsdx" }),
    /must contain a laid-out neural scene/,
  );
});

test("buildVisioRenderPlan rejects retired plan versions even when legacy options are supplied", () => {
  assert.throws(
    () => buildVisioRenderPlan({ version: "universal-publication-figure/v1", nodes: [], edges: [] }, {
      documentPath: "C:\\project\\existing.vsdx",
      allowLegacyProjection: true,
    }),
    /only Scene-backed Visio Diagram Plan/,
  );
  assert.throws(
    () => buildVisioRenderPlan({ version: "figure-plan/v1", nodes: [], edges: [] }, {
      documentPath: "C:\\project\\existing.vsdx",
      allowLegacyProjection: true,
    }),
    /only Scene-backed Visio Diagram Plan/,
  );
});

test("scene projection maps primitive forms mechanically with identity, anchors, z-order, and glue", () => {
  const forms = ["plane", "volume", "stack", "band", "wedge", "glyph", "cell", "strip", "callout", "text"];
  const primitives = forms.map((form, index) => ({
    id: `primitive-${form}`,
    form,
    role: form === "text" ? "decoration" : "body",
    category: form === "text" ? "annotation" : "operator",
    projectionId: `projection-${form}`,
    sourceNodeIds: [`source-${form}`],
    sourceEdgeIds: [],
    semanticTags: form === "glyph" ? ["merge"] : [form],
    labels: [`${form} label`],
    ports: { inputs: [], outputs: [] },
    derivedFrom: [`evidence-${form}`],
    data: {},
    bounds: { x: 20 + index * 110, y: 40, w: 80, h: 60 },
    anchors: { inputs: [{ id: "in", x: 20 + index * 110, y: 70 }], outputs: [{ id: "out", x: 100 + index * 110, y: 70 }] },
    zIndex: 100 + index,
  }));
  const input = scenePlan({
    scene: {
      primitives,
      connectors: [{
        id: "scene-flow",
        sourcePrimitiveId: "primitive-plane",
        targetPrimitiveId: "primitive-volume",
        sourcePortId: "out",
        targetPortId: "in",
        sourceEdgeIds: ["source-flow"],
        relationTags: ["data"],
        routeClass: "main-flow",
        points: [{ x: 100, y: 70 }, { x: 130, y: 70 }],
      }],
      page: { x: 0, y: 0, width: 1200, height: 180 },
    },
  });
  input.nodes = [{ id: "legacy", label: "YOLO ResNet LSTM", x: 0, y: 0, w: 1, h: 1 }];

  const plan = buildVisioRenderPlan(input, { documentPath: "C:\\project\\existing.vsdx" });
  assert.deepEqual(plan.shapes.map((shape) => shape.sceneForm), forms);
  assert.deepEqual(plan.shapes.map((shape) => shape.id), primitives.map((primitive) => primitive.id));
  assert.ok(plan.shapes.every((shape, index) => shape.zIndex === 100 + index));
  assert.deepEqual(plan.shapes[0].anchors, primitives[0].anchors);
  assert.deepEqual(plan.shapes[0].shapeData.sourceNodeIds, ["source-plane"]);
  assert.equal(plan.shapes[0].shapeData.derivedFrom, "evidence-plane");
  assert.equal(plan.shapes.some((shape) => shape.id === "outer::legacy"), false);
  assert.equal(plan.connectors[0].sourceShapeId, "primitive-plane");
  assert.equal(plan.connectors[0].targetShapeId, "primitive-volume");
  assert.deepEqual(plan.connectors[0].sourceEndpointIds, { source: "out", target: "in" });
  assert.equal(plan.connectors[0].sourceEdgeId, "source-flow");
});

test("scene projection preserves every source identity for an aggregated primitive", () => {
  const sourceNodeIds = ["source-left", "source-center", "source-right"];
  const plan = buildVisioRenderPlan(scenePlan({
    scene: {
      primitives: [{
        id: "aggregate-primitive",
        form: "band",
        role: "body",
        category: "operator",
        projectionId: "aggregate-projection",
        sourceNodeIds,
        sourceEdgeIds: [],
        semanticTags: ["operator"],
        labels: ["Aggregate"],
        bounds: { x: 20, y: 40, w: 240, h: 80 },
        anchors: { inputs: [], outputs: [] },
        data: {},
        zIndex: 1,
      }],
      connectors: [],
      page: { x: 0, y: 0, width: 300, height: 160 },
    },
  }), { documentPath: "C:\\project\\existing.vsdx", renderId: "aggregate-run" });

  assert.equal(plan.shapes[0].shapeData.sourceNodeId, "source-left");
  assert.deepEqual(plan.shapes[0].shapeData.sourceNodeIds, sourceNodeIds);
});

test("scene projection carries block entry and exit ports into Shape Data", () => {
  const input = scenePlan({
    scene: {
      primitives: [{
        id: "block-primitive",
        form: "band",
        role: "body",
        category: "structure",
        projectionId: "block-projection",
        sourceNodeIds: ["a", "b", "merge"],
        sourceEdgeIds: ["internal"],
        semanticTags: ["block"],
        blockKind: "residual-block",
        labels: ["Residual"],
        ports: {
          inputs: [{ portId: "image" }, { portId: "state" }],
          outputs: [{ portId: "features" }],
        },
        bounds: { x: 20, y: 40, w: 240, h: 80 },
        anchors: { inputs: [{ id: "image", x: 20, y: 60 }, { id: "state", x: 20, y: 100 }], outputs: [{ id: "features", x: 260, y: 80 }] },
        data: {},
        zIndex: 1,
      }],
      connectors: [],
      page: { x: 0, y: 0, width: 320, height: 180 },
    },
  });
  const plan = buildVisioRenderPlan(input, { documentPath: "C:\\project\\existing.vsdx" });
  assert.equal(plan.shapes[0].shapeData.inputPorts, "image|state");
  assert.equal(plan.shapes[0].shapeData.outputPorts, "features");
  assert.equal(plan.shapes[0].shapeData.blockEntryPorts, "image|state");
  assert.equal(plan.shapes[0].shapeData.blockExitPorts, "features");
});

test("scene projection preserves unique MIMO block endpoint ids for connector Glue", () => {
  const input = scenePlan({
    scene: {
      primitives: [
        {
          id: "block-primitive",
          form: "band",
          role: "body",
          category: "structure",
          projectionId: "block-projection",
          sourceNodeIds: ["a", "b"],
          sourceEdgeIds: [],
          semanticTags: ["block"],
          blockKind: "conv-block",
          labels: ["Block"],
          ports: { inputs: [], outputs: [{ portId: "out" }, { portId: "out-2" }] },
          bounds: { x: 20, y: 40, w: 240, h: 80 },
          anchors: { inputs: [], outputs: [{ id: "out", x: 260, y: 60 }, { id: "out-2", x: 260, y: 100 }] },
          data: {},
          zIndex: 1,
        },
        {
          id: "target-primitive",
          form: "band",
          role: "body",
          category: "operator",
          projectionId: "target-projection",
          sourceNodeIds: ["merge"],
          sourceEdgeIds: [],
          semanticTags: ["operator"],
          labels: ["Merge"],
          ports: { inputs: [{ portId: "in" }], outputs: [] },
          bounds: { x: 360, y: 40, w: 100, h: 80 },
          anchors: { inputs: [{ id: "in", x: 360, y: 80 }], outputs: [] },
          data: {},
          zIndex: 2,
        },
      ],
      connectors: [{
        id: "mimo-edge",
        sourcePrimitiveId: "block-primitive",
        targetPrimitiveId: "target-primitive",
        sourcePortId: "out-2",
        targetPortId: "in",
        sourceEdgeIds: ["mimo-source-edge"],
        relationTags: ["data"],
        routeClass: "main-flow",
        points: [{ x: 260, y: 100 }, { x: 360, y: 80 }],
      }],
      page: { x: 0, y: 0, width: 520, height: 180 },
    },
  });
  const plan = buildVisioRenderPlan(input, { documentPath: "C:\\project\\existing.vsdx" });
  assert.deepEqual(plan.connectors[0].sourceEndpointIds, { source: "out-2", target: "in" });
  assert.equal(plan.connectors[0].sourceShapeId, "block-primitive");
  assert.equal(plan.connectors[0].targetShapeId, "target-primitive");
});

test("buildVisioPowerShellCommand passes the Scene plan over stdin", () => {
  const plan = buildVisioRenderPlan(scenePlan(), { documentPath: "C:\\project\\existing.vsdx" });
  const command = buildVisioPowerShellCommand(plan, { scriptPath: "C:\\project\\visio-bridge.ps1" });
  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-File"));
  assert.ok(command.args.includes("C:\\project\\visio-bridge.ps1"));
  assert.ok(command.args.includes("-PlanBase64"));
  assert.equal(command.args.some((arg) => /CreateDocument|AddDocument|NewDocument/i.test(arg)), false);
  assert.ok(JSON.parse(Buffer.from(command.stdin, "base64").toString("utf8")).shapes.length >= 2);
});

test("buildVisioRenderPlan uses a stable agent-owned scope for repeated syncs", () => {
  const first = buildVisioRenderPlan(scenePlan(), { documentPath: "C:\\project\\existing.vsdx", pageName: "Page-1" });
  const second = buildVisioRenderPlan(scenePlan(), { documentPath: "C:\\project\\existing.vsdx", pageName: "Page-1" });
  assert.equal(first.renderId, second.renderId);
});

test("validateVisioReadback requires source nodes, connector edges, glue, and endpoint identities", () => {
  const plan = buildVisioRenderPlan(scenePlan(), { documentPath: "C:\\project\\existing.vsdx", renderId: "run-readback" });
  const report = validateVisioReadback(plan, {
    renderId: "run-readback",
    sourceNodeIds: ["source-input"],
    edgeIds: ["scene-edge"],
    gluedBeginEdgeIds: [],
    gluedEndEdgeIds: [],
    connectors: [{ sourceEdgeId: "edge-input-output", sourceEndpointId: "wrong", targetEndpointId: "in" }],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.missingSourceNodeIds, ["source-output"]);
  assert.deepEqual(report.missingGluedBeginEdgeIds, ["scene-edge"]);
  assert.deepEqual(report.missingGluedEndEdgeIds, ["scene-edge"]);
  assert.deepEqual(report.endpointMismatches, [{
    sourceEdgeId: "edge-input-output",
    side: "source",
    expected: "out",
    actual: "wrong",
    reason: "endpoint-identity-mismatch",
  }]);
});

test("PowerShell bridge dispatches only Scene primitives", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /function Draw-ScenePrimitive/);
  assert.match(script, /\$Spec\.sceneForm/);
  assert.match(script, /Unsupported Scene primitive form/);
  assert.doesNotMatch(script, /universal-publication-figure|legacy publication renderer/i);
  const drawPlanShape = script.match(/function Draw-PlanShape[\s\S]*?\r?\n}\r?\n\r?\nfunction Draw-JunctionDot/);
  assert.ok(drawPlanShape, "expected Draw-PlanShape to remain isolated");
  assert.doesNotMatch(drawPlanShape[0], /publication-tensor-box|classifier-prism|recurrent-instance|named-module/);
});

test("PowerShell bridge keeps native save, preview, glue, and readback paths", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /GlueTo/);
  assert.match(script, /\$doc\.Save\(\) \| Out-Null/);
  assert.match(script, /Page\.Export/i);
  assert.match(script, /sourceNodeIds[\s\S]{0,300}ConvertFrom-Json/);
  assert.match(script, /readbackMode -eq "reopen"/);
});
