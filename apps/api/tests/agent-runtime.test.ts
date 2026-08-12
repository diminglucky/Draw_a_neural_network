import { describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { loadConfig } from "../src/config.js";
import { createAgentServiceForConfig, resolveAgentProvider } from "../src/agent-runtime.js";

const TEST_SECRET = "test-session-secret-test-session-secret";

describe("agent runtime wiring", () => {
  it("uses the deterministic provider for development without a provider key", async () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      SESSION_SECRET: TEST_SECRET,
    });

    const runtime = resolveAgentProvider(config, {});
    expect(runtime.kind).toBe("local-deterministic");

    const service = createAgentServiceForConfig(config, { layoutNetworkIR: (ir) => ir });
    const result = await service.chat({
      userId: "user-1",
      message: "input -> Conv -> MaxPool -> Linear -> output",
      attachments: [],
    });

    expect(result.status).toBe("completed");
    expect(result.response.provider).toBe("local-deterministic");
  });

  it("keeps production without a provider key explicitly unavailable", async () => {
    const config = loadConfig({
      NODE_ENV: "production",
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgres://synapse:synapse@127.0.0.1:5432/synapse",
      SESSION_SECRET: "production-session-secret-production-secret",
    });

    const runtime = resolveAgentProvider(config, {});
    expect(runtime.kind).toBe("not-configured");

    const service = createAgentServiceForConfig(config, { layoutNetworkIR: (ir) => ir });
    await expect(service.chat({
      userId: "user-1",
      message: "draw a network",
      attachments: [],
    })).rejects.toMatchObject({ code: ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED });
  });

  it("selects the server-side OpenAI provider only when a key is configured", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      SESSION_SECRET: TEST_SECRET,
    });

    const runtime = resolveAgentProvider(config, { OPENAI_API_KEY: "sk-server-only" });
    expect(runtime.kind).toBe("openai-responses");
  });

  it("uses the publication layout validator for the default local diagram", async () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      SESSION_SECRET: TEST_SECRET,
    });

    const service = createAgentServiceForConfig(config);
    const result = await service.chat({
      userId: "user-1",
      message: "input -> Conv -> MaxPool -> Linear -> output",
      attachments: [],
    });
    const diagram = result.diagram as {
      nodes: Array<{ bwStyle?: unknown }>;
      validation?: { ok?: boolean; summary?: { overlapCount?: number } };
    };

    expect(diagram.validation?.ok).toBe(true);
    expect(diagram.validation?.summary?.overlapCount).toBe(0);
    expect(diagram.nodes.every((node) => node.bwStyle)).toBe(true);
  });
});
