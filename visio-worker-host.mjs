#!/usr/bin/env node
import { createInterface } from "node:readline";
import { buildVisioRenderPlan, renderUniversalFigureToVisio } from "./visio-bridge.mjs";
import { createPersistentVisioSession } from "./visio-powershell-session.mjs";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
let shuttingDown = false;
let persistentSession = null;

input.on("line", (line) => {
  queue = queue.then(() => handleLine(line)).catch((error) => {
    write({ id: null, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

input.on("close", () => {
  if (!shuttingDown) shutdownAndExit(0);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdownAndExit(0));
}

async function handleLine(line) {
  const text = String(line || "").trim();
  if (!text) return;
  let request;
  try {
    request = JSON.parse(text);
  } catch (error) {
    write({ id: null, ok: false, error: `Invalid worker JSON: ${error.message}` });
    return;
  }
  const id = request?.id ?? null;
  try {
    if (request.type === "ping") {
      write({ id, ok: true, result: { status: "pong" } });
      return;
    }
    if (request.type === "shutdown") {
      shuttingDown = true;
      await shutdownPersistentSession();
      write({ id, ok: true, result: { status: "shutdown" } });
      input.close();
      process.exit(0);
      return;
    }
    if (request.type !== "render") {
      write({ id, ok: false, error: `Unknown worker request type: ${request.type}` });
      return;
    }
    const result = process.env.VISIO_DRY_RUN === "1"
      ? { status: "dry_run", plan: buildVisioRenderPlan(request.layout, request.options || {}) }
      : await renderWithPersistentSession(request.layout, request.options || {});
    write({ id, ok: true, result });
  } catch (error) {
    write({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function renderWithPersistentSession(layout, options) {
  if (process.env.VISIO_PERSISTENT_COM === "0") {
    return renderUniversalFigureToVisio(layout, options);
  }
  if (!persistentSession) persistentSession = createPersistentVisioSession();
  return persistentSession.render(layout, options);
}

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function shutdownPersistentSession() {
  const session = persistentSession;
  persistentSession = null;
  if (session) {
    try { await session.close(); } catch {}
  }
}

async function shutdownAndExit(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await shutdownPersistentSession();
  process.exit(code);
}
