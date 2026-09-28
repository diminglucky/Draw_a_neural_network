import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function createVisioWorkerClient(options = {}) {
  const hostPath = options.hostPath || fileURLToPath(new URL("./visio-worker-host.mjs", import.meta.url));
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 180000;
  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let stderr = "";

  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    const text = String(line || "").trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      rejectAll(new Error(`Invalid Visio worker output: ${error.message}`));
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error || "Visio worker request failed."));
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectAll);
  child.on("close", (code) => {
    closed = true;
    rejectAll(new Error(`Visio worker exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
  });

  function request(type, payload = {}) {
    if (closed) return Promise.reject(new Error("Visio worker is closed."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Visio worker request timed out after ${timeoutMs}ms.`);
        reject(error);
        failWorker(error);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
    });
  }

  function rejectAll(error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  }

  function failWorker(error) {
    closed = true;
    rejectAll(error);
    killProcessTree(child);
  }

  return {
    ping: () => request("ping"),
    render: (layout, renderOptions = {}) => request("render", { layout, options: renderOptions }),
    async close() {
      if (closed) return;
      try {
        await request("shutdown");
      } catch {
        killProcessTree(child);
      }
      closed = true;
    },
    get closed() { return closed; },
  };
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {}
  }
  try { child.kill(); } catch {}
}
