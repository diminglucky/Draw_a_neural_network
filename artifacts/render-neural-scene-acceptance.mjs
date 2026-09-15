import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neuralStructureFixtures } from "../fixtures/neural-structure-fixtures.mjs";
import { deriveNeuralSemanticFacts } from "../neural-semantic-facts.mjs";
import { createProjectionMap } from "../neural-projection-map.mjs";
import { compileSemanticScene } from "../semantic-neural-scene.mjs";
import { layoutNeuralScene } from "../neural-scene-layout.mjs";
import { layoutUniversalFigure } from "../universal-figure.mjs";
import { createVisioDiagramPlan } from "../visio-diagram-plan.mjs";
import { createEmptyVisioDocument, renderUniversalFigureToVisio } from "../visio-bridge.mjs";

const outputDir = fileURLToPath(new URL("./neural-scene-acceptance/", import.meta.url));
mkdirSync(outputDir, { recursive: true });
const selected = new Set(["bypass-add", "three-scale-fusion", "state-feedback"]);
const fixtures = neuralStructureFixtures.filter((item) => selected.has(item.capability));
const compiled = fixtures.map((fixture) => {
  const facts = deriveNeuralSemanticFacts(fixture.ir);
  const projection = createProjectionMap(fixture.ir, facts, { detail: "balanced" });
  return { fixture, scene: layoutNeuralScene(compileSemanticScene(fixture.ir, facts, projection)) };
});

let yOffset = 70;
const primitives = [];
const connectors = [];
const groups = [];
for (const { fixture, scene } of compiled) {
  const prefix = `${fixture.capability}::`;
  const shifted = scene.primitives.map((primitive) => ({
    ...primitive,
    id: `${prefix}${primitive.id}`,
    projectionId: `${prefix}${primitive.projectionId}`,
    sourceNodeIds: primitive.sourceNodeIds.map((id) => `${prefix}${id}`),
    sourceEdgeIds: primitive.sourceEdgeIds.map((id) => `${prefix}${id}`),
    bounds: { ...primitive.bounds, y: primitive.bounds.y + yOffset },
    anchors: {
      inputs: primitive.anchors.inputs.map((anchor) => ({ ...anchor, y: anchor.y + yOffset })),
      outputs: primitive.anchors.outputs.map((anchor) => ({ ...anchor, y: anchor.y + yOffset })),
    },
  }));
  primitives.push(...shifted);
  connectors.push(...scene.connectors.map((connector) => ({
    ...connector,
    id: `${prefix}${connector.id}`,
    sourcePrimitiveId: `${prefix}${connector.sourcePrimitiveId}`,
    targetPrimitiveId: `${prefix}${connector.targetPrimitiveId}`,
    sourceEdgeIds: connector.sourceEdgeIds.map((id) => `${prefix}${id}`),
    points: connector.points.map((point) => ({ ...point, y: point.y + yOffset })),
  })));
  groups.push({ id: `group::${fixture.capability}`, label: fixture.capability.replaceAll("-", " "), kind: "stage", role: "acceptance-section", primitiveIds: shifted.map((item) => item.id), bounds: { x: 20, y: yOffset - 20, w: scene.page.width + 56, h: scene.page.height + 68 } });
  yOffset += scene.page.height + 90;
}

const ir = {
  figure: { title: "Neural Structure Acceptance", subtitle: "Residual, multi-scale, and recurrent structure" },
  nodes: fixtures.flatMap(({ capability, ir: source }) => source.nodes.map((item) => ({ ...item, id: `${capability}::${item.id}` }))),
  edges: fixtures.flatMap(({ capability, ir: source }) => source.edges.map((item) => ({ ...item, id: `${capability}::${item.id}`, source: `${capability}::${item.source}`, target: `${capability}::${item.target}` }))),
};
const scene = { version: "laid-out-neural-scene/v1", units: "layout-unit", primitives, connectors, groups, page: { x: 0, y: 0, width: Math.max(...compiled.map((item) => item.scene.page.width)) + 96, height: yOffset }, diagnostics: [], softScore: { crossings: 0, bends: connectors.reduce((sum, item) => sum + Math.max(0, item.points.length - 2), 0) } };
const plan = createVisioDiagramPlan({ ir, scene, geometry: layoutUniversalFigure(ir) });
const documentPath = `${outputDir}neural-structures-current.vsdx`;
const previewPath = `${outputDir}neural-structures-current.png`;

if (!existsSync(documentPath)) {
  const created = await createEmptyVisioDocument(documentPath);
  if (created.status !== "created") throw new Error(`Could not create acceptance document: ${JSON.stringify(created)}`);
}
const rendered = await renderUniversalFigureToVisio(plan, { documentPath, previewPath, openMode: "editable", renderId: "scene-acceptance-current" });
if (rendered.status !== "rendered" || !rendered.readbackValidation?.ok) throw new Error(`Visio acceptance failed: ${JSON.stringify(rendered)}`);
console.log(JSON.stringify({ status: "accepted", documentPath, previewPath, readback: rendered.readbackValidation }, null, 2));
