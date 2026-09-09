// Shape inference: static feature-map dimension propagation.
// Split out of generic-source-topology.mjs to isolate pure shape math
// from source-code topology extraction. Channels-last [H, W, C] convention
// (no batch dim), so tensor boxes shrink 224 -> 112 -> 56 -> ... while
// channels grow. Never guesses: returns null when a dimension is unknown.

// --- Shape inference -----------------------------------------------------
// Publication-grade architecture diagrams (PlotNeuralNet style) need the
// per-layer feature-map dimensions so tensor boxes shrink 224 → 112 → 56 →
// 28 → 14 → 7 while channels grow 3 → 64 → 128 → 256 → 512.  The static
// extractor never executes Python, so it propagates shapes analytically from
// constructor arguments plus a standard image input size.  Shapes use a
// channels-last [H, W, C] convention to match semantic-visual-grammar's
// spatialDimension/channelDimension heuristics.

const DEFAULT_INPUT_SHAPE = [224, 224, 3];

// LLM 可能输出带 batch 维的 shape（[1, 224, 224, 3] 或 [null, 224, 224, 3]），
// 而 shape 传播约定是 channels-last 无 batch 的 [H, W, C]。剥掉显式的 batch 维。
function normalizeInputShape(shape) {
  if (shape.length === 4 && (shape[0] === null || shape[0] === undefined || shape[0] === 1 || shape[0] === -1)) {
    return shape.slice(1);
  }
  return shape;
}

export function inferShapes(nodes, edges, options = {}) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge.source);
  }
  // The extractor emits nodes in execution order (input stage 0 first), so a
  // stage/order sort is already a topological order for these graphs.
  const ordered = [...nodes].sort((left, right) => (
    (Number(left.stage) - Number(right.stage)) || (Number(left.order) - Number(right.order))
  ));
  const shapeByNode = new Map();
  for (const node of ordered) {
    if (node.family === "input") {
      const explicit = node.shape?.output || node.attributes?.inputShape || node.attributes?.shape;
      const raw = Array.isArray(explicit) && explicit.length ? explicit : DEFAULT_INPUT_SHAPE;
      const seed = normalizeInputShape(raw);
      shapeByNode.set(node.id, [...seed]);
      continue;
    }
    const predecessors = (incoming.get(node.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const inputShape = predecessors[0];
    if (!inputShape) continue;
    const outputShape = computeOutputShape(node, inputShape, predecessors);
    if (outputShape && outputShape.length) shapeByNode.set(node.id, outputShape);
  }
  for (const node of nodes) {
    const shape = shapeByNode.get(node.id);
    if (shape && shape.length) node.shape = { output: shape };
  }
}

// 与 inferShapes 相同的传播逻辑，但记录每个「算不出 shape」节点的原因，
// 供闭环反馈使用——这是「验证」环节，让 LLM 输出的 IR 被规则验算并暴露矛盾。
export function diagnoseShapes(nodes, edges, options = {}) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge.source);
  }
  const ordered = [...nodes].sort((left, right) => (
    (Number(left.stage) - Number(right.stage)) || (Number(left.order) - Number(right.order))
  ));
  const shapeByNode = new Map();
  const issues = [];
  for (const node of ordered) {
    if (node.family === "input") {
      const explicit = node.shape?.output || node.attributes?.inputShape || node.attributes?.shape;
      const raw = Array.isArray(explicit) && explicit.length ? explicit : DEFAULT_INPUT_SHAPE;
      const seed = normalizeInputShape(raw);
      shapeByNode.set(node.id, [...seed]);
      continue;
    }
    const predecessors = (incoming.get(node.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const inputShape = predecessors[0];
    if (!inputShape) {
      if ((incoming.get(node.id) || []).length > 0) {
        issues.push({ kind: "no-input-shape", nodeId: node.id, op: node.op, family: node.family });
      }
      continue;
    }
    const outputShape = computeOutputShape(node, inputShape, predecessors);
    if (outputShape && outputShape.length) {
      shapeByNode.set(node.id, outputShape);
    } else {
      issues.push({
        kind: "shape-gap",
        nodeId: node.id,
        op: node.op,
        family: node.family,
        reason: classifyShapeGap(node, inputShape, predecessors),
      });
    }
  }
  for (const node of nodes) {
    const shape = shapeByNode.get(node.id);
    if (shape && shape.length) node.shape = { output: shape };
  }
  return { ok: issues.length === 0, issues, shapeByNode: Object.fromEntries(shapeByNode) };
}

function classifyShapeGap(node, inputShape, inputs) {
  const family = String(node.family || "");
  const op = String(node.op || "").toLowerCase();
  if (family === "merge") {
    const shapes = (inputs || []).filter(Boolean);
    if (!/concat|concatenate|cat|join/.test(op) && shapes.length > 1) {
      const first = shapes[0];
      if (shapes.some((shape) => !sameShape(shape, first))) return "mismatched-merge";
    }
  }
  if (family === "conv" || family === "dense" || family === "recurrent" || family === "graph") {
    const args = parseLayerArgs(node.attributes?.constructorArgs || node.subtitle || "");
    const missing = [];
    if (family === "conv") {
      if (!Number.isFinite(numericArg(args, 1))) missing.push("out_channels");
      const kernel = firstFinite(numericArg(args, 2), kwargNumber(args, "kernel_size"));
      if (!Number.isFinite(kernel)) missing.push("kernel_size");
    } else if (family === "dense") {
      const out = firstFinite(
        numericArg(args, 1), kwargNumber(args, "out_features"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(out)) missing.push("out_features");
    } else if (family === "recurrent") {
      const hidden = firstFinite(
        numericArg(args, 1), kwargNumber(args, "hidden_size"), kwargNumber(args, "hidden"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(hidden)) missing.push("hidden_size");
    } else if (family === "graph") {
      const out = firstFinite(
        numericArg(args, 1), kwargNumber(args, "out_features"), kwargNumber(args, "out_channels"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(out)) missing.push("out_features");
    }
    if (missing.length) return "missing-parameter";
  }
  return "unsupported-operator";
}

// 把诊断结果转成一段可供 LLM 自纠的自然语言反馈。
export function buildShapeFeedback(issues, shapeByNode = {}) {
  if (!issues || !issues.length) return "";
  const lines = ["Shape inference found the following inconsistencies in your IR:"];
  for (const issue of issues) {
    const where = `node "${issue.nodeId}" (${issue.op || issue.family})`;
    switch (issue.reason) {
      case "mismatched-merge":
        lines.push(`- ${where}: an element-wise merge (add/sum) receives branch shapes that do not match. Fix the branch tensors so both sides have identical dimensions, or mark the merge as concat if it is channel concatenation.`);
        break;
      case "missing-parameter":
        lines.push(`- ${where}: missing layer parameters (channels/kernel/out_features/hidden_size). Provide explicit numeric constructor arguments.`);
        break;
      case "unsupported-operator":
        lines.push(`- ${where}: the operator could not be shaped. Decompose it into primitive layers (conv/pool/dense/flatten/norm/activation/attention/merge) with explicit parameters.`);
        break;
      case "no-input-shape":
        lines.push(`- ${where}: no incoming tensor shape could be resolved (an upstream node is unresolved). Fix the upstream operator first.`);
        break;
      default:
        lines.push(`- ${where}: could not be shaped (${issue.reason || "unknown"}).`);
    }
  }
  lines.push("Return the corrected full IR JSON with the same figure/nodes/edges structure.");
  return lines.join("\n");
}

function computeOutputShape(node, inputShape, inputs = [inputShape]) {
  const family = String(node.family || "");
  const op = String(node.op || "").toLowerCase();
  const args = parseLayerArgs(node.attributes?.constructorArgs || node.subtitle || "");

  if (family === "activation" || family === "norm" || family === "dropout"
    || op === "relu" || op === "gelu" || op === "silu" || op === "sigmoid"
    || op === "tanh" || op === "softmax" || op === "batchnorm" || op === "batchnorm2d"
    || op === "layernorm" || op === "identity") {
    return inputShape;
  }

  if (family === "conv") return convShape(op, args, inputShape, node.attributes?.framework);

  if (family === "upsample") return upsampleShape(op, args, inputShape);

  if (family === "pool") return poolShape(op, args, inputShape);

  if (family === "merge") return mergeShape(op, inputs);

  if (family === "recurrent") return recurrentShape(op, args, inputShape);

  if (family === "graph") return graphShape(op, args, inputShape);

  if (family === "attention") {
    // Transformer 注意力：QKV 头拆分后再拼接回 d_model，输出保持输入形状（seq_len × d_model）。
    return inputShape;
  }

  if (family === "flatten" || op === "flatten" || op === "view" || op === "reshape") {
    if (op === "view" || op === "reshape") {
      const target = reshapeTarget(args, inputShape);
      if (target) return target;
    }
    const total = productOf(inputShape);
    return Number.isFinite(total) ? [total] : null;
  }

  if (family === "dense") {
    // PyTorch Linear(in, out) -> 位置 1；Keras Dense(units) -> 位置 0 或 units kwarg。
    const outFeatures = firstFinite(
      numericArg(args, 1),
      kwargNumber(args, "out_features"),
      numericArg(args, 0),
      kwargNumber(args, "units"),
    );
    return Number.isFinite(outFeatures) ? [Math.round(outFeatures)] : null;
  }

  if (family === "output") return inputShape;

  if (family === "custom" || node.compoundKind) {
    // Named composite modules (C2f / SPPF / Bottleneck, compoundKind "module")
    // are drawn as a single block. Resolution is preserved unless the LLM
    // supplied an explicit outputShape OR internalGraph evidence lets us
    // propagate through the subgraph exactly.
    if (node.compoundKind === "module") {
      const explicit = node.attributes?.outputShape;
      if (Array.isArray(explicit) && explicit.length) return explicit.map(Number);
      const hasInternal = Array.isArray(node.attributes?.internalGraph?.nodes)
        && node.attributes.internalGraph.nodes.length > 0;
      if (!hasInternal) return inputShape;
    }
    const inner = compoundShape(node, inputShape);
    if (inner && inner.length) return inner;
  }

  return null;
}

// 复合模块（C2f / SPPF / Bottleneck 等）：穿透 internalGraph，用模块输入 shape 作为
// 内部入口的 seed，在内部图上做一次拓扑 shape 传播，返回内部输出节点的 shape。
function compoundShape(node, inputShape) {
  const graph = node.attributes?.internalGraph || node.internalGraph;
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;
  const innerNodes = graph.nodes.map((child, index) => ({
    ...child,
    id: String(child.id || child.sourceNodeId || `inner-${index + 1}`),
    family: String(child.family || child.type || "custom").toLowerCase(),
    op: String(child.op || child.label || ""),
    attributes: child.attributes && typeof child.attributes === "object" ? child.attributes : {},
  }));
  const incoming = new Map(innerNodes.map((child) => [child.id, []]));
  const outgoing = new Map(innerNodes.map((child) => [child.id, []]));
  for (const edge of (Array.isArray(graph.edges) ? graph.edges : [])) {
    const source = String(edge.source || "");
    const target = String(edge.target || "");
    if (incoming.has(target)) incoming.get(target).push(source);
    if (outgoing.has(source)) outgoing.get(source).push(target);
  }
  const indegree = new Map(innerNodes.map((child) => [child.id, (incoming.get(child.id) || []).length]));
  const byId = new Map(innerNodes.map((child) => [child.id, child]));
  const queue = innerNodes.filter((child) => indegree.get(child.id) === 0);
  const shapeByNode = new Map();
  const visited = new Set();
  while (queue.length) {
    const child = queue.shift();
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    const predecessors = (incoming.get(child.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const childInput = predecessors[0] || (predecessors.length === 0 ? inputShape : undefined);
    if (childInput) {
      const output = computeOutputShape(child, childInput, predecessors);
      if (output && output.length) shapeByNode.set(child.id, output);
    }
    for (const target of (outgoing.get(child.id) || [])) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(byId.get(target));
    }
  }
  const sinks = innerNodes.filter((child) => (outgoing.get(child.id) || []).length === 0);
  const sinkShapes = sinks.map((child) => shapeByNode.get(child.id)).filter(Boolean);
  return sinkShapes.length ? sinkShapes[0] : null;
}

function convShape(op, args, inputShape, framework = "unknown") {
  // 支持 2D [H,W,C]（3 维）与 3D [D,H,W,C]（4 维）；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  const isKeras = framework === "keras" || framework === "tensorflow";
  const isTranspose = /transpose|transposed|deconv/i.test(op);
  // Keras Conv2D(filters, kernel_size, ...)；PyTorch Conv2d(in_channels, out_channels, kernel_size, ...)。
  const outChannels = isKeras
    ? firstFinite(numericArg(args, 0), kwargNumber(args, "filters"), kwargNumber(args, "out_channels"))
    : numericArg(args, 1);
  const kernel = isKeras
    ? layerArg(args, 1, "kernel_size", null)
    : layerArg(args, 2, "kernel_size", null);
  const stride = layerArg(args, isKeras ? 2 : 3, "stride", 1);
  const padding = resolvePadding(args.kwargs.padding ?? args.positional[isKeras ? 3 : 4] ?? 0, kernel);
  const dilation = layerArg(args, -1, "dilation", 1);
  const outputPadding = layerArg(args, -1, "output_padding", 0);
  if (!Number.isFinite(outChannels) || kernel == null) return null;
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  const kernels = expandKernel(kernel, dims);
  const strides = expandKernel(stride, dims);
  const paddings = expandKernel(padding, dims);
  const dilations = expandKernel(dilation, dims);
  const outputPaddings = expandKernel(outputPadding, dims);
  const result = [];
  for (let index = 0; index < dims; index += 1) {
    result.push(isTranspose
      ? transposedDimension(spatial[index], kernels[index], paddings[index], dilations[index], outputPaddings[index], strides[index])
      : convDimension(spatial[index], kernels[index], paddings[index], strides[index], dilations[index]));
  }
  result.push(Math.round(outChannels));
  return result;
}

function upsampleShape(op, args, inputShape) {
  // 上采样（nn.Upsample / F.interpolate / PixelShuffle）：2D [H,W,C] 与 3D [D,H,W,C]；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  const channels = channelsOf(inputShape);
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  const sizeTuple = tupleArg(args, 0) || kwargTuple(args, "size");
  if (sizeTuple && sizeTuple.length >= dims) return [...sizeTuple.slice(0, dims), channels];
  const size = firstFinite(numericArg(args, 0), kwargNumber(args, "size"));
  const scale = firstFinite(kwargNumber(args, "scale_factor"), 1);
  if (Number.isFinite(size)) return [...new Array(dims).fill(size), channels];
  return [...spatial.map((dim) => Math.round(dim * scale)), channels];
}

function poolShape(op, args, inputShape) {
  // 下采样（MaxPool/AvgPool/AdaptivePool/GlobalPool）：2D [H,W,C] 与 3D [D,H,W,C]；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  // 兜底：旧 IR 可能仍把 upsample 归入 pool family，按上采样公式处理。
  if (/upsample|interpolate/i.test(op)) return upsampleShape(op, args, inputShape);
  const channels = channelsOf(inputShape);
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  if (/adaptive|global/.test(op)) {
    const target = numericArg(args, 0);
    if (Number.isFinite(target)) return [...new Array(dims).fill(target), channels];
    const tuple = tupleArg(args, 0);
    if (tuple && tuple.length >= dims) return [...tuple.slice(0, dims), channels];
    return [...new Array(dims).fill(1), channels];
  }
  const kernel = layerArg(args, 0, "kernel_size", null);
  const stride = layerArg(args, 1, "stride", kernel ?? 1);
  const padding = resolvePadding(args.kwargs.padding ?? args.positional[2] ?? 0, kernel);
  if (kernel == null) return null;
  const kernels = expandKernel(kernel, dims);
  const strides = expandKernel(stride, dims);
  const paddings = expandKernel(padding, dims);
  const result = [];
  for (let index = 0; index < dims; index += 1) {
    result.push(poolDimension(spatial[index], kernels[index], strides[index], paddings[index]));
  }
  result.push(channels);
  return result;
}

function mergeShape(op, inputs) {
  const shapes = (inputs || []).filter(Boolean);
  if (!shapes.length) return null;
  if (/concat|concatenate|cat|join/.test(op)) {
    // 拼接在通道（最后一）维；空间维取第一个输入。
    const rank = Math.max(...shapes.map((shape) => shape.length));
    const spatial = rank >= 2 ? shapes[0].slice(0, rank - 1) : [];
    const totalChannels = shapes.reduce((acc, shape) => acc + (shape[shape.length - 1] ?? 1), 0);
    return rank >= 2 ? [...spatial, totalChannels] : [totalChannels];
  }
  // add / sum / merge（逐元素）：要求所有输入形状一致，否则保持未解决。
  const first = shapes[0];
  const consistent = shapes.every((shape) => sameShape(shape, first));
  return consistent ? first : null;
}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  return /^(?:true|yes|1)$/i.test(String(value));
}

function recurrentShape(op, args, inputShape) {
  // RNN 输入是序列 [seq_len, input_size]；空间维公式不适用，需 2 维否则安全失败。
  if (!Array.isArray(inputShape) || inputShape.length !== 2) return null;
  const seqLen = inputShape[0];
  const bidirectional = /bidirectional/i.test(op) || isTruthy(args.kwargs.bidirectional);
  // hidden_size：PyTorch LSTM(in, hidden) 位置 1；Keras LSTM(units) 位置 0 或 units kwarg。
  const hidden = firstFinite(
    numericArg(args, 1),
    kwargNumber(args, "hidden_size"),
    kwargNumber(args, "hidden"),
    numericArg(args, 0),
    kwargNumber(args, "units"),
  );
  if (!Number.isFinite(hidden)) return null;
  const hiddenOut = Math.round(hidden) * (bidirectional ? 2 : 1);
  // return_sequences 默认 true（PyTorch 语义：返回整序列）；显式 false（Keras 默认）才缩短。
  // op 名无法区分框架（两边都叫 LSTM/GRU），故只信显式声明。
  const returnSequences = !/^(?:false|no|0)$/i.test(String(args.kwargs.return_sequences));
  if (returnSequences && Number.isFinite(seqLen)) return [Math.round(seqLen), hiddenOut];
  return [hiddenOut];
}

function graphShape(op, args, inputShape) {
  // GCN/GAT 输入 [num_nodes, in_features]；节点数不变，只换特征维。
  if (!Array.isArray(inputShape) || inputShape.length !== 2) return null;
  const numNodes = inputShape[0];
  const outFeatures = firstFinite(
    numericArg(args, 1),
    kwargNumber(args, "out_features"),
    kwargNumber(args, "out_channels"),
    numericArg(args, 0),
    kwargNumber(args, "units"),
  );
  if (!Number.isFinite(outFeatures) || !Number.isFinite(numNodes)) return null;
  return [Math.round(numNodes), Math.round(outFeatures)];
}

function convDimension(size, kernel, padding, stride, dilation = 1) {
  const effective = kernel + (kernel - 1) * (dilation - 1);
  return Math.floor((size + 2 * padding - effective) / stride) + 1;
}

function poolDimension(size, kernel, stride, padding = 0) {
  return Math.floor((size + 2 * padding - kernel) / stride) + 1;
}

// Keras/TF 常用 padding='same'（输出 = ceil(size/stride)，等价 padding=(kernel-1)/2）
// 或 'valid'（padding=0）。PyTorch 用显式整数 padding。
function resolvePadding(paddingValue, kernel) {
  if (Array.isArray(paddingValue)) return paddingValue; // 元组 padding 直接透传（expandKernel 会补齐维度）。
  if (typeof paddingValue === "string" && /same/i.test(paddingValue)) {
    const k = Array.isArray(kernel) ? kernel[0] : kernel;
    return Number.isFinite(k) ? (k - 1) / 2 : 0;
  }
  return Number.isFinite(paddingValue) ? paddingValue : 0;
}

function transposedDimension(size, kernel, padding, dilation, outputPadding, stride) {
  return (size - 1) * stride - 2 * padding + (kernel - 1) * dilation + 1 + outputPadding;
}

function sameShape(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function spatialOf(shape) {
  return shape.length >= 2 ? [shape[0], shape[1]] : [1, 1];
}

function channelsOf(shape) {
  return shape.length >= 3 ? shape[shape.length - 1] : (shape.length ? shape[0] : 1);
}

function productOf(shape) {
  return shape.reduce((acc, value) => acc * (Number.isFinite(value) ? value : 1), 1);
}

function pairOf(value) {
  if (Array.isArray(value)) return [value[0] ?? 1, value[1] ?? value[0] ?? 1];
  return [value, value];
}

// 从位置参数或 kwarg 取一个标量或元组（PyTorch 常用 kernel_size/stride 的元组形式）。
// index 为负表示只取 kwarg（如 dilation 一般不作为位置参数出现）。
function layerArg(args, index, key, fallback) {
  if (index >= 0) {
    const pos = args.positional[index];
    if (Array.isArray(pos) && pos.length) return pos;
    if (Number.isFinite(pos)) return pos;
  }
  const kw = args.kwargs[key];
  if (Array.isArray(kw) && kw.length) return kw;
  if (Number.isFinite(kw)) return kw;
  return fallback;
}

// 把标量或元组扩展成 dims 元组（各向同性标量复制；元组不足时用最后一个元素补齐）。
function expandKernel(value, dims) {
  if (Array.isArray(value)) {
    const out = [];
    for (let index = 0; index < dims; index += 1) {
      out.push(Number.isFinite(value[index]) ? value[index]
        : Number.isFinite(value[value.length - 1]) ? value[value.length - 1] : 1);
    }
    return out;
  }
  const scalar = Number.isFinite(value) ? value : 1;
  return new Array(dims).fill(scalar);
}

function firstFinite(...values) {
  for (const value of values) if (Number.isFinite(value)) return value;
  return values[values.length - 1];
}

function parseLayerArgs(text) {
  const positional = [];
  const kwargs = {};
  const raw = String(text || "").trim();
  if (raw) {
    for (const part of splitArgs(raw)) {
      const keyword = part.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (keyword) kwargs[keyword[1]] = evaluateArg(keyword[2]);
      else positional.push(evaluateArg(part));
    }
  }
  return { positional, kwargs };
}

function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of String(text)) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
    } else {
      current += char;
    }
  }
  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function evaluateArg(text) {
  const trimmed = String(text).trim();
  if (/^\(.*\)$/.test(trimmed)) {
    const inner = splitArgs(trimmed.slice(1, -1));
    if (inner.length > 1) return inner.map(evaluateArg);
    return evaluateArg(inner[0] || "1");
  }
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[\d+\-*/()\s.]+$/.test(trimmed) && /\d/.test(trimmed)) {
    try {
      const value = Function(`"use strict"; return (${trimmed});`)();
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch {
      return NaN;
    }
  }
  return trimmed;
}

function numericArg(args, index) {
  const value = args.positional[index];
  return typeof value === "number" ? value : NaN;
}

function kwargNumber(args, key) {
  const value = args.kwargs[key];
  return typeof value === "number" ? value : NaN;
}

function tupleArg(args, index) {
  const value = args.positional[index];
  return Array.isArray(value) ? value : null;
}

function kwargTuple(args, key) {
  const value = args.kwargs[key];
  return Array.isArray(value) ? value : null;
}

function reshapeTarget(args, inputShape) {
  const first = args.positional[0];
  if (Array.isArray(first)) return resolveReshape(first, inputShape);
  const dims = args.positional.filter((value) => typeof value === "number");
  return dims.length > 1 ? resolveReshape(dims, inputShape) : null;
}

function resolveReshape(dims, inputShape) {
  const total = productOf(inputShape);
  let unknown = -1;
  let known = 1;
  dims.forEach((dim, index) => {
    if (dim === -1) { if (unknown === -1) unknown = index; }
    else known *= dim;
  });
  if (unknown === -1) return dims.map((dim) => Math.round(dim));
  if (known === 0 || total % known !== 0) return null;
  const resolved = dims.slice();
  resolved[unknown] = total / known;
  return resolved.map((dim) => Math.round(dim));
}

