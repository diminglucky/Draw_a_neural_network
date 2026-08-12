import { readdir } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { hashPassword } from "../apps/api/src/security.js";

const sessionSecret = "visio-api-route-async-live-smoke-session-secret-32";
const outputRoot = path.join(process.env.TEMP ?? path.join(process.cwd(), ".tmp"), `synapse-visio-api-route-async-live-smoke-${Date.now()}`);
const workerPath = path.resolve("workers/visio-worker/src/VisioWorker.Host/bin/Debug/net8.0-windows/VisioWorker.Host.exe");
const config = loadConfig({
  NODE_ENV: "test",
  STORAGE_DRIVER: "memory",
  SESSION_SECRET: sessionSecret,
  VISIO_WORKER_PATH: workerPath,
  VISIO_OUTPUT_ROOT: outputRoot,
  VISIO_WORKER_MODE: "live",
  VISIO_WORKER_TIMEOUT_MS: "120000",
});
const app = buildApp({
  config,
  sessionSecret,
  admin: { email: "admin@example.com", passwordHash: await hashPassword("admin-password") },
});

const diagram = {
  figure: { title: "Async API route live smoke", stages: ["Input", "Output"] },
  nodes: [
    { id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 },
    { id: "output", type: "output", label: "Output", stage: 1, x: 700, y: 100, w: 100, h: 100 },
  ],
  edges: [{ id: "edge-1", source: "input", target: "output", type: "signal", route: { points: [{ x: 200, y: 150 }, { x: 700, y: 150 }] } }],
};

async function waitForJob(authorization: string, jobId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { authorization } });
    if (response.statusCode !== 200) throw new Error(`Job polling failed: ${response.body}`);
    const job = response.json();
    if (["succeeded", "failed", "cancelled", "expired"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} did not reach a terminal state within 120 seconds`);
}

async function vsdxFiles() {
  try {
    return (await readdir(outputRoot)).filter((name) => name.endsWith(".vsdx")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

try {
  const email = `visio-async-live-${Date.now()}@example.com`;
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password-123",
      device: {
        name: "Async Visio live smoke",
        publicKey: "public-key",
        fingerprintHash: "fingerprint",
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  if (registered.statusCode !== 201) throw new Error(`registration failed: ${registered.body}`);
  const deviceId = registered.json().device.id;
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password-123", deviceId } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  const authorization = `Bearer ${login.json().accessToken}`;
  const idempotencyKey = `visio-api-route-async-live-smoke-${Date.now()}`;

  const submittedResponse = await app.inject({
    method: "POST",
    url: "/api/visio/export",
    headers: { authorization, "idempotency-key": idempotencyKey },
    payload: { diagram },
  });
  if (submittedResponse.statusCode !== 202) throw new Error(`expected 202 from Visio submission: ${submittedResponse.body}`);
  const submitted = submittedResponse.json();
  if (submitted.status !== "queued" || submitted.pollUrl !== `/api/jobs/${submitted.id}`) throw new Error(`invalid queued response: ${submittedResponse.body}`);

  const succeeded = await waitForJob(authorization, submitted.id);
  if (succeeded.status !== "succeeded" || succeeded.output?.readback?.valid !== true) throw new Error(`Visio export did not succeed: ${JSON.stringify(succeeded)}`);
  const filesAfterFirstRun = await vsdxFiles();
  if (filesAfterFirstRun.length !== 1) throw new Error(`expected one output file after first run, found ${filesAfterFirstRun.length}`);

  const replay = await app.inject({
    method: "POST",
    url: "/api/visio/export",
    headers: { authorization, "idempotency-key": idempotencyKey },
    payload: { diagram },
  });
  if (replay.statusCode !== 200) throw new Error(`expected 200 from idempotent replay: ${replay.body}`);
  if (replay.json().id !== submitted.id) throw new Error(`idempotent replay returned a different Job: ${replay.body}`);
  const filesAfterReplay = await vsdxFiles();
  if (filesAfterReplay.join("\n") !== filesAfterFirstRun.join("\n")) throw new Error("idempotent replay created a second .vsdx output");

  console.log(JSON.stringify({
    firstStatusCode: submittedResponse.statusCode,
    replayStatusCode: replay.statusCode,
    jobId: succeeded.id,
    status: succeeded.status,
    readback: succeeded.output.readback,
    outputFiles: filesAfterReplay,
  }, null, 2));
} finally {
  await app.close();
}
