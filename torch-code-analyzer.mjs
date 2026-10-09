import { normalizeEvidenceMetadata } from "./evidence-metadata.mjs";
import { runPythonTool } from "./python-analyzer-runtime.mjs";

export async function analyzeTorchSource(input = {}, options = {}) {
  const runner = options.runner || runPythonAnalyzer;
  const result = await runner({
    source: input.source,
    framework: input.framework || "pytorch",
    entryPoint: input.entryPoint || "",
    inputShape: input.inputShape || null,
    allowExecution: options.allowExecution === true || input.allowExecution === true,
  });
  if (!result || result.status === "error") {
    throw new Error(result?.message || "PyTorch code analysis failed.");
  }
  return {
    ...result,
    ir: normalizeEvidenceMetadata(result.ir, { sourceId: input.sourceId || "torch-source", analyzer: result.ir?.source?.analyzer || "python-ast" }),
  };
}

function runPythonAnalyzer(request) {
  return runPythonTool("torch_source_analyzer.py", request);
}
