import path from "node:path";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { hashPassword } from "../apps/api/src/security.js";

const sessionSecret = "visio-api-live-smoke-session-secret-32";
const outputRoot = path.join(process.env.TEMP ?? path.join(process.cwd(), ".tmp"), "synapse-visio-api-route-live-smoke");
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

try {
  const email = `visio-live-${Date.now()}@example.com`;
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password-123",
      device: {
        name: "Visio live smoke",
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

  const response = await app.inject({
    method: "POST",
    url: "/api/visio/export",
    headers: { authorization: `Bearer ${login.json().accessToken}`, "idempotency-key": "visio-api-route-live-smoke" },
    payload: {
      diagram: {
        figure: { title: "API route live smoke", stages: ["Input", "Output"] },
        nodes: [
          { id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 },
          { id: "output", type: "output", label: "Output", stage: 1, x: 700, y: 100, w: 100, h: 100 },
        ],
        edges: [{ id: "edge-1", source: "input", target: "output", type: "signal", route: { points: [{ x: 200, y: 150 }, { x: 700, y: 150 }] } }],
      },
    },
  });
  if (response.statusCode !== 202) throw new Error(`Visio export submission failed: ${response.body}`);
  const submitted = response.json();
  const job = await waitForJob(`Bearer ${login.json().accessToken}`, submitted.id);
  if (job.status !== "succeeded" || job.output?.readback?.valid !== true) throw new Error(`Visio export did not succeed: ${JSON.stringify(job)}`);
  console.log(JSON.stringify({ statusCode: response.statusCode, job }, null, 2));
} finally {
  await app.close();
}
