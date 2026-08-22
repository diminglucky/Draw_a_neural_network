import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FoundationError } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { vi } from "vitest";

const TEST_SESSION_SECRET = "test-session-secret-test-session-secret";
const NO_FIGURE_ANALYSIS = Symbol("no-figure-analysis");

type AgentChatCall = {
  userId: string;
  conversationId: string;
  message: string;
  attachments: Array<{ name: string; mimeType: string; data: string; kind: string }>;
  canvas?: Record<string, unknown>;
  providerApiKey?: string;
};

function maliciousFigureAnalysis(options?: {
  status?: "needs_confirmation" | "ready_for_preview";
  blockingQuestions?: unknown[];
  mutate?: (analysis: Record<string, any>) => void;
}) {
  const analysis: Record<string, any> = {
    status: options?.status ?? "ready_for_preview",
    taskIntent: {
      action: "analyze_network",
      sourceMode: "code",
      requestedArtifact: "structure_only",
      referencesDraftId: null,
      userConstraints: {
        orientation: "auto",
        density: "standard",
        printMode: "auto",
        requiresNativeVisio: false,
        visualRole: "malicious-visual-role",
      },
      outputPath: "C:\\sensitive\\task-intent.vsdx",
    },
    evidence: [{
      id: "fact-network",
      subject: "Network",
      predicate: "contains",
      value: "Conv2d",
      confidence: 0.97,
      source: {
        sourceId: "source-text-1",
        kind: "text",
        name: "User request",
        locator: "line 1: secret locator",
        excerpt: "secret excerpt",
        providerApiKey: "provider-key-inside-evidence",
      },
      primitiveIds: ["shape-1"],
      coordinates: { x: 10, y: 20 },
      outputPath: "C:\\sensitive\\evidence.vsdx",
    }],
    canonicalNetworkIR: {
      version: 2,
      figure: { id: "figure-1", title: "CNN", description: null, visualRole: "tensor-plate" },
      tensors: [{
        id: "tensor-1",
        name: "input",
        shape: [1],
        axes: ["feature"],
        semanticRole: "input",
        dtype: null,
        producerNodeId: "input",
        consumerNodeIds: ["output"],
        coordinates: { x: 0, y: 0 },
      }],
      nodes: [
        {
          id: "input",
          op: "input",
          inputTensorIds: [],
          outputTensorIds: ["tensor-1"],
          confidence: 0.97,
          sourceEvidenceIds: ["fact-network"],
          repeats: null,
          coordinates: { x: 1, y: 2 },
          primitiveIds: ["input-shape"],
        },
        {
          id: "output",
          op: "output",
          inputTensorIds: ["tensor-1"],
          outputTensorIds: [],
          confidence: 0.97,
          sourceEvidenceIds: ["fact-network"],
          repeats: null,
          outputPath: "C:\\sensitive\\output.vsdx",
        },
      ],
      edges: [{
        id: "edge-1",
        sourceNodeId: "input",
        targetNodeId: "output",
        relation: "data",
        tensorIds: ["tensor-1"],
        confidence: 0.97,
        evidenceIds: [],
        coordinates: { beginX: 1, endX: 2 },
      }],
      groups: [],
      unresolved: [],
      primitiveIds: ["diagram-shape-1"],
      outputPath: "C:\\sensitive\\diagram.vsdx",
    },
    blockingQuestions: options?.blockingQuestions ?? [],
    warnings: ["Structural analysis only."],
    readyForVisio: false,
    providerApiKey: "provider-key-at-top-level",
    requestHeaders: { "x-synapse-provider-api-key": "header-provider-key" },
    figurePlan: { primitiveIds: ["plan-shape-1"], coordinates: { x: 300, y: 400 } },
    primitiveIds: ["analysis-shape-1"],
    coordinates: { x: 500, y: 600 },
    outputPath: "C:\\sensitive\\analysis.vsdx",
  };
  options?.mutate?.(analysis);
  return analysis;
}

function createAgentService(
  figureAnalysis: unknown = maliciousFigureAnalysis(),
  response: unknown = "Drafted a publication-style neural network diagram.",
) {
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
          response,
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
          ...(figureAnalysis === NO_FIGURE_ANALYSIS ? {} : { figureAnalysis }),
        };
      },
    },
  };
}

async function createAuthorizedApp(
  agentServiceOverride?: { chat(input: AgentChatCall): Promise<unknown> },
  figureDraftService?: unknown,
) {
  const agent = createAgentService();
  const store = new InMemoryFoundationStore();
  const app = buildApp({
    sessionSecret: TEST_SESSION_SECRET,
    store,
    agentService: agentServiceOverride ?? agent.service,
    ...(figureDraftService ? { figureDraftService } : {}),
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

  it("persists a safe v2 analysis as revision 1 while preserving legacy chat fields", async () => {
    const { app, headers, store } = await createAuthorizedApp();
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-draft-revision-1" },
      payload: { message: "Analyze this CNN" },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload).toMatchObject({
      networkIR: expect.any(Object),
      diagram: expect.any(Object),
      diagramIntent: "replace",
      actions: { actions: [] },
      draft: {
        id: expect.any(String),
        status: "ready_for_preview",
        currentRevision: 1,
      },
    });
    expect(payload.draft).toEqual({
      id: payload.draft.id,
      status: "ready_for_preview",
      currentRevision: 1,
    });

    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    const userId = completedAudit?.actorId;
    if (typeof userId !== "string") throw new Error("completed chat audit must identify the user");
    const persistedDraft = await store.getFigureDraft(userId, payload.draft.id);
    const persistedRevision = await store.getFigureDraftRevision(userId, payload.draft.id, 1);
    expect(persistedDraft).toMatchObject({
      userId,
      conversationId: payload.conversationId,
      status: "ready_for_preview",
      currentRevision: 1,
    });
    expect(persistedRevision).toMatchObject({
      draftId: payload.draft.id,
      revision: 1,
      status: "ready_for_preview",
      payload: expect.objectContaining({
        blockingQuestions: [],
        resolvedConfirmations: [],
        readyForVisio: false,
      }),
    });
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

  it("projects only whitelisted figureAnalysis fields and audit counts", async () => {
    const { app, headers, store } = await createAuthorizedApp();
    apps.add(app);
    const providerApiKey = "relay-secret-must-not-return";

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-v2-privacy-1", "x-synapse-provider-api-key": providerApiKey },
      payload: { message: "Analyze a CNN", attachments: [] },
    });

    expect(response.statusCode).toBe(200);
    const figureAnalysis = response.json().figureAnalysis;
    expect(figureAnalysis).toMatchObject({
      status: "ready_for_preview",
      taskIntent: {
        action: "analyze_network",
        sourceMode: "code",
        requestedArtifact: "structure_only",
        referencesDraftId: null,
        userConstraints: {
          orientation: "auto",
          density: "standard",
          printMode: "auto",
          requiresNativeVisio: false,
        },
      },
      evidence: [{
        id: "fact-network",
        source: { sourceId: "source-text-1", kind: "text", name: "User request" },
      }],
      canonicalNetworkIR: expect.objectContaining({ version: 2 }),
      blockingQuestions: [],
      warnings: ["Structural analysis only."],
      readyForVisio: false,
    });
    const serializedFigureAnalysis = JSON.stringify(figureAnalysis);
    for (const sensitiveValue of [
      providerApiKey,
      "provider-key-inside-evidence",
      "provider-key-at-top-level",
      "header-provider-key",
      "secret locator",
      "secret excerpt",
      "C:\\sensitive\\analysis.vsdx",
      "C:\\sensitive\\diagram.vsdx",
      "malicious-visual-role",
      "analysis-shape-1",
    ]) {
      expect(serializedFigureAnalysis).not.toContain(sensitiveValue);
    }
    for (const sensitiveKey of ["locator", "excerpt", "visualRole", "coordinates", "outputPath", "primitiveIds", "providerApiKey", "requestHeaders", "figurePlan"]) {
      expect(serializedFigureAnalysis).not.toContain(sensitiveKey);
    }

    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    expect(completedAudit?.metadata).toMatchObject({
      figureAnalysisStatus: "ready_for_preview",
      blockingQuestionCount: 0,
      canonicalNodeCount: 2,
      canonicalEdgeCount: 1,
    });
    const serializedAudit = JSON.stringify(completedAudit);
    expect(serializedAudit).not.toContain("secret locator");
    expect(serializedAudit).not.toContain("secret excerpt");
    expect(serializedAudit).not.toContain("provider-key-at-top-level");
    for (const sensitiveAuditKey of ["locator", "excerpt", "providerApiKey", "requestHeaders", "figurePlan", "primitiveIds", "coordinates", "outputPath"]) {
      expect(serializedAudit).not.toContain(sensitiveAuditKey);
    }
  });

  it("persists the one confirmation question from a safe v2 analysis without Visio authorization", async () => {
    const agent = createAgentService(maliciousFigureAnalysis({
      status: "needs_confirmation",
      blockingQuestions: [
        { id: "merge-kind", question: "Is this merge Add or Concat?", candidateValues: ["add", "concat"] },
      ],
    }));
    const { app, headers, store } = await createAuthorizedApp(agent.service);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-needs-confirmation-1" },
      payload: { message: "Analyze a possibly ambiguous network" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().figureAnalysis).toMatchObject({
      status: "needs_confirmation",
      readyForVisio: false,
    });
    expect(response.json().figureAnalysis.blockingQuestions).toEqual([
      { id: "merge-kind", question: "Is this merge Add or Concat?", candidateValues: ["add", "concat"] },
    ]);
    expect(JSON.stringify(response.json().figureAnalysis)).not.toContain("ignored-second-question");
    expect(response.json().draft).toEqual({
      id: expect.any(String),
      status: "needs_confirmation",
      currentRevision: 1,
    });
    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    const userId = completedAudit?.actorId;
    if (typeof userId !== "string") throw new Error("completed chat audit must identify the user");
    const persistedRevision = await store.getFigureDraftRevision(userId, response.json().draft.id, 1);
    expect(persistedRevision).toMatchObject({
      status: "needs_confirmation",
      payload: expect.objectContaining({
        blockingQuestions: [
          { id: "merge-kind", question: "Is this merge Add or Concat?", candidateValues: ["add", "concat"] },
        ],
        resolvedConfirmations: [],
        readyForVisio: false,
      }),
    });
  });

  it.each([
    ["no analysis", NO_FIGURE_ANALYSIS],
    ["an unsafe analysis", maliciousFigureAnalysis({ mutate: (analysis) => { analysis.evidence[0].value = "sk-allowed-field-secret"; } })],
    ["an analysis with inconsistent status and blocking questions", maliciousFigureAnalysis({
      status: "ready_for_preview",
      blockingQuestions: [{ id: "merge-kind", question: "Which merge?", candidateValues: ["add", "concat"] }],
    })],
    ["an analysis with multiple blocking questions", maliciousFigureAnalysis({
      status: "needs_confirmation",
      blockingQuestions: [
        { id: "merge-kind", question: "Which merge?", candidateValues: ["add", "concat"] },
        { id: "second-ambiguity", question: "Which skip path?", candidateValues: ["identity", "projection"] },
      ],
    })],
  ])("omits an invalid FigureAnalysis and does not create a Draft for %s", async (_label, figureAnalysis) => {
    const createFromAnalysis = vi.fn();
    const agent = createAgentService(figureAnalysis);
    const { app, headers, store } = await createAuthorizedApp(agent.service, {
      createFromAnalysis,
      get: vi.fn(),
      confirm: vi.fn(),
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": `agent-no-draft-${_label.replaceAll(" ", "-")}` },
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("figureAnalysis");
    expect(response.json()).not.toHaveProperty("draft");
    expect(createFromAnalysis).not.toHaveBeenCalled();
    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    expect(completedAudit?.metadata).not.toHaveProperty("figureAnalysisStatus");
    expect(completedAudit?.metadata).not.toHaveProperty("blockingQuestionCount");
  });

  it("does not persist an untrusted response provider in usage or audit metadata", async () => {
    const untrustedProvider = "sk-user-relay-secret";
    const agent = createAgentService(NO_FIGURE_ANALYSIS, { provider: untrustedProvider });
    const { app, headers, store } = await createAuthorizedApp(agent.service);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-untrusted-response-provider-1" },
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(200);
    const audits = await store.listAuditRecords();
    const requested = audits.find((record) => record.action === "agent.chat.requested");
    const completed = audits.find((record) => record.action === "agent.chat.completed");
    if (!requested?.actorId) throw new Error("requested audit must identify the user");
    const duplicate = await store.reserveAgentUsage({
      userId: requested.actorId,
      metric: "agentChatRequests",
      periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString(),
      idempotencyKey: "agent-untrusted-response-provider-1",
      requestHash: "not-the-original-hash",
      amount: 1,
      limit: 10,
    });

    expect(duplicate).toMatchObject({ duplicate: true, reservation: { state: "completed", provider: null } });
    expect(completed?.metadata).not.toHaveProperty("provider");
    expect(JSON.stringify({ duplicate, completed })).not.toContain(untrustedProvider);
  });

  it("omits figureAnalysis and audit counts when an allowed evidence value contains a recognizable provider key", async () => {
    const agent = createAgentService(maliciousFigureAnalysis({
      mutate: (analysis) => {
        analysis.evidence[0].value = "sk-allowed-field-secret";
      },
    }));
    const { app, headers, store } = await createAuthorizedApp(agent.service);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-unsafe-evidence-value-1" },
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("figureAnalysis");
    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    expect(completedAudit?.metadata).not.toHaveProperty("figureAnalysisStatus");
  });

  it("omits figureAnalysis and audit counts when Canonical IR evidence is absent from public evidence", async () => {
    const agent = createAgentService(maliciousFigureAnalysis({
      mutate: (analysis) => {
        analysis.canonicalNetworkIR.nodes[0].sourceEvidenceIds = ["fact-not-in-public-evidence"];
      },
    }));
    const { app, headers, store } = await createAuthorizedApp(agent.service);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": "agent-unknown-public-evidence-1" },
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("figureAnalysis");
    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    expect(completedAudit?.metadata).not.toHaveProperty("figureAnalysisStatus");
  });

  it.each([
    ["an oversized warning", (analysis: Record<string, any>) => { analysis.warnings = ["x".repeat(513)]; }],
    ["an unsafe question candidate", (analysis: Record<string, any>) => {
      analysis.status = "needs_confirmation";
      analysis.blockingQuestions = [{ id: "merge-kind", question: "Which merge?", candidateValues: ["add", "powershell -Command invoke"] }];
    }],
    ["an unsafe evidence source name", (analysis: Record<string, any>) => { analysis.evidence[0].source.name = "sk-allowed-field-secret"; }],
  ])("omits figureAnalysis and audit counts for %s", async (_label, mutate) => {
    const agent = createAgentService(maliciousFigureAnalysis({ mutate }));
    const { app, headers, store } = await createAuthorizedApp(agent.service);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: { ...headers, "idempotency-key": `agent-unsafe-public-field-${_label.replace(/[^a-z]/gi, "-")}` },
      payload: { message: "Analyze this network" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("figureAnalysis");
    const completedAudit = (await store.listAuditRecords()).find((record) => record.action === "agent.chat.completed");
    expect(completedAudit?.metadata).not.toHaveProperty("figureAnalysisStatus");
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

  it("exposes an owner-scoped Drawing Run state and controlled cancellation", async () => {
    const { app, headers } = await createAuthorizedApp();
    apps.add(app);
    const start = await app.inject({
      method: "POST",
      url: "/api/drawing-runs",
      headers: { ...headers, "idempotency-key": "drawing-run-start-1" },
      payload: {
        intent: {
          action: "create_figure",
          requestedDetail: "overview",
          target: "browser_preview",
          sourceKinds: ["typed_text"],
        },
      },
    });
    expect(start.statusCode).toBe(201);
    expect(start.json()).toMatchObject({ status: "received", revision: 0, allowedActions: ["accept_input", "cancel"] });
    expect(start.json()).not.toHaveProperty("privateReceiptIds");

    const runId = start.json().runId as string;
    const read = await app.inject({ method: "GET", url: `/api/drawing-runs/${runId}`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(start.json());

    const cancel = await app.inject({
      method: "POST",
      url: `/api/drawing-runs/${runId}/cancel`,
      headers: { ...headers, "idempotency-key": "drawing-run-cancel-1" },
      payload: { expectedRevision: 0 },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ status: "cancelled", revision: 1, allowedActions: [] });
  });
});
