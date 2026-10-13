import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateBlockAcceptanceFixture } from "../block-acceptance-audit.mjs";
import {
  architectureShowcaseFixtures,
  findShowcaseFixture,
  showcaseNames,
} from "../model-showcase-fixtures.mjs";
import { renderSceneSvg, SCENE_SVG_RENDERER_VERSION } from "../scene-svg-renderer.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

if (args.has("list")) {
  console.log(showcaseNames().join("\n"));
  process.exit(0);
}

const modelName = String(args.get("model") || args.get("fixture") || "all");
const selected = modelName === "all"
  ? architectureShowcaseFixtures
  : [findShowcaseFixture(modelName)];
if (selected.some((fixture) => !fixture)) {
  throw new Error(`Unknown showcase model "${modelName}". Available: ${showcaseNames().join(", ")}, all`);
}

const outputRoot = fileURLToPath(new URL("../artifacts/showcase/", import.meta.url));
mkdirSync(outputRoot, { recursive: true });
const results = [];
for (const fixture of selected) results.push(renderFixture(fixture, outputRoot));
const index = {
  version: SCENE_SVG_RENDERER_VERSION,
  status: results.every((result) => result.status === "rendered") ? "rendered" : "failed",
  count: results.length,
  results,
};
writeFileSync(`${outputRoot}index.json`, JSON.stringify(index, null, 2));
console.log(JSON.stringify(selected.length === 1 ? results[0] : index, null, 2));

function renderFixture(fixture, outputRoot) {
  const { audit, result } = evaluateBlockAcceptanceFixture(fixture);
  if (!audit.accepted) throw new Error(`Showcase model failed: ${fixture.name}: ${JSON.stringify(audit)}`);
  const svg = renderSceneSvg(result.visioDiagramPlan.scene, { title: fixture.title });
  const outputDir = `${outputRoot}${fixture.name}/`;
  mkdirSync(outputDir, { recursive: true });
  const svgPath = `${outputDir}${fixture.name}.svg`;
  const auditPath = `${outputDir}${fixture.name}.audit.json`;
  writeFileSync(svgPath, svg, "utf8");
  writeFileSync(auditPath, JSON.stringify({
    version: SCENE_SVG_RENDERER_VERSION,
    name: fixture.name,
    title: fixture.title,
    subtitle: fixture.subtitle,
    capabilities: fixture.capabilities,
    expectedKinds: fixture.expectedKinds,
    svgPath,
    planHash: audit.planHash,
    scene: audit.scene,
    blockKinds: audit.blockIr?.kinds || [],
  }, null, 2));
  return {
    status: "rendered",
    name: fixture.name,
    title: fixture.title,
    svgPath,
    auditPath,
    planHash: audit.planHash,
    blockKinds: audit.blockIr?.kinds || [],
  };
}
