import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const openAIKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

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
    extract: async (input) => input?.kind === "image"
      ? extractImageEvidenceThroughProvider(input)
      : extractArchitectureEvidence(input),
    normalize: (evidence) => normalizeArchitectureEvidence(evidence),
    plan: (normalized) => planArchitectureFigure(normalized),
  };
}

async function extractImageEvidenceThroughProvider(input) {
  const vision = await requestVisionIR(input);
  if (vision.status) return {
    kind: "image",
    status: vision.status,
    diagnostics: vision.diagnostics,
    input,
  };
  return extractArchitectureEvidence({
    kind: "ir",
    ir: vision.ir,
    diagnostics: vision.diagnostics,
  });
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

const server = createServer(async (request, response) => {
  try {
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Synapse Studio running at http://127.0.0.1:${port}`);
  });
}

async function handleAnalyzeCode(request, response) {
  const result = analyzeArchitectureInput(await readJson(request));
  const status = result.status === "invalid_input" ? 422 : 200;
  sendJson(response, status, result);
}

async function requestVisionIR(body = {}) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  if (!images.length) {
    return {
      status: "needs_external_vision",
      diagnostics: [{ kind: "vision-analyzer-required", message: "No images provided." }],
    };
  }
  if (!openAIKey) {
    return {
      status: "needs_external_vision",
      diagnostics: [{ kind: "vision-analyzer-required", message: "Image input requires a configured vision analyzer." }],
    };
  }

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAIKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: buildVisionPrompt(body) },
          ...images.map((image) => ({ type: "input_image", image_url: image.dataUrl })),
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "editable_neural_diagram",
          schema: diagramSchema(),
          strict: false,
        },
      },
    }),
  });

  if (!apiResponse.ok) {
    throw new Error(`${apiResponse.status}: ${(await apiResponse.text()).slice(0, 1000)}`);
  }
  const payload = await apiResponse.json();
  const text = payload.output_text
    || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("Vision model returned no diagram JSON");
  const candidate = JSON.parse(text);
  return { ir: candidate.ir || candidate, diagnostics: candidate.diagnostics };
}

function buildVisionPrompt(body) {
  return [
    "You are converting uploaded neural-network diagrams, sketches, or multiple reference images into a framework-neutral Universal Neural Network IR for Synapse Studio.",
    "Return only the JSON required by the schema. Do not return drawing markup or Markdown.",
    "Preserve arbitrary operations, custom modules, multi-input/multi-output ports, tensor shapes, branch and merge topology, source evidence, and confidence. Use a known family when justified; use family custom and compoundKind unresolved when internal structure is not visible.",
    "Preserve labels and important arrows when visible. If ambiguous, infer a clean neural architecture rather than copying visual noise.",
    "Return one Universal IR object with nodes and edges; the Agent generates renderer-neutral Figure Plan geometry before Visio rendering.",
    "Prefer real neural-network topology over generic boxes, but never invent hidden internal layers without evidence.",
    `Mode: ${body.mode || "auto"}.`,
    `User instruction: ${body.prompt || "Generate a clear editable neural-network diagram."}`,
  ].join("\n");
}

function diagramSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ir"],
    properties: {
      figure: {
        type: "object",
        additionalProperties: false,
        required: ["title", "subtitle", "stages"],
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          stages: { type: "array", items: { type: "string" } },
        },
      },
      paletteName: { type: "string", enum: ["dopamine", "aurora", "citrus"] },
      nodes: {
        type: "array",
        minItems: 2,
        maxItems: 40,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "x", "y", "w", "h", "label", "subtitle", "stage", "color"],
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
            label: { type: "string" },
            subtitle: { type: "string" },
            stage: { type: "number" },
            color: { type: "string" },
            depth: { type: "number" },
            z: { type: "number" },
            layers: { type: "number" },
            badge: { type: "string" },
            note: { type: "string" },
            channels: { type: "string" },
            op: { type: "string" },
            family: { type: "string" },
            compoundKind: { type: "string" },
            inputs: { type: "array", items: { type: "string" } },
            outputs: { type: "array", items: { type: "string" } },
            ports: { type: "object", additionalProperties: true },
            shape: { type: "object", additionalProperties: true },
            attributes: { type: "object", additionalProperties: true },
            source: { type: "object", additionalProperties: true },
            evidence: { type: "array", items: { type: "object", additionalProperties: true } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      edges: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "source", "target", "label", "type", "color"],
          properties: {
            id: { type: "string" },
            source: { type: "string" },
            target: { type: "string" },
            label: { type: "string" },
            type: { type: "string" },
            color: { type: "string" },
            ports: { type: "object", additionalProperties: true },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
      ir: {
        type: "object",
        additionalProperties: true,
        required: ["nodes", "edges"],
        properties: {
          version: { type: "string" },
          source: { type: "object", additionalProperties: true },
          nodes: { type: "array", minItems: 1 },
          edges: { type: "array" },
          groups: { type: "array" },
          diagnostics: { type: "array" },
        },
      },
    },
  };
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  const content = await readFile(filePath);
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
