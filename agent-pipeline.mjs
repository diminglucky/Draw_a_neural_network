import { diagramFromCode } from "./code-workflow.js";
import { extractGenericSourceTopology } from "./generic-source-topology.mjs";
import { layoutDocumentForCanvas } from "./publication-layout-browser.mjs";
import { layoutUniversalFigure } from "./universal-figure.mjs";
import {
  normalizeUniversalIR,
  projectUniversalIRToCanvas,
  validateUniversalIR,
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

  if (kind === "source") return analyzeSourceInput(input);
  if (kind === "ir") return analyzeIRInput(input);
  if (kind === "image") return analyzeImageInput(input, options);
  if (kind === "prompt") return analyzePromptInput(input);

  return invalidResult([
    diagnostic("invalid-input", "error", "Expected source, ir, image, or prompt architecture input."),
  ]);
}

function analyzeSourceInput(input) {
  if (typeof input.source !== "string" || !input.source.trim()) {
    return invalidResult([
      diagnostic("invalid-source", "error", "Source input must contain non-empty model code."),
    ]);
  }

  const document = diagramFromCode(input.source, input.framework || "auto");
  const genericTopology = extractGenericSourceTopology(input.source, input.framework || "auto");
  const selectedIR = shouldPreferGenericTopology(genericTopology) ? genericTopology : document.ir;
  return finalizeResult(selectedIR, {
    source: document,
    baseDiagnostics: [
      ...(Array.isArray(document.diagnostics) ? document.diagnostics : []),
      ...(Array.isArray(genericTopology?.diagnostics) ? genericTopology.diagnostics : []),
    ],
    sourceKind: "source",
  });
}

function shouldPreferGenericTopology(topology) {
  if (!topology || !Array.isArray(topology.nodes) || !topology.nodes.length) return false;
  const operations = topology.nodes.filter((node) => !["input", "output"].includes(node.family));
  return operations.some((node) => node.family === "custom")
    || operations.some((node) => node.ports?.inputs?.length > 1 || node.ports?.outputs?.length > 1)
    || topology.edges.length > Math.max(0, topology.nodes.length - 1);
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
  const ir = {
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

  return finalizeResult(ir, { sourceKind: "prompt" });
}

function finalizeResult(rawIR, context = {}) {
  const ir = normalizeUniversalIR(rawIR || {});
  const validation = validateUniversalIR(ir);
  const diagnostics = [
    ...(Array.isArray(context.baseDiagnostics) ? context.baseDiagnostics : []),
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
  return {
    status: hasUncertainty ? STATUS.CONFIRM : STATUS.READY,
    readyForPreview: true,
    ir: publicIR(ir),
    canvasDocument: {
      ...laidOutCanvasDocument,
      ir: publicIR(ir),
      layoutValidation: laidOutCanvasDocument.validation,
      universalFigureLayout: figureLayout,
    },
    figureLayout,
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
  const report = validateUniversalIR(ir);
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
