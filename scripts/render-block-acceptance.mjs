import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  blockAcceptanceFixtures,
  findBlockAcceptanceFixture,
  fixtureNames,
} from "../block-acceptance-fixtures.mjs";
import {
  evaluateBlockAcceptanceFixture,
} from "../block-acceptance-audit.mjs";
import { createEmptyVisioDocument, renderUniversalFigureToVisio } from "../visio-bridge.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

if (args.has("list")) {
  console.log(fixtureNames().join("\n"));
  process.exit(0);
}

const fixtureName = String(args.get("fixture") || "mixed");
const planOnly = args.has("plan-only") || args.has("dry-run");
const selected = fixtureName === "all"
  ? blockAcceptanceFixtures
  : [findBlockAcceptanceFixture(fixtureName)];
if (selected.some((fixture) => !fixture)) {
  throw new Error(`Unknown fixture "${fixtureName}". Available: ${fixtureNames().join(", ")}, all`);
}

const results = [];
for (const fixture of selected) {
  results.push(await runFixture(fixture));
}
console.log(JSON.stringify(selected.length === 1 ? results[0] : { status: "accepted", count: results.length, results }, null, 2));

async function runFixture(fixture) {
  const outputDir = fileURLToPath(new URL(`../artifacts/block-acceptance/${fixture.name}/`, import.meta.url));
  mkdirSync(outputDir, { recursive: true });
  const { audit, result: analyzed } = evaluateBlockAcceptanceFixture(fixture);
  if (!audit.accepted) {
    throw new Error(`Block acceptance analysis failed: ${JSON.stringify(audit)}`);
  }
  if (planOnly) {
    const auditPath = `${outputDir}block-acceptance-${fixture.name}.plan.audit.json`;
    writeFileSync(auditPath, JSON.stringify(audit, null, 2));
    return {
      status: "plan_accepted",
      fixture: fixture.name,
      auditPath,
      planHash: audit.planHash,
      blockKinds: audit.blockIr.kinds,
      scene: audit.scene,
    };
  }

  const documentPath = `${outputDir}block-acceptance-${fixture.name}.vsdx`;
  const previewPath = `${outputDir}block-acceptance-${fixture.name}.png`;
  if (!existsSync(documentPath)) {
    const created = await createEmptyVisioDocument(documentPath);
    if (created.status !== "created") {
      throw new Error(`Could not create acceptance document: ${JSON.stringify(created)}`);
    }
  }

  const rendered = await renderUniversalFigureToVisio(analyzed.visioDiagramPlan, {
    documentPath,
    previewPath,
    openMode: "editable",
    renderId: `block-acceptance-${fixture.name}`,
  });
  if (rendered.status !== "rendered" || !rendered.readbackValidation?.ok) {
    throw new Error(`Visio block acceptance failed: ${JSON.stringify(rendered)}`);
  }

  const renderAudit = {
    ...audit,
    documentPath,
    previewPath,
    readbackValidation: rendered.readbackValidation,
  };
  const auditPath = `${outputDir}block-acceptance-${fixture.name}.audit.json`;
  writeFileSync(auditPath, JSON.stringify(renderAudit, null, 2));
  return {
    status: "accepted",
    fixture: fixture.name,
    documentPath,
    previewPath,
    auditPath,
    planHash: audit.planHash,
    blockSummary: analyzed.blockSummary,
    visualQuality: analyzed.visioDiagramPlan.scene.visualQuality,
  };
}
