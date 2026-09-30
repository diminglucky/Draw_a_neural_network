import { extractGenericSourceTopology } from "./generic-source-topology.mjs";
import { normalizeArchitectureInput } from "./input-adapters.mjs";
import { architectureEvidencePackageToEvidenceGraph, createEvidenceGraph, evidenceGraphToUniversalIR } from "./evidence-graph.mjs";
import { createArchitectureEvidencePackage, validateArchitectureEvidencePackage } from "./architecture-evidence-package.mjs";
import { resolveArchitectureRequest } from "./architecture-resolver.mjs";
import { importArchitectureConfig } from "./architecture-config-importer.mjs";
import { importOnnxGraph } from "./onnx-graph-importer.mjs";
import { createVisioDiagramPlan, validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";
import { deriveNeuralSemanticFacts, validateNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { createProjectionMap, validateProjectionMap } from "./neural-projection-map.mjs";
import { compileSemanticScene, validateSemanticScene } from "./semantic-neural-scene.mjs";
import { layoutNeuralScene, validateLaidOutScene } from "./neural-scene-layout.mjs";
import { containsUncertainTopology } from "./topology-uncertainty.mjs";
import { fuseGraphEvidence } from "./graph-evidence-fusion.mjs";
import { fuseAutomaticEvidence } from "./automatic-evidence.mjs";
import { buildCanonicalModelGraph, validateCanonicalModelGraph } from "./canonical-model-graph.mjs";
import { createPublicationLayoutPlan, validatePublicationLayoutPlan } from "./publication-layout-plan.mjs";
import { planNeuralFigure, validateNeuralFigurePlan } from "./figure-planner.mjs";
import { compileNeuralFigureDslToVisioLayout } from "./visio-dsl-bridge.mjs";
import { evaluatePublicationFigure } from "./figure-qa.mjs";
import { createPlotNeuralNetStyleSpec } from "./reference-figure-spec.mjs";
import { compileReferenceStyle } from "./reference-style-compiler.mjs";

const STATUS = Object.freeze({
  READY: "ready_for_visio",
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
  if (!["source", "ir", "image", "prompt", "repository", "config", "artifact", "evidence"].includes(kind)) {
    throw new TypeError("Expected source, ir, image, prompt, repository, config, artifact, or evidence architecture input.");
  }
  normalizeArchitectureInput({ ...input, kind });

  if (options.autoFuseEvidence === true) {
    return fuseAutomaticEvidence(input, options).then((fused) => evidenceFromFusion(fused, input));
  }

  if (kind === "evidence") {
    const fused = fuseGraphEvidence(input.sources);
    return evidenceFromFusion(fused, input);
  }

  if (kind === "source" && typeof options.codeAnalyzer === "function") {
    return Promise.resolve(options.codeAnalyzer(input)).then((analyzed) => {
      if (!analyzed?.ir) return extractArchitectureEvidence(input);
      return {
        kind,
        rawIR: analyzed.ir,
        nodes: analyzed.ir.nodes || [],
        edges: analyzed.ir.edges || [],
        source: analyzed.ir.source,
        baseDiagnostics: analyzed.diagnostics,
        input,
      };
    });
  }

  if (kind === "config") return packageImportedEvidence(input, importArchitectureConfig(input.config, sourceContext(input)));
  if (kind === "artifact") {
    if (String(input.artifact.format).toLowerCase() !== "onnx") return packageImportedEvidence(input, {
      status: "rejected", graph: { nodes: [], edges: [], ports: [], tensors: [], containers: [] }, claims: [], sources: [],
      diagnostics: [diagnostic("unsupported-artifact-format", "error", `Unsupported artifact format ${input.artifact.format}.`)],
    });
    return packageImportedEvidence(input, importOnnxGraph(decodeArtifactData(input.artifact.data), sourceContext(input)));
  }
  if (kind === "repository" || (kind === "prompt" && options.resolver)) {
    return resolveArchitectureRequest(input, options.resolver || {}).then((resolved) => packageResolvedEvidence(input, resolved));
  }

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

function evidenceFromFusion(fused, input) {
  return {
    kind: input.kind,
    status: fused.status,
    rawIR: fused.ir,
    nodes: fused.ir.nodes || [],
    edges: fused.ir.edges || [],
    source: fused.ir.source,
    diagnostics: fused.conflicts,
    fusion: fused,
    input,
  };
}

export function normalizeArchitectureEvidence(evidence = {}) {
  if (evidence.status === STATUS.VISION) return evidence;
  if (evidence.version === "architecture-evidence-package/v1") {
    if (!["grounded", "resolved"].includes(evidence.status)) return evidence;
    const packageValidation = validateArchitectureEvidencePackage(evidence);
    if (!packageValidation.ok) throw new TypeError(`Invalid Architecture Evidence Package: ${packageValidation.issues.map((issue) => issue.code).join(", ")}`);
    const evidenceGraph = architectureEvidencePackageToEvidenceGraph(evidence);
    const ir = normalizeNetworkIR(evidenceGraphToUniversalIR(evidenceGraph));
    const validation = validateNetworkIR(ir);
    return { ir, validation, evidenceGraph, evidencePackage: evidence, source: evidence.identity, kind: evidence.request?.kind };
  }
  const { evidenceGraph, ir, validation } = buildEvidenceGraphIR(evidence.rawIR, {
    input: evidence.input || { kind: evidence.kind || "unknown" },
    baseDiagnostics: evidence.baseDiagnostics,
  });
  return { ir, validation, evidenceGraph, source: evidence.source, kind: evidence.kind };
}

function packageImportedEvidence(input, imported) {
  return createArchitectureEvidencePackage({
    status: imported.status,
    request: { kind: input.kind, sourceId: input.sourceId },
    identity: { revision: input.revision, uri: input.metadata?.uri },
    sources: imported.sources,
    claims: imported.claims,
    graph: imported.graph,
    diagnostics: imported.diagnostics,
    unresolvedQuestions: imported.status === "unresolved" ? [{ code: "confirm-imported-topology" }] : [],
  });
}

function packageResolvedEvidence(input, resolved) {
  if (resolved.status === "resolved" && resolved.sources?.length === 1) {
    const source = resolved.sources[0];
    const context = { sourceId: source.id, revision: source.revision, uri: source.uri, authority: source.authority, format: source.path?.toLowerCase().endsWith(".onnx") ? "onnx" : "config" };
    const imported = context.format === "onnx"
      ? importOnnxGraph(source.content, context)
      : importArchitectureConfig(source.content, context);
    return createArchitectureEvidencePackage({
      status: imported.status,
      request: { kind: input.kind, requestedIdentity: input.prompt || input.repository },
      identity: resolved.identity,
      sources: resolved.sources,
      claims: imported.claims,
      graph: imported.graph,
      diagnostics: [...(resolved.diagnostics || []), ...(imported.diagnostics || [])],
      unresolvedQuestions: imported.status === "unresolved" ? [{ code: "confirm-imported-topology" }] : [],
    });
  }
  return createArchitectureEvidencePackage({
    status: resolved.status,
    request: { kind: input.kind, requestedIdentity: input.prompt || input.repository },
    identity: resolved.identity,
    sources: resolved.sources || [],
    claims: [],
    graph: { nodes: [], edges: [], ports: [], tensors: [], containers: [] },
    diagnostics: resolved.diagnostics || [],
    unresolvedQuestions: resolved.status === "needs_resolution" ? [{ code: "select-architecture-candidate", candidates: resolved.candidates }] : [],
  });
}

function sourceContext(input) {
  return { sourceId: input.sourceId, revision: input.revision, uri: input.metadata?.uri, authority: input.metadata?.authority, format: input.artifact?.format };
}

function decodeArtifactData(data) {
  if (typeof data === "string") return Buffer.from(data, "base64");
  if (data?.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
  return data;
}

export function planArchitectureFigure(normalized = {}) {
  if (normalized.status === STATUS.VISION) return normalized;
  const ir = normalized.ir || normalized;
  const diagnostics = computeDiagnostics(ir, normalized.evidenceGraph, normalized.validation);
  const planned = buildVisioPlan(ir, diagnostics);
  const allDiagnostics = dedupeDiagnostics([...diagnostics, ...planned.layoutDiagnostics]);
  if (!planned.sceneValidation.ok) {
    return {
      status: STATUS.INVALID,
      readyForVisio: false,
      ir: publicIR(ir),
      source: normalized.source,
      sceneValidation: planned.sceneValidation,
      validation: normalized.validation,
      diagnostics: allDiagnostics,
    };
  }
  return {
    ir: publicIR(ir),
    source: normalized.source,
    visioDiagramPlan: planned.visioDiagramPlan,
    visioDiagramPlanValidation: planned.visioDiagramPlanValidation,
    validation: normalized.validation,
    diagnostics: allDiagnostics,
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
    readyForVisio: false,
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
    groups: rawIR?.groups,
    containers: rawIR?.containers,
    lanes: rawIR?.lanes,
    constraints: rawIR?.constraints,
    layout: rawIR?.layout,
    projection: rawIR?.projection,
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
    ...assumedShapeDiagnostics(ir),
    ...((validation?.issues) || []).map((issue) => ({ ...issue, severity: "error" })),
  ]);
}

// 把已归一化的 IR 布局成 Figure Plan。plan 阶段与同步 finalize 共用。
function buildVisioPlan(ir, diagnostics) {
  const canonicalModel = buildCanonicalModelGraph(ir);
  const canonicalValidation = validateCanonicalModelGraph(canonicalModel);
  if (!canonicalValidation.ok) return invalidSceneContract("canonical-model", canonicalValidation.issues);
  const canonicalIR = canonicalModel.ir;
  const semanticFacts = deriveNeuralSemanticFacts(canonicalModel);
  const semanticFactsValidation = validateNeuralSemanticFacts(semanticFacts, canonicalIR);
  if (!semanticFactsValidation.ok) {
    return invalidSceneContract("semantic-facts", semanticFactsValidation.issues);
  }
  const projectionMap = createProjectionMap(canonicalIR, semanticFacts, { detail: "balanced" });
  const projectionValidation = validateProjectionMap(projectionMap, canonicalIR);
  if (!projectionValidation.ok) {
    return invalidSceneContract("projection", projectionValidation.issues);
  }
  const semanticScene = compileSemanticScene(canonicalIR, semanticFacts, projectionMap);
  const semanticSceneValidation = validateSemanticScene(semanticScene, canonicalIR, projectionMap);
  const semanticErrors = (semanticScene.diagnostics || []).filter((item) => item.severity === "error");
  if (!semanticSceneValidation.ok || semanticErrors.length) {
    return invalidSceneContract("semantic-scene", [
      ...semanticSceneValidation.issues,
      ...semanticErrors.map((item) => ({ code: item.code || "semantic-scene-error", ...item })),
    ]);
  }
  const publicationLayoutPlan = createPublicationLayoutPlan({
    canonicalModel,
    facts: semanticFacts,
    motifs: { motifs: semanticScene.motifs || [] },
    styleCompilation: compileReferenceStyle({
      style: createPlotNeuralNetStyleSpec(),
      canonicalModel,
    }),
  });
  const publicationLayoutValidation = validatePublicationLayoutPlan(publicationLayoutPlan, canonicalModel);
  if (!publicationLayoutValidation.ok) {
    return invalidSceneContract("publication-layout", publicationLayoutValidation.issues);
  }
  const scene = layoutNeuralScene(semanticScene, { publicationLayoutPlan });
  const sceneValidation = validateLaidOutScene(scene, semanticScene);
  const layoutDiagnostics = sceneValidation.issues.map((issue) => diagnostic(
    "layout-issue",
    "error",
    `Scene layout validation failed: ${issue.code}.`,
    { issueCode: issue.code, issue },
  ));
  if (!sceneValidation.ok) return { sceneValidation, layoutDiagnostics };
  const visioDiagramPlan = createVisioDiagramPlan({ ir: canonicalIR, scene, diagnostics });
  const visioDiagramPlanValidation = validateVisioDiagramPlan(visioDiagramPlan);
  const neuralFigureProgram = planNeuralFigure(canonicalModel, {
    facts: semanticFacts,
    motifs: { motifs: semanticScene.motifs || [] },
  });
  const neuralFigurePlanValidation = validateNeuralFigurePlan(neuralFigureProgram, canonicalModel);
  const publicationVisioDiagramPlan = neuralFigurePlanValidation.ok
    ? compileNeuralFigureDslToVisioLayout(neuralFigureProgram, {
      title: canonicalIR.figure?.title,
      subtitle: canonicalIR.figure?.subtitle,
    })
    : null;
  const publicationVisioDiagramPlanValidation = publicationVisioDiagramPlan
    ? validateVisioDiagramPlan(publicationVisioDiagramPlan)
    : neuralFigurePlanValidation;
  const publicationFigureQa = publicationVisioDiagramPlan
    ? evaluatePublicationFigure(publicationVisioDiagramPlan, {
      canonicalModel,
      neuralFigureProgram,
    })
    : { version: "figure-qa/v1", ok: false, issues: neuralFigurePlanValidation.issues, metrics: {} };
  return {
    visioDiagramPlan: { ...visioDiagramPlan, validation: visioDiagramPlanValidation },
    visioDiagramPlanValidation,
    neuralFigureProgram,
    neuralFigurePlanValidation,
    publicationVisioDiagramPlan,
    publicationVisioDiagramPlanValidation,
    publicationFigureQa,
    sceneValidation,
    layoutDiagnostics,
  };
}

function invalidSceneContract(stage, issues) {
  const validation = { ok: false, issues, summary: { issueCount: issues.length, stage } };
  return {
    sceneValidation: validation,
    layoutDiagnostics: issues.map((issue) => diagnostic(
      "layout-issue",
      "error",
      `Scene contract validation failed at ${stage}: ${issue.code}.`,
      { issueCode: issue.code, stage, issue },
    )),
  };
}

function finalizeResult(rawIR, context = {}) {
  const { evidenceGraph, ir, validation } = buildEvidenceGraphIR(rawIR, context);
  const uniqueDiagnostics = computeDiagnostics(ir, evidenceGraph, validation);
  const hasUncertainty = containsUncertainTopology({
    nodes: ir.nodes,
    diagnostics: uniqueDiagnostics,
  });

  const reviewableUncertainty = hasUncertainty && validation.issues.every((issue) =>
    ["low-confidence-edge", "missing-edge-evidence", "unresolved-edge"].includes(issue.kind)
  );

  if (!validation.ok && !reviewableUncertainty) {
    return {
      status: STATUS.INVALID,
      readyForVisio: false,
      ir: publicIR(ir),
      validation,
      diagnostics: uniqueDiagnostics,
      summary: summaryFor(ir, context.sourceKind),
    };
  }

  const planned = buildVisioPlan(ir, uniqueDiagnostics);
  const diagnostics = dedupeDiagnostics([...uniqueDiagnostics, ...planned.layoutDiagnostics]);
  if (!planned.sceneValidation.ok) {
    return {
      status: STATUS.INVALID,
      readyForVisio: false,
      ir: publicIR(ir),
      sceneValidation: planned.sceneValidation,
      validation,
      diagnostics,
      summary: summaryFor(ir, context.sourceKind),
      source: context.source,
    };
  }
  return {
    status: hasUncertainty ? STATUS.CONFIRM : STATUS.READY,
    readyForVisio: true,
    ir: publicIR(ir),
    visioDiagramPlan: planned.visioDiagramPlan,
    visioDiagramPlanValidation: planned.visioDiagramPlanValidation,
    neuralFigureProgram: planned.neuralFigureProgram,
    neuralFigurePlanValidation: planned.neuralFigurePlanValidation,
    publicationVisioDiagramPlan: planned.publicationVisioDiagramPlan,
    publicationVisioDiagramPlanValidation: planned.publicationVisioDiagramPlanValidation,
    publicationFigureQa: planned.publicationFigureQa,
    validation,
    diagnostics,
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

function assumedShapeDiagnostics(ir) {
  return ir.nodes
    .filter((node) => node.shape?.source === "assumed-default")
    .map((node) => diagnostic(
      "assumed-shape",
      "warning",
      `Node ${node.id} uses an assumed input shape; confirm the tensor shape before publication.`,
      { nodeId: node.id, shape: [...(node.shape.output || [])], confidence: node.shape.confidence }
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
    readyForVisio: false,
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
