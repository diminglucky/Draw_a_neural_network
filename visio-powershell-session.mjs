import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildVisioRenderPlan, validateVisioReadback } from "./visio-bridge.mjs";

export function createPersistentVisioSession(options = {}) {
  const scriptPath = options.scriptPath || fileURLToPath(new URL("./visio-bridge.ps1", import.meta.url));
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-WorkerMode",
  ], {
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let queue = Promise.resolve();
  let pending = null;
  let stderr = "";
  let closed = false;

  output.on("line", (line) => {
    const text = String(line || "").trim();
    if (!text || !pending) return;
    const waiter = pending;
    pending = null;
    try {
      const payload = JSON.parse(text);
      if (payload.status === "error") waiter.reject(new Error(payload.message || "Visio bridge request failed."));
      else waiter.resolve(payload);
    } catch (error) {
      waiter.reject(new Error(`Persistent Visio bridge returned invalid JSON: ${error.message}; output=${text}`));
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    closed = true;
    pending?.reject(error);
    pending = null;
  });
  child.on("close", (code) => {
    closed = true;
    pending?.reject(new Error(`Persistent Visio bridge exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
    pending = null;
  });

  function sendPlan(plan) {
    if (closed) return Promise.reject(new Error("Persistent Visio session is closed."));
    if (pending) return Promise.reject(new Error("Persistent Visio session already has an in-flight request."));
    const encoded = Buffer.from(JSON.stringify(plan), "utf8").toString("base64");
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      child.stdin.write(`${encoded}\n`);
    });
  }

  return {
    render(layout, renderOptions = {}) {
      queue = queue.then(async () => {
        const plan = buildVisioRenderPlan(layout, renderOptions);
        const result = await sendPlan(plan);
        const readbackValidation = validateVisioReadback(plan, result.readback || result);
        return {
          plan,
          ...result,
          status: result.status === "rendered" && !readbackValidation.ok ? "readback_failed" : result.status,
          readbackValidation,
        };
      });
      return queue;
    },
    async close() {
      if (closed) return;
      try { child.stdin.end(); } catch {}
      const exited = await waitForExit(child, options.shutdownTimeoutMs || 1500);
      if (!exited) {
        try { child.kill(); } catch {}
      }
      closed = true;
    },
    get closed() { return closed; },
  };
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
  });
}
