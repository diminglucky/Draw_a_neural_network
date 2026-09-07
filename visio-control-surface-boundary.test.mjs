import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL(".", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");

test("web page is a Visio control surface, not a diagram renderer", () => {
  const html = read("index.html");
  const app = read("app.js");
  const styles = read("styles.css");

  assert.match(html, /visioDocumentPathInput/i);
  assert.match(html, /visioRenderButton/i);
  assert.match(html, /visioConfirmButton/i);
  assert.doesNotMatch(app, /createElementNS|pointerdown|exportPng/i);
  assert.match(app, /\/api\/agent-run\//i);
  assert.match(app, /type:\s*"confirm"/i);
  assert.doesNotMatch(styles, /\.selection-layer/);
});

test("analysis contract ends at Universal IR and Figure Plan before Visio", () => {
  const pipeline = read("agent-pipeline.mjs");
  const figurePlan = read("figure-plan.mjs");
  const universalIR = read("universal-ir.mjs");
  const visioClient = read("visio-client.mjs");

  assert.doesNotMatch(pipeline, /FigurePlanForWeb|mergeWebStateIntoFigurePlan/i);
  assert.doesNotMatch(figurePlan, /FigurePlanForWeb|mergeWebStateIntoFigurePlan/i);
  assert.doesNotMatch(universalIR, /projectUniversalIRToWeb|typeForWebRole/i);
  assert.doesNotMatch(visioClient, /mergeWebStateIntoUniversalIR|familyForWebType/i);
});

test("server exposes no legacy direct diagram-analysis route", () => {
  const server = read("server.js");
  assert.doesNotMatch(server, /\/api\/analyze-diagram/);
  assert.doesNotMatch(server, /handleAnalyze\s*\(/);
});
