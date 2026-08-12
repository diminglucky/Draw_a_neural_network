import type { AppConfig } from "./config.js";
import { AgentService } from "./agent-service.js";
import {
  createLocalDeterministicAgentProvider,
  createOpenAIResponsesAgentProvider,
  NotConfiguredAgentProvider,
  type AgentProvider,
} from "./adapters.js";
import { parseNetworkIR, validateNetworkIR, type NetworkIR } from "./network-ir.js";
import { layoutNetworkIR as layoutPublicationNetworkIR } from "../../../publication-layout.js";

export type AgentProviderKind = "local-deterministic" | "openai-responses" | "not-configured";

export interface AgentRuntimeEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
}

export interface ResolvedAgentProvider {
  kind: AgentProviderKind;
  provider: AgentProvider;
}

export interface AgentRuntimeOptions {
  layoutNetworkIR?: (value: unknown) => unknown;
}

export function resolveAgentProvider(
  config: Pick<AppConfig, "nodeEnv">,
  environment: AgentRuntimeEnvironment = process.env,
): ResolvedAgentProvider {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (apiKey) {
    return {
      kind: "openai-responses",
      provider: createOpenAIResponsesAgentProvider({
        apiKey,
        model: environment.OPENAI_MODEL,
        baseUrl: environment.OPENAI_BASE_URL,
      }),
    };
  }

  if (config.nodeEnv === "development" || config.nodeEnv === "test") {
    return {
      kind: "local-deterministic",
      provider: createLocalDeterministicAgentProvider(),
    };
  }

  return {
    kind: "not-configured",
    provider: new NotConfiguredAgentProvider(),
  };
}

export function createAgentServiceForConfig(
  config: Pick<AppConfig, "nodeEnv">,
  options: AgentRuntimeOptions = {},
  environment: AgentRuntimeEnvironment = process.env,
): AgentService {
  const resolved = resolveAgentProvider(config, environment);
  return new AgentService({
    provider: resolved.provider,
    parseNetworkIR,
    validateNetworkIR: (value) => {
      const result = validateNetworkIR(value);
      return {
        valid: result.valid,
        warnings: result.issues.map((issue) => `${issue.code}: ${issue.message}`),
      };
    },
    layoutNetworkIR: options.layoutNetworkIR ?? ((value) => layoutPublicationNetworkIR(value as NetworkIR)),
  });
}
