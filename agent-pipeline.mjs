import { diagramFromCode } from "./code-workflow.js";
import { extractGenericSourceTopology } from "./generic-source-topology.mjs";
import { normalizeArchitectureInput } from "./input-adapters.mjs";
import { createEvidenceGraph, evidenceGraphToUniversalIR } from "./evidence-graph.mjs";
import { createFigurePlan, validateFigurePlan } from "./figure-plan.mjs";
import { layoutDocumentForCanvas } from "./publication-layout-browser.mjs";
import { layoutUniversalFigure } from "./universal-figure.mjs";
import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";
import {
  projectUniversalIRToCanvas,
} from "./universal-ir.mjs";

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
    const document = diagramFromCode(input.source, input.framework || "auto");
    const genericTopology = extractGenericSourceTopology(input.source, input.framework || "auto");
    const rawIR = shouldPreferGenericTopology(genericTopology, document) ? genericTopology : document.ir;
    return {
      kind,
      rawIR,
      nodes: rawIR?.nodes || [],
      edges: rawIR?.edges || [],
      source: document,
      baseDiagnostics: [
        ...(Array.isArray(document.diagnostics) ? document.diagnostics : []),
        ...(Array.isArray(genericTopology?.diagnostics) ? genericTopology.diagnostics : []),
      ],
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
  const evidenceGraph = createEvidenceGraph({
    input: evidence.input || { kind: evidence.kind || "unknown" },
    nodes: Array.isArray(evidence.rawIR?.nodes) ? evidence.rawIR.nodes : [],
    edges: Array.isArray(evidence.rawIR?.edges) ? evidence.rawIR.edges : [],
    diagnostics: [
      ...(Array.isArray(evidence.rawIR?.diagnostics) ? evidence.rawIR.diagnostics : []),
      ...(Array.isArray(evidence.baseDiagnostics) ? evidence.baseDiagnostics : []),
    ],
    figure: evidence.rawIR?.figure,
  });
  const ir = normalizeNetworkIR(evidenceGraphToUniversalIR(evidenceGraph));
  const validation = validateNetworkIR(ir);
  return { ir, validation, evidenceGraph, source: evidence.source, kind: evidence.kind };
}

export function planArchitectureFigure(normalized = {}) {
  if (normalized.status === STATUS.VISION) return normalized;
  const ir = normalized.ir || normalized;
  const rawCanvasDocument = projectUniversalIRToCanvas(ir);
  const laidOutCanvasDocument = layoutDocumentForCanvas(rawCanvasDocument);
  const figureLayout = layoutUniversalFigure(ir);
  const diagnostics = [
    ...(Array.isArray(normalized.evidenceGraph?.diagnostics) ? normalized.evidenceGraph.diagnostics : []),
    ...(Array.isArray(ir.diagnostics) ? ir.diagnostics : []),
    ...unresolvedDiagnostics(ir),
    ...(normalized.validation?.issues || []).map((issue) => ({ ...issue, severity: "error" })),
  ];
  const uniqueDiagnostics = dedupeDiagnostics(diagnostics);
  const figurePlan = createFigurePlan({ ir, layout: figureLayout, diagnostics: uniqueDiagnostics });
  const figurePlanValidation = validateFigurePlan(figurePlan);
  return {
    ir: publicIR(ir),
    source: normalized.source,
    rawCanvasDocument,
    canvasDocument: {
      ...laidOutCanvasDocument,
      ir: publicIR(ir),
      layoutValidation: laidOutCanvasDocument.validation,
      universalFigureLayout: figureLayout,
      figurePlan,
    },
    figureLayout,
    figurePlan: { ...figurePlan, validation: figurePlanValidation },
    figurePlanValidation,
    validation: normalized.validation,
    diagnostics: uniqueDiagnostics,
  };
}

function analyzeSourceInput(input) {
  if (typeof input.source !== "string" || !input.source.trim()) {
    return invalidResult([
      diagnostic("invalid-source", "error", "Source input must contain non-empty model code."),
    ]);
  }

  const document = diagramFromCode(input.source, input.framework || "auto");
  const genericTopology = extractGenericSourceTopology(input.source, input.framework || "auto");
  const selectedIR = shouldPreferGenericTopology(genericTopology, document) ? genericTopology : document.ir;
  return finalizeResult(selectedIR, {
    source: document,
    baseDiagnostics: [
      ...(Array.isArray(document.diagnostics) ? document.diagnostics : []),
      ...(Array.isArray(genericTopology?.diagnostics) ? genericTopology.diagnostics : []),
    ],
    sourceKind: "source",
    input,
  });
}

function shouldPreferGenericTopology(topology, document = {}) {
  if (!topology || !Array.isArray(topology.nodes) || !topology.nodes.length) return false;
  const operations = topology.nodes.filter((node) => (
    !["input", "output"].includes(node.family) && !isSourceExampleNode(node)
  ));
  const genericCustom = operations.filter((node) => node.family === "custom");
  const documentOperations = Array.isArray(document.ir?.nodes)
    ? document.ir.nodes.filter((node) => !["input", "output"].includes(node.family))
    : [];
  const containerOnly = genericCustom.length > 0
    && genericCustom.every((node) => /^(Sequential|ModuleList|ModuleDict)$/i.test(String(node.op || node.label || "")));
  if (containerOnly && documentOperations.length > operations.length) return false;
  return operations.some((node) => node.family === "custom")
    || operations.some((node) => node.ports?.inputs?.length > 1 || node.ports?.outputs?.length > 1)
    || topology.edges.length > Math.max(0, topology.nodes.length - 1);
}

function isSourceExampleNode(node = {}) {
  return /^(?:randn|zeros|ones|empty|full|tensor|arange|linspace|rand|randint)$/i.test(
    String(node.op || node.label || "").trim()
  );
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
    canvasDocument: null,
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
  // template-specific graph.
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

function finalizeResult(rawIR, context = {}) {
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
  const diagnostics = [
    ...(Array.isArray(evidenceGraph.diagnostics) ? evidenceGraph.diagnostics : []),
    ...(Array.isArray(ir.diagnostics) ? ir.diagnostics : []),
    ...unresolvedDiagnostics(ir),
    ...validation.issues.map((issue) => ({ ...issue, severity: "error" })),
  ];
  const uniqueDiagnostics = dedupeDiagnostics(diagnostics);
  const hasUncertainty = uniqueDiagnostics.some((item) =>
    item.kind === "unresolved-operator" || item.kind === "dynamic-control-flow" || item.kind === "prompt-topology-unresolved"
  );

  if (!validation.ok) {
    return {
      status: STATUS.INVALID,
      readyForPreview: false,
      ir: publicIR(ir),
      canvasDocument: null,
      validation,
      diagnostics: uniqueDiagnostics,
      summary: summaryFor(ir, context.sourceKind),
    };
  }

  const rawCanvasDocument = projectUniversalIRToCanvas(ir);
  const laidOutCanvasDocument = layoutDocumentForCanvas(rawCanvasDocument);
  const figureLayout = layoutUniversalFigure(ir);
  const figurePlan = createFigurePlan({ ir, layout: figureLayout, diagnostics: uniqueDiagnostics });
  const figurePlanValidation = validateFigurePlan(figurePlan);
  return {
    status: hasUncertainty ? STATUS.CONFIRM : STATUS.READY,
    readyForPreview: true,
    ir: publicIR(ir),
    canvasDocument: {
      ...laidOutCanvasDocument,
      ir: publicIR(ir),
      layoutValidation: laidOutCanvasDocument.validation,
      universalFigureLayout: figureLayout,
      figurePlan,
    },
    figureLayout,
    figurePlan: { ...figurePlan, validation: figurePlanValidation },
    figurePlanValidation,
    validation,
    diagnostics: uniqueDiagnostics,
    summary: summaryFor(ir, context.sourceKind),
    source: context.source,
  };
}

function unresolvedDiagnostics(ir) {
  return ir.nodes
    .filter((node) => node.family === "custom" || node.compoundKind === "unresolved")
    .map((node) => diagnostic(
      "unresolved-operator",
      "warning",
      `Operator ${node.op} is preserved as an unresolved compound and needs review.`,
      { nodeId: node.id, operator: node.op, confidence: node.confidence }
    ));
}

function invalidResult(diagnostics) {
  return {
    status: STATUS.INVALID,
    readyForPreview: false,
    ir: null,
    canvasDocument: null,
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
    unresolvedNodeCount: ir.nodes.filter((node) => node.family === "custom" || node.compoundKind === "unresolved").length,
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

export { STATUS };
