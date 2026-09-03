const ROLE_SPECS = Object.freeze({
  "image-input": {
    styleProfile: "image-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "sequence-input": {
    styleProfile: "sequence-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "state-input": {
    styleProfile: "state-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "vector-input": {
    styleProfile: "vector-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "volume-input": {
    styleProfile: "volume-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
  "unknown-input": {
    styleProfile: "unknown-input",
    labelSlots: { title: "below", subtitle: "below", tensorShape: "below", operatorDetails: "outside" },
  },
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
  if (family === "input") return inputVisualGrammarForNode(node, context).kind;
  if (["merge", "concat", "add", "sum"].includes(family)) return "merge";
  if (family === "pool") return "pool-downsample";
  if (family === "flatten") return "vectorize";
  if (family === "output") return "output-distribution";
  if (["dense", "neuron", "dense-layer"].includes(family)) {
    return context.terminal ? "output-distribution" : "neuron-layer";
  }
  if (["attention", "cross-attention"].includes(family)) return "attention";
  if (["token", "sequence"].includes(family)) return "token-sequence";
  if (["recurrent", "rnn", "lstm", "gru"].includes(family)) {
    const evidence = context.recurrentEvidence || normalizeRecurrentEvidence(node, context.edges || []);
    return hasInvalidInternalEvidence(evidence) ? "unresolved-module" : "recurrent-state";
  }
  if (family === "skip" || family === "residual" || family === "shortcut") return "skip-connection";
  if (family === "custom" || node.compoundKind) {
    if (node.compoundKind === "unresolved" || !hasInternalTopology(node)) return "unresolved-module";
    return "compound-module";
  }
  if (["conv", "volume"].includes(family) || hasSpatialTensor(node)) return "feature-map-stage";
  return "operator";
}

export function inputVisualGrammarForNode(node = {}, context = {}) {
  const dimensions = shapeDimensions(node.shape, node.subtitle);
  const symbolicImage = String(node.subtitle || "").match(/\b(?:h|height)\s*[x×]\s*(?:w|width)\s*[x×]\s*(1|3|4)\b/i);
  const tensorRank = dimensions.length || (symbolicImage ? 3 : null);
  const channelCount = channelDimension(node.shape, node.subtitle)
    || (symbolicImage ? Number(symbolicImage[1]) : null);
  const spatialSize = spatialDimension(node.shape, node.subtitle);
  const text = inputEvidenceText(node);
  const explicitModality = explicitInputModality(node);

  if (explicitModality === "image") return inputGrammar("image-input", "explicit image modality evidence", tensorRank, spatialSize, channelCount, 0.99);
  if (explicitModality === "sequence") return inputGrammar("sequence-input", "explicit sequence modality evidence", tensorRank, spatialSize, channelCount, 0.99);
  if (explicitModality === "state") return inputGrammar("state-input", "explicit recurrent state modality evidence", tensorRank, spatialSize, channelCount, 0.99);
  if (explicitModality === "volume") return inputGrammar("volume-input", "explicit volumetric modality evidence", tensorRank, spatialSize, channelCount, 0.99);
  if (explicitModality === "vector") return inputGrammar("vector-input", "explicit vector modality evidence", tensorRank, spatialSize, channelCount, 0.99);

  if (/(^|[\s_.-])(h_prev|c_prev|state|hidden|cell)(\b|[\s_.-])/i.test(text)
    || /(?:^|[\s_.-])(h|c)(?:\s*[_-]?\s*(?:prev|state|hidden|cell))?(?:$|[\s_.-])/i.test(text)
      && /(port|state|hidden|cell|recurrent|lstm|gru)/i.test(text)) {
    return inputGrammar("state-input", "state port or hidden/cell evidence", tensorRank, spatialSize, channelCount, 0.96);
  }
  if (/(sequence|token|time[-_ ]?step|timesteps?|temporal|embedding)/i.test(text)) {
    return inputGrammar("sequence-input", "sequence or time-axis evidence", tensorRank, spatialSize, channelCount, 0.94);
  }
  if (Array.isArray(context.outgoingEdges) && context.outgoingEdges.some((edge) => (
    /^(recurrent|rnn|lstm|gru)$/i.test(String(edge?.targetFamily || ""))
      && !/(state|hidden|cell|h_prev|c_prev)/i.test(`${edge?.type || ""} ${edge?.label || ""} ${edge?.targetPort || ""}`)
  ))) {
    return inputGrammar("sequence-input", "input port connected to a recurrent operator", tensorRank, spatialSize, channelCount, 0.91);
  }
  if (/(voxel|volume|volumetric|ct|mri|medical|depth)/i.test(text) || dimensions.length >= 4) {
    return inputGrammar("volume-input", "volumetric or rank-four-plus tensor evidence", tensorRank, spatialSize, channelCount, 0.92);
  }
  if ((dimensions.length === 3 || symbolicImage) && [1, 3, 4].includes(channelCount)) {
    return inputGrammar("image-input", "rank-three tensor with image channel count", tensorRank, spatialSize, channelCount, 0.9);
  }
  if (dimensions.length === 1) {
    return inputGrammar("vector-input", "one-dimensional feature vector evidence", tensorRank, spatialSize, channelCount, 0.9);
  }
  return inputGrammar("unknown-input", "insufficient modality evidence for a specialized input glyph", tensorRank, spatialSize, channelCount, 0.35);
}

export function styleProfileForRole(role) {
  return ROLE_SPECS[role]?.styleProfile || ROLE_SPECS.operator.styleProfile;
}

export function labelSlotsForRole(role) {
  const slots = ROLE_SPECS[role]?.labelSlots || ROLE_SPECS.operator.labelSlots;
  return { ...slots };
}

export function compileSemanticVisualNode(node = {}, context = {}) {
  const recurrentEvidence = isRecurrentNode(node)
    ? normalizeRecurrentEvidence(node, context.edges || [])
    : undefined;
  const visualRole = visualRoleForNode(node, { ...context, recurrentEvidence });
  const internalGraph = node.attributes?.internalGraph || node.internalGraph;
  const preferredSize = preferredSizeForRole(visualRole, node);
  const inputGrammar = String(node.family || node.type || "").toLowerCase() === "input"
    ? inputVisualGrammarForNode(node, context)
    : undefined;
  return {
    ...node,
    visualRole,
    ...(recurrentEvidence ? { recurrentEvidence } : {}),
    ...(inputGrammar ? { inputGrammar } : {}),
    styleProfile: styleProfileForRole(visualRole),
    labelSlots: labelSlotsForRole(visualRole),
    geometryData: {
      repeatCount: positiveCount(node.repeatCount ?? node.layers),
      ...(inputGrammar ? {
        inputGrammar: inputGrammar.kind,
        modalityReason: inputGrammar.reason,
      } : {}),
      ...(recurrentEvidence ? {
        timeAxis: "left-to-right",
        stateFlow: "feedback-loop",
        preservesStateFlow: true,
        recurrentEvidenceStatus: recurrentEvidence.internalGraph.status,
        recurrentEvidenceReason: recurrentEvidence.internalGraph.reason || "",
      } : {}),
      hasInternalTopology: recurrentEvidence
        ? recurrentEvidence.internalGraph.status === "resolved" && recurrentEvidence.internalGraph.nodes.length > 0
        : hasInternalTopology(node),
      internalNodeCount: recurrentEvidence
        ? recurrentEvidence.internalGraph.nodes.length
        : (Array.isArray(internalGraph?.nodes) ? internalGraph.nodes.length : 0),
      internalOperatorLabels: Array.isArray(internalGraph?.nodes)
        ? internalGraph.nodes
          .map((child) => String(child?.label || child?.op || child?.family || "Operator"))
          .filter(Boolean)
          .slice(0, 8)
        : [],
      tensorRank: inputGrammar?.tensorRank ?? tensorRank(node.shape, node.subtitle),
      spatialSize: inputGrammar?.spatialSize ?? spatialDimension(node.shape, node.subtitle),
      channelCount: inputGrammar?.channelCount ?? channelDimension(node.shape, node.subtitle),
      preferredWidth: preferredSize.width,
      preferredHeight: preferredSize.height,
    },
  };
}

export function recurrentEvidenceForNode(node = {}, edges = []) {
  return normalizeRecurrentEvidence(node, edges);
}

export function normalizeRecurrentEvidence(node = {}, edges = []) {
  const attributes = isRecord(node.attributes) ? node.attributes : {};
  const repetition = isRecord(attributes.repetition)
    ? { ...attributes.repetition, evidence: copyEvidence(attributes.repetition.evidence) }
    : { axis: "unknown", instances: [], sharedParameters: false, evidence: [] };
  const sourceEdges = Array.isArray(edges) ? edges : [];
  const edgeById = new Map();
  sourceEdges.forEach((edge) => {
    if (edge?.id !== undefined) edgeById.set(String(edge.id), edge);
    if (edge?.sourceEdgeId !== undefined) edgeById.set(String(edge.sourceEdgeId), edge);
  });
  const diagnostics = [];
  const stateTransitions = Array.isArray(attributes.stateTransitions)
    ? attributes.stateTransitions.map((transition, index) => {
      const sourceEdgeId = transition?.sourceEdgeId === undefined ? undefined : String(transition.sourceEdgeId);
      const edge = sourceEdgeId ? edgeById.get(sourceEdgeId) : undefined;
      const edgeType = String(edge?.type || "").toLowerCase();
      const edgeEndpoints = normalizeEndpointIds(edge?.sourceEndpointIds || edge?.ports);
      const declaredEndpoints = normalizeEndpointIds(transition?.sourceEndpointIds)
        || (transition?.sourcePort || transition?.targetPort
          ? { source: String(transition.sourcePort || ""), target: String(transition.targetPort || "") }
          : undefined);
      const invalidReason = !edge
        ? "missing-edge"
        : !["state", "loop", "recurrent-state"].includes(edgeType)
          ? "invalid-edge-type"
          : (transition?.source !== undefined && String(transition.source) !== String(edge.source))
            || (transition?.target !== undefined && String(transition.target) !== String(edge.target))
            ? "node-mismatch"
          : declaredEndpoints && edgeEndpoints && (declaredEndpoints.source !== edgeEndpoints.source || declaredEndpoints.target !== edgeEndpoints.target)
            ? "endpoint-mismatch"
            : undefined;
      if (invalidReason) diagnostics.push({ kind: invalidReason === "missing-edge" ? "missing-state-transition-edge" : "invalid-state-transition-edge", sourceEdgeId, reason: invalidReason });
      return {
        ...transition,
        ...(sourceEdgeId ? { sourceEdgeId } : {}),
        ...(invalidReason ? { status: "unresolved" } : {}),
        ...(transition?.sourceEndpointIds || edge?.sourceEndpointIds || edge?.ports
          ? { sourceEndpointIds: normalizeEndpointIds(transition?.sourceEndpointIds || edge?.sourceEndpointIds || edge?.ports) }
          : {}),
        id: String(transition?.id || sourceEdgeId || `state-transition-${index + 1}`),
      };
    })
    : [];
  const graphValue = attributes.internalGraph ?? node.internalGraph;
  if (!isRecord(graphValue)) {
    return {
      repetition,
      stateTransitions,
      diagnostics,
      internalGraph: { nodes: [], edges: [], ports: {}, status: "unresolved", reason: "internal topology evidence is absent", diagnostics: [] },
    };
  }
  const nodes = Array.isArray(graphValue.nodes) ? graphValue.nodes.map((child, index) => ({
    ...child,
    id: String(child?.id || child?.sourceNodeId || `internal-node-${index + 1}`),
    ...(child?.sourceNodeId !== undefined ? { sourceNodeId: String(child.sourceNodeId) } : {}),
  })) : [];
  const nodeIds = new Set(nodes.map((child) => child.id));
  const invalidEdges = [];
  const graphEdges = Array.isArray(graphValue.edges) ? graphValue.edges.flatMap((edge, index) => {
    const source = String(edge?.source || "");
    const target = String(edge?.target || "");
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      invalidEdges.push({ kind: "invalid-internal-edge", edgeId: String(edge?.id || `internal-edge-${index + 1}`), source, target });
      return [];
    }
    const id = String(edge?.id || edge?.sourceEdgeId || `internal-edge-${index + 1}`);
    const sourceEndpointIds = normalizeEndpointIds(edge?.sourceEndpointIds || edge?.ports);
    return [{ ...edge, id, sourceEdgeId: String(edge?.sourceEdgeId || id), ...(sourceEndpointIds ? { sourceEndpointIds } : {}), source, target }];
  }) : [];
  const graphDiagnostics = [...(Array.isArray(graphValue.diagnostics) ? graphValue.diagnostics : []), ...invalidEdges];
  return {
    repetition,
    stateTransitions,
    diagnostics,
    internalGraph: {
      ...graphValue,
      nodes,
      edges: graphEdges,
      ports: isRecord(graphValue.ports) ? { ...graphValue.ports } : {},
      status: invalidEdges.length ? "unresolved" : (graphValue.status || "resolved"),
      ...(invalidEdges.length ? { reason: "internal topology contains invalid edge references" } : {}),
      diagnostics: graphDiagnostics,
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
  const nodesById = new Map((Array.isArray(nodes) ? nodes : []).map((node) => [String(node?.id || ""), node]));
  const outgoingEdges = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = String(edge?.source || "");
    const target = nodesById.get(String(edge?.target || ""));
    if (!outgoingEdges.has(source)) outgoingEdges.set(source, []);
    outgoingEdges.get(source).push({
      ...edge,
      targetFamily: target?.family || target?.type || "",
      targetPort: edge?.ports?.target || edge?.targetPort || "",
    });
  }
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const sourceId = String(node?.id || "");
    const terminal = (outgoing.get(sourceId) || 0) === 0;
    const compiled = compileSemanticVisualNode(node, {
      terminal,
      edges,
      outgoingEdges: outgoingEdges.get(sourceId) || [],
    });
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
    case "image-input": return node.label || "Image";
    case "sequence-input": return node.label || "Sequence";
    case "state-input": return node.label || "State";
    case "vector-input": return node.label || "Vector";
    case "volume-input": return node.label || "Volume";
    case "unknown-input": return node.label || "Input";
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
  if (["image-input", "input-tensor"].includes(node.visualRole) && dimensions.length >= 3) {
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
  if (["sequence-input", "state-input", "vector-input", "volume-input", "unknown-input"].includes(node.visualRole)) {
    return dimensions.length ? dimensions.join("×") : String(node.subtitle || "").replace(/\s+x\s+/gi, "×");
  }
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
  if (role === "image-input") return { width: 122, height: 214 };
  if (role === "sequence-input") return { width: 150, height: 72 };
  if (role === "state-input") return { width: 86, height: 132 };
  if (role === "vector-input") return { width: 58, height: 150 };
  if (role === "volume-input") return { width: 132, height: 204 };
  if (role === "unknown-input") return { width: 104, height: 160 };
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

function isRecurrentNode(node = {}) {
  return ["recurrent", "rnn", "lstm", "gru"].includes(String(node.family || node.type || "").toLowerCase());
}

function hasInvalidInternalEvidence(evidence = {}) {
  return evidence.internalGraph?.status === "invalid"
    || evidence.internalGraph?.diagnostics?.some((item) => item?.kind === "invalid-internal-edge");
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

function inputEvidenceText(node = {}) {
  const evidence = Array.isArray(node.evidence) ? node.evidence : [];
  return [
    node.label,
    node.op,
    node.subtitle,
    node.attributes?.modality,
    node.attributes?.inputKind,
    node.ports?.inputs?.join(" "),
    node.ports?.outputs?.join(" "),
    ...evidence.flatMap((item) => [item?.modality, item?.kind, item?.operation, item?.variable, item?.claim]),
  ].filter(Boolean).join(" ");
}

function explicitInputModality(node = {}) {
  const evidenceModality = (Array.isArray(node.evidence) ? node.evidence : [])
    .map((item) => item?.modality)
    .find((item) => item !== undefined && item !== null);
  const value = [evidenceModality, node.attributes?.modality, node.attributes?.inputKind, node.modality]
    .find((item) => item !== undefined && item !== null);
  const normalized = String(value || "").toLowerCase();
  if (/image|rgb|pixel/.test(normalized)) return "image";
  if (/sequence|token|temporal/.test(normalized)) return "sequence";
  if (/state|hidden|cell/.test(normalized)) return "state";
  if (/volume|voxel|3d/.test(normalized)) return "volume";
  if (/vector|embedding/.test(normalized)) return "vector";
  return "";
}

function inputGrammar(kind, reason, tensorRank, spatialSize, channelCount, confidence) {
  return { kind, confidence, reason, tensorRank, spatialSize, channelCount };
}

function normalizeEndpointIds(value) {
  if (!isRecord(value)) return undefined;
  const normalized = {};
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key])) normalized[key] = String(value[key]);
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function copyEvidence(value) {
  return Array.isArray(value) ? value.map((item) => (isRecord(item) ? { ...item } : item)) : [];
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function positiveCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
}
