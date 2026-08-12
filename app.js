import { createEdge, createNode, createTemplate, defaultFigure, modelLibrary } from "./models.js";
import { setupAIWorkflow } from "./ai-workflow.js";
import { setupCodeWorkflow } from "./code-workflow.js";

const svg = document.querySelector("#networkCanvas");
const statusText = document.querySelector("#statusText");
const connectButton = document.querySelector("#connectButton");
const appShell = document.querySelector(".app-shell");
const minimap = document.querySelector("#minimap");
const viewportReadout = document.querySelector("#viewportReadout");

const ns = "http://www.w3.org/2000/svg";
const canvasSize = { width: 2600, height: 1500 };
const artboard = { x: 170, y: 160, width: 2260, height: 1060 };
const gridSize = 20;
const defaultPaletteName = "dopamine";
const paletteVersion = 2;

const state = {
  nodes: [],
  edges: [],
  paletteName: defaultPaletteName,
  paletteVersion,
  figure: defaultFigure,
  selected: null,
  connectMode: false,
  connectSource: null,
  connectPreview: null,
  suppressNextClick: false,
  drag: null,
  resize: null,
  guides: [],
  panMode: false,
  pan: null,
  snapToGrid: true,
  viewport: { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
  nextNodeId: 1,
  nextEdgeId: 1,
};

const storageKey = "synapse-studio-document-v5";

const palettes = {
  dopamine: {
    tensor: "#00e5ff",
    convA: "#ff2aa3",
    convB: "#ff9f1c",
    patch: "#c9ff2e",
    token: "#ffe94a",
    block: "#a855ff",
    encoderA: "#2f6bff",
    encoderB: "#00e676",
    output: "#ff4fd8",
    signal: "#2846d8",
    attention: "#ff2aa3",
    skip: "#00d4aa",
  },
  aurora: {
    tensor: "#22f7d0",
    convA: "#ff5c8a",
    convB: "#ff8f3d",
    patch: "#b6ff3b",
    token: "#fff35a",
    block: "#8b5cf6",
    encoderA: "#38bdf8",
    encoderB: "#f472b6",
    output: "#f43fce",
    signal: "#31507c",
    attention: "#06d6ff",
    skip: "#ff7a18",
  },
  citrus: {
    tensor: "#60efff",
    convA: "#ff6b00",
    convB: "#ffd000",
    patch: "#baff29",
    token: "#fff45f",
    block: "#36e69a",
    encoderA: "#0094ff",
    encoderB: "#9d4edd",
    output: "#ff2fb3",
    signal: "#243b6b",
    attention: "#00b7ff",
    skip: "#ff8f00",
  },
};

const stackPartTypes = new Set(["conv", "volume-stack", "flatten", "dense-layer"]);

function loadTemplate(name, options = {}) {
  const template = createTemplate(name);
  if (!template) {
    setStatus(`未知模型模板：${name}`);
    return;
  }
  state.nodes = template.nodes;
  state.edges = template.edges;
  state.figure = template.figure || state.figure;
  state.paletteName = palettes[state.paletteName] ? state.paletteName : defaultPaletteName;
  state.paletteVersion = paletteVersion;
  recolorDocument(palettes[state.paletteName]);
  state.selected = null;
  state.connectSource = null;
  state.connectPreview = null;
  state.connectMode = false;
  state.nextNodeId = state.nodes.length + 1;
  state.nextEdgeId = state.edges.length + 1;
  connectButton.classList.remove("is-active");
  if (options.persist !== false) persist();
  if (options.render !== false) {
    render();
    focusArchitecture({ silent: true });
  }
  updateModelLibrarySelection(name);
  updatePaletteSelection();
  setStatus(options.message || `已加载 ${name} 模板`);
}

function renderModelLibrary() {
  const container = document.querySelector("#modelLibrary");
  const buttons = modelLibrary.map((item) => {
    const button = document.createElement("button");
    button.className = "tool-button";
    button.type = "button";
    button.dataset.template = item.id;
    button.innerHTML = `<span>${item.title}</span><small>${item.description}</small>`;
    button.addEventListener("click", () => loadTemplate(item.id));
    return button;
  });
  container.replaceChildren(...buttons);
}

function updateModelLibrarySelection(name) {
  document.querySelectorAll("[data-template]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.template === name);
  });
}

function updatePaletteSelection() {
  document.querySelectorAll("[data-palette]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.palette === state.paletteName);
  });
}

function createNumberedEdge(source, target, label = "", type = "signal") {
  return {
    ...createEdge(source, target, label, type),
    id: `edge-${state.nextEdgeId++}`,
  };
}

function applyDiagramDocument(document, options = {}) {
  const normalized = normalizeDiagramDocument(document);
  if (!normalized) {
    setStatus("AI 结果无法绘制：缺少 nodes 或 edges");
    return false;
  }

  state.nodes = normalized.nodes;
  state.edges = normalized.edges;
  state.figure = normalized.figure || state.figure;
  state.paletteName = palettes[normalized.paletteName] ? normalized.paletteName : state.paletteName;
  state.paletteVersion = paletteVersion;
  recolorDocument(palettes[state.paletteName]);
  state.selected = null;
  state.connectSource = null;
  state.connectPreview = null;
  state.connectMode = false;
  state.nextNodeId = nextNumericId(state.nodes, "node");
  state.nextEdgeId = nextNumericId(state.edges, "edge");
  connectButton.classList.remove("is-active");
  svg.classList.remove("is-connect-mode");
  persist();
  render();
  updatePaletteSelection();
  focusArchitecture({ silent: true });
  setStatus(options.message || "AI 已生成可编辑神经网络图");
  return true;
}

function applyAgentDiagram(diagram) {
  return applyDiagramDocument(diagram, {
    message: "Agent diagram applied to the canvas",
  });
}

function normalizeDiagramDocument(document) {
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) return null;
  const nodes = document.nodes
    .filter((item) => item && item.id)
    .map((item, index) => ({
      ...item,
      type: item.type || "block",
      x: Number.isFinite(item.x) ? item.x : 320 + index * 240,
      y: Number.isFinite(item.y) ? item.y : 680,
      w: Number.isFinite(item.w) ? item.w : 160,
      h: Number.isFinite(item.h) ? item.h : 110,
      label: item.label || `Node ${index + 1}`,
      subtitle: item.subtitle || "",
      stage: Number.isFinite(item.stage) ? item.stage : index,
      color: item.color || "#b79cff",
    }));
  const ids = new Set(nodes.map((item) => item.id));
  const edges = document.edges
    .filter((item) => item && ids.has(item.source) && ids.has(item.target))
    .map((item, index) => ({
      ...item,
      id: item.id || `edge-${index + 1}`,
      label: item.label || "",
      type: item.type || "signal",
      color: item.color || "#4555a6",
    }));

  return {
    figure: document.figure,
    nodes,
    edges,
    paletteName: document.paletteName,
  };
}

function nextNumericId(items, prefix) {
  const max = items.reduce((value, item) => {
    const match = String(item.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(value, Number(match[1])) : value;
  }, items.length);
  return max + 1;
}

function render() {
  svg.replaceChildren();
  svg.appendChild(createDefs());
  svg.appendChild(createBackdrop());

  const edgeLayer = el("g", { class: "edge-layer" });
  const previewLayer = el("g", { class: "preview-layer" });
  const nodeLayer = el("g", { class: "node-layer" });
  const guideLayer = el("g", { class: "guide-layer" });
  const selectionLayer = el("g", { class: "selection-layer" });
  svg.appendChild(createStageLabels());
  state.edges.forEach((item) => edgeLayer.appendChild(drawEdge(item)));
  if (state.connectPreview) previewLayer.appendChild(drawConnectionPreview());
  state.nodes.forEach((item) => nodeLayer.appendChild(drawNode(item)));
  state.guides.forEach((item) => guideLayer.appendChild(drawGuide(item)));
  selectionLayer.appendChild(drawSelectionOverlay());
  svg.append(edgeLayer, previewLayer, nodeLayer, guideLayer, selectionLayer);
  updateInspector();
  renderMinimap();
}

function createDefs() {
  const defs = el("defs");
  const marker = el("marker", {
    id: "arrow",
    markerWidth: 13,
    markerHeight: 13,
    refX: 11,
    refY: 6,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.appendChild(el("path", { d: "M2,2 L11,6 L2,10 Z", fill: "context-stroke" }));
  defs.appendChild(marker);

  const attentionMarker = el("marker", {
    id: "arrow-attention",
    markerWidth: 13,
    markerHeight: 13,
    refX: 11,
    refY: 6,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  attentionMarker.appendChild(el("path", { d: "M2,2 L11,6 L2,10 Z", fill: "context-stroke" }));
  defs.appendChild(attentionMarker);

  const skipMarker = el("marker", {
    id: "arrow-skip",
    markerWidth: 13,
    markerHeight: 13,
    refX: 11,
    refY: 6,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  skipMarker.appendChild(el("path", { d: "M2,2 L11,6 L2,10 Z", fill: "context-stroke" }));
  defs.appendChild(skipMarker);

  const glow = el("filter", { id: "softGlow", x: "-30%", y: "-30%", width: "160%", height: "160%" });
  glow.appendChild(el("feGaussianBlur", { stdDeviation: "5", result: "blur" }));
  glow.appendChild(el("feColorMatrix", { in: "blur", type: "matrix", values: "0 0 0 0 0.84 0 0 0 0 0.54 0 0 0 0 0.25 0 0 0.45 0" }));
  glow.appendChild(el("feBlend", { in: "SourceGraphic", mode: "normal" }));
  defs.appendChild(glow);
  return defs;
}

function createBackdrop() {
  const group = el("g", { class: "backdrop-layer" });
  group.appendChild(el("rect", {
    class: "artboard-shell",
    x: artboard.x,
    y: artboard.y,
    width: artboard.width,
    height: artboard.height,
    rx: 18,
  }));
  group.appendChild(el("rect", {
    class: "artboard-inner",
    x: artboard.x + 74,
    y: artboard.y + 104,
    width: artboard.width - 148,
    height: artboard.height - 190,
    rx: 10,
  }));
  group.appendChild(el("text", {
    class: "figure-title",
    x: artboard.x + 80,
    y: artboard.y + 68,
  }, state.figure.title));
  group.appendChild(el("text", {
    class: "figure-subtitle",
    x: artboard.x + 80,
    y: artboard.y + 96,
  }, state.figure.subtitle));
  group.appendChild(createRulers());
  group.appendChild(createLegend());
  return group;
}

function createRulers() {
  const group = el("g", { class: "ruler-layer" });
  const top = artboard.y + 124;
  const left = artboard.x + 74;
  for (let x = left; x <= artboard.x + artboard.width - 74; x += 200) {
    group.appendChild(el("line", {
      class: "axis-tick",
      x1: x,
      x2: x,
      y1: top - 14,
      y2: top - 4,
    }));
    group.appendChild(el("text", {
      class: "axis-label",
      x,
      y: top - 24,
      "text-anchor": "middle",
    }, String(Math.round((x - left) / 10))));
  }
  for (let y = top; y <= artboard.y + artboard.height - 86; y += 200) {
    group.appendChild(el("line", {
      class: "axis-tick",
      x1: left - 14,
      x2: left - 4,
      y1: y,
      y2: y,
    }));
    group.appendChild(el("text", {
      class: "axis-label",
      x: left - 26,
      y: y + 4,
      "text-anchor": "end",
    }, String(Math.round((y - top) / 10))));
  }
  return group;
}

function createLegend() {
  const group = el("g", { class: "legend-layer" });
  const x = artboard.x + artboard.width - 590;
  const y = artboard.y + 68;
  const palette = palettes[state.paletteName] || palettes[defaultPaletteName];
  const hasVolume = state.nodes.some((item) => item.type === "volume" || item.type === "volume-stack");
  const entries = [
    ["Signal", palette.signal, ""],
    [hasVolume ? "3D volume flow" : "Attention / token flow", palette.attention, ""],
    ["Residual / skip", palette.skip, "8 9"],
  ];

  entries.forEach(([label, color, dash], index) => {
    const itemX = x + index * 190;
    group.appendChild(el("line", {
      x1: itemX,
      x2: itemX + 54,
      y1: y,
      y2: y,
      stroke: color,
      "stroke-width": 3,
      "stroke-linecap": "round",
      "stroke-dasharray": dash,
    }));
    group.appendChild(el("text", {
      class: "legend-label",
      x: itemX + 66,
      y: y + 4,
    }, label));
  });

  return group;
}

function createStageLabels() {
  const labels = state.figure.stages || [];
  const stageMap = new Map();
  state.nodes.forEach((item) => {
    if (!stageMap.has(item.stage)) stageMap.set(item.stage, []);
    stageMap.get(item.stage).push(item);
  });
  const group = el("g", { class: "stage-layer" });
  [...stageMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([stage, items]) => {
      const minX = Math.min(...items.map((item) => getNodeBounds(item).minX));
      const maxX = Math.max(...items.map((item) => getNodeBounds(item).maxX));
      const x = (minX + maxX) / 2;
      const bandX = Math.max(artboard.x + 90, minX - 32);
      const bandWidth = Math.min(artboard.x + artboard.width - 180 - bandX, maxX - minX + 64);
      group.appendChild(el("rect", {
        class: "stage-band",
        x: bandX,
        y: artboard.y + 150,
        width: Math.max(80, bandWidth),
        height: artboard.height - 260,
        rx: 14,
      }));
      group.appendChild(el("text", {
        class: "stage-label",
        x,
        y: artboard.y + 174,
        "text-anchor": "middle",
      }, labels[stage] || `Stage ${stage}`));
      group.appendChild(el("line", {
        class: "stage-rule",
        x1: minX,
        x2: maxX,
        y1: artboard.y + 194,
        y2: artboard.y + 194,
      }));
    });
  return group;
}

function drawNode(item) {
  const group = el("g", {
    class: `node ${state.selected?.type === "node" && state.selected.id === item.id ? "is-selected" : ""}`,
    transform: `translate(${item.x} ${item.y})`,
    "data-node-id": item.id,
  });
  group.addEventListener("pointerdown", (event) => startNodePointer(event, item.id));
  group.addEventListener("click", (event) => handleNodeClick(event, item.id));

  if (item.type === "neuron") {
    drawNeuron(group, item);
  } else if (item.type === "conv") {
    drawConvStack(group, item);
  } else if (item.type === "pool") {
    drawPooling(group, item);
  } else if (item.type === "flatten") {
    drawFlatten(group, item);
  } else if (item.type === "dense-layer") {
    drawDenseLayer(group, item);
  } else if (item.type === "concat") {
    drawConcat(group, item);
  } else if (item.type === "volume") {
    drawVolume(group, item);
  } else if (item.type === "volume-stack") {
    drawVolumeStack(group, item);
  } else if (item.type === "patch-grid") {
    drawPatchGrid(group, item);
  } else if (item.type === "token") {
    drawToken(group, item);
  } else if (item.type === "encoder") {
    drawEncoder(group, item);
  } else if (item.type === "attention") {
    drawAttention(group, item);
  } else if (item.type === "tensor") {
    drawTensor(group, item);
  } else if (item.type === "output") {
    drawOutput(group, item);
  } else {
    drawBlock(group, item);
  }

  drawNodePorts(group, item);
  return group;
}

function drawSelectionOverlay() {
  if (state.selected?.type !== "node") return el("g");
  const item = getNode(state.selected.id);
  if (!item) return el("g");
  const bounds = getNodeBounds(item);
  const group = el("g", { class: "selection-overlay" });
  const pad = 10;
  group.appendChild(el("rect", {
    class: "selection-box",
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width: bounds.maxX - bounds.minX + pad * 2,
    height: bounds.maxY - bounds.minY + pad * 2,
    rx: 8,
  }));

  getResizeHandles(bounds, pad).forEach((handle) => {
    const rect = el("rect", {
      class: `resize-handle resize-${handle.corner}`,
      x: handle.x - 6,
      y: handle.y - 6,
      width: 12,
      height: 12,
      rx: 3,
      "data-corner": handle.corner,
    });
    rect.addEventListener("pointerdown", (event) => startResize(event, item.id, handle.corner));
    group.appendChild(rect);
  });

  group.appendChild(el("text", {
    class: "selection-size",
    x: bounds.maxX + 16,
    y: bounds.maxY + 22,
  }, `${Math.round(item.w)} x ${Math.round(item.h)}`));
  return group;
}

function drawGuide(item) {
  return el("line", {
    class: "alignment-guide",
    x1: item.x1,
    x2: item.x2,
    y1: item.y1,
    y2: item.y2,
  });
}

function getResizeHandles(bounds, pad = 0) {
  const left = bounds.minX - pad;
  const right = bounds.maxX + pad;
  const top = bounds.minY - pad;
  const bottom = bounds.maxY + pad;
  return [
    { corner: "nw", x: left, y: top },
    { corner: "ne", x: right, y: top },
    { corner: "se", x: right, y: bottom },
    { corner: "sw", x: left, y: bottom },
  ];
}

function drawNodePorts(group, item) {
  const left = localAnchor(item, "left");
  const right = localAnchor(item, "right");
  group.appendChild(el("circle", {
    class: "node-port",
    cx: left.x,
    cy: left.y,
    r: 6,
  }));
  group.appendChild(el("circle", {
    class: "node-port",
    cx: right.x,
    cy: right.y,
    r: 6,
  }));
}

function decorateStackPart(element, item, index) {
  element.classList.add("stack-part");
  element.dataset.stackNodeId = item.id;
  element.dataset.stackIndex = String(index);
  if (state.selected?.type === "stackPart" && state.selected.id === item.id && state.selected.index === index) {
    element.classList.add("is-stack-selected");
    element.setAttribute("stroke", "#172033");
    element.setAttribute("stroke-width", "3.4");
    element.setAttribute("filter", "url(#softGlow)");
  }
  element.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    select({ type: "stackPart", id: item.id, index });
    setStatus(`${item.label}：已选择第 ${index + 1} 个堆叠单元`);
  });
}

function drawBlock(group, item) {
  group.appendChild(el("rect", {
    class: "node-shell",
    width: item.w,
    height: item.h,
    rx: 18,
    fill: item.color,
  }));
  group.appendChild(el("rect", {
    x: 11,
    y: 11,
    width: Math.max(8, item.w - 22),
    height: Math.max(8, item.h - 22),
    rx: 12,
    fill: "rgba(255,255,255,0.14)",
    stroke: "rgba(255,255,255,0.2)",
  }));
  addCenteredText(group, item);
  if (!addOperationChips(group, item, item.w / 2, item.h + 30)) {
    addNodeNote(group, item, item.w / 2, item.h + 28);
  }
}

function drawTensor(group, item) {
  const depth = item.depth || 18;
  group.appendChild(el("polygon", {
    points: `${depth},0 ${item.w},0 ${item.w - depth},${depth} 0,${depth}`,
    fill: lighten(item.color, 18),
    stroke: "rgba(15,23,24,0.18)",
  }));
  group.appendChild(el("polygon", {
    points: `${item.w},0 ${item.w},${item.h - depth} ${item.w - depth},${item.h} ${item.w - depth},${depth}`,
    fill: darken(item.color, 9),
    stroke: "rgba(15,23,24,0.18)",
  }));
  group.appendChild(el("rect", {
    class: "node-shell",
    x: 0,
    y: depth,
    width: item.w - depth,
    height: item.h - depth,
    rx: 14,
    fill: item.color,
  }));
  addTensorPixels(group, item, depth);
  addCenteredText(group, item, -4, depth / 2);
  addNodeNote(group, item, item.w / 2, item.h + 32);
}

function addTensorPixels(group, item, depth) {
  const faceW = item.w - depth;
  const faceH = item.h - depth;
  const cols = 5;
  const rows = 5;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      group.appendChild(el("rect", {
        x: 14 + col * ((faceW - 28) / cols),
        y: depth + 14 + row * ((faceH - 28) / rows),
        width: Math.max(5, (faceW - 48) / cols),
        height: Math.max(5, (faceH - 48) / rows),
        rx: 3,
        fill: row % 2 === col % 2 ? "rgba(255,255,255,0.22)" : "rgba(24,32,72,0.08)",
      }));
    }
  }
  ["R", "G", "B"].forEach((label, index) => {
    group.appendChild(el("text", {
      class: "node-micro",
      x: faceW + depth - 10,
      y: depth + 22 + index * 20,
      "text-anchor": "middle",
    }, label));
  });
}

function drawConvStack(group, item) {
  const depth = item.depth || 58;
  const layerCount = item.layers || 4;
  const visibleMaps = Math.min(18, Math.max(1, layerCount));
  const step = depth / Math.max(3, visibleMaps);
  const mapW = item.w;
  const mapH = item.h;

  for (let i = visibleMaps - 1; i >= 0; i -= 1) {
    const offset = i * step;
    const map = el("rect", {
      class: "feature-slice",
      x: offset,
      y: -offset * 0.46,
      width: mapW,
      height: mapH,
      rx: 4,
      fill: i === 0 ? item.color : lighten(item.color, i * 4),
      stroke: "rgba(20,28,26,0.20)",
    });
    decorateStackPart(map, item, i);
    group.appendChild(map);
    if (i <= 2 || layerCount <= 4) drawActivationGrid(group, offset, -offset * 0.46, mapW, mapH, i);
  }

  group.appendChild(el("path", {
    class: "feature-ridge",
    d: `M${depth} ${-depth * 0.46 + 18} L${item.w + depth - 16} ${-depth * 0.46 + 18}`,
  }));
  drawKernelGlyph(group, depth, item);
  drawChannelRulers(group, depth, item);
  drawFeatureMapBraces(group, item, depth);
  drawFeatureMapDimensions(group, item, depth);
  drawStackCountBadge(group, item, depth, visibleMaps, layerCount);
  group.appendChild(el("text", {
    class: "node-title compact",
    x: item.w / 2 + depth / 2,
    y: item.h / 2 - 12,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: item.w / 2 + depth / 2,
    y: item.h / 2 + 14,
    "text-anchor": "middle",
  }, item.subtitle));
  if (!addOperationChips(group, item, item.w / 2 + depth / 2, item.h + 42)) {
    addNodeNote(group, item, item.w / 2 + depth / 2, item.h + 38);
  }
}

function drawStackCountBadge(group, item, depth, visibleMaps, layerCount) {
  const label = layerCount > visibleMaps ? `show ${visibleMaps} / ${layerCount}` : `x${layerCount}`;
  const x = item.w + depth - 64;
  const y = -depth * 0.46 - 18;
  group.appendChild(el("rect", {
    x,
    y,
    width: 78,
    height: 28,
    rx: 8,
    fill: "#26323c",
    opacity: 0.94,
  }));
  group.appendChild(el("text", {
    class: "node-micro",
    x: x + 39,
    y: y + 18,
    "text-anchor": "middle",
  }, label));
}

function drawActivationGrid(group, x, y, w, h, index) {
  const cols = 4;
  const rows = 4;
  const pad = 12 + index * 2;
  const cellW = Math.max(6, (w - pad * 2) / cols - 3);
  const cellH = Math.max(6, (h - pad * 2) / rows - 3);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      group.appendChild(el("rect", {
        x: x + pad + col * (cellW + 3),
        y: y + pad + row * (cellH + 3),
        width: cellW,
        height: cellH,
        rx: 2,
        fill: (row + col + index) % 3 === 0 ? "rgba(255,255,255,0.28)" : "rgba(23,32,72,0.08)",
      }));
    }
  }
}

function drawFeatureMapBraces(group, item, depth) {
  const x = item.w + depth + 10;
  const y1 = -depth * 0.46;
  const y2 = item.h - 4;
  group.appendChild(el("path", {
    d: `M${x} ${y1} C${x + 16} ${y1 + 18}, ${x + 16} ${(y1 + y2) / 2 - 18}, ${x} ${(y1 + y2) / 2} C${x + 16} ${(y1 + y2) / 2 + 18}, ${x + 16} ${y2 - 18}, ${x} ${y2}`,
    fill: "none",
    stroke: "rgba(38,50,60,0.28)",
    "stroke-width": 1.4,
    "stroke-linecap": "round",
  }));
  group.appendChild(el("text", {
    class: "node-note",
    x: x + 28,
    y: (y1 + y2) / 2 + 4,
    "text-anchor": "middle",
    transform: `rotate(90 ${x + 28} ${(y1 + y2) / 2 + 4})`,
  }, item.channels || item.subtitle?.match(/\d+\s*(channels|filters)?/i)?.[0] || "channels"));
}

function drawFeatureMapDimensions(group, item, depth) {
  const shape = extractShapeLabel(item.subtitle);
  if (!shape) return;
  const topY = -depth * 0.46;
  const bottomY = item.h + 12;
  const rightX = item.w + depth - 8;
  group.appendChild(el("line", {
    class: "dimension-rule",
    x1: 0,
    x2: item.w,
    y1: bottomY,
    y2: bottomY,
  }));
  group.appendChild(el("line", {
    class: "dimension-rule",
    x1: -12,
    x2: -12,
    y1: 0,
    y2: item.h,
  }));
  group.appendChild(el("text", {
    class: "dimension-label",
    x: item.w / 2,
    y: bottomY + 18,
    "text-anchor": "middle",
  }, shape.spatial));
  if (shape.channels) {
    group.appendChild(el("text", {
      class: "dimension-label",
      x: rightX,
      y: topY - 10,
      "text-anchor": "end",
    }, `C=${shape.channels}`));
  }
}

function drawKernelGlyph(group, depth, item) {
  const startX = depth + 14;
  const startY = -depth * 0.46 + 34;
  const kernelLabel = kernelLabelFor(item);
  const kernelSize = Math.min(5, Math.max(1, Number(kernelLabel.match(/\d+/)?.[0] || 3)));
  const size = kernelSize >= 5 ? 6 : 9;
  for (let row = 0; row < kernelSize; row += 1) {
    for (let col = 0; col < kernelSize; col += 1) {
      group.appendChild(el("rect", {
        x: startX + col * (size + 3),
        y: startY + row * (size + 3),
        width: size,
        height: size,
        rx: 2,
        fill: row === Math.floor(kernelSize / 2) && col === Math.floor(kernelSize / 2) ? "rgba(20,28,55,0.32)" : "rgba(255,255,255,0.38)",
      }));
    }
  }
  group.appendChild(el("text", {
    class: "node-micro",
    x: startX + Math.max(16, (kernelSize * (size + 3)) / 2 - 2),
    y: startY + kernelSize * (size + 3) + 14,
    "text-anchor": "middle",
  }, kernelLabel));
}

function kernelLabelFor(item) {
  const source = `${item.note || ""} ${item.subtitle || ""}`;
  const explicit = source.match(/(?:k|kernel\s*)\s*([0-9]+(?:\s*[x,]\s*[0-9]+){0,2})/i)?.[1]
    || source.match(/([0-9]+)\s*x\s*([0-9]+)(?:\s*x\s*([0-9]+))?\s*(?:kernel|kernels)?/i)?.[0];
  if (!explicit) return "3x3";
  return explicit
    .replace(/kernel[s]?/i, "")
    .replace(/\s*,\s*/g, "x")
    .replace(/\s+/g, "")
    .replace(/^k/i, "");
}

function extractShapeLabel(value = "") {
  const dim = "[0-9?A-Z]+(?:[/*][0-9]+)?(?:\\+[0-9?A-Z]+)?";
  const match = String(value).match(new RegExp(`(${dim})\\s*x\\s*(${dim})(?:\\s*x\\s*(${dim})(?:\\s*x\\s*(${dim}))?)?`, "i"));
  if (!match) return null;
  const hasDepth = Boolean(match[4]);
  return {
    spatial: hasDepth ? `${match[1]} x ${match[2]} x ${match[3]}` : `${match[1]} x ${match[2]}`,
    channels: hasDepth ? match[4] : match[3] || "",
  };
}

function drawChannelRulers(group, depth, item) {
  const baseX = item.w + depth - 18;
  const top = -depth * 0.46 + 32;
  const height = Math.max(46, item.h - 70);
  for (let i = 0; i < 4; i += 1) {
    group.appendChild(el("line", {
      class: "feature-ridge",
      x1: baseX - i * 10,
      x2: baseX - i * 10,
      y1: top,
      y2: top + height,
      opacity: 0.7 - i * 0.1,
    }));
  }
}

function drawPooling(group, item) {
  const rows = 4;
  const cols = 4;
  const cell = Math.min(item.w / cols, item.h / rows);
  group.appendChild(el("rect", {
    class: "node-shell",
    width: item.w,
    height: item.h,
    rx: 10,
    fill: "rgba(255,255,255,0.72)",
  }));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      group.appendChild(el("rect", {
        x: col * cell + 4,
        y: row * cell + 4,
        width: cell - 8,
        height: cell - 8,
        rx: 5,
        fill: row === 1 && col === 2 ? item.color : lighten(item.color, (row + col) * 5),
        opacity: row === 1 && col === 2 ? 0.98 : 0.55,
      }));
    }
  }
  group.appendChild(el("path", {
    d: `M${item.w * 0.18} ${item.h + 18} L${item.w * 0.5} ${item.h + 54} L${item.w * 0.82} ${item.h + 18}`,
    fill: "none",
    stroke: item.color,
    "stroke-width": 3,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
  group.appendChild(el("text", {
    class: "node-title compact",
    x: item.w / 2,
    y: item.h + 82,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: item.w / 2,
    y: item.h + 104,
    "text-anchor": "middle",
  }, item.subtitle));
  addOperationChips(group, item, item.w / 2, item.h + 130);
}

function drawFlatten(group, item) {
  const total = item.layers || 10;
  const bars = Math.min(32, Math.max(1, total));
  const gap = 5;
  const barW = Math.max(6, (item.w - gap * (bars - 1)) / bars);
  for (let i = 0; i < bars; i += 1) {
    const height = item.h * (0.38 + ((i * 7) % 9) / 16);
    const bar = el("rect", {
      class: i === 0 ? "node-shell" : "flatten-bar",
      x: i * (barW + gap),
      y: item.h - height,
      width: barW,
      height,
      rx: barW / 2,
      fill: i % 2 ? lighten(item.color, 14) : item.color,
      stroke: "rgba(30,42,54,0.2)",
    });
    decorateStackPart(bar, item, i);
    group.appendChild(bar);
  }
  group.appendChild(el("path", {
    d: `M-18 ${item.h / 2} C${item.w * 0.25} ${item.h * 0.08}, ${item.w * 0.68} ${item.h * 0.92}, ${item.w + 18} ${item.h / 2}`,
    fill: "none",
    stroke: "rgba(38,50,60,0.24)",
    "stroke-width": 2,
    "stroke-dasharray": "5 7",
  }));
  if (total > bars) {
    group.appendChild(el("text", {
      class: "node-note",
      x: item.w / 2,
      y: -12,
      "text-anchor": "middle",
    }, `show ${bars} / ${total} dims`));
  }
  addUnderText(group, item);
  addOperationChips(group, item, item.w / 2, item.h + 72);
}

function drawDenseLayer(group, item) {
  const total = item.layers || 7;
  const count = Math.min(24, Math.max(1, total));
  const radius = Math.min(18, Math.max(9, item.h / (count * 2.5)));
  const centerX = item.w / 2;
  const startY = item.h / 2 - ((count - 1) * radius * 2.35) / 2;
  const shell = el("rect", {
    class: "node-shell",
    width: item.w,
    height: item.h,
    rx: 22,
    fill: "rgba(255,255,255,0.62)",
  });
  shell.dataset.nodeFill = item.color;
  group.appendChild(shell);
  for (let i = 0; i < count; i += 1) {
    const cy = startY + i * radius * 2.35;
    const neuron = el("circle", {
      cx: centerX,
      cy,
      r: radius,
      fill: i % 2 ? lighten(item.color, 10) : item.color,
      stroke: "rgba(30,42,54,0.24)",
      "stroke-width": 1.2,
    });
    decorateStackPart(neuron, item, i);
    group.appendChild(neuron);
    if (i > 0) {
      group.appendChild(el("line", {
        x1: centerX,
        x2: centerX,
        y1: cy - radius * 2.0,
        y2: cy - radius,
        stroke: "rgba(38,50,60,0.26)",
        "stroke-width": 1.1,
      }));
    }
  }
  if (total > count) {
    group.appendChild(el("text", {
      class: "node-note",
      x: centerX,
      y: item.h + 28,
      "text-anchor": "middle",
    }, `show ${count} / ${total} neurons`));
  }
  group.appendChild(el("text", {
    class: "node-title compact",
    x: centerX + item.w * 0.18,
    y: item.h / 2 - 4,
    "text-anchor": "start",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: centerX + item.w * 0.18,
    y: item.h / 2 + 20,
    "text-anchor": "start",
  }, item.subtitle));
  addOperationChips(group, item, centerX, item.h + 28);
}

function drawConcat(group, item) {
  const w = item.w;
  const h = item.h;
  group.appendChild(el("path", {
    class: "node-shell",
    d: `M${w * 0.5} 0 L${w} ${h * 0.5} L${w * 0.5} ${h} L0 ${h * 0.5} Z`,
    fill: item.color,
  }));
  group.appendChild(el("line", {
    x1: w * 0.24,
    x2: w * 0.76,
    y1: h * 0.5,
    y2: h * 0.5,
    stroke: "rgba(255,255,255,0.76)",
    "stroke-width": 4,
    "stroke-linecap": "round",
  }));
  group.appendChild(el("line", {
    x1: w * 0.5,
    x2: w * 0.5,
    y1: h * 0.24,
    y2: h * 0.76,
    stroke: "rgba(255,255,255,0.76)",
    "stroke-width": 4,
    "stroke-linecap": "round",
  }));
  group.appendChild(el("text", {
    class: "node-title compact",
    x: w / 2,
    y: h + 28,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: w / 2,
    y: h + 50,
    "text-anchor": "middle",
  }, item.subtitle));
}

function drawVolume(group, item) {
  const depth = item.depth || 78;
  const z = item.z || depth * 0.62;
  const skew = z * 0.46;
  const face = {
    x: 0,
    y: skew,
    w: item.w,
    h: item.h - skew,
  };
  drawVolumeFaces(group, item, depth, skew, face);
  drawVolumeGrid(group, item, depth, skew, face, 5);
  drawVoxelSlices(group, item, depth, skew, face);
  addVolumeText(group, item, face, depth, skew);
  if (!addOperationChips(group, item, face.x + item.w / 2 + depth / 2, item.h + 42)) {
    addNodeNote(group, item, face.x + item.w / 2 + depth / 2, item.h + 38);
  }
}

function drawVolumeStack(group, item) {
  const depth = item.depth || 104;
  const z = item.z || depth * 0.64;
  const skew = z * 0.44;
  const totalLayers = item.layers || 5;
  const layers = Math.min(18, Math.max(1, totalLayers));
  const step = depth / Math.max(3, layers + 1);
  const face = {
    x: 0,
    y: skew,
    w: item.w,
    h: item.h - skew,
  };

  for (let i = layers - 1; i >= 0; i -= 1) {
    const offset = i * step;
    const layer = {
      ...item,
      w: item.w,
      h: item.h,
      color: i === 0 ? item.color : lighten(item.color, i * 4),
    };
    const layerGroup = el("g", { transform: `translate(${offset} ${-offset * 0.44})` });
    decorateStackPart(layerGroup, item, i);
    drawVolumeFaces(layerGroup, layer, depth * 0.36, skew, face, i > 0 ? 0.72 : 1);
    group.appendChild(layerGroup);
  }

  drawVolumeGrid(group, item, depth, skew, face, 4);
  drawVoxelSlices(group, item, depth, skew, face);
  drawStackCountBadge(group, item, depth, layers, totalLayers);
  addVolumeText(group, item, face, depth, skew);
  if (!addOperationChips(group, item, item.w / 2 + depth / 2, item.h + 46)) {
    addNodeNote(group, item, item.w / 2 + depth / 2, item.h + 42);
  }
}

function drawVolumeFaces(group, item, depth, skew, face, opacity = 1) {
  group.appendChild(el("polygon", {
    class: "volume-top",
    points: `${face.x},${face.y} ${face.x + depth},${face.y - skew} ${face.x + item.w + depth},${face.y - skew} ${face.x + item.w},${face.y}`,
    fill: lighten(item.color, 18),
    opacity,
  }));
  group.appendChild(el("polygon", {
    class: "volume-side",
    points: `${face.x + item.w},${face.y} ${face.x + item.w + depth},${face.y - skew} ${face.x + item.w + depth},${face.y + face.h - skew} ${face.x + item.w},${face.y + face.h}`,
    fill: darken(item.color, 12),
    opacity,
  }));
  group.appendChild(el("rect", {
    class: "node-shell volume-front",
    x: face.x,
    y: face.y,
    width: face.w,
    height: face.h,
    rx: 12,
    fill: item.color,
    opacity,
  }));
}

function drawVolumeGrid(group, item, depth, skew, face, count) {
  for (let i = 1; i < count; i += 1) {
    const x = face.x + (face.w / count) * i;
    group.appendChild(el("line", {
      class: "volume-grid",
      x1: x,
      x2: x + depth,
      y1: face.y,
      y2: face.y - skew,
    }));
  }
  for (let i = 1; i < count; i += 1) {
    const y = face.y + (face.h / count) * i;
    group.appendChild(el("line", {
      class: "volume-grid",
      x1: face.x,
      x2: face.x + face.w,
      y1: y,
      y2: y,
    }));
  }
}

function drawVoxelSlices(group, item, depth, skew, face) {
  const sliceCount = Math.min(5, Math.max(3, item.layers || 4));
  for (let i = 1; i <= sliceCount; i += 1) {
    const t = i / (sliceCount + 1);
    const x = face.x + face.w * t;
    group.appendChild(el("path", {
      class: "volume-grid",
      d: `M${x} ${face.y} L${x + depth} ${face.y - skew} L${x + depth} ${face.y + face.h - skew}`,
      opacity: 0.78,
    }));
  }
  group.appendChild(el("text", {
    class: "node-micro",
    x: face.x + face.w + depth + 18,
    y: face.y + face.h / 2,
    "text-anchor": "middle",
    transform: `rotate(90 ${face.x + face.w + depth + 18} ${face.y + face.h / 2})`,
  }, "D slices"));
}

function addVolumeText(group, item, face, depth, skew) {
  group.appendChild(el("text", {
    class: "node-title compact",
    x: face.x + item.w / 2 + depth / 2,
    y: face.y + face.h / 2 - 12,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: face.x + item.w / 2 + depth / 2,
    y: face.y + face.h / 2 + 14,
    "text-anchor": "middle",
  }, item.subtitle));
  group.appendChild(el("text", {
    class: "node-note",
    x: face.x + item.w + depth + 22,
    y: face.y - skew + 18,
    "text-anchor": "middle",
    transform: `rotate(-24 ${face.x + item.w + depth + 22} ${face.y - skew + 18})`,
  }, "3D"));
}

function drawPatchGrid(group, item) {
  const cols = 6;
  const rows = 6;
  const gap = 5;
  const cell = Math.min((item.w - gap * (cols - 1)) / cols, (item.h - gap * (rows - 1)) / rows);
  group.appendChild(el("rect", {
    class: "node-shell",
    width: item.w,
    height: item.h,
    rx: 14,
    fill: "rgba(255,248,229,0.88)",
  }));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const alpha = 0.55 + (row + col) / 24;
      group.appendChild(el("rect", {
        x: 18 + col * (cell + gap),
        y: 18 + row * (cell + gap),
        width: cell,
        height: cell,
        rx: 5,
        fill: item.color,
        opacity: alpha.toFixed(2),
      }));
    }
  }
  group.appendChild(el("rect", {
    x: item.w - 58,
    y: item.h - 40,
    width: 42,
    height: 24,
    rx: 7,
    fill: "#26323c",
  }));
  group.appendChild(el("text", {
    class: "node-micro",
    x: item.w - 37,
    y: item.h - 24,
    "text-anchor": "middle",
  }, item.badge || "N"));
  addUnderText(group, item);
}

function drawToken(group, item) {
  group.appendChild(el("rect", {
    class: "node-shell",
    width: item.w,
    height: item.h,
    rx: item.h / 2,
    fill: item.color,
  }));
  group.appendChild(el("circle", {
    cx: 28,
    cy: item.h / 2,
    r: Math.max(10, item.h * 0.24),
    fill: "rgba(255,255,255,0.34)",
  }));
  group.appendChild(el("text", {
    class: "node-title compact",
    x: item.w / 2 + 12,
    y: item.h / 2 - 4,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: item.w / 2 + 12,
    y: item.h / 2 + 18,
    "text-anchor": "middle",
  }, item.subtitle));
}

function drawEncoder(group, item) {
  const layers = item.layers || 3;
  const offset = 14;
  for (let i = layers - 1; i >= 0; i -= 1) {
    group.appendChild(el("rect", {
      class: "encoder-card",
      x: i * offset,
      y: -i * offset,
      width: item.w,
      height: item.h,
      rx: 12,
      fill: i === 0 ? item.color : lighten(item.color, i * 5),
    }));
  }

  const xOffset = (layers - 1) * offset;
  const yOffset = -(layers - 1) * offset;
  const laneY = yOffset + 38;
  group.appendChild(el("rect", {
    x: xOffset + 18,
    y: laneY,
    width: item.w - 36,
    height: 28,
    rx: 8,
    fill: "rgba(255,255,255,0.28)",
  }));
  group.appendChild(el("text", {
    class: "node-micro",
    x: xOffset + item.w / 2,
    y: laneY + 18,
    "text-anchor": "middle",
  }, "LN  ·  MHSA"));
  group.appendChild(el("rect", {
    x: xOffset + 18,
    y: laneY + 44,
    width: item.w - 36,
    height: 28,
    rx: 8,
    fill: "rgba(255,255,255,0.2)",
  }));
  group.appendChild(el("text", {
    class: "node-micro",
    x: xOffset + item.w / 2,
    y: laneY + 62,
    "text-anchor": "middle",
  }, "MLP  ·  GELU"));
  group.appendChild(el("path", {
    d: `M${xOffset + 22} ${yOffset + 22} C${xOffset - 18} ${yOffset + item.h / 2}, ${xOffset - 18} ${yOffset + item.h / 2}, ${xOffset + 22} ${yOffset + item.h - 24}`,
    fill: "none",
    stroke: "rgba(255,255,255,0.58)",
    "stroke-width": 3,
    "stroke-linecap": "round",
    "stroke-dasharray": "5 7",
  }));
  group.appendChild(el("text", {
    class: "node-title compact",
    x: xOffset + item.w / 2,
    y: yOffset + item.h - 48,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: xOffset + item.w / 2,
    y: yOffset + item.h - 24,
    "text-anchor": "middle",
  }, item.subtitle));
  if (item.badge) {
    group.appendChild(el("rect", {
      x: xOffset + item.w - 54,
      y: yOffset + 14,
      width: 40,
      height: 26,
      rx: 7,
      fill: "#26323c",
    }));
    group.appendChild(el("text", {
      class: "node-micro",
      x: xOffset + item.w - 34,
      y: yOffset + 32,
      "text-anchor": "middle",
    }, item.badge));
  }
}

function drawAttention(group, item) {
  drawBlock(group, item);
  const headCount = 4;
  const gap = item.w / (headCount + 1);
  for (let i = 1; i <= headCount; i += 1) {
    group.appendChild(el("circle", {
      cx: gap * i,
      cy: 34,
      r: 13,
      fill: "rgba(255,255,255,0.42)",
      stroke: "rgba(23,32,31,0.18)",
    }));
  }
  group.appendChild(el("text", {
    class: "node-micro",
    x: item.w / 2,
    y: item.h - 22,
    "text-anchor": "middle",
  }, "Q · K · V"));
  const matrixX = item.w - 70;
  const matrixY = 58;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      group.appendChild(el("rect", {
        x: matrixX + col * 12,
        y: matrixY + row * 12,
        width: 10,
        height: 10,
        rx: 2,
        fill: row === col ? "rgba(255,255,255,0.74)" : "rgba(23,32,72,0.16)",
      }));
    }
  }
  group.appendChild(el("path", {
    d: `M30 ${item.h - 42} C${item.w * 0.32} ${item.h - 70}, ${item.w * 0.68} ${item.h - 16}, ${item.w - 28} ${item.h - 44}`,
    fill: "none",
    stroke: "rgba(255,255,255,0.62)",
    "stroke-width": 3,
    "stroke-linecap": "round",
  }));
  addOperationChips(group, item, item.w / 2, item.h + 30);
}

function addUnderText(group, item) {
  group.appendChild(el("text", {
    class: "node-title compact",
    x: item.w / 2,
    y: item.h + 26,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle compact",
    x: item.w / 2,
    y: item.h + 48,
    "text-anchor": "middle",
  }, item.subtitle));
}

function addOperationChips(group, item, centerX, y) {
  const chips = operationChipsFor(item);
  if (!chips.length) return false;
  const widths = chips.map((chip) => Math.max(28, chip.length * 6.5 + 16));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, chips.length - 1) * 6;
  let x = centerX - totalWidth / 2;
  chips.forEach((chip, index) => {
    const width = widths[index];
    group.appendChild(el("rect", {
      class: `op-chip-bg ${/^L\d+/.test(chip) ? "is-source" : ""}`,
      x,
      y: y - 16,
      width,
      height: 24,
      rx: 8,
    }));
    group.appendChild(el("text", {
      class: `op-chip ${/^L\d+/.test(chip) ? "is-source" : ""}`,
      x: x + width / 2,
      y,
      "text-anchor": "middle",
    }, chip));
    x += width + 6;
  });
  return true;
}

function operationChipsFor(item) {
  const chips = String(item.note || "")
    .split(/\s*·\s*|\s*\+\s*/)
    .map((chip) => chip.trim())
    .filter(Boolean)
    .filter((chip) => !/^editable|copy$|decode$|downsample$|pixels$|voxels$/i.test(chip));
  if (item.sourceLine && !chips.some((chip) => /^L\d+/.test(chip))) chips.push(`L${item.sourceLine}`);
  return [...new Set(chips)].slice(0, 4);
}

function addNodeNote(group, item, x, y) {
  if (!item.note) return;
  group.appendChild(el("text", {
    class: "node-note",
    x,
    y,
    "text-anchor": "middle",
  }, item.note));
}

function drawNeuron(group, item) {
  const radius = Math.min(item.w, item.h) / 2;
  group.appendChild(el("circle", {
    class: "node-shell",
    cx: radius,
    cy: radius,
    r: radius,
    fill: item.color,
  }));
  group.appendChild(el("circle", {
    cx: radius - 10,
    cy: radius - 12,
    r: Math.max(5, radius * 0.18),
    fill: "rgba(255,255,255,0.32)",
  }));
  group.appendChild(el("text", {
    class: "node-subtitle",
    x: radius,
    y: radius + 5,
    "text-anchor": "middle",
  }, item.subtitle || item.label));
}

function drawOutput(group, item) {
  const notch = 28;
  group.appendChild(el("polygon", {
    class: "node-shell",
    points: `${notch},0 ${item.w},0 ${item.w - notch},${item.h} 0,${item.h}`,
    fill: item.color,
  }));
  group.appendChild(el("path", {
    d: `M${notch + 10} 18 L${item.w - 22} 18 L${item.w - notch - 12} ${item.h - 18} L18 ${item.h - 18} Z`,
    fill: "rgba(255,255,255,0.14)",
  }));
  const bars = [0.72, 0.48, 0.86, 0.32];
  bars.forEach((value, index) => {
    group.appendChild(el("rect", {
      x: 24,
      y: 28 + index * 17,
      width: (item.w - 58) * value,
      height: 8,
      rx: 4,
      fill: "rgba(255,255,255,0.5)",
    }));
  });
  addCenteredText(group, item);
}

function addCenteredText(group, item, offsetX = 0, offsetY = 0) {
  group.appendChild(el("text", {
    class: "node-title",
    x: item.w / 2 + offsetX,
    y: item.h / 2 - 6 + offsetY,
    "text-anchor": "middle",
  }, item.label));
  group.appendChild(el("text", {
    class: "node-subtitle",
    x: item.w / 2 + offsetX,
    y: item.h / 2 + 22 + offsetY,
    "text-anchor": "middle",
  }, item.subtitle));
}

function drawEdge(item) {
  const source = getNode(item.source);
  const target = getNode(item.target);
  if (!source || !target) return el("g");

  const start = anchor(source, "right");
  const end = anchor(target, "left");
  const path = createEdgePath(start, end, item.type);
  const group = el("g", { "data-edge-id": item.id });
  const strokeWidth = item.type === "attention" ? 3.4 : item.type === "skip" ? 2.35 : 2.65;
  const visual = el("path", {
    class: `edge ${state.selected?.type === "edge" && state.selected.id === item.id ? "is-selected" : ""}`,
    d: path,
    stroke: item.color,
    "stroke-width": strokeWidth,
    "stroke-dasharray": item.type === "skip" ? "8 9" : "",
    "marker-end": markerForEdge(item.type),
  });
  const hit = el("path", { class: "edge-hit", d: path });
  hit.addEventListener("click", (event) => {
    event.stopPropagation();
    select({ type: "edge", id: item.id });
  });
  group.append(visual, hit);

  if (item.label) {
    const mid = edgeLabelPoint(start, end, item.type);
    const width = item.label.length * 7.2 + 22;
    group.appendChild(el("rect", {
      class: "edge-label-bg",
      x: mid.x - width / 2,
      y: mid.y - 17,
      width,
      height: 25,
      rx: 12,
    }));
    group.appendChild(el("text", {
      class: "edge-label",
      x: mid.x,
      y: mid.y,
      "text-anchor": "middle",
    }, item.label));
  }
  return group;
}

function drawConnectionPreview() {
  const source = getNode(state.connectPreview.source);
  if (!source) return el("g");
  const start = anchor(source, "right");
  const end = state.connectPreview.point;
  return el("path", {
    class: "edge edge-preview",
    d: createEdgePath(start, end, "attention"),
    stroke: "#2d6978",
    "stroke-width": 2.8,
    "marker-end": "url(#arrow-attention)",
  });
}

function createEdgePath(start, end, type = "signal") {
  const dx = end.x - start.x;

  if (type === "skip") {
    const lift = -Math.max(96, Math.min(210, Math.abs(dx) * 0.16));
    const midY = snap(Math.min(start.y, end.y) + lift);
    const startX = snap(start.x);
    const endX = snap(end.x);
    return [
      `M ${startX} ${snap(start.y)}`,
      `V ${midY}`,
      `H ${endX}`,
      `V ${snap(end.y)}`,
    ].join(" ");
  }

  if (type === "attention") {
    return `M ${snap(start.x)} ${snap(start.y)} L ${snap(end.x)} ${snap(end.y)}`;
  }

  if (Math.abs(start.y - end.y) <= 12) {
    return `M ${snap(start.x)} ${snap(start.y)} H ${snap(end.x)}`;
  }
  const midX = snap(start.x + dx / 2);
  return [
    `M ${snap(start.x)} ${snap(start.y)}`,
    `H ${midX}`,
    `V ${snap(end.y)}`,
    `H ${snap(end.x)}`,
  ].join(" ");
}

function edgeLabelPoint(start, end, type = "signal") {
  const x = (start.x + end.x) / 2;
  if (type === "skip") {
    return {
      x,
      y: snap(Math.min(start.y, end.y) - Math.max(96, Math.min(210, Math.abs(end.x - start.x) * 0.16))) - 14,
    };
  }
  return {
    x,
    y: (start.y + end.y) / 2 - 14,
  };
}

function markerForEdge(type) {
  if (type === "attention") return "url(#arrow-attention)";
  if (type === "skip") return "url(#arrow-skip)";
  return "url(#arrow)";
}

function startNodePointer(event, id) {
  if (state.connectMode) {
    handleNodeConnectStart(event, id);
    return;
  }
  const nodeItem = getNode(id);
  const point = toSvgPoint(event);
  state.drag = {
    id,
    offsetX: point.x - nodeItem.x,
    offsetY: point.y - nodeItem.y,
  };
  svg.setPointerCapture(event.pointerId);
  select({ type: "node", id });
}

function startResize(event, id, corner) {
  event.stopPropagation();
  const item = getNode(id);
  if (!item) return;
  const point = toSvgPoint(event);
  state.resize = {
    id,
    corner,
    startPoint: point,
    start: {
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    },
  };
  svg.setPointerCapture(event.pointerId);
  select({ type: "node", id });
  setStatus("拖动控制点调整节点尺寸");
}

function handleNodeConnectStart(event, id) {
  event.stopPropagation();
  const point = toSvgPoint(event);
  state.connectSource = id;
  state.connectPreview = { source: id, point };
  select({ type: "node", id });
  svg.setPointerCapture(event.pointerId);
  setStatus("拖到目标节点后松开，即可绘制连接线");
}

function resizeSelectedNode(point) {
  const active = state.resize;
  const item = getNode(active.id);
  if (!item) return;
  const dx = point.x - active.startPoint.x;
  const dy = point.y - active.startPoint.y;
  const minW = item.type === "neuron" ? 42 : 58;
  const minH = item.type === "neuron" ? 42 : 44;
  const maxW = item.type === "volume" || item.type === "volume-stack" ? 360 : 320;
  const maxH = item.type === "volume" || item.type === "volume-stack" ? 300 : 260;
  let next = { ...active.start };

  if (active.corner.includes("e")) {
    next.w = clamp(active.start.w + dx, minW, maxW);
  }
  if (active.corner.includes("s")) {
    next.h = clamp(active.start.h + dy, minH, maxH);
  }
  if (active.corner.includes("w")) {
    next.w = clamp(active.start.w - dx, minW, maxW);
    next.x = active.start.x + active.start.w - next.w;
  }
  if (active.corner.includes("n")) {
    next.h = clamp(active.start.h - dy, minH, maxH);
    next.y = active.start.y + active.start.h - next.h;
  }

  if (state.snapToGrid) {
    next.x = snap(next.x);
    next.y = snap(next.y);
    next.w = snap(next.w);
    next.h = snap(next.h);
  }

  item.x = clamp(next.x, 20, canvasSize.width - next.w - 20);
  item.y = clamp(next.y, 20, canvasSize.height - next.h - 20);
  item.w = next.w;
  item.h = next.h;
  state.guides = createAlignmentGuides(item);
}

function createAlignmentGuides(active) {
  const guides = [];
  const activeBounds = getNodeBounds(active);
  const activeCenterX = (activeBounds.minX + activeBounds.maxX) / 2;
  const activeCenterY = (activeBounds.minY + activeBounds.maxY) / 2;
  const threshold = 8;

  state.nodes.forEach((item) => {
    if (item.id === active.id) return;
    const bounds = getNodeBounds(item);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    if (Math.abs(centerX - activeCenterX) <= threshold) {
      guides.push({
        x1: centerX,
        x2: centerX,
        y1: Math.min(bounds.minY, activeBounds.minY) - 36,
        y2: Math.max(bounds.maxY, activeBounds.maxY) + 36,
      });
    }
    if (Math.abs(centerY - activeCenterY) <= threshold) {
      guides.push({
        x1: Math.min(bounds.minX, activeBounds.minX) - 36,
        x2: Math.max(bounds.maxX, activeBounds.maxX) + 36,
        y1: centerY,
        y2: centerY,
      });
    }
  });

  return guides.slice(0, 4);
}

function handleNodeClick(event, id) {
  event.stopPropagation();
  if (state.suppressNextClick) return;
  if (!state.connectMode || state.connectPreview) {
    select({ type: "node", id });
    return;
  }

  if (!state.connectSource) {
    state.connectSource = id;
    select({ type: "node", id });
    setStatus("选择目标节点以创建连接");
    return;
  }

  if (state.connectSource !== id) {
    state.edges.push(createNumberedEdge(state.connectSource, id, "new link"));
    state.connectSource = null;
    persist();
    render();
    setStatus("连接已创建");
  }
}

svg.addEventListener("pointermove", (event) => {
  const point = toSvgPoint(event);
  if (state.resize) {
    resizeSelectedNode(point);
    render();
    return;
  }

  if (state.drag) {
    const item = getNode(state.drag.id);
    const nextX = clamp(point.x - state.drag.offsetX, 20, canvasSize.width - item.w - 20);
    const nextY = clamp(point.y - state.drag.offsetY, 20, canvasSize.height - item.h - 20);
    item.x = state.snapToGrid ? snap(nextX) : nextX;
    item.y = state.snapToGrid ? snap(nextY) : nextY;
    state.guides = createAlignmentGuides(item);
    render();
    return;
  }

  if (state.connectPreview) {
    state.connectPreview.point = point;
    render();
    return;
  }

  if (state.pan) {
    const dx = event.clientX - state.pan.startClientX;
    const dy = event.clientY - state.pan.startClientY;
    const scaleX = state.pan.startViewport.width / svg.clientWidth;
    const scaleY = state.pan.startViewport.height / svg.clientHeight;
    setViewport({
      ...state.pan.startViewport,
      x: state.pan.startViewport.x - dx * scaleX,
      y: state.pan.startViewport.y - dy * scaleY,
    });
  }
});

svg.addEventListener("pointerup", (event) => {
  if (state.resize) {
    state.resize = null;
    state.guides = [];
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be gone if the cursor left the SVG.
    }
    persist();
    render();
    setStatus("节点尺寸已更新");
    return;
  }

  if (state.connectPreview) {
    finishConnection(event);
    return;
  }

  if (state.pan) {
    state.pan = null;
    svg.classList.remove("is-panning");
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be gone if the cursor left the SVG.
    }
    return;
  }

  if (!state.drag) return;
  state.drag = null;
  state.guides = [];
  try {
    svg.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture may already be gone if the cursor left the SVG.
  }
  persist();
});

svg.addEventListener("pointerdown", (event) => {
  if (event.target.closest?.(".node")) return;
  if (event.target.closest?.(".edge-hit")) return;
  if (state.panMode || event.button === 1 || event.shiftKey) {
    state.pan = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: { ...state.viewport },
    };
    svg.classList.add("is-panning");
    svg.setPointerCapture(event.pointerId);
    return;
  }
  if (state.connectMode) {
    state.connectSource = null;
    state.connectPreview = null;
    setStatus("连接模式：从一个节点拖到另一个节点");
  }
});

svg.addEventListener("click", (event) => {
  if (state.panMode || state.connectMode) return;
  if (event.target === svg || event.target.closest?.(".stage-layer")) select(null);
});

svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 0.9 : 1.1;
  zoomAt(event, factor);
}, { passive: false });

svg.addEventListener("dblclick", (event) => {
  zoomAt(event, 0.82);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Delete" || event.key === "Backspace") {
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    deleteSelected();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    if (adjustSelectedStackPart(1)) event.preventDefault();
  }
  if (event.key === "-" || event.key === "_") {
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    if (adjustSelectedStackPart(-1)) event.preventDefault();
  }
});

renderModelLibrary();

document.querySelectorAll("[data-palette]").forEach((button) => {
  button.addEventListener("click", () => applyPalette(button.dataset.palette));
});

document.querySelector("#addLayerButton").addEventListener("click", addNeuronLayer);
document.querySelector("#addBlockButton").addEventListener("click", addBlock);
document.querySelector("#addVolumeButton").addEventListener("click", addVolume);
document.querySelector("#autoLayoutButton").addEventListener("click", autoLayout);
document.querySelector("#togglePanelsButton").addEventListener("click", togglePanels);
document.querySelector("#panButton").addEventListener("click", togglePanMode);
document.querySelector("#snapButton").addEventListener("click", toggleSnapToGrid);
document.querySelector("#zoomInButton").addEventListener("click", () => zoomAtCenter(0.82));
document.querySelector("#zoomOutButton").addEventListener("click", () => zoomAtCenter(1.18));
document.querySelector("#zoomResetButton").addEventListener("click", resetZoom);
document.querySelector("#fitButton").addEventListener("click", () => fitToContent());
document.querySelector("#deleteButton").addEventListener("click", deleteSelected);
document.querySelector("#resetButton").addEventListener("click", () => loadTemplate("hybrid", { message: "画布已重置为 Hybrid ViT 模板" }));

connectButton.addEventListener("click", () => {
  state.connectMode = !state.connectMode;
  state.connectSource = null;
  state.connectPreview = null;
  state.panMode = false;
  connectButton.classList.toggle("is-active", state.connectMode);
  document.querySelector("#panButton").classList.remove("is-active");
  svg.classList.toggle("is-connect-mode", state.connectMode);
  svg.classList.remove("is-pan-mode");
  render();
  setStatus(state.connectMode ? "连接模式：从一个节点拖到另一个节点" : "连接模式已关闭");
});

document.querySelector("#exportSvgButton").addEventListener("click", exportSvg);
document.querySelector("#exportPngButton").addEventListener("click", exportPng);
document.querySelector("#saveJsonButton").addEventListener("click", exportJson);
document.querySelector("#importJsonInput").addEventListener("change", importJson);
minimap.addEventListener("pointerdown", handleMinimapPointer);
minimap.addEventListener("keydown", handleMinimapKeydown);

bindInspector();
setupAIWorkflow({ applyDiagramDocument, setStatus });
setupCodeWorkflow({ applyDiagramDocument, setStatus });
window.synapseApplyAgentDiagram = applyAgentDiagram;
window.__synapseTestApply = applyDiagramDocument;
const previewTemplate = new URLSearchParams(window.location.search).get("previewTemplate");
if (previewTemplate && modelLibrary.some((item) => item.id === previewTemplate)) {
  loadTemplate(previewTemplate, { render: false, persist: false, message: `预览 ${previewTemplate} 模板，不覆盖当前草稿` });
} else {
  restore();
}
render();
updatePaletteSelection();
focusArchitecture({ silent: true });

function bindInspector() {
  const nodeFields = {
    label: document.querySelector("#nodeLabelInput"),
    subtitle: document.querySelector("#nodeSubtitleInput"),
    type: document.querySelector("#nodeTypeInput"),
    color: document.querySelector("#nodeColorInput"),
    w: document.querySelector("#nodeWidthInput"),
    h: document.querySelector("#nodeHeightInput"),
    depth: document.querySelector("#nodeDepthInput"),
    z: document.querySelector("#nodeZInput"),
    layers: document.querySelector("#nodeLayersInput"),
    note: document.querySelector("#nodeNoteInput"),
  };

  Object.entries(nodeFields).forEach(([key, input]) => {
    input.addEventListener("input", () => {
      if (state.selected?.type !== "node" && state.selected?.type !== "stackPart") return;
      const item = getNode(state.selected.id);
      item[key] = ["w", "h", "depth", "z", "layers"].includes(key) ? Number(input.value) : input.value;
      persist();
      render();
    });
  });

  const edgeFields = {
    label: document.querySelector("#edgeLabelInput"),
    color: document.querySelector("#edgeColorInput"),
    type: document.querySelector("#edgeTypeInput"),
  };

  Object.entries(edgeFields).forEach(([key, input]) => {
    input.addEventListener("input", () => {
      if (state.selected?.type !== "edge") return;
      const item = getEdge(state.selected.id);
      item[key] = input.value;
      persist();
      render();
    });
  });
}

function updateInspector() {
  const title = document.querySelector("#inspectorTitle");
  const hint = document.querySelector("#inspectorHint");
  const nodePanel = document.querySelector("#nodeInspector");
  const edgePanel = document.querySelector("#edgeInspector");
  nodePanel.classList.add("is-hidden");
  edgePanel.classList.add("is-hidden");

  if (!state.selected) {
    title.textContent = "未选择元素";
    hint.textContent = "点击节点、连接线，或点击卷积/全连接内部的某个堆叠单元进行编辑。";
    return;
  }

  if (state.selected.type === "stackPart") {
    const item = getNode(state.selected.id);
    title.textContent = `${item.label} · #${state.selected.index + 1}`;
    hint.textContent = `堆叠单元：${item.type}，+ 增加，Delete / - 减少，滑块可精确设置总数。`;
    nodePanel.classList.remove("is-hidden");
    document.querySelector("#nodeLabelInput").value = item.label;
    document.querySelector("#nodeSubtitleInput").value = item.subtitle || "";
    document.querySelector("#nodeTypeInput").value = item.type;
    document.querySelector("#nodeColorInput").value = item.color;
    document.querySelector("#nodeWidthInput").value = item.w;
    document.querySelector("#nodeHeightInput").value = item.h;
    document.querySelector("#nodeDepthInput").value = item.depth || 48;
    document.querySelector("#nodeZInput").value = item.z || 42;
    document.querySelector("#nodeLayersInput").value = item.layers || 3;
    document.querySelector("#nodeNoteInput").value = item.note || "";
    return;
  }

  if (state.selected.type === "node") {
    const item = getNode(state.selected.id);
    title.textContent = item.label;
    hint.textContent = `节点 ID：${item.id}`;
    nodePanel.classList.remove("is-hidden");
    document.querySelector("#nodeLabelInput").value = item.label;
    document.querySelector("#nodeSubtitleInput").value = item.subtitle || "";
    document.querySelector("#nodeTypeInput").value = item.type;
    document.querySelector("#nodeColorInput").value = item.color;
    document.querySelector("#nodeWidthInput").value = item.w;
    document.querySelector("#nodeHeightInput").value = item.h;
    document.querySelector("#nodeDepthInput").value = item.depth || 48;
    document.querySelector("#nodeZInput").value = item.z || 42;
    document.querySelector("#nodeLayersInput").value = item.layers || 3;
    document.querySelector("#nodeNoteInput").value = item.note || "";
    return;
  }

  const item = getEdge(state.selected.id);
  title.textContent = "连接线";
  hint.textContent = `${getNode(item.source)?.label || item.source} → ${getNode(item.target)?.label || item.target}`;
  edgePanel.classList.remove("is-hidden");
  document.querySelector("#edgeLabelInput").value = item.label || "";
  document.querySelector("#edgeColorInput").value = item.color;
  document.querySelector("#edgeTypeInput").value = item.type;
}

function renderMinimap() {
  if (!minimap) return;
  minimap.replaceChildren();
  const scale = getMinimapScale();
  const palette = palettes[state.paletteName] || palettes[defaultPaletteName];

  minimap.appendChild(el("rect", {
    class: "minimap-artboard",
    x: artboard.x * scale.x,
    y: artboard.y * scale.y,
    width: artboard.width * scale.x,
    height: artboard.height * scale.y,
    rx: 3,
  }));

  state.nodes.forEach((item) => {
    const bounds = getNodeBounds(item);
    minimap.appendChild(el("rect", {
      class: `minimap-node ${state.selected?.type === "node" && state.selected.id === item.id ? "is-selected" : ""}`,
      x: bounds.minX * scale.x,
      y: bounds.minY * scale.y,
      width: Math.max(2.4, (bounds.maxX - bounds.minX) * scale.x),
      height: Math.max(2.4, (bounds.maxY - bounds.minY) * scale.y),
      rx: 1.8,
      fill: colorForNode(item, palette),
    }));
  });

  const center = {
    x: (state.viewport.x + state.viewport.width / 2) * scale.x,
    y: (state.viewport.y + state.viewport.height / 2) * scale.y,
  };
  minimap.appendChild(el("line", {
    class: "minimap-crosshair",
    x1: center.x,
    x2: center.x,
    y1: 0,
    y2: 150,
  }));
  minimap.appendChild(el("line", {
    class: "minimap-crosshair",
    x1: 0,
    x2: 260,
    y1: center.y,
    y2: center.y,
  }));
  minimap.appendChild(el("rect", {
    class: "minimap-viewport",
    x: state.viewport.x * scale.x,
    y: state.viewport.y * scale.y,
    width: state.viewport.width * scale.x,
    height: state.viewport.height * scale.y,
    rx: 2,
  }));
}

function handleMinimapPointer(event) {
  event.preventDefault();
  const point = minimapPoint(event);
  centerViewportOn(point.x, point.y);
  setStatus("已通过导航器定位画布区域");
}

function handleMinimapKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  fitToContent();
}

function minimapPoint(event) {
  const rect = minimap.getBoundingClientRect();
  const scale = getMinimapScale();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 260 / scale.x,
    y: ((event.clientY - rect.top) / rect.height) * 150 / scale.y,
  };
}

function centerViewportOn(x, y) {
  setViewport({
    ...state.viewport,
    x: x - state.viewport.width / 2,
    y: y - state.viewport.height / 2,
  });
}

function getMinimapScale() {
  return {
    x: 260 / canvasSize.width,
    y: 150 / canvasSize.height,
  };
}

function addNeuronLayer() {
  const palette = palettes[state.paletteName] || palettes[defaultPaletteName];
  const layerIndex = Math.max(0, ...state.nodes.map((item) => item.stage ?? 0)) + 1;
  const x = Math.min(artboard.x + artboard.width - 220, artboard.x + 130 + layerIndex * 280);
  const count = 5;
  const startY = artboard.y + artboard.height / 2 - (count - 1) * 46;
  const newNodes = [];
  for (let i = 0; i < count; i += 1) {
    const id = `node-${state.nextNodeId++}`;
    const created = createNode(id, "neuron", snap(x), snap(startY + i * 92), 64, 64, `Layer ${layerIndex}`, `n${i + 1}`, layerIndex >= 3 ? palette.output : palette.convA, layerIndex);
    newNodes.push(created);
    state.nodes.push(created);
  }
  const previous = state.nodes.filter((item) => item.stage === layerIndex - 1);
  previous.forEach((source) => {
    newNodes.forEach((target) => {
      state.edges.push(createNumberedEdge(source.id, target.id));
    });
  });
  select({ type: "node", id: newNodes[0].id });
  persist();
  render();
  focusArchitecture({ silent: true });
  setStatus("已添加神经元层");
}

function addBlock() {
  const palette = palettes[state.paletteName] || palettes[defaultPaletteName];
  const id = `node-${state.nextNodeId++}`;
  const stage = Math.max(0, ...state.nodes.map((item) => item.stage ?? 0)) + 1;
  const item = createNode(id, "encoder", snap(Math.min(artboard.x + artboard.width - 260, artboard.x + 130 + stage * 280)), artboard.y + 500, 190, 150, "Encoder", "LN · MHSA · MLP", stage % 2 ? palette.encoderA : palette.encoderB, stage, { layers: 4, badge: "xN" });
  state.nodes.push(item);
  if (state.selected?.type === "node") {
    state.edges.push(createNumberedEdge(state.selected.id, id));
  }
  select({ type: "node", id });
  persist();
  render();
  focusArchitecture({ silent: true });
  setStatus("已添加模块块");
}

function addVolume() {
  const palette = palettes[state.paletteName] || palettes[defaultPaletteName];
  const id = `node-${state.nextNodeId++}`;
  const stage = Math.max(0, ...state.nodes.map((item) => item.stage ?? 0)) + 1;
  const x = snap(Math.min(artboard.x + artboard.width - 320, artboard.x + 130 + stage * 280));
  const item = createNode(id, "volume-stack", x, artboard.y + 470, 132, 250, "3D Volume", "D x H x W", stage > 1 ? palette.convB : palette.convA, stage, {
    depth: 110,
    z: 76,
    layers: 5,
    note: "editable 3D block",
  });
  state.nodes.push(item);
  if (state.selected?.type === "node") {
    state.edges.push(createNumberedEdge(state.selected.id, id, "volume", "attention"));
  }
  select({ type: "node", id });
  persist();
  render();
  focusArchitecture({ silent: true });
  setStatus("已添加可编辑 3D 体块");
}

function applyPalette(name) {
  const paletteName = palettes[name] ? name : defaultPaletteName;
  const palette = palettes[paletteName];
  state.paletteName = paletteName;
  state.paletteVersion = paletteVersion;
  recolorDocument(palette);
  persist();
  render();
  updatePaletteSelection();
  setStatus(`已将 ${paletteName} 配色应用到神经网络图`);
}

function recolorDocument(palette) {
  state.nodes.forEach((item) => {
    item.color = colorForNode(item, palette);
  });
  state.edges.forEach((item) => {
    item.color = item.type === "skip" ? palette.skip : item.type === "attention" ? palette.attention : palette.signal;
  });
}

function colorForNode(item, palette) {
  if (item.type === "conv" || item.type === "volume-stack") return item.id.includes("2") || item.stage > 1 ? palette.convB : palette.convA;
  if (item.type === "volume") return item.stage >= 5 ? palette.output : palette.tensor;
  if (item.type === "pool") return palette.token;
  if (item.type === "flatten") return palette.attention;
  if (item.type === "dense-layer") return item.stage >= 5 ? palette.output : palette.encoderA;
  if (item.type === "concat") return palette.skip;
  if (item.type === "patch-grid") return palette.patch;
  if (item.type === "token") return palette.token;
  if (item.type === "encoder") return item.id.includes("2") ? palette.encoderB : palette.encoderA;
  if (item.type === "output") return palette.output;
  if (item.type === "neuron") return item.stage >= 3 ? palette.output : palette.convA;
  if (item.type === "block" || item.type === "attention") return palette.block;
  return palette.tensor;
}

function autoLayout() {
  const groups = new Map();
  state.nodes.forEach((item) => {
    const key = item.stage ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const layoutLeft = artboard.x + 130;
  const layoutRight = artboard.x + artboard.width - 260;
  const gapX = Math.min(360, (layoutRight - layoutLeft) / Math.max(1, ordered.length - 1));
  ordered.forEach(([stage, items], stageIndex) => {
    const totalHeight = items.reduce((sum, item) => sum + item.h, 0) + (items.length - 1) * 46;
    let y = Math.max(artboard.y + 260, artboard.y + artboard.height / 2 - totalHeight / 2);
    items.forEach((item) => {
      item.x = snap(layoutLeft + stageIndex * gapX);
      item.y = snap(y);
      item.stage = stage;
      y += item.h + 46;
    });
  });
  persist();
  render();
  focusArchitecture({ silent: true });
  setStatus("布局已重新美化");
}

function togglePanels() {
  const collapsed = appShell.classList.toggle("panels-collapsed");
  document.querySelector("#togglePanelsButton").textContent = collapsed ? "显示侧栏" : "隐藏侧栏";
  window.requestAnimationFrame(() => fitToContent({ silent: true }));
  setStatus(collapsed ? "侧栏已隐藏，画布空间已扩大" : "侧栏已显示");
}

function deleteSelected() {
  if (!state.selected) return;
  if (state.selected.type === "node") {
    const id = state.selected.id;
    state.nodes = state.nodes.filter((item) => item.id !== id);
    state.edges = state.edges.filter((item) => item.source !== id && item.target !== id);
  } else if (state.selected.type === "stackPart") {
    adjustSelectedStackPart(-1);
    return;
  } else {
    state.edges = state.edges.filter((item) => item.id !== state.selected.id);
  }
  state.selected = null;
  persist();
  render();
  setStatus("已删除选中元素");
}

function adjustSelectedStackPart(delta) {
  if (state.selected?.type !== "stackPart") return false;
  const item = getNode(state.selected.id);
  if (!item || !stackPartTypes.has(item.type)) return false;
  const current = item.layers || 1;
  const next = clamp(current + delta, 1, 64);
  if (next === current) return true;
  item.layers = next;
  if (state.selected.index >= item.layers) {
    state.selected.index = item.layers - 1;
  }
  persist();
  render();
  setStatus(`${item.label} 的可视堆叠数量已${delta > 0 ? "增加" : "减少"}到 ${item.layers}`);
  return true;
}

function focusArchitecture(options = {}) {
  if (!state.nodes.length) {
    setViewport({ x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height });
    return;
  }

  const padding = 82;
  const bounds = state.nodes.map(getNodeBounds).reduce((acc, item) => ({
    minX: Math.min(acc.minX, item.minX),
    minY: Math.min(acc.minY, item.minY),
    maxX: Math.max(acc.maxX, item.maxX),
    maxY: Math.max(acc.maxY, item.maxY),
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });

  bounds.minY = Math.min(bounds.minY, artboard.y + 290);
  bounds.maxY = Math.max(bounds.maxY, artboard.y + artboard.height - 260);
  const x = clamp(bounds.minX - padding, 0, canvasSize.width);
  const y = clamp(bounds.minY - padding, 0, canvasSize.height);
  const width = clamp(bounds.maxX - bounds.minX + padding * 2, 980, canvasSize.width - x);
  const height = clamp(bounds.maxY - bounds.minY + padding * 2, 620, canvasSize.height - y);
  setViewport({ x, y, width, height });
  if (!options.silent) setStatus("已聚焦到可编辑架构主体");
}

function fitToContent(options = {}) {
  if (!state.nodes.length) {
    setViewport({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height });
    return;
  }

  const padding = 170;
  const bounds = state.nodes.map(getNodeBounds).reduce((acc, item) => ({
    minX: Math.min(acc.minX, item.minX),
    minY: Math.min(acc.minY, item.minY),
    maxX: Math.max(acc.maxX, item.maxX),
    maxY: Math.max(acc.maxY, item.maxY),
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });

  bounds.minX = Math.min(bounds.minX, artboard.x + 38);
  bounds.minY = Math.min(bounds.minY, artboard.y + 34);
  bounds.maxX = Math.max(bounds.maxX, artboard.x + artboard.width - 38);
  bounds.maxY = Math.max(bounds.maxY, artboard.y + artboard.height - 38);
  const x = clamp(bounds.minX - padding, 0, canvasSize.width);
  const y = clamp(bounds.minY - padding, 0, canvasSize.height);
  const width = clamp(bounds.maxX - bounds.minX + padding * 2, 720, canvasSize.width - x);
  const height = clamp(bounds.maxY - bounds.minY + padding * 2, 460, canvasSize.height - y);
  setViewport({ x, y, width, height });
  if (!options.silent) setStatus("已聚焦到神经网络主体");
}

function setViewport(next) {
  const width = clamp(next.width, 300, canvasSize.width * 1.5);
  const height = clamp(next.height, 220, canvasSize.height * 1.5);
  const x = clamp(next.x, -canvasSize.width * 0.15, canvasSize.width - width + canvasSize.width * 0.15);
  const y = clamp(next.y, -canvasSize.height * 0.15, canvasSize.height - height + canvasSize.height * 0.15);
  state.viewport = { x, y, width, height };
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  updateZoomLabel();
  updateViewportReadout();
  renderMinimap();
}

function zoomAt(event, factor) {
  const point = toSvgPoint(event);
  zoomToward(point, factor);
}

function zoomAtCenter(factor) {
  zoomToward({
    x: state.viewport.x + state.viewport.width / 2,
    y: state.viewport.y + state.viewport.height / 2,
  }, factor);
}

function zoomToward(point, factor) {
  const nextWidth = clamp(state.viewport.width * factor, 340, canvasSize.width * 1.35);
  const nextHeight = clamp(state.viewport.height * factor, 240, canvasSize.height * 1.35);
  const ratioX = (point.x - state.viewport.x) / state.viewport.width;
  const ratioY = (point.y - state.viewport.y) / state.viewport.height;
  setViewport({
    x: point.x - nextWidth * ratioX,
    y: point.y - nextHeight * ratioY,
    width: nextWidth,
    height: nextHeight,
  });
  setStatus(`缩放 ${Math.round((canvasSize.width / state.viewport.width) * 100)}%`);
}

function resetZoom() {
  setViewport({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height });
  setStatus("缩放已重置为 100%");
}

function togglePanMode() {
  state.panMode = !state.panMode;
  state.connectMode = false;
  state.connectSource = null;
  state.connectPreview = null;
  document.querySelector("#panButton").classList.toggle("is-active", state.panMode);
  connectButton.classList.remove("is-active");
  svg.classList.toggle("is-pan-mode", state.panMode);
  svg.classList.remove("is-connect-mode");
  render();
  setStatus(state.panMode ? "拖动画布模式：按住空白处移动画布，滚轮缩放" : "拖动画布模式已关闭");
}

function toggleSnapToGrid() {
  state.snapToGrid = !state.snapToGrid;
  document.querySelector("#snapButton").classList.toggle("is-active", state.snapToGrid);
  setStatus(state.snapToGrid ? `网格吸附已开启：${gridSize}px` : "网格吸附已关闭");
}

function updateZoomLabel() {
  const label = document.querySelector("#zoomResetButton");
  if (!label) return;
  label.textContent = `${Math.round((canvasSize.width / state.viewport.width) * 100)}%`;
}

function updateViewportReadout() {
  if (!viewportReadout) return;
  const zoom = Math.round((canvasSize.width / state.viewport.width) * 100);
  viewportReadout.textContent = `x${Math.round(state.viewport.x)} y${Math.round(state.viewport.y)} · ${zoom}%`;
}

function finishConnection(event) {
  const point = toSvgPoint(event);
  const targetId = findNodeAt(point, state.connectPreview.source)?.id;
  const sourceId = state.connectPreview.source;

  if (targetId && targetId !== sourceId) {
    state.edges.push(createNumberedEdge(sourceId, targetId, "signal"));
    persist();
    setStatus("连接线已绘制");
  } else {
    setStatus("未连接：请拖到另一个节点上松开");
  }

  state.connectSource = null;
  state.connectPreview = null;
  state.suppressNextClick = true;
  window.setTimeout(() => {
    state.suppressNextClick = false;
  }, 80);
  try {
    svg.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture may already be gone if the cursor left the SVG.
  }
  render();
}

function findNodeAt(point, excludeId = null) {
  return [...state.nodes].reverse().find((item) => {
    if (item.id === excludeId) return false;
    const bounds = getNodeBounds(item);
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  });
}

function getNodeBounds(item) {
  const depth = item.depth || 0;
  let minX = item.x;
  let minY = item.y;
  let maxX = item.x + item.w;
  let maxY = item.y + item.h;

  if (item.type === "conv") {
    minY -= depth * 0.46;
    maxX += depth + 50;
    maxY += 42;
  }

  if (item.type === "pool") {
    maxY += 108;
  }

  if (item.type === "flatten" || item.type === "concat") {
    maxY += 58;
  }

  if (item.type === "encoder") {
    const offset = ((item.layers || 3) - 1) * 14;
    minY -= offset;
    maxX += offset;
  }

  if (item.type === "tensor") {
    maxX += depth || 18;
    maxY += item.note ? 42 : 0;
  }

  if (item.type === "volume" || item.type === "volume-stack") {
    const volumeDepth = item.depth || 78;
    const skew = (item.z || volumeDepth * 0.62) * 0.46;
    minY -= skew;
    maxX += volumeDepth;
    maxY += item.note ? 46 : 20;
  }

  if (item.type === "patch-grid") {
    maxY += 56;
  }

  return { minX, minY, maxX, maxY };
}

function exportSvg() {
  download("neural-network.svg", serializeCanvasSvg(), "image/svg+xml");
}

function exportPng() {
  const svgBlob = new Blob([serializeCanvasSvg()], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width * 2;
    canvas.height = canvasSize.height * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fbfaf5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const link = document.createElement("a");
      link.download = "neural-network.png";
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }, "image/png");
  };
  image.src = url;
}

function serializeCanvasSvg() {
  const copy = svg.cloneNode(true);
  copy.setAttribute("xmlns", ns);
  copy.setAttribute("width", canvasSize.width);
  copy.setAttribute("height", canvasSize.height);
  copy.insertBefore(exportStyleElement(), copy.firstChild);

  const background = el("rect", {
    width: canvasSize.width,
    height: canvasSize.height,
    rx: 0,
    fill: "#fbfaf5",
  });
  copy.insertBefore(background, copy.children[1] || null);

  return new XMLSerializer().serializeToString(copy);
}

function exportStyleElement() {
  const styles = el("style");
  styles.textContent = `
    .artboard-shell { fill: rgba(255,255,250,0.78); stroke: rgba(30,42,54,0.14); stroke-width: 1.4; }
    .artboard-inner { fill: none; stroke: rgba(30,42,54,0.08); stroke-dasharray: 12 16; stroke-width: 1.1; }
    .stage-band { fill: rgba(255,255,252,0.38); stroke: rgba(30,42,54,0.08); stroke-width: 1; }
    .figure-title { fill: #16202a; font-size: 24px; font-weight: 900; letter-spacing: -.03em; font-family: Avenir Next, PingFang SC, sans-serif; }
    .figure-subtitle, .axis-label, .legend-label { fill: rgba(32,44,55,.58); font-size: 12px; font-weight: 800; font-family: Avenir Next, PingFang SC, sans-serif; }
    .axis-tick { stroke: rgba(30,42,54,.14); stroke-linecap: round; }
    .stage-label { fill: rgba(32,44,55,.52); font-size: 12px; font-weight: 900; letter-spacing: .13em; font-family: Avenir Next, PingFang SC, sans-serif; }
    .stage-rule { stroke: rgba(38,59,88,.16); stroke-dasharray: 6 10; stroke-linecap: round; }
    .node-shell { stroke: rgba(30,42,54,0.28); stroke-width: 1.25; }
    .node-title { fill: #16202a; font-size: 18px; font-weight: 900; font-family: Avenir Next, PingFang SC, sans-serif; }
    .node-title.compact { font-size: 16px; }
    .node-subtitle { fill: rgba(32,44,55,0.64); font-size: 12px; font-weight: 700; font-family: Avenir Next, PingFang SC, sans-serif; }
    .node-subtitle.compact { font-size: 11px; }
    .node-micro { fill: rgba(255,255,255,0.76); font-size: 10px; font-weight: 800; letter-spacing: .08em; font-family: Avenir Next, PingFang SC, sans-serif; }
    .node-note { fill: rgba(38,50,60,.52); font-size: 11px; font-weight: 800; font-family: Avenir Next, PingFang SC, sans-serif; }
    .op-chip-bg { fill: rgba(255,255,255,.84); stroke: rgba(31,45,58,.14); stroke-width: .9; }
    .op-chip-bg.is-source { fill: rgba(31,45,58,.86); stroke: rgba(31,45,58,.25); }
    .op-chip { fill: rgba(31,45,58,.72); font-size: 9px; font-weight: 900; letter-spacing: .05em; font-family: Avenir Next, PingFang SC, sans-serif; }
    .op-chip.is-source { fill: rgba(255,255,255,.86); }
    .dimension-rule { stroke: rgba(31,45,58,.25); stroke-dasharray: 3 5; stroke-linecap: round; stroke-width: 1; }
    .dimension-label { fill: rgba(31,45,58,.56); font-size: 9px; font-weight: 900; letter-spacing: .04em; font-family: Avenir Next, PingFang SC, sans-serif; }
    .feature-slice, .encoder-card { stroke: rgba(30,42,54,.24); stroke-width: 1.2; }
    .feature-ridge { fill: none; stroke: rgba(255,255,255,.58); stroke-linecap: round; stroke-width: 2.2; }
    .volume-top, .volume-side { stroke: rgba(30,42,54,.2); stroke-linejoin: round; stroke-width: 1.2; }
    .volume-grid { stroke: rgba(255,255,255,.36); stroke-linecap: round; stroke-width: 1; }
    .edge { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .edge-hit { display: none; }
    .edge-label-bg { fill: rgba(255,255,250,.94); stroke: rgba(38,59,88,.12); }
    .edge-label { fill: rgba(32,44,55,.64); font-size: 11px; font-weight: 800; font-family: Avenir Next, PingFang SC, sans-serif; }
    .is-selected .node-shell, .edge.is-selected { stroke: inherit; stroke-width: inherit; }
  `;
  return styles;
}

function exportJson() {
  download("neural-network.json", JSON.stringify({ nodes: state.nodes, edges: state.edges, paletteName: state.paletteName, paletteVersion: state.paletteVersion, figure: state.figure }, null, 2), "application/json");
}

function importJson(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error("Invalid schema");
      }
      state.nodes = parsed.nodes;
      state.edges = parsed.edges;
      state.paletteName = palettes[parsed.paletteName] ? parsed.paletteName : defaultPaletteName;
      state.paletteVersion = Number.isFinite(parsed.paletteVersion) ? parsed.paletteVersion : paletteVersion;
      if (!palettes[parsed.paletteName]) recolorDocument(palettes[state.paletteName]);
      state.figure = parsed.figure || state.figure;
      state.selected = null;
      state.nextNodeId = state.nodes.length + 1;
      state.nextEdgeId = state.edges.length + 1;
      persist();
      render();
      setStatus("JSON 已导入");
    } catch {
      setStatus("导入失败：JSON 结构不正确");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus(`${filename} 已导出`);
}

function restore() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    loadTemplate("hybrid", { render: false, persist: false, message: "已加载默认 Hybrid ViT 模板" });
    return;
  }
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error("Invalid saved document");
    }
    state.nodes = parsed.nodes;
    state.edges = parsed.edges;
    state.paletteName = palettes[parsed.paletteName] ? parsed.paletteName : defaultPaletteName;
    state.paletteVersion = Number.isFinite(parsed.paletteVersion) ? parsed.paletteVersion : 1;
    state.figure = parsed.figure || state.figure;
    if (!palettes[parsed.paletteName] || state.paletteVersion < paletteVersion) {
      recolorDocument(palettes[state.paletteName]);
      state.paletteVersion = paletteVersion;
      persist();
    }
    state.selected = null;
    state.connectSource = null;
    state.connectMode = false;
    state.nextNodeId = state.nodes.length + 1;
    state.nextEdgeId = state.edges.length + 1;
    setStatus("已恢复上次编辑的画布");
  } catch {
    loadTemplate("hybrid", { render: false, persist: false, message: "旧草稿读取失败，已加载默认模板" });
  }
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify({ nodes: state.nodes, edges: state.edges, paletteName: state.paletteName, paletteVersion: state.paletteVersion, figure: state.figure }));
}

function select(selection) {
  state.selected = selection;
  render();
}

function setStatus(message) {
  statusText.textContent = message;
}

function getNode(id) {
  return state.nodes.find((item) => item.id === id);
}

function getEdge(id) {
  return state.edges.find((item) => item.id === id);
}

function anchor(item, side) {
  const point = localAnchor(item, side);
  return { x: item.x + point.x, y: item.y + point.y };
}

function localAnchor(item, side) {
  if (item.type === "neuron") {
    const r = Math.min(item.w, item.h) / 2;
    return {
      x: side === "right" ? r * 2 : 0,
      y: r,
    };
  }
  if (item.type === "conv") {
    const depth = item.depth || 58;
    return {
      x: side === "right" ? item.w + depth + 28 : 0,
      y: item.h / 2 - depth * 0.22,
    };
  }
  if (item.type === "pool") {
    return {
      x: side === "right" ? item.w : 0,
      y: item.h / 2,
    };
  }
  if (item.type === "flatten" || item.type === "dense-layer") {
    return {
      x: side === "right" ? item.w : 0,
      y: item.h / 2,
    };
  }
  if (item.type === "concat") {
    return {
      x: side === "right" ? item.w : 0,
      y: item.h / 2,
    };
  }
  if (item.type === "volume" || item.type === "volume-stack") {
    const depth = item.depth || 78;
    const skew = (item.z || depth * 0.62) * 0.46;
    return {
      x: side === "right" ? item.w + depth : 0,
      y: item.h / 2 + skew * 0.18,
    };
  }
  if (item.type === "encoder") {
    const offset = ((item.layers || 3) - 1) * 14;
    return {
      x: side === "right" ? item.w + offset : 0,
      y: item.h / 2 - offset / 2,
    };
  }
  return {
    x: side === "right" ? item.w : 0,
    y: item.h / 2,
  };
}

function toSvgPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function el(tag, attrs = {}, text = "") {
  const element = document.createElementNS(ns, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  });
  if (text) element.textContent = text;
  return element;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snap(value) {
  return Math.round(value / gridSize) * gridSize;
}

function lighten(hex, amount) {
  return shiftColor(hex, amount);
}

function darken(hex, amount) {
  return shiftColor(hex, -amount);
}

function shiftColor(hex, amount) {
  const normalized = hex.replace("#", "");
  const next = [0, 2, 4]
    .map((index) => {
      const channel = parseInt(normalized.slice(index, index + 2), 16);
      return clamp(channel + amount, 0, 255).toString(16).padStart(2, "0");
    })
    .join("");
  return `#${next}`;
}
