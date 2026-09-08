import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeArchitectureInput,
  extractArchitectureEvidence,
  normalizeArchitectureEvidence,
  planArchitectureFigure,
} from "./agent-pipeline.mjs";
import { createAgentRun, persistAgentRun, resumeAgentRun, runAgentPipeline } from "./agent-orchestrator.mjs";
import { createMemoryRunStore } from "./run-store.mjs";
import { validateFigurePlan } from "./figure-plan.mjs";
import { buildVisioRenderPlan, renderUniversalFigureToVisio } from "./visio-bridge.mjs";
import { createLLMAnalyzer } from "./llm-analyzer.mjs";
import { inferShapes, diagnoseShapes, buildShapeFeedback } from "./generic-source-topology.mjs";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const llmConfigPath = join(root, "llm-config.json");

function loadLLMConfig() {
  const fromEnv = {
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
  };
  try {
    if (existsSync(llmConfigPath)) {
      const saved = JSON.parse(readFileSync(llmConfigPath, "utf8"));
      // 通过 UI 保存的最新配置优先于环境变量。
      return { ...fromEnv, ...saved };
    }
  } catch {
    // 配置文件缺失或损坏时回退环境变量。
  }
  return fromEnv;
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

let llmConfig = loadLLMConfig();
let llmAnalyzer = createLLMAnalyzer(llmConfig);

function applyLLMConfig(patch = {}) {
  llmConfig = {
    baseUrl: String(patch.baseUrl || llmConfig.baseUrl).trim() || llmConfig.baseUrl,
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : llmConfig.apiKey,
    model: String(patch.model || llmConfig.model).trim() || llmConfig.model,
  };
  llmAnalyzer = createLLMAnalyzer(llmConfig);
  try { writeFileSync(llmConfigPath, JSON.stringify(llmConfig, null, 2)); } catch { /* 持久化失败不影响内存配置 */ }
  return llmConfig;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

const agentService = createAgentService();

export function createAgentService({ dependencies = {}, runStore: configuredRunStore } = {}) {
  const runs = new Map();
  const runStore = configuredRunStore || createMemoryRunStore();
  const stageDependencies = {
    ...createDefaultAgentDependencies(),
    ...dependencies,
  };
  return async function route(request) {
    const url = new URL(request.url || "/", "http://agent.test");
    if (request.method !== "POST") return jsonResponse(404, { status: "not_found", code: "route-not-found", message: "Agent route not found." });
    try {
      const body = await request.json();
      if (url.pathname === "/api/render-visio") {
        return renderVisioThroughAgent(body, stageDependencies, runs, runStore);
      }
      if (url.pathname === "/api/agent-run") {
        const documentPath = String(body?.documentPath || "").trim();
        const runDependencies = documentPath
          ? withVisioExecution(stageDependencies, {
              documentPath,
              pageName: body?.pageName || "Page-1",
              renderId: body?.renderId,
              unitScale: body?.unitScale,
              previewPath: body?.previewPath,
              scriptPath: process.env.VISIO_BRIDGE_SCRIPT,
            })
          : stageDependencies;
        let run;
        try {
          run = createAgentRun(body, runDependencies, { runStore });
        } catch (error) {
          return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
        }
        runs.set(run.id, run);
        const result = await runAgentPipeline(run);
        return jsonResponse(200, { ...result, status: agentRunStatus(result) });
      }
      const match = url.pathname.match(/^\/api\/agent-run\/([^/]+)\/resume$/);
      if (!match) return jsonResponse(404, { status: "not_found", code: "route-not-found", message: "Agent route not found." });
      const storedRun = await runStore.get(match[1]);
      const run = runs.get(match[1]) || (storedRun ? { ...storedRun, dependencies: stageDependencies, runStore } : undefined);
      if (!run) return jsonResponse(404, { status: "not_found", code: "run-not-found", message: `Agent run ${match[1]} was not found.` });
      const event = body && typeof body === "object" ? body : {};
      if (!["confirm", "repair", "render-result", "readback-result"].includes(event.type)) {
        return jsonResponse(400, { status: "invalid_event", code: "invalid-event", message: "Event type must be confirm, repair, render-result, or readback-result." });
      }
      const next = resumeAgentRun(run, event);
      await persistAgentRun(next);
      const resumed = ["repair", "confirm"].includes(event.type) && ["repair-pending", "confirmed"].includes(next.status)
        ? await runAgentPipeline(next)
        : next;
      runs.set(resumed.id, resumed);
      const statusCode = resumed.status === "repair-failed" ? 409 : 200;
      return jsonResponse(statusCode, resumed.status === "repair-failed"
        ? { ...nextResult(resumed), code: "repair-limit-exceeded" }
        : nextResult(resumed));
    } catch (error) {
      return jsonResponse(400, { status: "invalid_request", code: "invalid-json", message: error.message });
    }
  };
}

function createDefaultAgentDependencies() {
  return {
    inspect: async (input) => input,
    extract: async (input) => {
      if (input?.kind === "image") return extractImageEvidenceThroughProvider(input);
      if (llmAnalyzer.available && (input?.kind === "source" || input?.kind === "prompt")) {
        return extractThroughLLM(input);
      }
      return extractArchitectureEvidence(input);
    },
    normalize: (evidence) => normalizeArchitectureEvidence(evidence),
    plan: (normalized) => planArchitectureFigure(normalized),
  };
}

async function extractImageEvidenceThroughProvider(input) {
  const result = await llmAnalyzer.analyze(input);
  if (result.status) {
    return {
      kind: "image",
      status: "needs_external_vision",
      diagnostics: result.diagnostics || [{ kind: "vision-analyzer-required", message: "Image input requires a configured vision analyzer." }],
      input,
    };
  }
  return extractArchitectureEvidence({
    kind: "ir",
    ir: applyShapeInference(result.ir),
    diagnostics: result.diagnostics,
  });
}

const MAX_SHAPE_CORRECTION_ROUNDS = 3;

async function extractThroughLLM(input) {
  const result = await llmAnalyzer.analyze(input);
  if (result.status) return extractArchitectureEvidence(input);
  let ir = applyShapeInference(result.ir);
  const diagnostics = Array.isArray(result.diagnostics) ? [...result.diagnostics] : [];
  // 自纠闭环：规则验算 → 发现问题 → 带回反馈重问 LLM → 修正，直到自洽或达到上限。
  for (let round = 0; round < MAX_SHAPE_CORRECTION_ROUNDS; round += 1) {
    const diagnosis = diagnoseShapes(ir?.nodes || [], ir?.edges || []);
    if (diagnosis.ok) break;
    const feedback = buildShapeFeedback(diagnosis.issues, diagnosis.shapeByNode);
    const correction = await llmAnalyzer.refine(input, ir, feedback);
    if (!correction?.ir) {
      diagnostics.push({ kind: "shape-correction-failed", message: "Shape self-correction round did not return a revised IR." });
      break;
    }
    ir = applyShapeInference(correction.ir);
    diagnostics.push({ kind: "shape-corrected", round: round + 1, issueCount: diagnosis.issues.length });
  }
  return extractArchitectureEvidence({
    kind: "ir",
    ir,
    diagnostics,
  });
}

function applyShapeInference(ir) {
  const nodes = Array.isArray(ir?.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir?.edges) ? ir.edges : [];
  if (!nodes.length) return ir;
  inferShapes(nodes, edges);
  return { ...ir, nodes, edges };
}

async function renderVisioThroughAgent(body = {}, stageDependencies, runs, runStore) {
  const documentPath = String(body.documentPath || "").trim();
  if (!documentPath) {
    return jsonResponse(400, { error: "documentPath is required; rendering never creates an implicit Visio document." });
  }

  if (body.figurePlan) {
    return jsonResponse(422, {
      status: "invalid_input",
      code: "figure-plan-not-accepted",
      error: "Client-supplied Figure Plans are not accepted; render must start from source, image, or Universal IR through Agent Run.",
    });
  }

  const input = body.images
    ? { kind: "image", images: body.images, prompt: body.prompt, metadata: body.metadata }
    : body.ir
    ? { kind: "ir", ir: body.ir, diagnostics: body.diagnostics }
    : body.prompt
    ? { kind: "prompt", prompt: body.prompt, metadata: body.metadata }
    : { kind: "source", source: body.source, framework: body.framework };
  let options;
  try {
    options = {
      documentPath,
      pageName: body.pageName || "Page-1",
      renderId: body.renderId,
      unitScale: body.unitScale,
      previewPath: body.previewPath,
      scriptPath: process.env.VISIO_BRIDGE_SCRIPT,
    };
    const render = stageDependencies.render || defaultVisioRender;
    const readback = process.env.VISIO_DRY_RUN === "1"
      ? undefined
      : (stageDependencies.readback || defaultVisioReadback);
    let run;
    try {
      run = createAgentRun(input, {
      ...stageDependencies,
      render: (figurePlan, current) => render(figurePlan, { ...current, visioOptions: options }),
      ...(readback ? {
        readback: (figurePlan, renderResult, current) => readback(figurePlan, renderResult, { ...current, visioOptions: options }),
      } : {}),
      }, { runStore });
    } catch (error) {
      return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
    }
    runs.set(run.id, run);
    const result = await runAgentPipeline(run);
    if (result.status === "needs-confirmation" || result.status === "needs_confirmation") {
      return jsonResponse(409, {
        status: "needs_confirmation",
        error: "Architecture evidence requires confirmation; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
      });
    }
    if (result.status === "needs_external_vision") {
      return jsonResponse(409, {
        status: "needs_external_vision",
        error: "Image evidence requires an available vision analyzer; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
      });
    }
    if (!result.figurePlan) {
      return jsonResponse(422, {
        status: "invalid_layout",
        error: "Architecture input did not produce a Figure Plan; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
      });
    }
    const renderPlan = result.renderResult?.plan || buildVisioRenderPlan(result.figurePlan, options);
    const validation = result.figurePlan.validation || validateFigurePlan(result.figurePlan);
    if (!validation.ok) {
      return jsonResponse(422, {
        status: "invalid_layout",
        error: "Publication figure validation failed; Visio was not modified.",
        validation,
        diagnostics: result.diagnostics,
        ...nextResult(result),
      });
    }
    const responseStatus = result.renderResult?.status === "dry_run"
      ? "dry_run"
      : result.renderResult?.status === "readback_failed"
        ? "readback_failed"
      : result.status === "completed" ? "rendered" : result.status;
    const response = {
      ...nextResult(result),
      status: responseStatus,
      analysisStatus: result.status,
      diagnostics: result.diagnostics,
      validation,
      plan: renderPlan,
    };
    runs.set(result.id, result);
    return jsonResponse(200, response);
  } catch (error) {
    return jsonResponse(503, { status: "visio_unavailable", error: error.message });
  }
}

function withVisioExecution(stageDependencies, options) {
  const render = stageDependencies.render || defaultVisioRender;
  const readback = process.env.VISIO_DRY_RUN === "1"
    ? undefined
    : (stageDependencies.readback || defaultVisioReadback);
  return {
    ...stageDependencies,
    render: (figurePlan, current) => render(figurePlan, { ...current, visioOptions: options }),
    ...(readback ? {
      readback: (figurePlan, renderResult, current) => readback(figurePlan, renderResult, { ...current, visioOptions: options }),
    } : {}),
  };
}

function agentRunStatus(result = {}) {
  if (result.status !== "completed") return result.status;
  if (!result.renderResult) return "plan_ready";
  if (result.renderResult.status === "dry_run") return "dry_run";
  if (!result.readback) return "rendered";
  return "completed";
}

async function defaultVisioRender(figurePlan, current = {}) {
  const options = current.visioOptions || {};
  const plan = buildVisioRenderPlan(figurePlan, options);
  if (process.env.VISIO_DRY_RUN === "1") return { status: "dry_run", plan };
  return renderUniversalFigureToVisio(figurePlan, options);
}

async function defaultVisioReadback(_figurePlan, renderResult = {}) {
  return renderResult.readback || renderResult;
}

function nextResult(run) {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    snapshots: run.snapshots,
    diagnostics: run.diagnostics,
    attempts: { ...run.attempts },
    input: run.input,
    ir: run.ir,
    figurePlan: run.figurePlan,
    planOutput: run.planOutput,
    renderResult: run.renderResult,
    readback: run.readback,
  };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function handleAgentRequest(request, response) {
  const body = await readJson(request);
  const agentResponse = await agentService(new Request(`http://agent.test${request.url}`, {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  sendJson(response, agentResponse.status, await agentResponse.json());
}

function createAppServer() {
  return createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/llm-config") {
      sendJson(response, 200, {
        baseUrl: llmConfig.baseUrl,
        model: llmConfig.model,
        apiKeyConfigured: Boolean(llmConfig.apiKey),
        apiKeyMasked: maskApiKey(llmConfig.apiKey),
      });
      return;
    }
    if (request.method === "POST" && (request.url === "/api/agent-run" || /^\/api\/agent-run\/[^/]+\/resume$/.test(request.url || ""))) {
      await handleAgentRequest(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/analyze-code") {
      await handleAnalyzeCode(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/render-visio") {
      await handleAgentRequest(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/llm-config") {
      const body = await readJson(request);
      const config = applyLLMConfig(body);
      sendJson(response, 200, {
        baseUrl: config.baseUrl,
        model: config.model,
        apiKeyConfigured: Boolean(config.apiKey),
        apiKeyMasked: maskApiKey(config.apiKey),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/api/llm-models") {
      const body = await readJson(request);
      const baseUrl = String(body.baseUrl || llmConfig.baseUrl || "").trim().replace(/\/+$/, "");
      const apiKey = String(body.apiKey || "").trim() || llmConfig.apiKey || "";
      if (!baseUrl) {
        sendJson(response, 400, { status: "invalid_input", message: "请先填写 Base URL。" });
        return;
      }
      if (!apiKey) {
        sendJson(response, 400, { status: "invalid_input", message: "请先填写 API Key。" });
        return;
      }
      try {
        const upstream = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!upstream.ok) {
          const detail = (await upstream.text()).slice(0, 300);
          sendJson(response, upstream.status, { status: "upstream_error", message: `拉取模型失败：HTTP ${upstream.status} ${detail}` });
          return;
        }
        const payload = await upstream.json();
        const models = (Array.isArray(payload.data) ? payload.data : [])
          .map((entry) => (typeof entry === "string" ? entry : entry?.id))
          .filter(Boolean)
          .sort();
        sendJson(response, 200, { models });
      } catch (error) {
        sendJson(response, 502, { status: "network_error", message: `无法连接端点：${error.message}` });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/api/chat") {
      const body = await readJson(request);
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      if (!messages.length) {
        sendJson(response, 400, { status: "invalid_input", code: "invalid-input", message: "No messages provided." });
        return;
      }
      const result = await llmAnalyzer.chat(messages);
      if (result.status) sendJson(response, 502, result);
      else sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST") {
      sendJson(response, 404, { status: "not_found", code: "route-not-found", message: "Agent route not found." });
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
  });
}

export function startServer({ port: listenPort = port, host = "127.0.0.1" } = {}) {
  const appServer = createAppServer();
  return new Promise((resolve, reject) => {
    appServer.once("error", reject);
    appServer.listen(listenPort, host, () => {
      console.log(`Synapse Studio running at http://${host}:${listenPort}`);
      resolve(appServer);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer({ port, host: "127.0.0.1" }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function handleAnalyzeCode(request, response) {
  const result = analyzeArchitectureInput(await readJson(request));
  const status = result.status === "invalid_input" ? 422 : 200;
  sendJson(response, status, result);
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  let content;
  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    throw error;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  response.end(content);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 12 * 1024 * 1024) {
        request.destroy(new Error("Request too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
