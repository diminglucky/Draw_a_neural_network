import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function resolvePythonToolPath(relativeName) {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  if (moduleDir.includes(".asar")) {
    const resourcesPath = process.resourcesPath || dirname(moduleDir.split(".asar")[0]);
    return join(resourcesPath, "tools", relativeName);
  }
  return fileURLToPath(new URL(`./tools/${relativeName}`, import.meta.url));
}

export function runPythonTool(relativeName, request) {
  const scriptPath = resolvePythonToolPath(relativeName);
  const python = String(process.env.PYTHON || "python").trim() || "python";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error(`Python executable "${python}" was not found. Install Python 3.10+ or set PYTHON to its executable path.`));
        return;
      }
      reject(error);
    });
    child.stdin.end(JSON.stringify(request), "utf8");
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python analyzer failed with exit code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Python analyzer returned invalid JSON: ${error.message}; output=${stdout}`));
      }
    });
  });
}
