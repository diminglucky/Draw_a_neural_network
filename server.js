import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const openAIKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
const foundationApiUrl = (process.env.FOUNDATION_API_URL || "http://127.0.0.1:4180").replace(/\/$/, "");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/analyze-diagram") {
      await handleAnalyze(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
}).listen(port, () => {
  console.log(`Synapse Studio running at http://127.0.0.1:${port}`);
});

async function handleAnalyze(request, response) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    sendJson(response, 401, { error: "Online authorization is required", code: "INVALID_TOKEN" });
    return;
  }
  const authorized = await verifyFoundationSession(authorization);
  if (!authorized) {
    sendJson(response, 401, { error: "Foundation session is not active", code: "SESSION_REVOKED" });
    return;
  }
  if (!openAIKey) {
    sendJson(response, 200, synthesizeFallbackDiagram(await readJson(request)));
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
  sendJson(response, 200, JSON.parse(text));
}

async function verifyFoundationSession(authorization) {
  try {
    const response = await fetch(`${foundationApiUrl}/api/auth/session`, {
      headers: { Authorization: authorization },
    });
    if (!response.ok) console.error(`Foundation authorization rejected with HTTP ${response.status}`);
    return response.ok;
  } catch (error) {
    console.error(`Foundation authorization service is unreachable: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

function buildVisionPrompt(body) {
  return [
    "You are converting uploaded neural-network diagrams, sketches, or multiple reference images into an editable JSON diagram for Synapse Studio.",
    "Return only the JSON required by the schema. Do not return SVG or Markdown.",
    "Use publication-quality architecture semantics inspired by PlotNeuralNet, NN-SVG, VisualKeras, and Netron: tensor, conv, pool, flatten, dense-layer, concat, volume, volume-stack, patch-grid, token, encoder, block, attention, neuron, output.",
    "Preserve labels and important arrows when visible. If ambiguous, infer a clean neural architecture rather than copying visual noise.",
    "Use canvas coordinates within 2600 x 1500, centered around y=650, with readable spacing.",
    "Prefer real neural-network topology over generic boxes: feature-map stacks, pooling/downsampling, flatten vectors, dense classifier layers, concat/add nodes, attention matrices, and long skip connections.",
    "For 3D / medical / volumetric diagrams use volume or volume-stack nodes with depth, z, layers, concat nodes, and skip connections.",
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
    required: ["figure", "paletteName", "nodes", "edges"],
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
            type: { type: "string", enum: ["tensor", "conv", "pool", "flatten", "dense-layer", "concat", "volume", "volume-stack", "patch-grid", "token", "encoder", "block", "attention", "neuron", "output"] },
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
            type: { type: "string", enum: ["signal", "skip", "attention"] },
            color: { type: "string" },
          },
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
