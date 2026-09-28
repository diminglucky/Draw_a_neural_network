import { normalizeNetworkIR } from "./network-ir.mjs";
import { createArchitectureEvidencePackage } from "./architecture-evidence-package.mjs";
import { architectureEvidencePackageToEvidenceGraph, evidenceGraphToUniversalIR } from "./evidence-graph.mjs";
import { importArchitectureConfig } from "./architecture-config-importer.mjs";
import { importOnnxGraph } from "./onnx-graph-importer.mjs";
import { analyzeTorchSource } from "./torch-code-analyzer.mjs";
import { analyzeKerasSource } from "./keras-code-analyzer.mjs";
import { fuseGraphEvidence } from "./graph-evidence-fusion.mjs";
import { normalizeEvidenceMetadata } from "./evidence-metadata.mjs";
import { resolveArchitectureRequest } from "./architecture-resolver.mjs";
import { inferShapes } from "./shape-inference.mjs";

export async function collectAutomaticEvidenceSources(input = {}, options = {}) {
  const sources = [];
  if (input.ir) {
    sources.push({ id: "explicit-ir", authority: 10, analyzer: "explicit-ir", ir: normalizeEvidenceMetadata(input.ir, { sourceId: "explicit-ir", analyzer: "explicit-ir" }) });
  }
  if (input.source) {
    await collectSourceEvidence(input.source, input, sources, options);
  }
  if (input.config !== undefined) {
    const imported = importArchitectureConfig(input.config, {
      sourceId: input.sourceId || "config-source",
      revision: input.revision,
      uri: input.metadata?.uri,
      authority: input.metadata?.authority || 6,
    });
    sources.push(toEvidenceSource("config-source", 6, "config", imported, input));
  }
  if (input.artifact) {
    const format = String(input.artifact.format || "").toLowerCase();
    if (format !== "onnx") {
      sources.push({
        id: "artifact-source",
        authority: 8,
        analyzer: "artifact",
        ir: unresolvedIR("artifact", `Unsupported artifact format ${format || "unknown"}.`),
      });
    } else {
      const imported = importOnnxGraph(decodeArtifactData(input.artifact.data), {
        sourceId: input.sourceId || "onnx-source",
        revision: input.revision,
        uri: input.metadata?.uri,
        authority: input.metadata?.authority || 8,
      });
      sources.push(toEvidenceSource("onnx-source", 8, "onnx", imported, input));
    }
  }
  if (input.repository && repositoryDependenciesAvailable(options)) {
    await collectRepositoryEvidence(input, options, sources);
  }
  for (const source of input.sources || []) {
    sources.push({
      id: String(source.id || `evidence-${sources.length + 1}`),
      authority: Number.isFinite(source.authority) ? source.authority : 0,
      analyzer: String(source.analyzer || "evidence"),
      ir: normalizeEvidenceMetadata(source.ir || {}, { sourceId: source.id, analyzer: source.analyzer }),
    });
  }
  return sources;
}

export async function fuseAutomaticEvidence(input = {}, options = {}) {
  const sources = await collectAutomaticEvidenceSources(input, options);
  return {
    ...fuseGraphEvidence(sources),
    sources,
  };
}

function analyzerList(framework, options) {
  if (framework === "keras" || framework === "tensorflow" || framework === "tf") {
    return [{ id: "keras-ast", framework: "keras", authority: 3, fn: options.kerasAnalyzer || analyzeKerasSource }];
  }
  if (framework === "pytorch" || framework === "torch" || framework === "auto") {
    return [{ id: "torch-ast", framework: "pytorch", authority: 3, fn: options.torchAnalyzer || analyzeTorchSource }];
  }
  return [];
}

function toEvidenceSource(id, authority, analyzer, imported, input) {
  const pkg = createArchitectureEvidencePackage({
    status: imported.status,
    request: { kind: input.kind || analyzer, sourceId: id },
    identity: { revision: input.revision, uri: input.metadata?.uri },
    sources: imported.sources,
    claims: imported.claims,
    graph: imported.graph,
    diagnostics: imported.diagnostics,
    unresolvedQuestions: [],
  });
  const evidenceGraph = architectureEvidencePackageToEvidenceGraph(pkg);
  const ir = normalizeNetworkIR(evidenceGraphToUniversalIR(evidenceGraph));
  return { id, authority, analyzer, ir: normalizeEvidenceMetadata(ir, { sourceId: id, analyzer }) };
}

async function collectRepositoryEvidence(input, options, sources) {
  let resolved;
  try {
    resolved = await resolveArchitectureRequest({ ...input, kind: "repository" }, options.resolver || options);
  } catch (error) {
    sources.push({
      id: input.sourceId || "repository-source",
      authority: 4,
      analyzer: "repository",
      ir: unresolvedIR("repository", error.message),
    });
    return;
  }

  if (resolved.status !== "resolved" || !Array.isArray(resolved.sources) || !resolved.sources.length) {
    const message = resolved.diagnostics?.map((item) => item.code || item.message).filter(Boolean).join(", ")
      || `Repository resolution returned ${resolved.status || "no sources"}.`;
    sources.push({
      id: input.sourceId || "repository-source",
      authority: 4,
      analyzer: "repository",
      ir: unresolvedIR("repository", message),
    });
    return;
  }

  for (const source of resolved.sources) {
    const id = String(source.id || input.sourceId || "repository-source");
    if (isPythonSource(source)) {
      await collectSourceEvidence(source.content, {
        ...input,
        sourceId: id,
        framework: input.framework || "auto",
        entryPoint: input.entryPoint || source.path || "",
      }, sources, options, `${id}-`, source.authority || input.metadata?.authority || 4);
      continue;
    }
    const analyzer = isOnnxSource(source) ? "onnx" : "repository-config";
    const imported = isOnnxSource(source)
      ? importOnnxGraph(decodeArtifactData(source.content), {
        sourceId: id,
        revision: source.revision,
        uri: source.uri,
        authority: source.authority || input.metadata?.authority || 4,
      })
      : importArchitectureConfig(source.content, {
        sourceId: id,
        revision: source.revision,
        uri: source.uri,
        authority: source.authority || input.metadata?.authority || 4,
      });
    sources.push(toEvidenceSource(id, source.authority || input.metadata?.authority || 4, analyzer, imported, {
      ...input,
      sourceId: id,
      revision: source.revision,
      metadata: { ...(input.metadata || {}), uri: source.uri },
    }));
  }
}

function repositoryDependenciesAvailable(options = {}) {
  const dependencies = options.resolver || options;
  return typeof dependencies.fetchRepository === "function";
}

function isOnnxSource(source = {}) {
  return String(source.kind || "").toLowerCase() === "artifact"
    || String(source.path || "").toLowerCase().endsWith(".onnx")
    || String(source.format || "").toLowerCase() === "onnx";
}

function isPythonSource(source = {}) {
  return String(source.kind || "").toLowerCase() === "source"
    || String(source.path || "").toLowerCase().endsWith(".py")
    || String(source.format || "").toLowerCase() === "python";
}

async function collectSourceEvidence(sourceText, input, sources, options, idPrefix = "", authorityOverride) {
  const framework = String(input.framework || "auto").toLowerCase();
  for (const analyzer of analyzerList(framework, options)) {
    const sourceId = `${idPrefix}${analyzer.id}-source`;
    const authority = Number.isFinite(authorityOverride) ? authorityOverride : analyzer.authority;
    try {
      const result = await analyzer.fn({ ...input, source: sourceText, framework: analyzer.framework }, options);
      if (result?.ir && result.status !== "error") {
        const inferred = withShapeInference(result.ir);
        sources.push({
          id: sourceId,
          authority,
          analyzer: analyzer.id,
          ir: normalizeEvidenceMetadata(inferred, { sourceId, analyzer: analyzer.id }),
        });
      }
    } catch (error) {
      sources.push({
        id: sourceId,
        authority,
        analyzer: analyzer.id,
        ir: unresolvedIR(analyzer.id, error.message, sourceId),
      });
    }
  }
}

function withShapeInference(ir = {}) {
  const normalized = normalizeNetworkIR(ir);
  inferShapes(normalized.nodes, normalized.edges);
  return normalized;
}

function decodeArtifactData(data) {
  if (typeof data === "string") return Buffer.from(data, "base64");
  if (data?.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
  return data;
}

function unresolvedIR(analyzer, message, sourceId = `${analyzer}-source`) {
  return normalizeEvidenceMetadata({
    version: "universal-neural-ir/v1",
    source: { kind: "source", analyzer },
    nodes: [{
      id: `${analyzer}-unresolved`,
      op: "UnresolvedSourceGraph",
      family: "custom",
      compoundKind: "unresolved",
      confidence: 0.2,
      evidence: [{ kind: "analyzer-error", analyzer, message }],
    }],
    edges: [],
  }, { sourceId, analyzer });
}
