import { access } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/api/src/app.js";
import type { AppConfig } from "../apps/api/src/config.js";
import type { AgentServiceContract } from "../apps/api/src/routes.js";
import { InMemoryFoundationStore } from "../apps/api/src/store.js";
import { VisioWorkerClient } from "../apps/api/src/visio-worker-client.js";
import { readyVgg16FigureAnalysis } from "../apps/api/tests/fixtures/ready-vgg16-figure-analysis.js";

const ACCEPTANCE_SWITCH = "SYNAPSE_REAL_VISIO_ACCEPTANCE";

export interface AgentVgg16VisioAcceptanceOptions {
  environment: Record<string, string | undefined>;
  workerPath?: string;
  outputRoot?: string;
  timeoutMs?: number;
}

export interface AgentVgg16VisioAcceptanceSession {
  jobId: string;
  draftId: string;
  revision: number;
  outputPath: string;
  readback: { shapeCount: number; connectorCount: number };
  close(): Promise<void>;
}

export function requireRealVisioAcceptance(environment: Record<string, string | undefined>): void {
  if (environment[ACCEPTANCE_SWITCH] !== "1") {
    throw new Error(`${ACCEPTANCE_SWITCH}=1 is required`);
  }
}

export async function runAgentVgg16VisioAcceptance(options: AgentVgg16VisioAcceptanceOptions): Promise<AgentVgg16VisioAcceptanceSession> {
  requireRealVisioAcceptance(options.environment);
  const workerPath = options.workerPath ?? options.environment.VISIO_WORKER_PATH;
  const outputRoot = options.outputRoot ?? options.environment.VISIO_OUTPUT_ROOT;
  if (!workerPath || !outputRoot) throw new Error("VISIO_WORKER_PATH and VISIO_OUTPUT_ROOT are required");
  await access(workerPath);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const client = new VisioWorkerClient({ workerPath, outputRoot, mode: "live", visible: true, attachToRunning: false, timeoutMs });
  const store = new InMemoryFoundationStore();
  const config: AppConfig = {
    nodeEnv: "development",
    port: 4180,
    sessionSecret: "agent-vgg16-real-visio-session-secret-0001",
    storageDriver: "memory",
    leaseDriver: "memory",
    requireDeviceProof: false,
    visioWorkerPath: workerPath,
    visioOutputRoot: outputRoot,
    visioWorkerMode: "live",
    visioVisible: true,
    visioAttachToRunning: false,
    visioWorkerTimeoutMs: timeoutMs,
    visioMaxConcurrency: 1,
  };
  const app = buildApp({ config, store, visioExecutor: client, agentService: deterministicVgg16Agent() });
  if (options.environment.SYNAPSE_DEBUG_AGENT_VISIO === "1") {
    (app.log as unknown as { error: (...args: unknown[]) => void }).error = (...args) => console.error("[agent-vgg16-visio-debug]", ...args);
  }
  let session: { userId: string; deviceId: string; workflowId: string } | undefined;
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "agent-vgg16-acceptance@example.com",
        password: "agent-vgg16-acceptance-password",
        device: {
          name: "Agent VGG16 acceptance device",
          publicKey: "agent-vgg16-acceptance-public-key",
          fingerprintHash: "agent-vgg16-acceptance-fingerprint",
          clientVersion: "0.0.3",
          osVersion: "Windows",
        },
      },
    });
    if (registered.statusCode !== 201) throw new Error(`Acceptance registration failed: ${registered.statusCode}`);
    const userId = registered.json().user.id as string;
    const deviceId = registered.json().device.id as string;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "agent-vgg16-acceptance@example.com", password: "agent-vgg16-acceptance-password", deviceId },
    });
    if (login.statusCode !== 200) throw new Error(`Acceptance login failed: ${login.statusCode}`);
    const headers = { authorization: `Bearer ${login.json().accessToken as string}` };
    const agent = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-vgg16-draft-1" },
      payload: { conversationId: "agent-vgg16-acceptance", message: "绘制一个顶刊风格的 VGG16 神经网络图，并输出到 Visio。" },
    });
    if (agent.statusCode !== 200 || typeof agent.json().draft?.id !== "string") throw new Error(`Agent VGG16 draft creation failed: ${agent.statusCode}`);
    const draftId = agent.json().draft.id as string;
    const revision = agent.json().draft.currentRevision as number;
    const started = await app.inject({
      method: "POST",
      url: `/api/figure-drafts/${draftId}/revisions/${revision}/visio-exports`,
      headers: { ...headers, "idempotency-key": "agent-vgg16-visio-1" },
      payload: {},
    });
    if (started.statusCode !== 202) {
      const error = started.json().error;
      throw new Error(`Agent VGG16 Visio export start failed: ${started.statusCode} ${typeof error?.code === "string" ? error.code : "UNKNOWN"} ${typeof error?.message === "string" ? error.message : ""}`.trim());
    }
    const jobId = started.json().id as string;
    const completed = await waitForJob(app, headers, jobId, timeoutMs);
    if (completed.status !== "succeeded" || !completed.output?.readback?.valid || typeof completed.output?.path !== "string") {
      throw new Error(`Agent VGG16 Visio export failed: ${completed.errorCode ?? completed.status} ${typeof completed.errorMessage === "string" ? completed.errorMessage : ""}`.trim());
    }
    session = { userId, deviceId, workflowId: jobId };
    return {
      jobId,
      draftId,
      revision,
      outputPath: completed.output.path,
      readback: { shapeCount: completed.output.readback.shapeCount, connectorCount: completed.output.readback.connectorCount },
      close: async () => {
        if (!session) return;
        await client.closeSession(session);
        session = undefined;
        await app.close();
      },
    };
  } catch (error) {
    if (session) await client.closeSession(session).catch(() => {});
    await app.close().catch(() => {});
    throw error;
  }
}

function deterministicVgg16Agent(): AgentServiceContract {
  return {
    chat: async (input) => {
      const analysis = readyVgg16FigureAnalysis();
      return {
        conversationId: input.conversationId,
        status: "completed",
        stages: [],
        response: {
          provider: "local-deterministic",
          text: "已识别并确认 VGG16 的 5 个卷积块、5 次池化和三层分类头。",
          summary: "VGG16 canonical network ready for Visio rendering.",
          confidence: 0.95,
          evidence: [],
          warnings: [],
        },
        networkIR: analysis.canonicalNetworkIR,
        diagram: null,
        diagramIntent: "replace",
        actions: { actions: [] },
        figureAnalysis: analysis,
      };
    },
  };
}

async function waitForJob(app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string>, jobId: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers });
    const job = response.json();
    if (job.status !== "queued" && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Agent VGG16 Visio Job timed out");
}

async function main(): Promise<void> {
  const result = await runAgentVgg16VisioAcceptance({ environment: process.env });
  process.stdout.write(`${JSON.stringify({ status: "DRAWN", jobId: result.jobId, draftId: result.draftId, revision: result.revision, outputPath: result.outputPath, readback: result.readback })}\n`);
  process.stdout.write("Visio remains open. Press Enter in this terminal only when you want to close this Agent-owned VGG16 session.\n");
  process.stdin.resume();
  await once(process.stdin, "data");
  await result.close();
  process.stdout.write("Agent-owned VGG16 Visio session closed.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
