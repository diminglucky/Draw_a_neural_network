const ROLE_SPECS = Object.freeze({
  "input-tensor": {
    styleProfile: "input-tensor",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "feature-map-stage": {
    styleProfile: "feature-map",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "pool-downsample": {
    styleProfile: "pool",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  merge: {
    styleProfile: "merge",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "outside", operatorDetails: "outside" },
  },
  "skip-connection": {
    styleProfile: "skip",
    labelSlots: { title: "outside", subtitle: "outside", tensorShape: "outside", operatorDetails: "outside" },
  },
  attention: {
    styleProfile: "attention",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "token-sequence": {
    styleProfile: "token",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "recurrent-state": {
    styleProfile: "recurrent",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "vectorize": {
    styleProfile: "vectorize",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "neuron-layer": {
    styleProfile: "neuron",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "output-distribution": {
    styleProfile: "output",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "compound-module": {
    styleProfile: "compound",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "unresolved-module": {
    styleProfile: "unresolved",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  operator: {
    styleProfile: "operator",
    labelSlots: { title: "above", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
});

export function visualRoleForNode(node = {}, context = {}) {
  const family = String(node.family || node.type || "custom").toLowerCase();
  if (family === "input") return "input-tensor";
  if (["merge", "concat", "add", "sum"].includes(family)) return "merge";
  if (family === "pool") return "pool-downsample";
  if (family === "flatten") return "vectorize";
  if (family === "output") return "output-distribution";
  if (["dense", "neuron", "dense-layer"].includes(family)) {
    return context.terminal ? "output-distribution" : "neuron-layer";
  }
  if (["attention", "cross-attention"].includes(family)) return "attention";
  if (["token", "sequence"].includes(family)) return "token-sequence";
  if (["recurrent", "rnn", "lstm", "gru"].includes(family)) return "recurrent-state";
  if (family === "skip" || family === "residual" || family === "shortcut") return "skip-connection";
  if (family === "custom" || node.compoundKind) {
    if (node.compoundKind === "unresolved" || !hasInternalTopology(node)) return "unresolved-module";
    return "compound-module";
  }
  if (["conv", "volume"].includes(family) || hasSpatialTensor(node)) return "feature-map-stage";
  return "operator";
}

export function styleProfileForRole(role) {
  return ROLE_SPECS[role]?.styleProfile || ROLE_SPECS.operator.styleProfile;
}

export function labelSlotsForRole(role) {
  const slots = ROLE_SPECS[role]?.labelSlots || ROLE_SPECS.operator.labelSlots;
  return { ...slots };
}

export function compileSemanticVisualNode(node = {}, context = {}) {
  const visualRole = visualRoleForNode(node, context);
  const internalGraph = node.attributes?.internalGraph || node.internalGraph;
  const preferredSize = preferredSizeForRole(visualRole, node);
  return {
    ...node,
    visualRole,
    styleProfile: styleProfileForRole(visualRole),
    labelSlots: labelSlotsForRole(visualRole),
    geometryData: {
      repeatCount: positiveCount(node.repeatCount ?? node.layers),
      ...(visualRole === "recurrent-state" ? {
        timeAxis: "left-to-right",
        stateFlow: "feedback-loop",
        preservesStateFlow: true,
      } : {}),
      hasInternalTopology: hasInternalTopology(node),
      internalNodeCount: Array.isArray(internalGraph?.nodes) ? internalGraph.nodes.length : 0,
      internalOperatorLabels: Array.isArray(internalGraph?.nodes)
        ? internalGraph.nodes
          .map((child) => String(child?.label || child?.op || child?.family || "Operator"))
          .filter(Boolean)
          .slice(0, 8)
        : [],
      tensorRank: tensorRank(node.shape, node.subtitle),
      spatialSize: spatialDimension(node.shape, node.subtitle),
      channelCount: channelDimension(node.shape, node.subtitle),
      preferredWidth: preferredSize.width,
      preferredHeight: preferredSize.height,
    },
  };
}

export function compileSemanticVisualNodes(nodes = [], edges = []) {
  const outgoing = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = String(edge?.source || "");
    if (!outgoing.has(source)) outgoing.set(source, 0);
    outgoing.set(source, outgoing.get(source) + 1);
  }
  const counters = new Map();
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const sourceId = String(node?.id || "");
    const terminal = (outgoing.get(sourceId) || 0) === 0;
    const compiled = compileSemanticVisualNode(node, { terminal });
    const role = compiled.visualRole;
    const ordinal = (counters.get(role) || 0) + 1;
    counters.set(role, ordinal);
    return {
      ...compiled,
      figureLabel: publicationLabel(compiled, ordinal),
      figureSubtitle: publicationSubtitle(compiled),
    };
  });
}

function publicationLabel(node, ordinal) {
  switch (node.visualRole) {
    case "input-tensor": return node.label || "Input";
    case "feature-map-stage": return /conv|convolution/i.test(`${node.family} ${node.op} ${node.label}`)
      ? `CONV ${ordinal}`
      : `FEATURE ${ordinal}`;
    case "pool-downsample": return "MP";
    case "vectorize": return "Flatten";
    case "neuron-layer": return `FC ${ordinal}`;
    case "output-distribution": return "OUTPUT";
    default: return node.label || node.op || "Operator";
  }
}

function publicationSubtitle(node) {
  const tensorShape = tensorDimensions(node.shape);
  // Publication labels give tensor evidence priority. Kernel, stride, and
  // repeat semantics already belong to the stage title or geometry; repeating
  // them below a thin tensor volume turns the label into a competing card.
  const dimensions = tensorShape.length ? tensorShape : parseDimensionEvidence(node.subtitle);
  if (node.visualRole === "input-tensor" && dimensions.length >= 3) {
    return `${dimensions.at(-1) === 3 ? "RGB image\n" : ""}${dimensions.join("×")}`;
  }
  if (node.visualRole === "feature-map-stage" && dimensions.length >= 3) {
    return dimensions.slice(-3).join("×");
  }
  if (node.visualRole === "feature-map-stage") {
    const spatial = Number(node.geometryData?.spatialSize);
    const channels = Number(node.geometryData?.channelCount);
    const kernel = `${node.subtitle || ""} ${node.label || ""}`.match(/(?:k|kernel(?:_size)?\s*[=:]?\s*)(\d+)/i)?.[1];
    const repeat = Number(node.geometryData?.repeatCount) || 1;
    const operatorDetail = [
      kernel ? `${kernel}×${kernel}` : "",
      Number.isFinite(channels) && channels > 0 ? `${channels}${repeat > 1 ? `×${repeat}` : ""}` : "",
    ].filter(Boolean).join(" · ");
    const spatialDetail = Number.isFinite(spatial) && spatial > 0 && Number.isFinite(channels) && channels > 0
      ? `${spatial}×${spatial}×${channels}`
      : "";
    return `${operatorDetail}${operatorDetail && spatialDetail ? "\n" : ""}${spatialDetail}`;
  }
  if (node.visualRole === "pool-downsample" && dimensions.length >= 3) return dimensions.slice(-3).join("×");
  if (node.visualRole === "neuron-layer" && dimensions.length > 0) return `${dimensions.at(-1)} units`;
  if (node.visualRole === "output-distribution" && dimensions.length > 0) return `${dimensions.at(-1)} outputs`;
  const scalarEvidence = String(node.subtitle || "").match(/^(\d+)-d$/i)?.[1];
  if (scalarEvidence && node.visualRole === "neuron-layer") return `${scalarEvidence} units`;
  if (scalarEvidence && node.visualRole === "output-distribution") return `${scalarEvidence} outputs`;
  if (node.visualRole === "vectorize" && dimensions.length > 0) return `${dimensions.join("×")} vector`;
  return String(node.subtitle || "").replace(/\s+x\s+/gi, "×");
}

function tensorDimensions(shape = {}) {
  const value = shape?.output || shape?.input;
  if (!Array.isArray(value)) return [];
  const dimensions = value.map(Number).filter((item) => Number.isFinite(item) && item > 0);
  return dimensions.length > 1 && dimensions[0] === 1 ? dimensions.slice(1) : dimensions;
}

function preferredSizeForRole(role, node) {
  const currentWidth = Number(node.w) || 0;
  const currentHeight = Number(node.h) || 0;
  const spatial = spatialDimension(node.shape, node.subtitle);
  const channels = channelDimension(node.shape, node.subtitle);
  if (role === "input-tensor") return { width: 104, height: 238 };
  if (role === "feature-map-stage") {
    const height = spatial
      ? Math.max(96, Math.round(320 * Math.pow(Math.max(1, spatial) / 224, 0.4)))
      : Math.max(180, currentHeight || 220);
    const width = spatial
      ? Math.max(54, Math.round(height * 0.24) + Math.round(Math.sqrt(Math.max(1, channels || 64)) * 0.95))
      : Math.max(86, currentWidth || 120);
    return { width, height };
  }
  if (role === "pool-downsample") return { width: 88, height: 0 };
  if (role === "vectorize") return { width: 84, height: 92 };
  if (role === "neuron-layer") return { width: 50, height: 150 };
  if (role === "output-distribution") return { width: 62, height: 128 };
  return { width: currentWidth, height: currentHeight };
}

function hasInternalTopology(node = {}) {
  const graph = node.attributes?.internalGraph || node.internalGraph;
  return Array.isArray(graph?.nodes) && graph.nodes.length > 0;
}

function hasSpatialTensor(node = {}) {
  return tensorRank(node.shape) >= 4;
}

function tensorRank(shape = {}, fallbackText = "") {
  return shapeDimensions(shape, fallbackText).length;
}

function shapeDimensions(shape = {}, fallbackText = "") {
  const value = shape?.output || shape?.input;
  const dimensions = Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : parseDimensionEvidence(fallbackText);
  return dimensions.length > 1 && dimensions[0] === 1 ? dimensions.slice(1) : dimensions;
}

function channelDimension(shape = {}, fallbackText = "") {
  const dimensions = shapeDimensions(shape, fallbackText);
  if (dimensions.length < 3) return dimensions.at(-1) || null;
  const first = dimensions[0];
  const last = dimensions.at(-1);
  // Equal leading spatial dimensions are strong evidence for HxWxC,
  // including small maps such as 7x7x512 where the old "first < 16"
  // heuristic incorrectly classified 7 as the channel count.
  if (dimensions[0] === dimensions[1]) return last;
  return first < 16 && last >= first ? first : last;
}

function spatialDimension(shape = {}, fallbackText = "") {
  const dimensions = shapeDimensions(shape, fallbackText);
  if (dimensions.length < 3) return null;
  const channel = channelDimension(shape, fallbackText);
  const spatial = dimensions.filter((dimension) => dimension !== channel);
  return spatial.length ? Math.max(...spatial) : null;
}

function parseDimensionEvidence(text = "") {
  const match = String(text).match(/(\d+)\s*[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?/i);
  if (!match) return [];
  return match.slice(1).filter(Boolean).map(Number).filter((item) => Number.isFinite(item) && item > 0);
}

function positiveCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
}
