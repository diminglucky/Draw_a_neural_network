import { extractGenericSourceTopology } from "./generic-source-topology.mjs";
import { normalizeArchitectureInput } from "./input-adapters.mjs";
import { createEvidenceGraph, evidenceGraphToUniversalIR } from "./evidence-graph.mjs";
import { createFigurePlan, validateFigurePlan } from "./figure-plan.mjs";
import { layoutUniversalFigure } from "./universal-figure.mjs";
import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";

const STATUS = Object.freeze({
  READY: "ready_for_preview",
  CONFIRM: "needs_confirmation",
  VISION: "needs_external_vision",
  INVALID: "invalid_input",
});

/**
 * Route every supported architecture input through the same IR boundary.
 *
 * The function is deliberately synchronous: source parsing, IR validation and
 * deterministic projection are local operations. Image analysis is an
 * external capability and therefore stops with an explicit status instead of
 * inventing a topology when no analyzer is available.
 */
export function analyzeArchitectureInput(input = {}, options = {}) {
  const kind = inferInputKind(input);

  if (["source", "ir", "prompt"].includes(kind)) {
    try {
      normalizeArchitectureInput({ ...input, kind });
    } catch (error) {
      return invalidResult([diagnostic("invalid-input", "error", error.message)]);
    }
  }

  if (kind === "source") return analyzeSourceInput(input);
  if (kind === "ir") return analyzeIRInput(input);
  if (kind === "image") return analyzeImageInput(input, options);
  if (kind === "prompt") return analyzePromptInput(input);

  return invalidResult([
    diagnostic("invalid-input", "error", "Expected source, ir, image, or prompt architecture input."),
  ]);
}

/**
 * Stage adapters used by the resumable Agent. They intentionally stop at the
 * boundary named by each function so the synchronous compatibility facade and
 * the HTTP Agent cannot accidentally perform the same work twice.
 */
export function extractArchitectureEvidence(input = {}, options = {}) {
  const kind = inferInputKind(input);
  if (!["source", "ir", "image", "prompt"].includes(kind)) {
    throw new TypeError("Expected source, ir, image, or prompt architecture input.");
  }
  normalizeArchitectureInput({ ...input, kind });

  if (kind === "source") {
    const genericTopology = extractGenericSourceTopology(input.source, input.framework || "auto");
    const rawIR = genericTopology || unresolvedSourceIR(input.source);
    return {
      kind,
      rawIR,
      nodes: rawIR?.nodes || [],
      edges: rawIR?.edges || [],
      source: rawIR.source,
      baseDiagnostics: Array.isArray(rawIR.diagnostics) ? rawIR.diagnostics : [],
      input,
    };
  }
  if (kind === "ir") return { kind, rawIR: input.ir, nodes: input.ir.nodes || [], edges: input.ir.edges || [], baseDiagnostics: input.diagnostics, input };
  if (kind === "prompt") {
    const rawIR = promptHypothesisIR(input);
    return { kind, rawIR, nodes: rawIR.nodes, edges: rawIR.edges, diagnostics: rawIR.diagnostics, input };
  }

  const analyzer = options.visionAnalyzer;
  const images = Array.isArray(input.images) ? input.images.filter(Boolean) : [];
  if (typeof analyzer === "function") {
    const analyzed = analyzer({ ...input, images });
    if (analyzed && typeof analyzed.then !== "function" && analyzed.ir) {
      return { kind, rawIR: analyzed.ir, baseDiagnostics: analyzed.diagnostics, input };
    }
  }
  return {
    kind,
    status: STATUS.VISION,
    diagnostics: [diagnostic(
      "vision-analyzer-required",
      "info",
      images.length
        ? "Image input is waiting for a vision analyzer to extract Universal IR."
        : "Image input must include at least one image before vision analysis."
    )],
    input,
  };
}

export function normalizeArchitectureEvidence(evidence = {}) {
  if (evidence.status === STATUS.VISION) return evidence;
  const { evidenceGraph, ir, validation } = buildEvidenceGraphIR(evidence.rawIR, {
    input: evidence.input || { kind: evidence.kind || "unknown" },
    baseDiagnostics: evidence.baseDiagnostics,
  });
  return { ir, validation, evidenceGraph, source: evidence.source, kind: evidence.kind };
}

export function planArchitectureFigure(normalized = {}) {
  if (normalized.status === STATUS.VISION) return normalized;
  const ir = normalized.ir || normalized;
  const diagnostics = computeDiagnostics(ir, normalized.evidenceGraph, normalized.validation);
  const { figureLayout, figurePlan, figurePlanValidation } = buildFigurePlan(ir, diagnostics);
  return {
    ir: publicIR(ir),
    source: normalized.source,
    figureLayout,
    figurePlan,
    figurePlanValidation,
    validation: normalized.validation,
    diagnostics,
  };
}

function analyzeSourceInput(input) {
  if (typeof input.source !== "string" || !input.source.trim()) {
    return invalidResult([
      diagnostic("invalid-source", "error", "Source input must contain non-empty model code."),
    ]);
  }

  const genericTopology = extractGenericSourceTopology(input.source, input.framework || "auto");
  const rawIR = genericTopology || unresolvedSourceIR(input.source);
  return finalizeResult(rawIR, {
    source: rawIR.source,
    baseDiagnostics: rawIR.diagnostics,
    sourceKind: "source",
    input,
  });
}

function analyzeIRInput(input) {
  if (!input.ir || typeof input.ir !== "object" || Array.isArray(input.ir)) {
    return invalidResult([
      diagnostic("invalid-ir", "error", "IR input must contain an object-valued ir field."),
    ]);
  }

  return finalizeResult(input.ir, {
    sourceKind: "ir",
    baseDiagnostics: input.diagnostics,
    input,
  });
}

function analyzeImageInput(input, options) {
  const images = Array.isArray(input.images) ? input.images.filter(Boolean) : [];
  const analyzer = options.visionAnalyzer;

  // A future caller may provide an already-integrated local analyzer. The
  // public synchronous contract still refuses an unresolved Promise so that
  // callers cannot accidentally treat async work as a finished diagram.
  if (typeof analyzer === "function") {
    const analyzed = analyzer({ ...input, images });
    if (analyzed && typeof analyzed.then !== "function" && analyzed.ir) {
      return finalizeResult(analyzed.ir, {
        sourceKind: "image",
        baseDiagnostics: analyzed.diagnostics,
        input,
      });
    }
  }

  return {
    status: STATUS.VISION,
    readyForPreview: false,
    ir: null,
    validation: null,
    diagnostics: [diagnostic(
      "vision-analyzer-required",
      "info",
      images.length
        ? "Image input is waiting for a vision analyzer to extract Universal IR."
        : "Image input must include at least one image before vision analysis."
    )],
    summary: { inputKind: "image", imageCount: images.length },
  };
}

function analyzePromptInput(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    return invalidResult([
      diagnostic("invalid-prompt", "error", "Prompt input must contain non-empty architecture requirements."),
    ]);
  }

  // Prompt-only input has no grounded topology. Keep one unresolved semantic
  // operator as a reviewable hypothesis rather than fabricating a CNN or a
  // topology-specific graph.
  const ir = promptHypothesisIR(input);
  return finalizeResult(ir, { sourceKind: "prompt", input });
}

function promptHypothesisIR(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  return {
    source: { kind: "prompt", text: prompt },
    figure: {
      title: "Prompt-derived architecture hypothesis",
      subtitle: "Topology requires confirmation or additional model evidence",
    },
    nodes: [{
      id: "prompt-hypothesis",
      op: "PromptArchitectureHypothesis",
      family: "custom",
      semanticRole: "unresolved_operator",
      label: "Architecture hypothesis",
      subtitle: "confirm topology",
      confidence: 0.2,
      evidence: [{ kind: "prompt", text: prompt }],
      note: "prompt-only hypothesis; topology not grounded",
    }],
    edges: [],
    diagnostics: [diagnostic(
      "prompt-topology-unresolved",
      "warning",
      "Prompt describes an architecture but does not provide grounded node and edge evidence."
    )],
  };

}

// 提取失败时的兜底 IR：一个未解决的自定义算子，携带 source 文本长度作为证据。
// 全项目只此一处定义，避免 source 提取失败路径的语义漂移。
function unresolvedSourceIR(sourceText) {
  return {
    nodes: [{
      id: "unresolved-source",
      op: "UnresolvedSourceGraph",
      family: "custom",
      compoundKind: "unresolved",
      label: "Unresolved source graph",
      stage: 0,
      confidence: 0.15,
      evidence: [{ kind: "source", textLength: String(sourceText || "").length }],
    }],
    edges: [],
    diagnostics: [{ kind: "unresolved-source", severity: "warning", message: "Source topology could not be extracted." }],
  };
}

// 把原始 evidence（rawIR）归一化为证据图 → Universal IR → 校验结果。
// normalize 阶段与同步 finalize 共用这一段，保证两条路径产出同一份 IR。
function buildEvidenceGraphIR(rawIR, context = {}) {
  const evidenceGraph = createEvidenceGraph({
    input: context.input || { kind: context.sourceKind || "unknown" },
    nodes: Array.isArray(rawIR?.nodes) ? rawIR.nodes : [],
    edges: Array.isArray(rawIR?.edges) ? rawIR.edges : [],
    diagnostics: [
      ...(Array.isArray(rawIR?.diagnostics) ? rawIR.diagnostics : []),
      ...(Array.isArray(context.baseDiagnostics) ? context.baseDiagnostics : []),
    ],
    figure: rawIR?.figure,
  });
  const ir = normalizeNetworkIR(evidenceGraphToUniversalIR(evidenceGraph));
  const validation = validateNetworkIR(ir);
  return { evidenceGraph, ir, validation };
}

// 汇总诊断：证据图诊断 + IR 诊断 + 未解决算子 + 校验 issue，去重。
function computeDiagnostics(ir, evidenceGraph, validation) {
  return dedupeDiagnostics([
    ...(Array.isArray(evidenceGraph?.diagnostics) ? evidenceGraph.diagnostics : []),
    ...(Array.isArray(ir.diagnostics) ? ir.diagnostics : []),
    ...unresolvedDiagnostics(ir),
    ...((validation?.issues) || []).map((issue) => ({ ...issue, severity: "error" })),
  ]);
}

// 把已归一化的 IR 布局成 Figure Plan。plan 阶段与同步 finalize 共用。
function buildFigurePlan(ir, diagnostics) {
  const figureLayout = layoutUniversalFigure(ir);
  const figurePlan = createFigurePlan({ ir, layout: figureLayout, diagnostics });
  const figurePlanValidation = validateFigurePlan(figurePlan);
  return {
    figureLayout,
    figurePlan: { ...figurePlan, validation: figurePlanValidation },
    figurePlanValidation,
  };
}

function finalizeResult(rawIR, context = {}) {
  const { evidenceGraph, ir, validation } = buildEvidenceGraphIR(rawIR, context);
  const uniqueDiagnostics = computeDiagnostics(ir, evidenceGraph, validation);
  const hasUncertainty = uniqueDiagnostics.some((item) =>
    item.kind === "unresolved-operator" || item.kind === "dynamic-control-flow" || item.kind === "prompt-topology-unresolved"
  ) || ir.nodes.some((node) => isUnresolvedNode(node) || unresolvedRecurrentNode(node));

  const reviewableUncertainty = hasUncertainty && validation.issues.every((issue) =>
    ["low-confidence-edge", "missing-edge-evidence", "unresolved-edge"].includes(issue.kind)
  );

  if (!validation.ok && !reviewableUncertainty) {
    return {
      status: STATUS.INVALID,
      readyForPreview: false,
      ir: publicIR(ir),
      validation,
      diagnostics: uniqueDiagnostics,
      summary: summaryFor(ir, context.sourceKind),
    };
  }

  const { figureLayout, figurePlan, figurePlanValidation } = buildFigurePlan(ir, uniqueDiagnostics);
  return {
    status: hasUncertainty ? STATUS.CONFIRM : STATUS.READY,
    readyForPreview: true,
    ir: publicIR(ir),
    figureLayout,
    figurePlan,
    figurePlanValidation,
    validation,
    diagnostics: uniqueDiagnostics,
    summary: summaryFor(ir, context.sourceKind),
    source: context.source,
  };
}

function unresolvedDiagnostics(ir) {
  return ir.nodes
    .filter((node) => isUnresolvedNode(node) || unresolvedRecurrentNode(node))
    .map((node) => diagnostic(
      "unresolved-operator",
      "warning",
      `Operator ${node.op} is preserved as an unresolved compound and needs review.`,
      { nodeId: node.id, operator: node.op, confidence: node.confidence }
    ));
}

function isUnresolvedNode(node = {}) {
  if (node.compoundKind === "unresolved" || node.status === "unresolved") return true;
  if (node.family !== "custom") return false;
  return node.compoundKind !== "module";
}

function unresolvedRecurrentNode(node = {}) {
  if (!["recurrent", "rnn", "lstm", "gru"].includes(String(node.family || "").toLowerCase())) return false;
  const graph = node.attributes?.internalGraph || node.internalGraph;
  return !graph || graph.status === "unresolved" || !Array.isArray(graph.nodes) || graph.nodes.length === 0;
}

function invalidResult(diagnostics) {
  return {
    status: STATUS.INVALID,
    readyForPreview: false,
    ir: null,
    validation: { ok: false, issues: diagnostics, summary: {} },
    diagnostics,
    summary: { inputKind: "unknown" },
  };
}

function inferInputKind(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "invalid";
  if (typeof input.kind === "string") return input.kind.toLowerCase();
  if (input.ir) return "ir";
  if (typeof input.source === "string") return "source";
  if (Array.isArray(input.images)) return "image";
  if (typeof input.prompt === "string") return "prompt";
  return "invalid";
}

function publicIR(ir) {
  const { nodeIds, ...serializable } = ir;
  return serializable;
}

function summaryFor(ir, inputKind) {
  const report = validateNetworkIR(ir);
  return {
    inputKind,
    ...report.summary,
    unresolvedNodeCount: ir.nodes.filter((node) => node.compoundKind === "unresolved" || (node.family === "custom" && node.compoundKind !== "module")).length,
  };
}

function diagnostic(kind, severity, message, extra = {}) {
  return { kind, severity, message, ...extra };
}

function dedupeDiagnostics(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${item.nodeId || ""}:${item.message || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
