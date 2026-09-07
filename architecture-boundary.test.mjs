import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productionModules = [
  "agent-pipeline.mjs",
  "figure-plan.mjs",
  "universal-figure.mjs",
  "universal-ir.mjs",
  "visio-bridge.mjs",
  "server.js",
];

test("production architecture modules do not import retired topology data", () => {
  for (const file of productionModules) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from|import\s*\()[^\n]*models\.js/);
  }
});

test("image analysis has no fixed topology fallback in the server workflow", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function synthesizeFallbackDiagram\s*\(/);
  assert.doesNotMatch(source, /function is3DPrompt\s*\(/);
});

test("the production pipeline has one generic source extractor", () => {
  const source = readFileSync(new URL("./agent-pipeline.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /diagramFromCode|shouldPreferGenericTopology/);
});

test("the browser control surface requires confirmation before Visio rendering", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /analyzeArchitectureInput/);
  assert.doesNotMatch(source, /analyzeWithOptionalBackend/);
  assert.match(source, /renderCurrentIRToVisio/);
  assert.match(source, /needs_confirmation/);
  assert.match(source, /待确认/);
});
