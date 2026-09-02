import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildVisioPowerShellCommand,
  buildVisioRenderPlan,
  validateVisioReadback,
} from "./visio-bridge.mjs";
import { createFigurePlan } from "./figure-plan.mjs";

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

test("Visio consumes Figure Plan source identities for shapes and connectors", () => {
  const figurePlan = createFigurePlan({
    ir: {
      nodes: [
        { id: "source-a", family: "recurrent", label: "State A", stage: 0 },
        { id: "source-b", family: "custom", label: "Opaque B", stage: 1 },
      ],
      edges: [{ id: "source-edge", source: "source-a", target: "source-b", type: "loop" }],
    },
    layout: {
      grammar: { id: "generic-dag" },
      figure: { title: "Identity fixture" },
      artboard: { x: 0, y: 0, width: 600, height: 300 },
      nodes: [
        { id: "layout-a", sourceNodeId: "source-a", family: "recurrent", representation: "compound", x: 20, y: 40, w: 120, h: 100 },
        { id: "layout-b", sourceNodeId: "source-b", family: "custom", representation: "compound", x: 300, y: 40, w: 120, h: 100 },
      ],
      edges: [{ id: "layout-edge", sourceEdgeId: "source-edge", source: "layout-a", target: "layout-b", route: { kind: "direct", points: [{ x: 140, y: 90 }, { x: 300, y: 90 }] } }],
    },
  });
  const plan = buildVisioRenderPlan(figurePlan, { documentPath: "C:\\project\\existing.vsdx" });

  assert.equal(plan.shapes[0].shapeData.sourceNodeId, "source-a");
  assert.equal(plan.shapes[1].shapeData.sourceNodeId, "source-b");
  assert.equal(plan.connectors[0].sourceEdgeId, "source-edge");
  assert.equal(plan.connectors[0].sourceNodeId, "source-a");
  assert.equal(plan.connectors[0].targetNodeId, "source-b");
  assert.equal(plan.connectors[0].sourceShapeId, "outer::layout-a");
  assert.equal(plan.connectors[0].targetShapeId, "outer::layout-b");
  assert.equal(plan.shapes[0].shapeKind, "compound");
  assert.equal(plan.shapes[0].x, 20);
  assert.equal(plan.shapes[0].w, 120);
});

test("Visio plan carries semantic role, style profile, label slots, and geometry evidence", () => {
  const plan = buildVisioRenderPlan({
    grammar: { id: "topology-derived" },
    nodes: [{
      id: "feature-stage",
      family: "conv",
      label: "Feature stage",
      subtitle: "32 x 32 x 64",
      visualRole: "feature-map-stage",
      styleProfile: "feature-map",
      labelSlots: {
        title: "above",
        subtitle: "below",
        tensorShape: "below",
        operatorDetails: "outside",
      },
      geometryData: {
        repeatCount: 3,
        hasInternalTopology: true,
        internalNodeCount: 3,
      },
      x: 100,
      y: 100,
      w: 180,
      h: 220,
    }],
    edges: [],
  }, { documentPath: "C:\\project\\existing.vsdx" });

  assert.equal(plan.shapes[0].visualRole, "feature-map-stage");
  assert.equal(plan.shapes[0].styleProfile, "feature-map");
  assert.equal(plan.shapes[0].labelSlots.title, "above");
  assert.equal(plan.shapes[0].geometryData.repeatCount, 3);
  assert.equal(plan.shapes[0].shapeData.visualRole, "feature-map-stage");
  assert.equal(plan.shapes[0].shapeData.operatorFamily, "conv");
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

test("Visio bridge renders semantic roles with publication geometry and external labels", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /styleProfile/i);
  assert.match(script, /feature-map/i);
  assert.match(script, /Draw-FeatureMapGrid/i);
  assert.match(script, /Draw-PlanLabel/i);
  assert.match(script, /labelTitleSlot/i);
  assert.match(script, /#FFC47A/i);
  assert.match(script, /OUTPUT|output-distribution/i);
  assert.match(script, /input-tensor/i);
  assert.match(script, /feature-map/i);
});

test("Visio compound frames use valid foreground and background transparency cells", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const body = script.match(/function Draw-CompoundModule[\s\S]*?\n}\n\nfunction Draw-UnresolvedModule/);
  assert.ok(body, "expected compound module renderer");
  assert.doesNotMatch(body[0], /CellsU\("FillTransparency"\)/);
  assert.match(body[0], /FillForegndTrans/);
  assert.match(body[0], /FillBkgndTrans/);
});

test("Visio bridge gives vectorization a funnel silhouette and bolds stage labels", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const flattenBody = script.match(/function Draw-FlattenRibbon[\s\S]*?\n}\n\nfunction Draw-/);
  assert.ok(flattenBody, "expected an isolated vectorization drawing function");
  assert.match(flattenBody[0], /DrawPolyline/);
  assert.match(flattenBody[0], /targetHeight/);
  assert.match(flattenBody[0], /vectorize-funnel/);
  assert.match(script, /\$visualRole -eq "vectorize"[\s\S]*Draw-FlattenRibbon/);
  assert.match(script, /VisualRole -eq "figure-label"/i);
  assert.match(script, /titleY.*\+ 0\.3/i);
  const poolBody = script.match(/if \(\$kind -eq "pool-prism"\)[\s\S]*?return @\(Draw-DownsampleFrustum/);
  assert.ok(poolBody, "expected a dedicated pool geometry path");
  assert.match(script, /sourceHeight|targetHeight/);
  assert.match(script, /labelWidth/);
  assert.match(script, /pool-downsample/);
  const downsampleBody = script.match(/function Draw-DownsampleFrustum[\s\S]*?\n}\n\nfunction Draw-NeuronColumn/);
  assert.ok(downsampleBody, "expected an isolated pooling transition renderer");
  assert.match(downsampleBody[0], /Draw-PlotNeuralNetTensorBox/);
  assert.doesNotMatch(downsampleBody[0], /pool-frustum-side/);
  const labelBody = script.match(/function Draw-PlanLabel[\s\S]*?\n}\n\nfunction Draw-CompoundModule/);
  assert.ok(labelBody, "expected the external caption renderer");
  assert.match(labelBody[0], /pool-downsample[\s\S]*\$subtitleText = ""/);
});

test("Visio bridge translates generic neural roles into the tensor-flow visual grammar", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  for (const token of [
    '"feature-map" { "#FFC47A"',
    '"pool" { "#E65034"',
    '"vectorize" { "#7A238C"',
    '"neuron" { "#9563C8"',
    '"output" { "#7A238C"',
  ]) {
    assert.ok(script.includes(token), `expected PlotNeuralNet-style role color ${token}`);
  }
  const featureMapBody = script.match(/function Draw-FeatureMapStack[\s\S]*?\n}\n\nfunction Draw-FeatureMapGrid/);
  assert.ok(featureMapBody, "expected an isolated feature-map renderer");
  assert.doesNotMatch(featureMapBody[0], /Draw-FeatureMapBand/);
  assert.match(featureMapBody[0], /\$cellCount/);
  assert.match(featureMapBody[0], /\$cellWidth/);
  assert.match(featureMapBody[0], /Draw-RightBandedTensorCell/);
  assert.doesNotMatch(featureMapBody[0], /\$layerX|\$layerY/);
  const outputBody = script.match(/function Draw-OutputDistribution[\s\S]*?\n}\n\nfunction Draw-ClassifierPrism/);
  assert.ok(outputBody, "expected an isolated output renderer");
  assert.match(outputBody[0], /Draw-PrismFaces/);
  assert.doesNotMatch(script, /VGG16|ResNet|U-Net|Transformer/);
});

test("CNN tensors use the PlotNeuralNet Box and RightBandedBox projection rather than compressed prisms", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const tensorBox = script.match(/function Draw-PlotNeuralNetTensorBox[\s\S]*?\n}\n\nfunction Draw-InputTensor/);
  const bandedCell = script.match(/function Draw-RightBandedTensorCell[\s\S]*?\n}\n\nfunction Draw-FeatureMapGrid/);
  const poolBox = script.match(/function Draw-DownsampleFrustum[\s\S]*?\n}\n\nfunction Draw-NeuronColumn/);

  assert.match(script, /function Project-PlotNeuralNetTensorPoint/);
  assert.ok(tensorBox, "expected a dedicated translation of PlotNeuralNet Box vertices");
  assert.match(tensorBox[0], /near|far/i);
  assert.match(tensorBox[0], /densely-dashed|far-edge/i);
  assert.doesNotMatch(tensorBox[0], /\$h\s*=\s*Project-PlotNeuralNetTensorPoint/, "PowerShell treats $H and $h as the same variable");
  assert.ok(bandedCell, "expected a dedicated translation of PlotNeuralNet RightBandedBox cells");
  assert.match(bandedCell[0], /Draw-PlotNeuralNetTensorBox/);
  assert.match(bandedCell[0], /right third|bandWidth/i);
  assert.ok(poolBox, "expected a dedicated pooling Box renderer");
  assert.match(poolBox[0], /Draw-PlotNeuralNetTensorBox/);
  assert.doesNotMatch(bandedCell[0], /Draw-PrismFaces/);
  assert.doesNotMatch(poolBox[0], /Draw-PrismFaces/);
});

test("PlotNeuralNet transplant keeps its exact z basis, opacity, cell loop, and east-face paint order", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const projection = script.match(/function Project-PlotNeuralNetTensorPoint[\s\S]*?\n}\n\nfunction New-PlotNeuralNetFaceSpec/);
  const featureMap = script.match(/function Draw-FeatureMapStack[\s\S]*?\n}\n\nfunction Draw-RightBandedTensorCell/);
  const bandedCell = script.match(/function Draw-RightBandedTensorCell[\s\S]*?\n}\n\nfunction Draw-FeatureMapGrid/);

  assert.ok(projection, "expected the upstream TikZ z-basis projection helper");
  assert.match(projection[0], /-0\.385/);
  assert.match(projection[0], /DepthCoordinate/);
  assert.ok(featureMap, "expected the direct RightBandedBox cell loop");
  assert.doesNotMatch(featureMap[0], /\$cellCount\s*=\s*\[Math\]::Min\(4/);
  assert.ok(bandedCell, "expected the direct RightBandedBox cell implementation");
  assert.match(bandedCell[0], /Draw-PlotNeuralNetTensorBox[\s\S]*\$IsLast/);
  assert.match(bandedCell[0], /fillOpacity\s*=\s*0\.6/);
  assert.doesNotMatch(bandedCell[0], /\$\w+Spec\.fillOpacity\s*=/, "PowerShell PSCustomObject opacity must be declared in its literal");
  assert.doesNotMatch(bandedCell[0], /\$h\s*=\s*Project-PlotNeuralNetTensorPoint/, "PowerShell must not alias the far h vertex to the H height parameter");
  assert.match(script, /\$FillOpacity\s*=\s*0\.4/);
});

test("PlotNeuralNet fill opacity targets the native Visio foreground and background transparency cells", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const style = script.match(/function Set-ShapeStyle[\s\S]*?\n}\n\nfunction Set-PageLayout/);

  assert.ok(style, "expected the central native ShapeSheet styling function");
  assert.match(style[0], /FillForegndTrans/);
  assert.match(style[0], /FillBkgndTrans/);
  assert.doesNotMatch(style[0], /CellsU\("FillTransparency"\)/);
});

test("Visio opacity is opt-in so the PlotNeuralNet CNN transplant cannot erase other semantic roles", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const style = script.match(/function Set-ShapeStyle[\s\S]*?\n}\n\nfunction Set-PageLayout/);

  assert.ok(style, "expected the central native ShapeSheet styling function");
  assert.match(style[0], /PSObject\.Properties\["fillOpacity"\]/);
});

test("Visio bridge gives each publication role its own native geometry renderer", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  for (const renderer of [
    "Draw-InputTensor",
    "Draw-FeatureMapStack",
    "Draw-DownsampleFrustum",
    "Draw-FlattenRibbon",
    "Draw-NeuronColumn",
    "Draw-OutputDistribution",
  ]) {
    assert.match(script, new RegExp(`function ${renderer}`), `missing ${renderer}`);
  }
  assert.match(script, /Draw-DownsampleFrustum[\s\S]*sourceAnchor/i);
  assert.match(script, /Draw-FeatureMapStack[\s\S]*repeatCount/i);
  assert.match(script, /Draw-NeuronColumn[\s\S]*DrawOval/i);
  assert.match(script, /Draw-OutputDistribution[\s\S]*barCount/i);
});

test("Visio bridge keeps compound and unresolved modules distinguishable from generic cards", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /function Draw-CompoundModule/);
  assert.match(script, /function Draw-UnresolvedModule/);
  assert.match(script, /Draw-CompoundModule[\s\S]*LinePattern/);
  assert.match(script, /Draw-UnresolvedModule[\s\S]*DrawPolyline/);
});

test("current feature-map renderer keeps the tensor face clean and topology evidence external", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const body = script.match(/function Draw-FeatureMapStack[\s\S]*?\n}\n\nfunction Draw-DownsampleFrustum/);
  assert.ok(body, "expected the current feature-map renderer body");
  assert.doesNotMatch(body[0], /Draw-FeatureMapOperatorRail/);
  assert.match(body[0], /channelCount|repeatCount/);
  assert.match(body[0], /feature-map-cell/);
  assert.doesNotMatch(script, /function Draw-FeatureMapOperatorRail/);
  assert.doesNotMatch(body[0], /Draw-FeatureMapActivationField/);
  assert.doesNotMatch(script, /feature-map-operator-rail/);
  assert.doesNotMatch(script, /cellCount = \[Math\]::Min\(4/);
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

test("Visio bridge removes stale agent scopes before an in-place resync", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /Remove-StaleAgentShapes/i);
  assert.match(script, /Quarantine-AgentShape/i);
  assert.match(script, /FillPattern/i);
  assert.match(script, /agent-scope-/i);
  assert.match(script, /replaceScope/i);
});

test("Visio bridge keeps the document hidden while cleaning and drawing", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  const cleanupIndex = script.indexOf("$agentCleanup = Remove-StaleAgentShapes");
  const visibleIndex = script.indexOf("$doc.Application.Visible = $true");
  assert.ok(cleanupIndex >= 0);
  assert.ok(visibleIndex >= 0);
  assert.ok(cleanupIndex < visibleIndex);
});

test("Visio bridge replaces a hidden moniker attachment with a writable existing-document session", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /attachedViaMoniker/i);
  assert.match(script, /hiddenAttachedDocument/i);
  assert.match(script, /Windows\.Count/i);
  assert.match(script, /Documents\.Open/i);
});

test("Visio bridge refuses to overwrite a visible read-only document", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /hiddenSavedDocument/i);
  assert.match(script, /The existing Visio document is read-only/i);
  assert.match(script, /will not modify or replace/i);
});

test("Visio bridge can export a preview from the current page after an in-place sync", () => {
  const plan = buildVisioRenderPlan(layout, {
    documentPath: "C:\\project\\existing.vsdx",
    previewPath: "C:\\project\\current-page.png",
  });
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.equal(plan.previewPath, "C:\\project\\current-page.png");
  assert.match(script, /Page\.Export/i);
  assert.match(script, /previewPath/i);
});

test("Visio page height follows a compact publication artboard instead of a fixed letter page", () => {
  const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /pageHeight\s*=\s*\[Math\]::Max\(4\.8/);
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
