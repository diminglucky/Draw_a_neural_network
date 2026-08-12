import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FoundationError } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";

const TEST_SESSION_SECRET = "test-session-secret-test-session-secret";

type AgentChatCall = {
  userId: string;
  conversationId: string;
  message: string;
  attachments: Array<{ name: string; mimeType: string; data: string; kind: string }>;
  canvas?: Record<string, unknown>;
  providerApiKey?: string;
};

function createAgentService() {
  const calls: AgentChatCall[] = [];
  return {
    calls,
    service: {
      chat: async (input: AgentChatCall) => {
        calls.push(input);
        return {
          conversationId: input.conversationId,
          status: "completed",
          stages: ["received", "analyzing", "completed"],
          response: "Drafted a publication-style neural network diagram.",
          networkIR: {
            figure: { title: "ResNet draft" },
            nodes: [{ id: "input", kind: "input", label: "Input" }],
            edges: [],
            groups: [],
            annotations: [],
            style: {},
            layout: {},
          },
          diagram: {
            figure: { title: "ResNet draft" },
            paletteName: "publication",
            nodes: [{ id: "input", x: 0, y: 0 }],
            edges: [],
          },
        };
      },
    },
  };
}

async function createAuthorizedApp(agentServiceOverride?: { chat(input: AgentChatCall): Promise<unknown> }) {
  const agent = createAgentService();
  const store = new InMemoryFoundationStore();
  const app = buildApp({
    sessionSecret: TEST_SESSION_SECRET,
    store,
    agentService: agentServiceOverride ?? agent.service,
  } as any);

  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: "agent-user@example.com",
      password: "password-123",
      device: {
        name: "Research PC",
        publicKey: "public-key-a",
        fingerprintHash: "fingerprint-a",
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });

  expect(registered.statusCode).toBe(201);
  const deviceId = registered.json().device.id as string;

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "agent-user@example.com",
      password: "password-123",
      deviceId,
    },
  });

  expect(login.statusCode).toBe(200);

  return {
    app,
    agent,
    store,
    headers: { authorization: `Bearer ${login.json().accessToken as string}` },
  };
}

describe("agent chat routes", () => {
  const apps = new Set<Awaited<ReturnType<typeof buildApp>>>();

  afterEach(async () => {
    for (const app of apps) {
      await app.close();
    }
    apps.clear();
  });

  it("rejects agent chat without a bearer session", async () => {
    const app = buildApp({ sessionSecret: TEST_SESSION_SECRET } as any);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_TOKEN");
  });

  it("returns a stable agent chat payload for an authorized request", async () => {
    const { app, agent, store, headers } = await createAuthorizedApp();
    apps.add(app);

    const attachment = {
      name: "model.py",
      mimeType: "text/x-python",
      kind: "code",
      data: Buffer.from("class Net:\n    pass\n", "utf8").toString("base64"),
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-success-1" },
      payload: {
        message: "Please draft a CNN from this code",
        attachments: [attachment],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversationId: expect.any(String),
      status: "completed",
      stages: ["received", "analyzing", "completed"],
      response: "Drafted a publication-style neural network diagram.",
      networkIR: expect.any(Object),
      diagram: expect.any(Object),
    });
    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0]).toMatchObject({
      userId: expect.any(String),
      conversationId: response.json().conversationId,
      message: "Please draft a CNN from this code",
      attachments: [attachment],
    });

    const agentAudits = (await store.listAuditRecords()).filter((record) => record.action.startsWith("agent.chat."));
    expect(agentAudits.map((record) => record.action)).toEqual(["agent.chat.requested", "agent.chat.completed"]);
    expect(agentAudits[0]?.metadata).toMatchObject({
      conversationId: response.json().conversationId,
      messageChars: "Please draft a CNN from this code".length,
      attachmentCount: 1,
      attachmentKinds: ["code"],
    });
    expect(JSON.stringify(agentAudits)).not.toContain(attachment.data);
    expect(JSON.stringify(agentAudits)).not.toContain("Please draft a CNN from this code");
  });

  it("passes the transient relay API key without writing it to the audit record", async () => {
    const { app, agent, store, headers } = await createAuthorizedApp();
    apps.add(app);
    const providerApiKey = "sk-user-relay-secret";

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-user-key-1", "x-synapse-provider-api-key": providerApiKey },
      payload: { message: "draw a CNN" },
    });

    expect(response.statusCode).toBe(200);
    expect(agent.calls[0]?.providerApiKey).toBe(providerApiKey);
    const audits = await store.listAuditRecords();
    expect(JSON.stringify(audits)).not.toContain(providerApiKey);
  });

  it("passes a bounded current canvas snapshot to the Agent and returns actions", async () => {
    const { app, agent, headers } = await createAuthorizedApp();
    apps.add(app);

    const canvas = {
      figure: { title: "Current CNN" },
      paletteName: "dopamine",
      nodes: [{ id: "input", type: "tensor", x: 100, y: 100, w: 120, h: 180, label: "Input", subtitle: "224 x 224 x 3", stage: 0, color: "#00e5ff" }],
      edges: [],
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "canvas-context-1" },
      payload: { message: "把当前图改成 ResNet", canvas },
    });

    expect(response.statusCode).toBe(200);
    expect(agent.calls[0]?.canvas).toEqual(canvas);
    expect(response.json()).toHaveProperty("actions");
    expect(response.json()).toHaveProperty("diagramIntent");
  });

  it("rejects canvas fields that are not part of the canonical Agent snapshot", async () => {
    const { app, agent, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "canvas-unsafe-1" },
      payload: {
        message: "Inspect this canvas",
        canvas: {
          figure: { title: "Current", apiKey: "secret", serviceConfig: { baseUrl: "https://internal" } },
          nodes: [{ id: "input", type: "tensor", x: 0, y: 0, w: 100, h: 100, label: "Input", subtitle: "", stage: 0, color: "#00e5ff", command: "powershell" }],
          edges: [],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toMatchObject({ field: "canvas", reason: "invalid_canvas" });
    expect(agent.calls).toHaveLength(0);
  });

  it.each([
    {
      name: "conversationId exceeds the maximum length",
      payload: { conversationId: "c".repeat(129), message: "hello" },
      field: "conversationId",
    },
    {
      name: "message exceeds the maximum length",
      payload: { message: "m".repeat(12001) },
      field: "message",
    },
    {
      name: "attachment count exceeds the maximum limit",
      payload: {
        message: "hello",
        attachments: Array.from({ length: 7 }, (_, index) => ({
          name: `code-${index}.py`,
          mimeType: "text/x-python",
          kind: "code",
          data: Buffer.from(`print(${index})`, "utf8").toString("base64"),
        })),
      },
      field: "attachments",
    },
  ])("rejects over-limit requests when $name", async ({ payload, field }) => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "validation-1" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(response.json().error.details.field).toBe(field);
  });

  it("rejects unsupported attachment MIME types", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "mime-1" },
      payload: {
        message: "inspect attachment",
        attachments: [
          {
            name: "weights.bin",
            mimeType: "application/octet-stream",
            kind: "code",
            data: Buffer.from("weights", "utf8").toString("base64"),
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(response.json().error.details).toMatchObject({
      field: "attachments[0].mimeType",
      reason: "unsupported_mime",
    });
  });

  it("rejects blank agent messages at the API boundary", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "blank-1" },
      payload: { message: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(response.json().error.details).toMatchObject({ field: "message", reason: "empty" });
  });

  it("rejects malformed attachment bodies with invalid base64 data", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "base64-1" },
      payload: {
        message: "inspect attachment",
        attachments: [
          {
            name: "model.py",
            mimeType: "text/x-python",
            kind: "code",
            data: "%%%not-base64%%%",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(response.json().error.details).toMatchObject({
      field: "attachments[0].data",
      reason: "invalid_base64",
    });
  });

  it("requires an idempotency key for an authorized agent request", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers,
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toMatchObject({ field: "Idempotency-Key", reason: "required" });
  });

  it("does not invoke the provider twice for a repeated idempotency key", async () => {
    const { app, agent, headers } = await createAuthorizedApp();
    apps.add(app);
    const request = {
      method: "POST" as const,
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "repeat-1" },
      payload: { message: "same request" },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("AGENT_IDEMPOTENCY_KEY_REUSED");
    expect(second.json().error.details.requestHashMatches).toBe(true);
    expect(agent.calls).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different request hash", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);
    const first = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "conflict-1" },
      payload: { message: "first request" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "conflict-1" },
      payload: { message: "different request" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("AGENT_IDEMPOTENCY_KEY_REUSED");
    expect(second.json().error.details.requestHashMatches).toBe(false);
  });

  it("stops provider calls after the trial agent quota is consumed", async () => {
    const { app, agent, store, headers } = await createAuthorizedApp();
    apps.add(app);

    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/chat",
        headers: { ...headers, "idempotency-key": `quota-${index}` },
        payload: { message: `request-${index}` },
      });
      expect(response.statusCode).toBe(200);
    }

    const exceeded = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "quota-exceeded" },
      payload: { message: "one too many" },
    });

    expect(exceeded.statusCode).toBe(429);
    expect(exceeded.json().error.code).toBe("AGENT_QUOTA_EXCEEDED");
    expect(agent.calls).toHaveLength(10);
    expect((await store.listAuditRecords()).some((record) => record.action === "agent.chat.rejected")).toBe(true);
  });

  it("finalizes a failed provider attempt and keeps the consumed quota", async () => {
    const failingService = {
      chat: async () => {
        throw new FoundationError("AGENT_PROVIDER_FAILED", "provider failed", 502);
      },
    };
    const { app, store, headers } = await createAuthorizedApp(failingService);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "failed-provider-1" },
      payload: { message: "provider failure" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("AGENT_PROVIDER_FAILED");
    const requested = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.requested");
    const duplicate = await store.reserveAgentUsage({
      userId: requested!.actorId!,
      metric: "agentChatRequests",
      periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString(),
      idempotencyKey: "failed-provider-1",
      requestHash: "not-the-original-hash",
      amount: 1,
      limit: 10,
    });
    expect(duplicate).toMatchObject({ duplicate: true, reservation: { state: "failed", consumed: 1 } });
  });
});
