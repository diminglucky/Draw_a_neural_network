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
  ".svg": "image/svg+xml",
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
        let run;
        try {
          run = createAgentRun(body, stageDependencies, { runStore });
        } catch (error) {
          return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
        }
        runs.set(run.id, run);
        const result = await runAgentPipeline(run);
        return jsonResponse(200, result);
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

export function createDefaultAgentDependencies() {
  return {
    inspect: async (input) => input,
    extract: (input) => extractArchitectureEvidence(input),
    normalize: (evidence) => normalizeArchitectureEvidence(evidence),
    plan: (normalized) => planArchitectureFigure(normalized),
  };
}

async function renderVisioThroughAgent(body = {}, stageDependencies, runs, runStore) {
  const documentPath = String(body.documentPath || "").trim();
  if (!documentPath) {
    return jsonResponse(400, { error: "documentPath is required; rendering never creates an implicit Visio document." });
  }

  const input = body.ir
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
      readback: (figurePlan, renderResult, current) => readback(figurePlan, renderResult, { ...current, visioOptions: options }),
      }, { runStore, allowUnresolved: true });
    } catch (error) {
      return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
    }
    runs.set(run.id, run);
    const result = await runAgentPipeline(run);
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
    if (request.method === "POST" && request.url === "/api/analyze-diagram") {
      await handleAnalyze(request, response);
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

async function handleAnalyze(request, response) {
  if (!openAIKey) {
    const body = await readJson(request);
    sendJson(response, 200, analyzeArchitectureInput({ ...body, kind: "image" }));
    return;
  }

  const body = await readJson(request);
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  if (!images.length) {
    sendJson(response, 400, { error: "No images provided" });
    return;
  }

  const prompt = buildVisionPrompt(body);
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
          { type: "input_text", text: prompt },
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
    const text = await apiResponse.text();
    sendJson(response, apiResponse.status, { error: "OpenAI vision request failed", detail: text.slice(0, 1000) });
    return;
  }

  const payload = await apiResponse.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) {
    sendJson(response, 502, { error: "Vision model returned no diagram JSON" });
    return;
  }
  const candidate = JSON.parse(text);
  const analysis = analyzeArchitectureInput({
    kind: "ir",
    ir: candidate.ir || candidate,
    diagnostics: candidate.diagnostics,
  });
  if (analysis.status === "invalid_input") {
    sendJson(response, 422, {
      error: "Vision model returned invalid Universal IR",
      ...analysis,
    });
    return;
  }
  sendJson(response, 200, analysis);
}

function buildVisionPrompt(body) {
  return [
    "You are converting uploaded neural-network diagrams, sketches, or multiple reference images into a framework-neutral Universal Neural Network IR for Synapse Studio.",
    "Return only the JSON required by the schema. Do not return SVG or Markdown.",
    "Preserve arbitrary operations, custom modules, multi-input/multi-output ports, tensor shapes, branch and merge topology, source evidence, and confidence. Use a known family when justified; use family custom and compoundKind unresolved when internal structure is not visible.",
    "Preserve labels and important arrows when visible. If ambiguous, infer a clean neural architecture rather than copying visual noise.",
    "Return one Universal IR object with nodes and edges; canvas coordinates are optional and the client will lay out the graph deterministically.",
    "Prefer real neural-network topology over generic boxes, but never invent hidden internal layers without evidence.",
    `Mode: ${body.mode || "auto"}.`,
    `User instruction: ${body.prompt || "Generate a clear editable neural-network diagram."}`,
  ].join("\n");
}

function synthesizeFallbackDiagram(body) {
  const imageCount = Array.isArray(body.images) ? body.images.length : 1;
  const wants3D = body.mode === "3d" || is3DPrompt(body.prompt || "");
  const title = wants3D ? "AI Draft 3D Neural Network" : imageCount > 1 ? "AI Draft Merged Architecture" : "AI Draft Neural Architecture";
  const nodes = wants3D ? [
    node("srv-vol-input", "volume", 250, 650, 145, 210, "CT / MRI", "128 x 128 x 96", 0, { depth: 80, z: 56, note: "voxels" }),
    node("srv-vol-e1", "volume-stack", 525, 610, 108, 250, "3D Conv", "32 channels", 1, { depth: 106, z: 74, layers: 6, note: "downsample" }),
    node("srv-vol-e2", "volume-stack", 875, 560, 102, 310, "3D Conv", "64 channels", 2, { depth: 132, z: 88, layers: 7, note: "pool" }),
    node("srv-vol-core", "volume", 1235, 610, 165, 210, "Latent Cube", "128 channels", 3, { depth: 150, z: 94, note: "context" }),
    node("srv-vol-cat2", "concat", 1570, 680, 82, 82, "Concat", "skip e2", 4),
    node("srv-vol-d2", "volume-stack", 1740, 560, 102, 310, "3D UpConv", "64 channels", 5, { depth: 132, z: 88, layers: 7, note: "decode" }),
    node("srv-vol-cat1", "concat", 2075, 690, 78, 78, "Concat", "skip e1", 6),
    node("srv-vol-d1", "volume-stack", 2215, 610, 108, 250, "3D UpConv", "32 channels", 7, { depth: 106, z: 74, layers: 6, note: "decode" }),
    node("srv-vol-output", "volume", 2395, 650, 100, 190, "Mask", "voxel labels", 8, { depth: 58, z: 42, note: "1x1x1" }),
  ] : [
    node("srv-input", "tensor", 260, 660, 122, 188, "Input", "224 x 224 x 3", 0, { depth: 24, note: "uploaded image" }),
    node("srv-stem", "conv", 500, 640, 78, 220, "Conv Stem", "112 x 112 x 64", 1, { depth: 96, layers: 8, note: "7x7 / s2", channels: "64 maps" }),
    node("srv-pool", "pool", 770, 704, 92, 92, "MaxPool", "56 x 56", 2),
    node("srv-stage1", "conv", 1010, 600, 76, 285, "Feature Block", "56 x 56 x 128", 3, { depth: 118, layers: 9, note: "3x3 conv", channels: "128 maps" }),
    node("srv-flat", "flatten", 1345, 650, 154, 150, "Flatten", "feature vector", 4, { layers: 13 }),
    node("srv-attn", "attention", 1635, 635, 210, 138, "Attention", "optional / detected", 5, { note: "context" }),
    node("srv-head", "dense-layer", 2220, 625, 128, 210, "Classifier", "softmax", 6, { layers: 7, note: "probabilities" }),
  ];
  const sequential = nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id, index === 3 ? "features" : "signal", index === 3 ? "attention" : "signal"));
  const skips = wants3D
    ? [edge("srv-vol-e2", "srv-vol-cat2", "skip concat", "skip"), edge("srv-vol-e1", "srv-vol-cat1", "skip concat", "skip")]
    : [edge("srv-stage1", "srv-head", "residual / readout", "skip")];
  return {
    figure: {
      title,
      subtitle: `Server fallback generated from ${imageCount} image${imageCount > 1 ? "s" : ""}. Configure OPENAI_API_KEY for real vision analysis.`,
      stages: nodes.map((item) => item.label),
    },
    paletteName: "dopamine",
    nodes,
    edges: [...sequential, ...skips],
  };
}

function node(id, type, x, y, w, h, label, subtitle, stage, extras = {}) {
  return { id, type, x, y, w, h, label, subtitle, stage, color: "#b79cff", ...extras };
}

function edge(source, target, label, type) {
  return {
    id: `srv-${source}-${target}`,
    source,
    target,
    label,
    type,
    color: type === "skip" ? "#20c7a8" : type === "attention" ? "#ff3d9a" : "#4555a6",
  };
}

function is3DPrompt(prompt = "") {
  return /(^|\W)(3d|ct|mri)(\W|$)|volume|volumetric|体数据|体素|医学|u-net|unet/i.test(prompt);
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
