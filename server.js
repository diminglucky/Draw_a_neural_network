import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeArchitectureInput } from "./agent-pipeline.mjs";
import { createEmptyVisioDocument, resolveVisioDocumentPath } from "./visio-bridge.mjs";
import { createLLMAnalyzer } from "./llm-analyzer.mjs";
import { loadLLMConfig, maskApiKey, persistLLMConfig, fetchModelList } from "./llm-config.mjs";
import { createAgentService, setLLMAnalyzer } from "./agent-service.mjs";

// Re-export for backward compatibility: server.test.mjs and server-llm.test.mjs
// import createAgentService from "./server.js". The implementation now lives in
// agent-service.mjs.
export { createAgentService };

const port = Number(process.env.PORT || 4173);
// 静态文件目录 = server.js 所在目录（不依赖 cwd；Electron 打包后从 app.asar 读取）
const root = fileURLToPath(new URL(".", import.meta.url));

let llmConfig = loadLLMConfig();
let llmAnalyzer = createLLMAnalyzer(llmConfig);
setLLMAnalyzer(llmAnalyzer);
const agentService = createAgentService();

function applyLLMConfig(patch = {}) {
  llmConfig = {
    baseUrl: String(patch.baseUrl || llmConfig.baseUrl).trim() || llmConfig.baseUrl,
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : llmConfig.apiKey,
    model: String(patch.model || llmConfig.model).trim() || llmConfig.model,
  };
  llmAnalyzer = createLLMAnalyzer(llmConfig);
  setLLMAnalyzer(llmAnalyzer);
  persistLLMConfig(llmConfig);
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
        const models = await fetchModelList(baseUrl, apiKey);
        sendJson(response, 200, { models });
      } catch (error) {
        if (error?.status) {
          sendJson(response, error.status, { status: "upstream_error", message: error.message });
        } else {
          sendJson(response, 502, { status: "network_error", message: `无法连接端点：${error.message}` });
        }
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
    if (request.method === "POST" && request.url === "/api/visio-prepare") {
      const body = await readJson(request);
      const resolved = resolveVisioDocumentPath(body?.path);
      if (resolved.error) {
        sendJson(response, 400, { status: "invalid_input", message: resolved.error });
        return;
      }
      let created = false;
      if (!existsSync(resolved.path)) {
        try {
          const result = await createEmptyVisioDocument(resolved.path, {
            scriptPath: process.env.VISIO_CREATE_SCRIPT,
          });
          if (result?.status !== "created") {
            sendJson(response, 500, { status: "visio_unavailable", message: result?.message || "无法自动创建 Visio 文档，请确认已安装 Visio。" });
            return;
          }
          created = true;
        } catch (error) {
          sendJson(response, 500, { status: "visio_unavailable", message: `无法自动创建 Visio 文档：${error.message}` });
          return;
        }
      }
      sendJson(response, 200, { status: "ok", documentPath: resolved.path, created });
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
      const actualPort = appServer.address()?.port ?? listenPort;
      console.log(`Synapse Studio running at http://${host}:${actualPort}`);
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
  const safePath = normalize(pathname).replace(/^(\\.\.[/\\])+/, "");
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
