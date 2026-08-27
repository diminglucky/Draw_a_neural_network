import { createUniversalIR } from "./universal-ir.mjs";

const paletteName = "dopamine";

const nodePalette = {
  tensor: "#00e5ff",
  conv: "#ff2aa3",
  conv2: "#ff9f1c",
  pool: "#ffe94a",
  flatten: "#00e5ff",
  dense: "#2f6bff",
  merge: "#00d4aa",
  attention: "#a855ff",
  output: "#ff4fd8",
};

const opPatterns = [
  {
    kind: "conv",
    regex: /\b(?:nn\.)?Conv([123])d\s*\(([^)]*)\)|\bConv([123])D\s*\(([^)]*)\)/gi,
    framework: "both",
  },
  {
    kind: "pool",
    regex: /\b(?:nn\.)?(MaxPool|AvgPool|AdaptiveAvgPool)([123])d\s*\(([^)]*)\)|\b(MaxPooling|AveragePooling)([123])D\s*\(([^)]*)\)/gi,
    framework: "both",
  },
  {
    kind: "norm",
    regex: /\b(?:nn\.)?(BatchNorm|LayerNorm|GroupNorm)([123])?d?\s*\(([^)]*)\)|\b(BatchNormalization|LayerNormalization)\s*\(([^)]*)\)/gi,
    framework: "both",
  },
  {
    kind: "activation",
    regex: /\b(?:nn\.|F\.)?(ReLU|GELU|SiLU|LeakyReLU|Sigmoid|Tanh|Softmax)\s*\(([^)]*)\)|\bActivation\s*\(\s*["']([^"']+)["']/gi,
    framework: "both",
  },
  {
    kind: "flatten",
    regex: /\b(?:nn\.)?Flatten\s*\(([^)]*)\)|\btorch\.flatten\s*\(|\.flatten\s*\(|\.view\s*\(|\.reshape\s*\(/gi,
    framework: "both",
  },
  {
    kind: "dense",
    regex: /\b(?:nn\.)?Linear\s*\(([^)]*)\)|\bDense\s*\(([^)]*)\)/gi,
    framework: "both",
  },
  {
    kind: "concat",
    regex: /\btorch\.cat\s*\(|\bConcatenate\s*\(|\bconcatenate\s*\(/gi,
    framework: "both",
  },
  {
    kind: "add",
    regex: /\bAdd\s*\(|\btorch\.add\s*\(|\w+\s*=\s*\w+\s*\+\s*\w+/gi,
    framework: "both",
  },
  {
    kind: "attention",
    regex: /\b(?:nn\.)?MultiheadAttention\s*\(([^)]*)\)|\bAttention\s*\(|\bMultiHeadAttention\s*\(([^)]*)\)/gi,
    framework: "both",
  },
  {
    kind: "upsample",
    regex: /\b(?:nn\.)?(ConvTranspose|Upsample)([123])d?\s*\(([^)]*)\)|\bUpSampling([123])D\s*\(([^)]*)\)|\bConv([123])DTranspose\s*\(([^)]*)\)/gi,
    framework: "both",
  },
];

export function setupCodeWorkflow({ applyDiagramDocument, setStatus, analyzeArchitectureInput }) {
  const textarea = document.querySelector("#modelCodeInput");
  const frameworkInput = document.querySelector("#codeFrameworkInput");
  const generateButton = document.querySelector("#codeGenerateButton");
  const fileInput = document.querySelector("#codeFileInput");
  const codeStatus = document.querySelector("#codeStatusText");

  if (!textarea || !generateButton || !frameworkInput) return;

  generateButton.addEventListener("click", () => {
    const source = textarea.value.trim();
    if (!source) {
      updateCodeStatus(codeStatus, "请先粘贴 PyTorch / Keras 模型代码。");
      return;
    }

    const analysis = typeof analyzeArchitectureInput === "function"
      ? analyzeArchitectureInput({ kind: "source", framework: frameworkInput.value, source })
      : { status: "ready_for_preview", readyForPreview: true, canvasDocument: diagramFromCode(source, frameworkInput.value) };
    const document = analysis?.canvasDocument;
    if (!analysis?.readyForPreview || !document) {
      updateCodeStatus(codeStatus, formatAgentStatus(analysis));
      setStatus(formatAgentStatus(analysis));
      return;
    }

    const ok = applyDiagramDocument(document, { message: "已根据代码绘制可编辑神经网络图" });
    updateCodeStatus(codeStatus, ok
      ? formatAgentStatus(analysis, document)
      : "代码解析结果没有通过画布校验。");
    if (ok) setStatus(`代码生成完成：${document.figure.title}${analysis.status === "needs_confirmation" ? "（部分结构待确认）" : ""}`);
  });

  fileInput?.addEventListener("change", async () => {
    const [file] = fileInput.files;
    if (!file) return;
    textarea.value = await file.text();
    updateCodeStatus(codeStatus, `已导入 ${file.name}，可以从代码绘制。`);
    fileInput.value = "";
  });
}

function formatCodeStatus(document) {
  const meta = document.meta || {};
  const parts = [
    `已解析 ${meta.layerCount || document.nodes.length - 1} 个语义层`,
    `${document.nodes.length} 个节点`,
    `${document.edges.length} 条连接`,
  ];
  if (meta.forwardOrdered) parts.push("按 forward 顺序");
  if (meta.skipCount) parts.push(`${meta.skipCount} 条 skip`);
  if (meta.concatCount) parts.push(`${meta.concatCount} 个 concat`);
  if (meta.shapeInferred) parts.push("已推断 shape");
  return `${parts.join("，")}。`;
}

export function diagramFromCode(source, framework = "auto") {
  const inferred = framework === "auto" ? inferFramework(source) : framework;
  const parsed = parseModelCode(source, inferred);
  const layers = compressSemanticLayers(parsed.operations);

  if (!layers.length) {
    return withUniversalIR(fallbackDiagram(source, inferred), source, inferred);
  }

  return withUniversalIR(buildDiagram(layers, {
    framework: inferred,
    source,
    modelName: detectModelName(source),
  }), source, inferred);
}

function formatAgentStatus(analysis, document = analysis?.canvasDocument) {
  if (!analysis) return "代码解析结果没有通过画布校验。";
  if (analysis.status === "invalid_input") {
    return `代码解析失败：${analysis.diagnostics?.[0]?.message || "输入无效"}`;
  }
  if (analysis.status === "needs_external_vision") {
    return "当前输入需要外部视觉分析器。";
  }
  const base = document ? formatCodeStatus(document) : "已生成架构预览";
  if (analysis.status === "needs_confirmation") {
    const count = analysis.summary?.unresolvedNodeCount || analysis.diagnostics?.filter((item) => item.kind === "dynamic-control-flow").length || 0;
    return `${base} 部分结构需要确认${count ? `（${count} 项）` : ""}。`;
  }
  return base;
}

function withUniversalIR(document, source, framework) {
  const diagnostics = dynamicControlFlowDiagnostics(source);
  const enriched = { ...document, diagnostics };
  return {
    ...enriched,
    diagnostics,
    ir: createUniversalIR(enriched, {
      sourceKind: framework,
      sourceName: document.meta?.modelName || detectModelName(source),
      source: { textLength: source.length },
    }),
  };
}

function dynamicControlFlowDiagnostics(source = "") {
  const diagnostics = [];
  if (/\bif\s+|\belse\s*:|torch\.cond|tf\.cond|lax\.cond/i.test(source)) {
    diagnostics.push({ kind: "dynamic-control-flow", severity: "warning", message: "Conditional execution may require runtime tracing to resolve all branches." });
  }
  if (/\bfor\s+|\bwhile\s+|range\s*\(/i.test(source)) {
    diagnostics.push({ kind: "dynamic-control-flow", severity: "warning", message: "Loop execution was statically approximated; provide an example input for exact expansion." });
  }
  return diagnostics;
}

function parseModelCode(source, framework) {
  if (framework === "pytorch") {
    const forwardOperations = parsePyTorchForward(source);
    if (forwardOperations.length) return { operations: forwardOperations };
  }

  return { operations: [...parseOperationMatches(source, framework), ...parseCustomLayerOperations(source, framework)].sort((a, b) => a.index - b.index) };
}

function parseCustomLayerOperations(source, framework) {
  const operations = [];
  const pattern = /(?:layers\.)?([A-Z][A-Za-z0-9_]*(?:Layer|Block|Fusion|Attention))\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1];
    if (/^(?:Conv|MaxPool|AvgPool|AdaptiveAvgPool|BatchNorm|LayerNorm|GroupNorm|Linear|Dense|Flatten|ReLU|GELU|SiLU|Sigmoid|Tanh|Softmax|MultiheadAttention|MultiHeadAttention|Upsample|ConvTranspose)/i.test(name)) continue;
    operations.push({
      kind: "custom",
      framework,
      text: match[0],
      args: match[0].slice(match[0].indexOf("(") + 1, -1),
      line: lineNumberAt(source, match.index),
      index: match.index,
      name,
      constructor: name,
      label: name,
      note: "custom operator · structure requires review",
    });
  }
  return operations;
}

function parseOperationMatches(source, framework, options = {}) {
  const operations = [];
  const includeKinds = options.includeKinds ? new Set(options.includeKinds) : null;
  const baseIndex = options.baseIndex || 0;
  const fullSource = options.fullSource || source;

  opPatterns.forEach((pattern) => {
    if (includeKinds && !includeKinds.has(pattern.kind)) return;
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(source))) {
      operations.push(operationFromMatch(pattern.kind, match, fullSource, framework, baseIndex));
    }
  });

  operations.sort((a, b) => a.index - b.index);
  return operations;
}

function parsePyTorchForward(source) {
  const definitions = collectPyTorchDefinitions(source);
  const forwardLines = extractForwardLines(source);
  const operations = [];
  const variableMap = new Map([["x", -1], ["input", -1], ["identity", -1], ["residual", -1], ["shortcut", -1]]);

  if (!definitions.size || !forwardLines.length) return operations;

  forwardLines.forEach(({ text, index }) => {
    const lineOperations = [];
    const outputVariable = assignedVariableFromLine(text);
    propagateAliasAssignment(text, variableMap);
    const selfCalls = [...text.matchAll(/self\.([A-Za-z_]\w*)\s*\(/g)]
      .map((match) => ({ name: match[1], index: match.index }))
      .filter((call) => definitions.has(call.name));

    selfCalls.forEach((call) => {
      definitions.get(call.name).forEach((operation, order) => {
        lineOperations.push({
          ...operation,
          index: index + call.index + order / 100,
          line: lineNumberAt(source, index),
          name: call.name,
          outputVariable,
          sourceOps: [operation.text],
        });
      });
    });

    lineOperations.push(...functionalForwardOperations(text, index, source));
    const hasExpandedSequence = lineOperations.some((operation) => operation.fromSequential);
    const orderedLineOperations = text.includes(";") || hasExpandedSequence
      ? lineOperations.sort((a, b) => a.index - b.index)
      : lineOperations.sort((a, b) => b.index - a.index);
    orderedLineOperations.forEach((operation) => {
      const mergeMeta = operation.mergeMeta;
      if (mergeMeta?.inputs?.length) {
        operation.skipSources = mergeMeta.inputs
          .map((name) => ({ name, operationIndex: variableMap.get(name) }))
          .filter((item) => Number.isFinite(item.operationIndex));
      }
      operations.push(operation);
      if (operation.outputVariable) {
        variableMap.set(operation.outputVariable, operations.length - 1);
      }
    });
  });

  return operations;
}

function propagateAliasAssignment(line, variableMap) {
  const match = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/);
  if (!match) return;
  const [, target, source] = match;
  if (variableMap.has(source)) variableMap.set(target, variableMap.get(source));
}

function assignedVariableFromLine(line) {
  const match = line.match(/^\s*([A-Za-z_]\w*)\s*=(?!=)/);
  return match?.[1] || "";
}

function collectPyTorchDefinitions(source) {
  const definitions = new Map();
  const constructorKinds = ["conv", "pool", "norm", "activation", "dense", "attention", "upsample", "flatten"];
  const sequentialRanges = collectPyTorchSequentialDefinitions(source, definitions, constructorKinds);
  const operations = parseOperationMatches(source, "pytorch", { includeKinds: constructorKinds });

  operations.forEach((operation) => {
    const line = sourceLineAt(source, operation.index);
    if (isInsideRanges(operation.index, sequentialRanges) || /nn\.Sequential\s*\(/.test(line)) return;
    const assignment = line.match(/self\.([A-Za-z_]\w*)\s*=/)?.[1];
    if (!assignment) return;
    if (!definitions.has(assignment)) definitions.set(assignment, []);
    definitions.get(assignment).push({ ...operation, name: assignment });
  });

  const customPattern = /self\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let customMatch;
  while ((customMatch = customPattern.exec(source))) {
    const [, name, constructor, args] = customMatch;
    if (definitions.has(name) || /^(?:Conv|MaxPool|AvgPool|Adaptive|BatchNorm|LayerNorm|GroupNorm|Linear|Flatten|ReLU|GELU|SiLU|Sigmoid|Tanh|Softmax|MultiheadAttention|Upsample|ConvTranspose)/i.test(constructor)) continue;
    const index = customMatch.index;
    definitions.set(name, [{
      kind: "custom",
      framework: "pytorch",
      text: customMatch[0],
      args,
      line: lineNumberAt(source, index),
      index,
      name,
      constructor,
      label: constructor,
      note: "custom operator · structure requires review",
    }]);
  }

  return definitions;
}

function collectPyTorchSequentialDefinitions(source, definitions, constructorKinds) {
  const ranges = [];
  const sequentialPattern = /self\.([A-Za-z_]\w*)\s*=\s*nn\.Sequential\s*\(/g;
  let match;
  while ((match = sequentialPattern.exec(source))) {
    const name = match[1];
    const openIndex = source.indexOf("(", match.index);
    const block = extractBalancedBlock(source, openIndex);
    if (!block) continue;
    const operations = parseOperationMatches(block.content, "pytorch", {
      includeKinds: constructorKinds,
      baseIndex: block.start,
      fullSource: source,
    }).map((operation, index) => ({
      ...operation,
      name: `${name}_${index + 1}`,
      fromSequential: true,
    }));
    if (operations.length) definitions.set(name, operations);
    ranges.push({ start: match.index, end: block.end });
  }
  return ranges;
}

function extractBalancedBlock(source, openIndex) {
  if (openIndex < 0 || source[openIndex] !== "(") return null;
  let depth = 0;
  let quote = "";
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const previous = source[i - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) {
      return {
        content: source.slice(openIndex + 1, i),
        start: openIndex + 1,
        end: i,
      };
    }
  }
  return null;
}

function isInsideRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index <= range.end);
}

function functionalForwardOperations(line, lineStart, source) {
  const operations = parseOperationMatches(line, "pytorch", {
    baseIndex: lineStart,
    fullSource: source,
    includeKinds: ["flatten", "concat", "add"],
  });

  if (/\bF\.(ReLU|GELU|SiLU|LeakyReLU|Sigmoid|Tanh|Softmax)\s*\(/i.test(line)) {
    operations.push(...parseOperationMatches(line, "pytorch", {
      baseIndex: lineStart,
      fullSource: source,
      includeKinds: ["activation"],
    }).filter((operation) => /\bF\./i.test(operation.text)));
  }

  operations.forEach((operation) => {
    const mergeMeta = mergeMetaFromLine(line, operation.kind);
    if (mergeMeta) operation.mergeMeta = mergeMeta;
  });

  return operations.sort((a, b) => a.index - b.index);
}

function mergeMetaFromLine(line, kind) {
  if (kind === "add") {
    const plus = line.match(/([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\+\s*([A-Za-z_]\w*)/);
    if (plus) return { output: plus[1], inputs: [plus[2], plus[3]], mode: "add" };
    const inplace = line.match(/([A-Za-z_]\w*)\s*\+=\s*([A-Za-z_]\w*)/);
    if (inplace) return { output: inplace[1], inputs: [inplace[1], inplace[2]], mode: "add" };
    const torchAdd = line.match(/([A-Za-z_]\w*)\s*=\s*torch\.add\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/);
    if (torchAdd) return { output: torchAdd[1], inputs: [torchAdd[2], torchAdd[3]], mode: "add" };
  }

  if (kind === "concat") {
    const cat = line.match(/([A-Za-z_]\w*)\s*=\s*(?:torch\.)?cat\s*\(\s*\[([^\]]+)\]/);
    if (cat) {
      return {
        output: cat[1],
        inputs: cat[2].split(",").map((item) => item.trim()).filter(Boolean),
        mode: "concat",
      };
    }
  }

  return null;
}

function extractForwardLines(source) {
  const match = /^([ \t]*)def\s+forward\s*\([^)]*\)\s*:/m.exec(source);
  if (!match) return [];
  const defIndent = indentationWidth(match[1]);
  const firstLineEnd = source.indexOf("\n", match.index);
  if (firstLineEnd === -1) return [];

  const lines = [];
  let cursor = firstLineEnd + 1;
  while (cursor < source.length) {
    const nextNewline = source.indexOf("\n", cursor);
    const end = nextNewline === -1 ? source.length : nextNewline;
    const text = source.slice(cursor, end);
    const trimmed = text.trim();
    const indent = indentationWidth(text);
    if (trimmed && indent <= defIndent && /^(def|class)\b/.test(trimmed)) break;
    lines.push({ text, index: cursor });
    if (nextNewline === -1) break;
    cursor = nextNewline + 1;
  }

  return lines;
}

function operationFromMatch(kind, match, source, framework, baseIndex = 0) {
  const text = match[0];
  const args = argsFromMatch(match);
  const index = baseIndex + match.index;
  const line = lineNumberAt(source, index);
  const assignment = nearestAssignment(source, index);
  const dimensionality = detectDimensionality(text, match);
  const base = {
    kind,
    framework,
    text,
    args,
    line,
    index,
    name: assignment || `${kind}${line}`,
    dim: dimensionality,
  };

  if (kind === "conv") return enrichConv(base);
  if (kind === "pool") return enrichPool(base);
  if (kind === "dense") return enrichDense(base);
  if (kind === "attention") return enrichAttention(base);
  if (kind === "upsample") return enrichUpsample(base);
  if (kind === "norm") return { ...base, label: normalizeOpLabel(text), note: normalizeOpLabel(text) };
  if (kind === "activation") return { ...base, label: activationName(text), note: activationName(text) };
  if (kind === "flatten") return { ...base, label: "Flatten", note: "flatten / reshape" };
  if (kind === "concat") return { ...base, label: "Concat", note: "torch.cat / concatenate" };
  if (kind === "add") return { ...base, label: "Add", note: "residual add" };
  return base;
}

function compressSemanticLayers(operations) {
  const layers = [];
  const pendingByStage = [];

  operations.forEach((op) => {
    const last = layers[layers.length - 1];
    if (op.kind === "norm" || op.kind === "activation") {
      const attachTarget = last && ["conv", "dense", "attention", "upsample"].includes(last.kind) ? last : pendingByStage[pendingByStage.length - 1];
      if (attachTarget) {
        attachTarget.ops.push(op.label);
        attachTarget.note = uniqueOps(attachTarget.ops).join(" · ");
        return;
      }
    }

    const semantic = {
      ...op,
      ops: op.note ? [op.note] : [],
      sourceOps: [op.text],
    };
    layers.push(semantic);
    if (["conv", "dense", "attention", "upsample"].includes(semantic.kind)) pendingByStage.push(semantic);
  });

  return layers;
}

function buildDiagram(layers, context) {
  const is3D = layers.some((item) => item.dim === 3 || item.kind === "upsample" && item.dim === 3);
  const inputShape = inferInputShapeObject(context.source, is3D, layers[0], context.framework);
  const shapedLayers = annotateLayerShapes(layers, inputShape, is3D);
  const nodes = [];
  const edges = [];
  const xStart = 250;
  const xStep = Math.max(210, Math.min(310, 2000 / Math.max(1, shapedLayers.length)));
  const centerY = is3D ? 632 : 652;
  const stages = ["Input"];

  nodes.push(makeNode({
    id: "code-input",
    type: is3D ? "volume" : "tensor",
    x: xStart,
    y: is3D ? 650 : 660,
    w: is3D ? 140 : 118,
    h: is3D ? 205 : 180,
    label: is3D ? "Input Volume" : "Input",
    subtitle: shapeLabel(inputShape),
    stage: 0,
    color: nodePalette.tensor,
    depth: is3D ? 72 : 22,
    z: is3D ? 54 : undefined,
    note: context.framework,
  }));

  shapedLayers.forEach((layer, index) => {
    const stage = index + 1;
    const x = Math.round(xStart + 220 + index * xStep);
    const node = layerToNode(layer, stage, x, centerY, is3D);
    nodes.push(node);
    stages.push(stageLabelFor(layer, stage));
  });

  for (let i = 0; i < nodes.length - 1; i += 1) {
    const source = nodes[i];
    const target = nodes[i + 1];
    const targetLayer = layers[i];
    edges.push(makeEdge(source.id, target.id, edgeLabelFor(targetLayer), edgeTypeFor(targetLayer)));
  }

  addSkipEdges(edges, nodes, shapedLayers);

  const modelName = context.modelName || `${titleCase(context.framework)} Model`;
  const skipCount = edges.filter((edge) => edge.type === "skip").length;
  return {
    figure: {
      title: `${modelName} Architecture`,
      subtitle: "Generated from source code with editable feature maps, operator chains, shapes, residuals, and merges",
      stages,
    },
    paletteName,
    nodes,
    edges,
    meta: {
      framework: context.framework,
      layerCount: shapedLayers.length,
      generatedFrom: "code",
      forwardOrdered: context.framework === "pytorch" && /def\s+forward\s*\(/.test(context.source),
      shapeInferred: shapedLayers.some((layer) => layer.shape),
      skipCount,
      concatCount: shapedLayers.filter((layer) => layer.kind === "concat").length,
      addCount: shapedLayers.filter((layer) => layer.kind === "add").length,
    },
  };
}

function layerToNode(layer, stage, x, centerY, is3D) {
  const channels = layer.outChannels || layer.filters || layer.units || layer.heads || 8;
  const height = heightForLayer(layer, channels, is3D);
  const y = Math.round(centerY - height / 2 + yOffsetForLayer(layer, stage));
  const common = {
    id: `code-${stage}-${slug(layer.name || layer.label || layer.kind)}`,
    x,
    y,
    w: widthForLayer(layer, is3D),
    h: height,
    label: labelForLayer(layer),
    subtitle: subtitleForLayer(layer),
    stage,
    note: noteForLayer(layer),
    sourceLine: layer.line,
    op: layer.kind,
  };

  if (layer.kind === "conv") {
    return makeNode({
      ...common,
      type: is3D || layer.dim === 3 ? "volume-stack" : "conv",
      color: stage > 2 ? nodePalette.conv2 : nodePalette.conv,
      depth: is3D || layer.dim === 3 ? 118 : depthForChannels(channels),
      z: is3D || layer.dim === 3 ? 82 : undefined,
      layers: visibleStackCount(channels),
      channels: `${channels || "C"} maps`,
    });
  }

  if (layer.kind === "upsample") {
    return makeNode({
      ...common,
      type: is3D || layer.dim === 3 ? "volume-stack" : "conv",
      color: "#00d4aa",
      depth: is3D || layer.dim === 3 ? 126 : 96,
      z: is3D || layer.dim === 3 ? 86 : undefined,
      layers: visibleStackCount(channels || 8),
      channels: `${channels || "C"} maps`,
    });
  }

  if (layer.kind === "pool") {
    return makeNode({
      ...common,
      type: "pool",
      y: Math.round(centerY - 46),
      w: 92,
      h: 92,
      color: nodePalette.pool,
    });
  }

  if (layer.kind === "flatten") {
    return makeNode({
      ...common,
      type: "flatten",
      w: 150,
      h: 148,
      y: Math.round(centerY - 74),
      color: nodePalette.flatten,
      layers: 18,
    });
  }

  if (layer.kind === "dense") {
    return makeNode({
      ...common,
      type: "dense-layer",
      w: 132,
      h: 218,
      y: Math.round(centerY - 109),
      color: layer.units && layer.units <= 10 ? nodePalette.output : nodePalette.dense,
      layers: visibleStackCount(layer.units || 8),
    });
  }

  if (layer.kind === "concat" || layer.kind === "add") {
    return makeNode({
      ...common,
      type: "concat",
      w: 82,
      h: 82,
      y: Math.round(centerY - 41),
      label: layer.kind === "add" ? "Add" : "Concat",
      color: nodePalette.merge,
    });
  }

  if (layer.kind === "attention") {
    return makeNode({
      ...common,
      type: "attention",
      w: 210,
      h: 138,
      y: Math.round(centerY - 69),
      color: nodePalette.attention,
      badge: layer.heads ? `${layer.heads}h` : undefined,
    });
  }

  return makeNode({
    ...common,
    type: "compound",
    compoundKind: "unresolved",
    w: 320,
    h: 250,
    label: layer.name || layer.label || "Custom operator",
    subtitle: layer.constructor ? `${layer.constructor} · unresolved` : "unresolved operator",
    color: nodePalette.attention,
  });
}

function addSkipEdges(edges, nodes, layers) {
  const mergeIndexes = layers
    .map((layer, index) => ({ layer, nodeIndex: index + 1 }))
    .filter((item) => item.layer.kind === "add" || item.layer.kind === "concat");

  mergeIndexes.forEach(({ layer, nodeIndex }, offset) => {
    const sourceIndex = skipSourceIndexForMerge(layers, nodeIndex - 1, offset);
    const source = nodes[sourceIndex];
    const target = nodes[nodeIndex];
    if (!source || !target || source.id === target.id) return;
    const label = mergeSkipLabel(layer);
    if (!edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.type === "skip")) {
      edges.push(makeEdge(source.id, target.id, label, "skip"));
    }
  });

  if (!mergeIndexes.length && /residual|shortcut|identity|skip/i.test(layers.map((item) => item.text || item.name).join(" "))) {
    const source = nodes.find((item) => item.type === "conv");
    const target = [...nodes].reverse().find((item) => item.type === "conv" || item.type === "concat");
    if (source && target && source.id !== target.id) {
      edges.push(makeEdge(source.id, target.id, "residual", "skip"));
    }
  }
}

function skipSourceIndexForMerge(layers, mergeLayerIndex, offset) {
  const mergeLayer = layers[mergeLayerIndex];
  const semanticSource = semanticSkipSourceIndex(mergeLayer, mergeLayerIndex);
  if (semanticSource !== null) return semanticSource;
  const lookback = mergeLayer?.kind === "concat" ? 5 : 4;
  const candidates = [];
  for (let i = mergeLayerIndex - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (["conv", "upsample", "pool", "attention"].includes(layer.kind)) candidates.push(i + 1);
    if (candidates.length >= lookback) break;
  }
  if (!candidates.length) return Math.max(1, mergeLayerIndex - 2);
  if (mergeLayer?.mergeMeta?.inputs?.length > 1) {
    return candidates[Math.min(candidates.length - 1, 1 + offset)] || candidates[candidates.length - 1];
  }
  return candidates[Math.min(candidates.length - 1, mergeLayer?.kind === "concat" ? 2 : 1)] || candidates[candidates.length - 1];
}

function semanticSkipSourceIndex(layer, mergeLayerIndex) {
  const sources = layer?.skipSources || [];
  if (!sources.length) return null;
  const sorted = [...sources]
    .filter((source) => source.operationIndex < mergeLayerIndex)
    .sort((a, b) => a.operationIndex - b.operationIndex);
  if (!sorted.length) return null;
  if (layer.kind === "add" && layer.mergeMeta?.output) {
    const sideBranch = sorted.find((source) => source.name !== layer.mergeMeta.output);
    if (sideBranch) return Math.max(0, sideBranch.operationIndex + 1);
  }
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const selected = layer.kind === "concat" && earliest.operationIndex !== latest.operationIndex ? earliest : latest;
  return Math.max(0, selected.operationIndex + 1);
}

function mergeSkipLabel(layer) {
  if (layer.mergeMeta?.inputs?.length > 1) {
    const [, skip] = layer.mergeMeta.inputs;
    if (skip) return layer.kind === "concat" ? `cat ${skip}` : skip;
  }
  return layer.kind === "add" ? "identity" : "skip concat";
}

function fallbackDiagram(source, framework) {
  const title = detectModelName(source) || `${titleCase(framework)} Model`;
  const nodes = [
    makeNode({
      id: "code-unresolved",
      type: "compound",
      compoundKind: "unresolved",
      x: 860,
      y: 625,
      w: 320,
      h: 250,
      label: "Unresolved source graph",
      subtitle: "No recognized operations; provide a trace or explicit IR",
      op: "UnresolvedSourceGraph",
      family: "custom",
      semanticRole: "unresolved_operator",
      stage: 0,
      color: nodePalette.attention,
      confidence: 0.15,
      evidence: [{ kind: "source", framework, textLength: source.length }],
      note: "source was not statically resolved",
    }),
  ];
  return {
    figure: {
      title: `${title} Architecture`,
      subtitle: "No stable topology was extracted; confirm the model or provide runtime evidence",
      stages: ["Unresolved"],
    },
    paletteName,
    nodes,
    edges: [],
    meta: { framework, layerCount: 0, generatedFrom: "code-unresolved", unresolved: true },
  };
}

function enrichConv(base) {
  const keras = /\bConv[123]D\b/.test(base.text);
  const positional = splitArgs(base.args);
  const values = numericArgs(base.args);
  const outChannels = keras
    ? namedNumber(base.args, "filters") || numericValue(positional[0]) || values[0]
    : namedNumber(base.args, "out_channels") || numericValue(positional[1]) || values[1] || values[0];
  const inChannels = keras ? undefined : namedNumber(base.args, "in_channels") || numericValue(positional[0]) || values[0];
  return {
    ...base,
    inChannels,
    outChannels,
    kernel: namedOrPositional(base.args, "kernel_size", keras ? 1 : 2) || namedOrPositional(base.args, "kernel", keras ? 1 : 2) || (keras ? positional[1] : positional[2]) || inferKernel(base.args),
    stride: namedOrPositional(base.args, "stride", null) || namedOrPositional(base.args, "strides", null) || "1",
    padding: namedOrPositional(base.args, "padding", null),
    label: `${base.dim || ""}D Conv`.trim(),
    note: "Conv",
  };
}

function enrichPool(base) {
  const firstPositional = splitArgs(base.args)[0]?.replace(/^\s*[A-Za-z_]\w*\s*=\s*/, "").trim();
  const kernel = namedOrPositional(base.args, "kernel_size", null) || namedOrPositional(base.args, "pool_size", null) || firstPositional || inferKernel(base.args) || "2";
  return {
    ...base,
    kernel,
    stride: namedOrPositional(base.args, "stride", null) || namedOrPositional(base.args, "strides", null) || kernel,
    label: /avg|average/i.test(base.text) ? "AvgPool" : "MaxPool",
    note: /adaptive/i.test(base.text) ? "adaptive pool" : "pool",
  };
}

function enrichDense(base) {
  const keras = /\bDense\b/.test(base.text);
  const positional = splitArgs(base.args);
  const values = numericArgs(base.args);
  return {
    ...base,
    inFeatures: keras ? undefined : namedNumber(base.args, "in_features") || numericValue(positional[0]) || values[0],
    units: keras
      ? namedNumber(base.args, "units") || numericValue(positional[0]) || values[0]
      : namedNumber(base.args, "out_features") || numericValue(positional[1]) || values[1] || values[0],
    label: keras ? "Dense" : "Linear",
    note: keras ? "Dense" : "Linear",
  };
}

function enrichAttention(base) {
  const values = numericArgs(base.args);
  return {
    ...base,
    embedDim: values[0],
    heads: namedNumber(base.args, "num_heads") || namedNumber(base.args, "heads") || values[1],
    label: "Multi-Head Attention",
    note: "Q · K · V",
  };
}

function enrichUpsample(base) {
  const positional = splitArgs(base.args);
  const values = numericArgs(base.args);
  return {
    ...base,
    outChannels: /Conv.*Transpose|Transpose/i.test(base.text)
      ? namedNumber(base.args, "out_channels") || numericValue(positional[1]) || values[1] || values[0]
      : undefined,
    kernel: namedOrPositional(base.args, "kernel_size", 2) || namedOrPositional(base.args, "size", 0),
    stride: namedOrPositional(base.args, "stride", null) || namedOrPositional(base.args, "scale_factor", null),
    label: /transpose/i.test(base.text) ? "Transposed Conv" : "Upsample",
    note: /transpose/i.test(base.text) ? "ConvTranspose" : "upsample",
  };
}

function labelForLayer(layer) {
  if (layer.kind === "conv") {
    const channels = layer.outChannels ? ` ${layer.outChannels}` : "";
    return layer.dim === 3 ? `3D Conv${channels}` : `Conv${channels}`;
  }
  if (layer.kind === "pool") return layer.label;
  if (layer.kind === "dense") return layer.units ? `${layer.label} ${layer.units}` : layer.label;
  if (layer.kind === "upsample") return layer.outChannels ? `UpConv ${layer.outChannels}` : layer.label;
  if (layer.kind === "attention") return layer.heads ? `MHSA ${layer.heads}h` : "MHSA";
  return layer.label || titleCase(layer.kind);
}

function subtitleForLayer(layer) {
  if (layer.shape) {
    const detail = parameterSummaryForLayer(layer);
    return detail ? `${shapeLabel(layer.shape)} · ${detail}` : shapeLabel(layer.shape);
  }

  if (layer.kind === "conv") {
    const parts = [];
    if (layer.inChannels || layer.outChannels) parts.push(`${layer.inChannels || "C"} -> ${layer.outChannels || "C"}`);
    if (layer.kernel) parts.push(`k${cleanTuple(layer.kernel)}`);
    if (layer.stride && layer.stride !== "1") parts.push(`s${cleanTuple(layer.stride)}`);
    return parts.join(" · ") || "feature maps";
  }
  if (layer.kind === "pool") return [layer.kernel && `k${cleanTuple(layer.kernel)}`, layer.stride && `s${cleanTuple(layer.stride)}`].filter(Boolean).join(" · ") || "downsample";
  if (layer.kind === "dense") return layer.inFeatures ? `${layer.inFeatures} -> ${layer.units || "units"}` : `${layer.units || "units"} units`;
  if (layer.kind === "flatten") return "N x features";
  if (layer.kind === "concat") return layer.mergeMeta?.inputs?.length ? `cat ${layer.mergeMeta.inputs.join(", ")}` : "channel merge";
  if (layer.kind === "add") return layer.mergeMeta?.inputs?.length ? `${layer.mergeMeta.inputs.join(" + ")}` : "identity + residual";
  if (layer.kind === "attention") return layer.embedDim ? `dim ${layer.embedDim}` : "QK^T / sqrt(d)";
  if (layer.kind === "upsample") return [layer.outChannels && `${layer.outChannels} maps`, layer.stride && `scale ${cleanTuple(layer.stride)}`].filter(Boolean).join(" · ") || "spatial upsample";
  return layer.name || "";
}

function parameterSummaryForLayer(layer) {
  if (layer.kind === "conv") {
    return [layer.kernel && `k${cleanTuple(layer.kernel)}`, layer.stride && layer.stride !== "1" && `s${cleanTuple(layer.stride)}`].filter(Boolean).join(" · ");
  }
  if (layer.kind === "pool") {
    return [layer.kernel && `k${cleanTuple(layer.kernel)}`, layer.stride && `s${cleanTuple(layer.stride)}`].filter(Boolean).join(" · ");
  }
  if (layer.kind === "upsample") {
    return layer.stride ? `scale ${cleanTuple(layer.stride)}` : "";
  }
  return "";
}

function annotateLayerShapes(layers, inputShape, is3D) {
  let current = { ...inputShape };
  return layers.map((layer) => {
    const shaped = { ...layer, inputShape: { ...current } };

    if (layer.kind === "conv") {
      current = convShape(current, layer, is3D);
      shaped.shape = { ...current };
    } else if (layer.kind === "pool") {
      current = poolShape(current, layer, is3D);
      shaped.shape = { ...current };
    } else if (layer.kind === "upsample") {
      current = upsampleShape(current, layer, is3D);
      shaped.shape = { ...current };
    } else if (layer.kind === "flatten") {
      current = flattenShape(current);
      shaped.shape = { ...current };
    } else if (layer.kind === "dense") {
      current = { kind: "vector", features: layer.units || current.features || "N" };
      shaped.shape = { ...current };
    } else if (layer.kind === "concat") {
      current = { ...current, channels: combineChannels(current.channels, current.channels) };
      shaped.shape = { ...current };
    } else if (layer.kind === "add") {
      shaped.shape = { ...current };
    } else if (layer.kind === "attention") {
      current = { kind: "sequence", tokens: current.tokens || "N", features: layer.embedDim || current.features || current.channels || "d" };
      shaped.shape = { ...current };
    }

    return shaped;
  });
}

function convShape(shape, layer, is3D) {
  const stride = numericOrOne(layer.stride);
  const next = { ...shape, kind: is3D || layer.dim === 3 ? "volume" : "image", channels: layer.outChannels || shape.channels || "C" };
  next.h = downDim(shape.h || "H", stride);
  next.w = downDim(shape.w || "W", stride);
  if (next.kind === "volume") next.d = downDim(shape.d || "D", stride);
  return next;
}

function poolShape(shape, layer, is3D) {
  const stride = numericOrOne(layer.stride) || numericOrOne(layer.kernel) || 2;
  const next = { ...shape, kind: is3D || layer.dim === 3 ? "volume" : "image" };
  next.h = downDim(shape.h || "H", stride);
  next.w = downDim(shape.w || "W", stride);
  if (next.kind === "volume") next.d = downDim(shape.d || "D", stride);
  return next;
}

function upsampleShape(shape, layer, is3D) {
  const scale = numericOrOne(layer.stride) || 2;
  const next = { ...shape, kind: is3D || layer.dim === 3 ? "volume" : "image", channels: layer.outChannels || shape.channels || "C" };
  next.h = upDim(shape.h || "H", scale);
  next.w = upDim(shape.w || "W", scale);
  if (next.kind === "volume") next.d = upDim(shape.d || "D", scale);
  return next;
}

function flattenShape(shape) {
  if (shape.kind === "vector") return shape;
  const dims = [shape.d, shape.h, shape.w, shape.channels].filter(Boolean);
  return {
    kind: "vector",
    features: dims.length ? dims.join("·") : "features",
  };
}

function inferInputShapeObject(source, is3D, firstLayer, framework) {
  const input = inputShapeFromSource(source, is3D);
  if (input) return input;
  const channels = firstLayer?.inChannels || (framework === "keras" ? firstLayer?.inputChannels : undefined) || "C";
  if (is3D) return { kind: "volume", d: "D", h: "H", w: "W", channels };
  return { kind: "image", h: "H", w: "W", channels };
}

function inputShapeFromSource(source, is3D) {
  const inputMatch = source.match(/(?:input_shape|shape)\s*=\s*\(?\[?([0-9,\s]+)\]?\)?/i);
  if (inputMatch) {
    const values = inputMatch[1].split(",").map((part) => Number(part.trim())).filter(Number.isFinite);
    if (values.length >= 4) return { kind: "volume", d: values[0], h: values[1], w: values[2], channels: values[3] };
    if (values.length >= 3) return { kind: "image", h: values[0], w: values[1], channels: values[2] };
  }

  const torchInput = source.match(/(?:randn|zeros|ones)\s*\(\s*(?:\d+\s*,\s*)?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/i);
  if (torchInput) {
    const [, c, a, b, d] = torchInput;
    if (d || is3D) return { kind: "volume", d: d || "D", h: a, w: b, channels: c };
    return { kind: "image", h: a, w: b, channels: c };
  }

  return null;
}

function shapeLabel(shape = {}) {
  if (shape.kind === "vector") return `${shape.features || "features"}-d`;
  if (shape.kind === "sequence") return `${shape.tokens || "N"} x ${shape.features || "d"}`;
  if (shape.kind === "volume") return `${shape.d || "D"} x ${shape.h || "H"} x ${shape.w || "W"} x ${shape.channels || "C"}`;
  return `${shape.h || "H"} x ${shape.w || "W"} x ${shape.channels || "C"}`;
}

function downDim(value, stride) {
  if (!stride || stride === 1) return value;
  if (typeof value === "number") return Math.max(1, Math.ceil(value / stride));
  if (/^\d+$/.test(String(value))) return Math.max(1, Math.ceil(Number(value) / stride));
  const simplified = multiplySymbolicDivisor(value, stride);
  return simplified || `${value}/${stride}`;
}

function upDim(value, scale) {
  if (!scale || scale === 1) return value;
  if (typeof value === "number") return value * scale;
  if (/^\d+$/.test(String(value))) return Number(value) * scale;
  const simplified = divideSymbolicDivisor(value, scale);
  if (simplified) return simplified;
  return `${value}x${scale}`;
}

function multiplySymbolicDivisor(value, stride) {
  const source = String(value);
  const match = source.match(/^([A-Z])(?:\/(\d+))?$/);
  if (!match) return "";
  const current = match[2] ? Number(match[2]) : 1;
  return `${match[1]}/${current * stride}`;
}

function divideSymbolicDivisor(value, scale) {
  const source = String(value);
  const match = source.match(/^([A-Z])\/(\d+)$/);
  if (!match) return "";
  const current = Number(match[2]);
  if (!Number.isFinite(current) || current % scale !== 0) return "";
  const next = current / scale;
  return next === 1 ? match[1] : `${match[1]}/${next}`;
}

function numericOrOne(value) {
  if (!value) return 1;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 1;
}

function combineChannels(a, b) {
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) + Number(b);
  if (!a) return b || "C";
  if (!b) return a;
  return `${a}+${b}`;
}

function noteForLayer(layer) {
  const baseOps = layer.ops?.length ? layer.ops : String(layer.note || "").split(/\s*·\s*/);
  const ops = uniqueOps(baseOps).filter(Boolean);
  if (layer.line) ops.push(`L${layer.line}`);
  return ops.slice(0, 4).join(" · ");
}

function edgeLabelFor(layer) {
  if (!layer) return "signal";
  if (layer.kind === "conv") return layer.outChannels ? `${layer.outChannels} maps` : "features";
  if (layer.kind === "pool") return "down";
  if (layer.kind === "flatten") return "flatten";
  if (layer.kind === "dense") return "logits";
  if (layer.kind === "concat") return "concat";
  if (layer.kind === "add") return "add";
  if (layer.kind === "attention") return "tokens";
  if (layer.kind === "upsample") return "up";
  return "signal";
}

function edgeTypeFor(layer) {
  if (!layer) return "signal";
  if (layer.kind === "flatten" || layer.kind === "attention" || layer.kind === "upsample") return "attention";
  return "signal";
}

function stageLabelFor(layer, stage) {
  if (layer.kind === "conv") return layer.dim === 3 ? `3D Conv ${stage}` : `Conv ${stage}`;
  if (layer.kind === "pool") return "Pool";
  if (layer.kind === "dense") return "Dense";
  if (layer.kind === "flatten") return "Flatten";
  if (layer.kind === "concat" || layer.kind === "add") return "Merge";
  if (layer.kind === "attention") return "Attention";
  if (layer.kind === "upsample") return "Upsample";
  return titleCase(layer.kind);
}

function makeNode(item) {
  return {
    subtitle: "",
    color: "#b79cff",
    ...item,
  };
}

function makeEdge(source, target, label = "", type = "signal") {
  return {
    id: `code-${source}-${target}-${type}`,
    source,
    target,
    label,
    type,
    color: type === "skip" ? "#00d4aa" : type === "attention" ? "#ff2aa3" : "#2846d8",
  };
}

function inferFramework(source) {
  if (/\btorch\b|nn\.Module|nn\.Conv|torch\.nn/i.test(source)) return "pytorch";
  if (/\bkeras\b|tensorflow|tf\.keras|layers\.Conv[123]D|[^A-Za-z_]Conv[123]D\s*\(|[^A-Za-z_]Dense\s*\(/.test(source)) return "keras";
  return "pytorch";
}

function detectModelName(source) {
  return source.match(/class\s+([A-Z]\w*)\s*\(/)?.[1]
    || source.match(/model\s*=\s*(?:Sequential|keras\.Sequential)\s*\(/i)?.[0]?.replace(/\s*=.*/, "")
    || source.match(/def\s+([A-Za-z]\w*)\s*\(/)?.[1]
    || "";
}

function inferInputShape(source, is3D) {
  const shapeMatch = source.match(/(?:input_shape|Input\s*\(\s*shape)\s*=\s*\(?\[?([^\])]+)/i);
  if (shapeMatch) return cleanTuple(shapeMatch[1]);
  const conv = source.match(/Conv[123]d\s*\(\s*(\d+)/i);
  if (conv) return is3D ? `D x H x W x ${conv[1]}` : `H x W x ${conv[1]}`;
  return is3D ? "D x H x W x C" : "H x W x C";
}

function nearestAssignment(source, index) {
  const line = sourceLineAt(source, index);
  return line.match(/(?:self\.)?([A-Za-z_]\w*)\s*=/)?.[1] || "";
}

function sourceLineAt(source, index) {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const lineEnd = source.indexOf("\n", index);
  return source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function indentationWidth(line = "") {
  const match = line.match(/^[ \t]*/)?.[0] || "";
  return [...match].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0);
}

function firstArgGroup(match) {
  return match.slice(1).find((part) => part && !/^\d$/.test(part) && !/^(MaxPool|AvgPool|AdaptiveAvgPool|MaxPooling|AveragePooling)$/i.test(part)) || "";
}

function argsFromMatch(match) {
  for (let i = match.length - 1; i >= 1; i -= 1) {
    const part = match[i];
    if (part && !/^[123]$/.test(part) && !/^(MaxPool|AvgPool|AdaptiveAvgPool|MaxPooling|AveragePooling|ConvTranspose|Upsample)$/i.test(part)) {
      return part;
    }
  }
  return firstArgGroup(match);
}

function detectDimensionality(text, match) {
  const explicit = text.match(/(?:Conv|Pool|Norm|Sampling|Transpose)([123])d?/i)?.[1]
    || match.slice(1).find((part) => /^[123]$/.test(part));
  return explicit ? Number(explicit) : 2;
}

function numericArgs(args = "") {
  return [...args.matchAll(/(?<![A-Za-z_])\d+(?:\.\d+)?/g)].map((item) => Number(item[0])).filter(Number.isFinite);
}

function numericValue(value = "") {
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function namedNumber(args = "", name) {
  const match = args.match(new RegExp(`${name}\\s*=\\s*(\\d+)`, "i"));
  return match ? Number(match[1]) : undefined;
}

function namedOrPositional(args = "", name, index) {
  const named = splitArgs(args).find((part) => new RegExp(`^\\s*${name}\\s*=`, "i").test(part));
  if (named) return named.replace(new RegExp(`^\\s*${name}\\s*=\\s*`, "i"), "").trim();
  const legacyNamed = args.match(new RegExp(`${name}\\s*=\\s*([^,\\)]+(?:\\([^\\)]*\\))?)`, "i"));
  if (legacyNamed) return legacyNamed[1].trim();
  if (index === null || index === undefined) return "";
  return splitArgs(args)[index]?.trim() || "";
}

function inferKernel(args = "") {
  const tuple = args.match(/\((\s*\d+\s*,\s*\d+(?:\s*,\s*\d+)?\s*)\)/);
  if (tuple) return tuple[1];
  return numericArgs(args)[0]?.toString() || "";
}

function splitArgs(args = "") {
  const result = [];
  let current = "";
  let depth = 0;
  for (const char of args) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

function normalizeOpLabel(text) {
  if (/BatchNorm/i.test(text)) return "BN";
  if (/LayerNorm/i.test(text)) return "LN";
  if (/GroupNorm/i.test(text)) return "GN";
  if (/BatchNormalization/i.test(text)) return "BN";
  if (/LayerNormalization/i.test(text)) return "LN";
  return "Norm";
}

function activationName(text) {
  const match = text.match(/(ReLU|GELU|SiLU|LeakyReLU|Sigmoid|Tanh|Softmax)|Activation\s*\(\s*["']([^"']+)/i);
  const value = match?.[1] || match?.[2] || "Activation";
  if (/^relu$/i.test(value)) return "ReLU";
  if (/^gelu$/i.test(value)) return "GELU";
  if (/^silu$/i.test(value)) return "SiLU";
  if (/^leakyrelu$/i.test(value)) return "LeakyReLU";
  return value.replace(/^./, (char) => char.toUpperCase());
}

function uniqueOps(ops) {
  return [...new Set(ops.filter(Boolean).map((item) => String(item).trim()))];
}

function cleanTuple(value = "") {
  return String(value)
    .replace(/[()]/g, "")
    .replace(/\s*,\s*/g, "x")
    .replace(/\s+/g, "");
}

function visibleStackCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 8;
  if (numeric <= 8) return Math.max(3, numeric);
  return Math.min(18, Math.max(6, Math.round(Math.log2(numeric) * 2)));
}

function depthForChannels(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 92;
  return Math.min(145, Math.max(72, 58 + Math.log2(Math.max(2, numeric)) * 11));
}

function heightForLayer(layer, channels, is3D) {
  if (layer.kind === "conv" || layer.kind === "upsample") {
    const numeric = Number(channels);
    const base = is3D || layer.dim === 3 ? 238 : 188;
    if (!Number.isFinite(numeric)) return base;
    return Math.min(is3D ? 330 : 285, Math.max(base, base + Math.log2(Math.max(2, numeric)) * 15));
  }
  return 140;
}

function widthForLayer(layer, is3D) {
  if (layer.kind === "conv") return is3D || layer.dim === 3 ? 108 : 78;
  if (layer.kind === "upsample") return is3D || layer.dim === 3 ? 106 : 80;
  return 150;
}

function yOffsetForLayer(layer, stage) {
  if (layer.kind === "pool") return 0;
  if (layer.kind === "concat" || layer.kind === "add") return 0;
  if (layer.kind === "upsample") return (stage % 2 ? -18 : 18);
  return stage % 2 ? -10 : 10;
}

function slug(value) {
  return String(value || "layer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "layer";
}

function titleCase(value) {
  return String(value || "").replace(/(^|\s)\w/g, (char) => char.toUpperCase());
}

function updateCodeStatus(element, message) {
  if (element) element.textContent = message;
}
