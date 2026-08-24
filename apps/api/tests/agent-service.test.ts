import { describe, expect, it, vi } from "vitest";
import { ApiErrorCode } from "../src/domain.js";

async function loadAgentServiceModule() {
  return import("../src/agent-service.js");
}

async function loadAdaptersModule() {
  return import("../src/adapters.js");
}

function validProviderProposal() {
  return {
    provider: "openai-responses",
    responseText: "A bounded analysis proposal is ready.",
    summary: "Analysis proposal ready for deterministic validation.",
    overallConfidence: 0.8,
    taskIntentSuggestion: {},
    evidence: [{
      id: "fact-message",
      subject: "request",
      predicate: "architecture",
      value: "input to output",
      confidence: 0.8,
      source: { sourceId: "source-message", kind: "text", locator: null, excerpt: null },
    }],
    networkCandidate: {
      figure: { id: "figure-1", title: "Draft", description: null },
      nodes: [
        { id: "input", kind: "input", label: "Input", stage: 0, confidence: 0.9, sourceEvidence: [] },
        { id: "output", kind: "output", label: "Output", stage: 1, confidence: 0.9, sourceEvidence: [] },
      ],
      edges: [{ source: "input", target: "output", kind: "flow", skip: false, confidence: 0.9, sourceEvidence: [] }],
      groups: [],
    },
    unresolved: [],
    figureIntentSuggestion: {},
    warnings: [],
  };
}

function createNetworkIrHarness() {
  return {
    parseNetworkIR(value: unknown) {
      const ir = value as { nodes?: Array<{ id: string; kind: string }>; edges?: Array<{ source: string; target: string }> };
      if (!ir || !Array.isArray(ir.nodes) || ir.nodes.length < 2) {
        throw new Error("invalid network ir");
      }
      return {
        figure: { title: "Draft diagram" },
        edges: [],
        groups: [],
        annotations: [],
        style: { paletteName: "deterministic" },
        layout: { algorithm: "publication-v1" },
        ...ir,
      };
    },
    validateNetworkIR(value: unknown) {
      const ir = value as { nodes: Array<{ kind: string }> };
      return { valid: ir.nodes.length >= 2, warnings: [] };
    },
    layoutNetworkIR(value: unknown) {
      const ir = value as { nodes: Array<{ id: string; kind: string }>; edges: Array<{ source: string; target: string }> };
      return {
        figure: { title: "Draft diagram" },
        paletteName: "publication-v1",
        nodes: ir.nodes.map((node, index) => ({
          id: node.id,
          kind: node.kind,
          x: index * 160,
          y: 80,
          width: 120,
          height: 56,
          label: node.kind,
        })),
        edges: ir.edges ?? [],
      };
    },
  };
}

describe("agent service orchestration", () => {
  it("handles text-only local analysis with deterministic stages and draft output", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...networkIr,
      createConversationId: () => "conv-local-1",
      now: () => "2026-08-12T10:00:00.000Z",
    });

    const result = await service.chat({
      userId: "user-1",
      message: "Please draw a CNN: input -> Conv 3x3 -> ReLU -> MaxPool -> Linear -> output.",
      attachments: [],
    });

    expect(result.status).toBe("completed");
    expect(result.conversationId).toBe("conv-local-1");
    expect(result.stages.map((stage: { name: string }) => stage.name)).toEqual([
      "received",
      "analyzing",
      "evidence",
      "building_ir",
      "validating",
      "layouting",
      "completed",
    ]);
    expect(result.response.provider).toBe("local-deterministic");
    expect(result.response.text).toContain("deterministic");
    expect((result.networkIR as { nodes: Array<{ kind: string }> }).nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["input", "conv", "pool", "dense", "output"]),
    );
  });

  it("returns v2 analysis readiness without removing legacy diagram compatibility", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...createNetworkIrHarness(),
      createConversationId: () => "conv-v2-compat",
      now: () => "2026-08-13T10:00:00.000Z",
    });

    const result = await service.chat({
      userId: "user-1",
      message: "Analyze this CNN: input, Conv2d, MaxPool2d, Linear, output.",
      attachments: [],
    });

    expect(result.networkIR).toBeTruthy();
    expect(result.diagram).toBeTruthy();
    expect(result.figureAnalysis).toMatchObject({
      status: "ready_for_preview",
      taskIntent: expect.objectContaining({ action: "analyze_network" }),
      canonicalNetworkIR: expect.objectContaining({ version: 2 }),
      blockingQuestions: [],
      readyForVisio: false,
    });
  });

  it("merges mixed code and image attachments into local evidence without claiming real vision", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...networkIr,
      createConversationId: () => "conv-local-2",
      now: () => "2026-08-12T10:05:00.000Z",
    });

    const result = await service.chat({
      userId: "user-1",
      conversationId: "conv-local-2",
      message: "Sketch and code should describe the same model.",
      attachments: [
        {
          kind: "code",
          name: "model.py",
          mimeType: "text/x-python",
          data: "nn.Conv2d(3, 16, 3)\nnn.MaxPool2d(2)\nnn.Linear(128, 10)",
        },
        {
          kind: "image",
          name: "architecture.png",
          mimeType: "image/png",
          data: "data:image/png;base64,AA==",
        },
      ],
    });

    expect(result.response.provider).toBe("local-deterministic");
    expect(result.response.text).toContain("reference");
    expect(result.response.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "code", label: "model.py" }),
        expect.objectContaining({ kind: "image", label: "architecture.png", confidence: 0.25 }),
      ]),
    );
  });

  it("decodes base64 code attachments before deterministic pattern matching", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...networkIr,
    });

    const result = await service.chat({
      userId: "user-1",
      message: "Analyze the attached model.",
      attachments: [
        {
          kind: "code",
          name: "model.py",
          mimeType: "text/x-python",
          data: Buffer.from("self.conv = nn.Conv2d(3, 16, 3)", "utf8").toString("base64"),
        },
      ],
    });

    expect((result.networkIR as { nodes: Array<{ kind: string }> }).nodes.map((node) => node.kind)).toContain("conv");
  });

  it("rejects invalid OpenAI provider output and never forwards arbitrary tools", async () => {
    const [{ createOpenAIResponsesAgentProvider }] = await Promise.all([loadAdaptersModule()]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.tools).toBeUndefined();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            { type: "tool_call", name: "shell" },
            {
              type: "message",
              content: [{ type: "output_text", text: "{\"nodes\":[{\"id\":\"only\",\"kind\":\"conv\"}],\"edges\":[]}" }],
            },
          ],
        }),
      } satisfies Pick<Response, "ok" | "status" | "json">;
    });

    const provider = createOpenAIResponsesAgentProvider({
      apiKey: "sk-test",
      model: "gpt-5-mini",
      fetchImpl,
      parseNetworkIR: createNetworkIrHarness().parseNetworkIR,
    });

    await expect(provider.buildDraft({
      userId: "user-1",
      conversationId: "conv-openai-1",
      message: "Create an IR from this model.",
      attachments: [],
    })).rejects.toMatchObject({
      code: ApiErrorCode.VALIDATION_FAILED,
      statusCode: 502,
    });
  });

  it("sends image attachments as data URLs and requests strict structured JSON", async () => {
    const [{ createOpenAIResponsesAgentProvider }] = await Promise.all([loadAdaptersModule()]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(validProviderProposal()),
          }],
        }],
      }),
      body: init?.body,
    }));
    const provider = createOpenAIResponsesAgentProvider({
      apiKey: "sk-test",
      fetchImpl,
      parseNetworkIR: createNetworkIrHarness().parseNetworkIR,
    });

    await provider.buildDraft({
      userId: "user-1",
      conversationId: "conv-openai-image",
      message: "Read this architecture sketch.",
      attachments: [{
        kind: "image",
        name: "sketch.png",
        mimeType: "image/png",
        data: "aW1hZ2U=",
      }],
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}"));
    const imageItem = requestBody.input[0].content.find((item: { type?: string }) => item.type === "input_image");
    expect(imageItem.image_url).toBe("data:image/png;base64,aW1hZ2U=");
    expect(requestBody.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
    expect(requestBody.text.format.name).toBe("analysis_proposal");
  });

  it("sends bounded canvas context to OpenAI and separates safe actions from network IR", async () => {
    const [{ createOpenAIResponsesAgentProvider }] = await Promise.all([loadAdaptersModule()]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(validProviderProposal()),
          }],
        }],
      }),
    }));
    const provider = createOpenAIResponsesAgentProvider({
      apiKey: "sk-test",
      fetchImpl,
      parseNetworkIR: createNetworkIrHarness().parseNetworkIR,
    });

    const result = await provider.buildDraft({
      userId: "user-1",
      conversationId: "conv-openai-canvas",
      message: "Rename the current figure title to Updated",
      attachments: [],
      canvas: {
        figure: { title: "Current" },
        paletteName: "dopamine",
        nodes: [{ id: "input", type: "tensor", x: 0, y: 0, w: 100, h: 100, label: "Input", subtitle: "", stage: 0, color: "#00e5ff" }, { id: "output", type: "output", x: 200, y: 0, w: 100, h: 100, label: "Output", subtitle: "", stage: 1, color: "#ff4fd8" }],
        edges: [{ id: "edge-1", source: "input", target: "output", label: "flow", type: "signal", color: "#2846d8" }],
      },
    });

    expect(result.diagramIntent).toBe("modify");
    expect(result.actions.actions).toEqual([{ type: "update_figure", patch: { title: "Updated" } }]);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(requestBody.input[0].content[0].text).toContain("Legacy compatibility canvas context");
  });

  it("projects oversized legacy canvas context before sending it to OpenAI", async () => {
    const [{ createOpenAIResponsesAgentProvider }] = await Promise.all([loadAdaptersModule()]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validProviderProposal()) }] }],
      }),
      body: init?.body,
    }));
    const provider = createOpenAIResponsesAgentProvider({
      apiKey: "sk-test",
      fetchImpl,
      parseNetworkIR: createNetworkIrHarness().parseNetworkIR,
    });
    const nodes = Array.from({ length: 80 }, (_, index) => ({
      id: `oversized-node-${index}`,
      type: "tensor",
      x: index,
      y: index,
      w: 100,
      h: 80,
      label: `Node ${index}`,
      subtitle: "x".repeat(400),
      stage: index,
      color: "#00e5ff",
      shellCommand: "powershell -c whoami",
    }));

    await provider.buildDraft({
      userId: "user-1",
      conversationId: "conv-openai-oversized-canvas",
      message: "Explain the current figure",
      attachments: [],
      canvas: {
        figure: { title: "Current", outputPath: "C:\\output\\figure.vsdx" },
        paletteName: "dopamine",
        nodes,
        edges: Array.from({ length: 80 }, (_, index) => ({ id: `edge-${index}`, source: `oversized-node-${index}`, target: `oversized-node-${(index + 1) % 80}`, label: "flow", type: "signal", color: "#2846d8" })),
      } as any,
    });

    const requestText = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")).input[0].content[0].text as string;
    expect(requestText).not.toContain("oversized-node-79");
    expect(requestText).not.toContain("shellCommand");
    expect(requestText).not.toContain("outputPath");
    expect(requestText.length).toBeLessThan(12000);
  });

  it("reports stage progression in order during a successful run", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...networkIr,
      createConversationId: () => "conv-stage-1",
      now: () => "2026-08-12T10:10:00.000Z",
    });
    const observed: string[] = [];

    await service.chat(
      {
        userId: "user-1",
        message: "input -> Conv -> Pool -> Linear -> output",
        attachments: [],
      },
      {
        onStage(stage: { name: string }) {
          observed.push(stage.name);
        },
      },
    );

    expect(observed).toEqual(["received", "analyzing", "evidence", "building_ir", "validating", "layouting", "completed"]);
  });

  it("uses a request-scoped provider when the desktop supplies a relay API key", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const selectedKeys: string[] = [];
    const defaultProvider = createLocalDeterministicAgentProvider();
    const selectedProvider = createLocalDeterministicAgentProvider();
    const defaultAnalysis = vi.spyOn(defaultProvider, "buildAnalysisProposal");
    const selectedAnalysis = vi.spyOn(selectedProvider, "buildAnalysisProposal");
    const service = new AgentService({
      provider: defaultProvider,
      providerForApiKey: (apiKey) => {
        selectedKeys.push(apiKey);
        return selectedProvider;
      },
      ...networkIr,
      now: () => "2026-08-12T10:20:00.000Z",
    });

    const result = await service.chat({
      userId: "user-1",
      message: "draw a CNN",
      attachments: [],
      providerApiKey: "sk-relay-user-key",
    });

    expect(result.status).toBe("completed");
    expect(selectedKeys).toEqual(["sk-relay-user-key"]);
    expect(defaultAnalysis).not.toHaveBeenCalled();
    expect(selectedAnalysis).toHaveBeenCalled();
  });

  it("fails with AGENT_PROVIDER_NOT_CONFIGURED when no real provider is configured", async () => {
    const [{ AgentService }, { NotConfiguredAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: new NotConfiguredAgentProvider(),
      ...networkIr,
      createConversationId: () => "conv-missing-provider",
      now: () => "2026-08-12T10:15:00.000Z",
    });

    await expect(service.chat({
      userId: "user-1",
      message: "input -> Conv -> Linear -> output",
      attachments: [],
    })).rejects.toMatchObject({
      code: ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED,
      details: {
        conversationId: "conv-missing-provider",
        stages: expect.arrayContaining([
          expect.objectContaining({ name: "received" }),
          expect.objectContaining({ name: "analyzing" }),
          expect.objectContaining({ name: "failed" }),
        ]),
      },
    });
  });

  it("returns a safe canvas modification action when the user asks to change the current diagram", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const networkIr = createNetworkIrHarness();
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...networkIr,
      createConversationId: () => "conv-edit-1",
    });

    const result = await service.chat({
      userId: "user-1",
      message: "把 conv1 改成 128 channels，并把标题改成 Architecture revision",
      canvas: {
        figure: { title: "Current draft" },
        paletteName: "dopamine",
        nodes: [
          { id: "input", type: "tensor", x: 100, y: 100, w: 120, h: 180, label: "Input", subtitle: "224 x 224 x 3", stage: 0, color: "#00e5ff" },
          { id: "conv1", type: "conv", x: 300, y: 100, w: 120, h: 220, label: "Conv 1", subtitle: "64 channels", stage: 1, color: "#ff2aa3" },
        ],
        edges: [{ id: "edge-input-conv1", source: "input", target: "conv1", label: "features", type: "signal", color: "#2846d8" }],
      },
    } as any);

    expect(result.diagramIntent).toBe("modify");
    expect(result.actions.actions).toEqual(expect.arrayContaining([
      { type: "update_node", id: "conv1", patch: { subtitle: "128 channels" } },
      { type: "update_figure", patch: { title: "Architecture revision" } },
    ]));
  });

  it("derives a local structural draft from attached code evidence without a runtime preset", async () => {
    const [{ AgentService }, { createLocalDeterministicAgentProvider }] = await Promise.all([
      loadAgentServiceModule(),
      loadAdaptersModule(),
    ]);
    const service = new AgentService({
      provider: createLocalDeterministicAgentProvider(),
      ...createNetworkIrHarness(),
    });

    const result = await service.chat({
      userId: "user-1",
      message: "Analyze the attached implementation and produce a structural draft.",
      attachments: [{
        kind: "code",
        name: "model.py",
        mimeType: "text/x-python",
        data: "self.stem = nn.Conv2d(3, 24, 3)\nself.gate = SpectralGate()\nself.head = nn.Linear(24, 4)",
      }],
    });

    const ir = result.networkIR as {
      figure: { description: string | null };
      nodes: Array<{ kind: string; subtitle?: string }>;
      style: { preset: string };
    };
    expect(ir.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["conv", "dense"]));
    expect(JSON.stringify(ir)).not.toContain("224 x 224");
    expect(ir.figure.description).toBe("A source-derived structural draft.");
    expect(ir.style.preset).toBe("source-derived");
    expect(result.response.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "code", label: "model.py" }),
    ]));
  });

});
