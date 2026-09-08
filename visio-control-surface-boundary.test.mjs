import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL(".", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");

test("web page is a Visio control surface, not a diagram renderer", () => {
  const html = read("index.html");
  const app = read("app.js");
  const styles = read("styles.css");

  // 控制面：Visio 路径 + LLM 配置 + 对话输入入口
  assert.match(html, /visioDocumentPathInput/i);
  assert.match(html, /llmApiKeyInput/i);
  assert.match(html, /id="input"/i);
  // 渲染必须通过 visio-client 走 Agent Run，而非在浏览器内绘制
  assert.match(app, /renderCurrentIRToVisio/i);
  assert.doesNotMatch(app, /createElementNS|pointerdown|exportPng/i);
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
