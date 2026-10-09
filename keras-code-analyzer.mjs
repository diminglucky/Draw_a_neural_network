import { normalizeEvidenceMetadata } from "./evidence-metadata.mjs";
import { runPythonTool } from "./python-analyzer-runtime.mjs";

export async function analyzeKerasSource(input = {}, options = {}) {
  const runner = options.runner || runPythonAnalyzer;
  const result = await runner({
    source: input.source,
    framework: input.framework || "keras",
    entryPoint: input.entryPoint || "",
  });
  if (!result || result.status === "error") {
    throw new Error(result?.message || "Keras code analysis failed.");
  }
  return {
    ...result,
    ir: normalizeEvidenceMetadata(result.ir, { sourceId: input.sourceId || "keras-source", analyzer: result.ir?.source?.analyzer || "keras-ast" }),
  };
}

function runPythonAnalyzer(request) {
  return runPythonTool("keras_source_analyzer.py", request);
}
