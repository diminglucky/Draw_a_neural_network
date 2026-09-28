import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeEvidenceMetadata } from "./evidence-metadata.mjs";

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
  const scriptPath = fileURLToPath(new URL("./tools/keras_source_analyzer.py", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("python", [scriptPath], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.stdin.end(JSON.stringify(request), "utf8");
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Keras analyzer failed with exit code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Keras analyzer returned invalid JSON: ${error.message}; output=${stdout}`));
      }
    });
  });
}
