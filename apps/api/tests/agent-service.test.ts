import { describe, expect, it, vi } from "vitest";
import { ApiErrorCode } from "../src/domain.js";

async function loadAgentServiceModule() {
  return import("../src/agent-service.js");
}

async function loadAdaptersModule() {
  return import("../src/adapters.js");
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
      "building_ir",
      "layouting",
      "validating",
      "completed",
    ]);
    expect(result.response.provider).toBe("local-deterministic");
    expect(result.response.text).toContain("deterministic");
    expect((result.networkIR as { nodes: Array<{ kind: string }> }).nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["input", "conv", "pool", "dense", "output"]),
    );
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
            text: JSON.stringify({ nodes: [{ id: "input", kind: "input" }, { id: "output", kind: "output" }], edges: [{ source: "input", target: "output" }] }),
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
    expect(requestBody.text.format.name).toBe("network_ir");
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

    expect(observed).toEqual(["received", "analyzing", "building_ir", "layouting", "validating", "completed"]);
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
});
