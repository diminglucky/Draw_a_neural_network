import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  blockAcceptanceFixtures,
  findBlockAcceptanceFixture,
  fixtureNames,
} from "../block-acceptance-fixtures.mjs";
import { evaluateBlockAcceptanceFixture } from "../block-acceptance-audit.mjs";
import { renderSceneSvg, SCENE_SVG_RENDERER_VERSION } from "../scene-svg-renderer.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

if (args.has("list")) {
  console.log(fixtureNames().join("\n"));
  process.exit(0);
}

const fixtureName = String(args.get("fixture") || "all");
const selected = fixtureName === "all"
  ? blockAcceptanceFixtures
  : [findBlockAcceptanceFixture(fixtureName)];
if (selected.some((fixture) => !fixture)) {
  throw new Error(`Unknown fixture "${fixtureName}". Available: ${fixtureNames().join(", ")}, all`);
}

const results = [];
for (const fixture of selected) results.push(renderFixture(fixture));
console.log(JSON.stringify(selected.length === 1 ? results[0] : { status: "rendered", count: results.length, results }, null, 2));

function renderFixture(fixture) {
  const { audit, result } = evaluateBlockAcceptanceFixture(fixture);
  if (!audit.accepted) throw new Error(`Cannot render rejected fixture ${fixture.name}: ${JSON.stringify(audit)}`);
  const svg = renderSceneSvg(result.visioDiagramPlan.scene, {
    title: fixture.ir.figure?.title || fixture.name,
  });
  const outputDir = fileURLToPath(new URL(`../artifacts/scene-preview/${fixture.name}/`, import.meta.url));
  mkdirSync(outputDir, { recursive: true });
  const svgPath = `${outputDir}${fixture.name}.svg`;
  const auditPath = `${outputDir}${fixture.name}.svg.audit.json`;
  writeFileSync(svgPath, svg, "utf8");
  writeFileSync(auditPath, JSON.stringify({
    version: SCENE_SVG_RENDERER_VERSION,
    fixture: fixture.name,
    svgPath,
    planHash: audit.planHash,
    scene: audit.scene,
    capabilities: audit.capabilities,
    expectedKinds: audit.expectedKinds,
  }, null, 2));
  return {
    status: "rendered",
    fixture: fixture.name,
    svgPath,
    auditPath,
    planHash: audit.planHash,
    scene: audit.scene,
  };
}
