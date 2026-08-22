import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  AgentVisioExecutionSnapshotService,
  InMemoryAgentVisioExecutionSnapshotStore,
} from "../src/agent-visio-execution-snapshot.js";
import type { VisioExecutor } from "../src/adapters.js";
import { FigureDraftService } from "../src/figure-draft-service.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { completeVisioReadback } from "./fixtures/visio-readback.js";
import { readyVgg16FigureAnalysis } from "./fixtures/ready-vgg16-figure-analysis.js";

const SESSION_SECRET = "agent-visio-export-route-session-secret";

async function registerAndLogin(app: ReturnType<typeof buildApp>) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: "vgg16-owner@example.com",
      password: "password-123",
      device: { name: "Visio PC", publicKey: "public-key-vgg16", fingerprintHash: "fingerprint-vgg16", clientVersion: "0.1.0", osVersion: "Windows 11" },
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: registered.json().user.email, password: "password-123", deviceId: registered.json().device.id },
  });
  return {
    userId: registered.json().user.id as string,
    headers: { authorization: `Bearer ${login.json().accessToken as string}`, "idempotency-key": "agent-vgg16-export-1" },
  };
}

async function waitForJob(app: ReturnType<typeof buildApp>, headers: Record<string, string>, jobId: string) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers });
    if (response.json().status !== "queued" && response.json().status !== "running") return response.json();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Agent VGG16 Visio Job did not finish");
}

describe("Agent VGG16 Visio export route", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("creates a server-bound VGG16 Job and never accepts a browser diagram or session directive", async () => {
    const store = new InMemoryFoundationStore();
    const drafts = new FigureDraftService({ store, createDraftId: () => "draft-vgg16", now: () => "2026-08-19T10:00:00.000Z" });
    const snapshots = new InMemoryAgentVisioExecutionSnapshotStore();
    const executionSnapshots = new AgentVisioExecutionSnapshotService({ foundation: store, figureDraftService: drafts, snapshotStore: snapshots });
    const calls: Parameters<VisioExecutor["executeDiagram"]>[0][] = [];
    const executor: VisioExecutor = {
      healthCheck: async () => ({ connected: true }),
      executeDiagram: async (input) => {
        calls.push(input);
        return { path: `C:\\exports\\${input.jobId}.vsdx`, readback: completeVisioReadback({ shapeCount: 126, connectorCount: 14 }) };
      },
      readback: async () => completeVisioReadback({ shapeCount: 126, connectorCount: 14 }),
    };
    const app = buildApp({
      store,
      sessionSecret: SESSION_SECRET,
      figureDraftService: drafts,
      visioExecutor: executor,
      agentVisioExecutionSnapshotStore: snapshots,
      agentVisioExecutionSnapshotService: executionSnapshots,
    });
    apps.add(app);
    const owner = await registerAndLogin(app);
    await drafts.createFromAnalysis(owner.userId, "conversation-vgg16", readyVgg16FigureAnalysis());

    const rejected = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-vgg16/revisions/1/visio-exports",
      headers: owner.headers,
      payload: { diagram: { unsafe: true }, path: "C:\\unsafe.vsdx", operation: "close", sessionId: "browser-controlled" },
    });
    expect(rejected.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-vgg16/revisions/1/visio-exports",
      headers: owner.headers,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ type: "visio-export", status: "queued", draftId: "draft-vgg16", revision: 1 });

    await expect(waitForJob(app, owner.headers, response.json().id)).resolves.toMatchObject({ status: "succeeded" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userId: owner.userId,
      workflowId: response.json().id,
      operation: "apply",
      diagram: { nodes: [], edges: [], figurePlan: { primitiveGroups: expect.any(Array) } },
    });
    expect(calls[0]).not.toHaveProperty("planHash");
  });
});
