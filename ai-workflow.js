const aiState = {
  files: [],
  previews: [],
};

const paletteName = "dopamine";

export function setupAIWorkflow({ applyDiagramDocument, setStatus }) {
  const input = document.querySelector("#aiImageInput");
  const previewList = document.querySelector("#aiPreviewList");
  const uploadZone = document.querySelector(".ai-upload-zone");
  const analyzeButton = document.querySelector("#aiAnalyzeButton");
  const modeInput = document.querySelector("#aiModeInput");
  const promptInput = document.querySelector("#aiPromptInput");
  const aiStatus = document.querySelector("#aiStatusText");

  if (!input || !previewList || !analyzeButton) return;

  input.addEventListener("change", async () => {
    await setFiles([...input.files], previewList, aiStatus);
  });

  uploadZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("is-dragging");
  });

  uploadZone?.addEventListener("dragleave", () => {
    uploadZone.classList.remove("is-dragging");
  });

  uploadZone?.addEventListener("drop", async (event) => {
    event.preventDefault();
    uploadZone.classList.remove("is-dragging");
    await setFiles([...event.dataTransfer.files], previewList, aiStatus);
  });

  analyzeButton.addEventListener("click", async () => {
    if (!aiState.files.length) {
      updateAIStatus(aiStatus, "请先上传论文图、草图或参考图。");
      return;
    }

    analyzeButton.disabled = true;
    updateAIStatus(aiStatus, "正在分析图片结构并生成可编辑画布...");
    setStatus("AI 正在分析上传图片");

    try {
      const request = {
        mode: modeInput.value,
        prompt: promptInput.value.trim(),
        images: aiState.previews.map(({ file, dataUrl, size }) => ({
          name: file.name,
          type: file.type,
          size,
          dataUrl,
        })),
      };
      const document = await analyzeWithOptionalBackend(request);
      const ok = applyDiagramDocument(document, { message: "AI 已根据上传图片绘制可编辑网络图" });
      updateAIStatus(aiStatus, ok ? `已生成 ${document.nodes.length} 个节点、${document.edges.length} 条连接。` : "AI 结果没有通过画布校验。");
    } catch (error) {
      console.error(error);
      updateAIStatus(aiStatus, "分析失败，已保留当前画布。请检查图片格式或稍后再试。");
      setStatus("AI 分析失败");
    } finally {
      analyzeButton.disabled = false;
    }
  });
}

async function setFiles(files, previewList, aiStatus) {
  aiState.files = files.filter((file) => file.type.startsWith("image/"));
  aiState.previews = await Promise.all(aiState.files.map(readPreview));
  renderPreviews(previewList, aiState.previews);
  updateAIStatus(aiStatus, `${aiState.files.length} 张图片已准备好，可开始分析。`);
}

async function analyzeWithOptionalBackend(request) {
  const accessToken = globalThis.localStorage?.getItem("synapse.accessToken");
  if (!accessToken) throw new Error("Online authorization is required before diagram analysis");
  const response = await fetch("/api/analyze-diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Diagram analysis failed (${response.status})`);
  if (!payload?.nodes || !payload?.edges) throw new Error("Diagram analysis returned an invalid document");
  return payload;
}

function synthesizeDiagram(request) {
  const imageCount = request.images.length;
  const mode = request.mode === "auto" ? inferMode(request) : request.mode;
  const wants3D = mode === "3d" || is3DPrompt(request.prompt);
  const wantsMerge = mode === "merge" || imageCount > 1;
  const wantsSketch = mode === "sketch" || /草图|手绘|sketch|白板/i.test(request.prompt);

  const title = wantsMerge
    ? "AI Merged Neural Architecture"
    : wants3D
      ? "AI Reconstructed 3D Neural Network"
      : wantsSketch
        ? "AI Polished Sketch Architecture"
        : "AI Reconstructed Neural Network";
  const stages = wants3D
    ? ["Volume", "3D Encoder", "Latent", "3D Decoder", "Mask"]
    : wantsMerge
      ? ["Reference A", "Shared Stem", "Fusion", "Decoder", "Output"]
      : ["Input", "Stem", "Feature Blocks", "Attention", "Head"];

  const nodes = wants3D ? volumeNodes() : wantsMerge ? mergedNodes(imageCount) : standardNodes(wantsSketch);
  const edges = createEdgesFor(nodes, wants3D || wantsMerge);
  const skipEdges = createSkipEdges(nodes, wants3D || wantsMerge);

  return {
    figure: {
      title,
      subtitle: `Generated from ${imageCount} uploaded image${imageCount > 1 ? "s" : ""}${request.prompt ? ` · ${request.prompt}` : ""}`,
      stages,
    },
    paletteName,
    nodes,
    edges: [...edges, ...skipEdges],
  };
}

function standardNodes(wantsSketch) {
  const note = wantsSketch ? "cleaned from sketch" : "detected input";
  return [
    node("ai-input", "tensor", 260, 660, 122, 188, "Input", "224 x 224 x 3", 0, { depth: 24, note }),
    node("ai-stem", "conv", 500, 640, 78, 220, "Conv Stem", "112 x 112 x 64", 1, { depth: 96, layers: 8, note: "7x7 / s2", channels: "64 maps" }),
    node("ai-pool", "pool", 770, 704, 92, 92, "MaxPool", "56 x 56", 2),
    node("ai-stage1", "conv", 1010, 600, 76, 285, "Feature Block", "56 x 56 x 128", 3, { depth: 118, layers: 9, note: "3x3 conv", channels: "128 maps" }),
    node("ai-patch", "patch-grid", 1325, 625, 184, 184, "Patch / Tokens", "14 x 14", 4, { badge: "196" }),
    node("ai-attn", "attention", 1625, 635, 210, 138, "MHSA", "QK^T / sqrt(d)", 5, { note: "attention map" }),
    node("ai-flat", "flatten", 1935, 650, 145, 140, "Readout", "CLS / flatten", 6, { layers: 12 }),
    node("ai-head", "dense-layer", 2220, 625, 128, 210, "Classifier", "softmax", 7, { layers: 7, note: "probabilities" }),
  ];
}

function volumeNodes() {
  return [
    node("ai-vol-input", "volume", 250, 650, 145, 210, "CT / MRI", "128 x 128 x 96", 0, { depth: 82, z: 58, note: "voxels" }),
    node("ai-vol-e1", "volume-stack", 525, 610, 108, 250, "3D Conv", "32 channels", 1, { depth: 106, z: 74, layers: 6, note: "downsample" }),
    node("ai-vol-e2", "volume-stack", 875, 560, 102, 310, "3D Conv", "64 channels", 2, { depth: 132, z: 88, layers: 7, note: "pool" }),
    node("ai-vol-core", "volume", 1235, 610, 165, 210, "Latent Cube", "128 channels", 3, { depth: 152, z: 96, note: "context" }),
    node("ai-vol-cat2", "concat", 1570, 680, 82, 82, "Concat", "skip e2", 4),
    node("ai-vol-d2", "volume-stack", 1740, 560, 102, 310, "3D UpConv", "64 channels", 5, { depth: 132, z: 88, layers: 7, note: "decode" }),
    node("ai-vol-cat1", "concat", 2075, 690, 78, 78, "Concat", "skip e1", 6),
    node("ai-vol-d1", "volume-stack", 2215, 610, 108, 250, "3D UpConv", "32 channels", 7, { depth: 106, z: 74, layers: 6, note: "decode" }),
    node("ai-vol-mask", "volume", 2395, 650, 100, 190, "Mask", "voxel labels", 8, { depth: 58, z: 42, note: "1x1x1" }),
  ];
}

function mergedNodes(imageCount) {
  const refs = Array.from({ length: Math.min(imageCount, 4) }, (_, index) => (
    node(`ai-ref-${index + 1}`, "tensor", 300, 470 + index * 160, 140, 120, `Reference ${index + 1}`, "uploaded figure", 0, { depth: 24 })
  ));
  return [
    ...refs,
    node("ai-fusion-stem", "conv", 680, 610, 86, 270, "Shared Stem", "aligned maps", 1, { depth: 112, layers: 8, channels: "C maps" }),
    node("ai-tokenize", "patch-grid", 1015, 630, 180, 180, "Tokenize", "common patches", 2, { badge: "N" }),
    node("ai-fusion", "attention", 1340, 650, 214, 140, "Cross-Figure Fusion", "attention merge", 3, { note: "multi-image" }),
    node("ai-merge", "concat", 1630, 680, 82, 82, "Concat", "merged refs", 4),
    node("ai-decoder", "encoder", 1840, 615, 190, 150, "Decoder", "unified graph", 5, { badge: "xN", layers: 5 }),
    node("ai-output", "output", 2240, 640, 128, 152, "Final Figure", "editable diagram", 6),
  ];
}

function createEdgesFor(nodes, emphasizeAttention) {
  const ordered = [...nodes].sort((a, b) => a.stage - b.stage || a.y - b.y);
  const primary = ordered.filter((item, index, list) => index === 0 || item.stage !== list[index - 1].stage);
  return primary.slice(0, -1).map((source, index) => {
    const target = primary[index + 1];
    return edge(source.id, target.id, emphasizeAttention && index === primary.length - 3 ? "fusion" : "signal", emphasizeAttention && index === primary.length - 3 ? "attention" : "signal");
  });
}

function createSkipEdges(nodes, enabled) {
  if (!enabled || nodes.length < 5) return [];
  const concatNodes = nodes.filter((item) => item.type === "concat").sort((a, b) => a.stage - b.stage);
  if (concatNodes.length) {
    const e1 = nodes.find((item) => /e1|stem/i.test(item.id));
    const e2 = nodes.find((item) => /e2|stage1|fusion-stem/i.test(item.id));
    return [
      e2 && concatNodes[0] ? edge(e2.id, concatNodes[0].id, "skip concat", "skip") : null,
      e1 && concatNodes[1] ? edge(e1.id, concatNodes[1].id, "skip concat", "skip") : null,
    ].filter(Boolean);
  }
  const byStage = new Map(nodes.map((item) => [item.stage, item]));
  const skips = [];
  if (byStage.has(1) && byStage.has(4)) skips.push(edge(byStage.get(1).id, byStage.get(4).id, "skip", "skip"));
  if (byStage.has(2) && byStage.has(5)) skips.push(edge(byStage.get(2).id, byStage.get(5).id, "skip", "skip"));
  if (byStage.has(2) && byStage.has(3)) skips.push(edge(byStage.get(2).id, byStage.get(3).id, "context", "attention"));
  return skips;
}

function node(id, type, x, y, w, h, label, subtitle, stage, extras = {}) {
  return {
    id,
    type,
    x,
    y,
    w,
    h,
    label,
    subtitle,
    stage,
    color: "#b79cff",
    ...extras,
  };
}

function edge(source, target, label = "", type = "signal") {
  return {
    id: `ai-${source}-${target}`,
    source,
    target,
    label,
    type,
    color: type === "skip" ? "#20c7a8" : type === "attention" ? "#ff3d9a" : "#4555a6",
  };
}

function inferMode(request) {
  if (request.images.length > 1) return "merge";
  if (is3DPrompt(request.prompt)) return "3d";
  if (/草图|手绘|白板|sketch/i.test(request.prompt)) return "sketch";
  return "paper";
}

function is3DPrompt(prompt = "") {
  return /(^|\W)(3d|ct|mri)(\W|$)|volume|volumetric|体数据|体素|医学|u-net|unet/i.test(prompt);
}

function renderPreviews(container, previews) {
  container.replaceChildren(...previews.map(({ file, dataUrl }) => {
    const item = document.createElement("figure");
    item.className = "ai-preview-card";
    const image = document.createElement("img");
    image.alt = "";
    image.src = dataUrl;
    const caption = document.createElement("figcaption");
    caption.textContent = file.name;
    item.append(image, caption);
    return item;
  }));
}

function updateAIStatus(element, message) {
  if (element) element.textContent = message;
}

function readPreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ file, dataUrl: reader.result, size: file.size });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
