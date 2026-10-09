import assert from "node:assert/strict";
import test from "node:test";

import { blockAcceptanceFixtures } from "./block-acceptance-fixtures.mjs";
import { evaluateBlockAcceptanceFixture } from "./block-acceptance-audit.mjs";
import { renderSceneSvg, SCENE_SVG_RENDERER_VERSION } from "./scene-svg-renderer.mjs";

test("renders a laid-out Scene to deterministic SVG", () => {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === "multimodal");
  const { result } = evaluateBlockAcceptanceFixture(fixture);
  const svg = renderSceneSvg(result.visioDiagramPlan.scene, { title: "Multimodal" });
  assert.equal(SCENE_SVG_RENDERER_VERSION, "scene-svg-renderer/v1");
  assert.match(svg, /^<svg /);
  assert.match(svg, /marker id="arrow-main-flow"/);
  assert.match(svg, /class="scene-connector/);
  assert.match(svg, /class="block-badge"/);
  assert.match(svg, /Multimodal/);
  assert.equal(svg, renderSceneSvg(result.visioDiagramPlan.scene, { title: "Multimodal" }));
});

test("escapes labels and rejects incomplete scenes", () => {
  const { result } = evaluateBlockAcceptanceFixture(blockAcceptanceFixtures.find((item) => item.name === "graph"));
  const scene = structuredClone(result.visioDiagramPlan.scene);
  scene.primitives.find((primitive) => primitive.role !== "body").labels = ["A < B & C"];
  const svg = renderSceneSvg(scene, { title: "Graph <Preview>" });
  assert.match(svg, /A &lt; B &amp; C/);
  assert.match(svg, /Graph &lt;Preview&gt;/);
  assert.throws(() => renderSceneSvg({ primitives: [], connectors: null }), /requires primitives and connectors/);
});
