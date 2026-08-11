import { ApiErrorCode, FoundationError } from "./domain.js";

export interface ChatInput {
  message: string;
}

export interface CodeAnalysisInput {
  source: string;
  framework?: string;
}

export interface ImageAnalysisInput {
  dataUrl: string;
  prompt?: string;
}

export interface AnalysisResult {
  summary: string;
  document: unknown | null;
}

export interface AgentProvider {
  chat(input: ChatInput): Promise<{ text: string }>;
  analyzeCode(input: CodeAnalysisInput): Promise<AnalysisResult>;
  analyzeImage(input: ImageAnalysisInput): Promise<AnalysisResult>;
}

export interface VisioHealthResult {
  connected: boolean;
  reason?: string;
}

export interface VisioExecutor {
  healthCheck(): Promise<VisioHealthResult>;
  executeDiagram(input: { jobId: string }): Promise<{ path: string }>;
  readback(input: { path: string }): Promise<{ valid: boolean; shapeCount: number }>;
}

export class NotConfiguredAgentProvider implements AgentProvider {
  async chat(_input: ChatInput): Promise<{ text: string }> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }

  async analyzeCode(_input: CodeAnalysisInput): Promise<AnalysisResult> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }

  async analyzeImage(_input: ImageAnalysisInput): Promise<AnalysisResult> {
    throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent provider is not configured", 503);
  }
}

export class NotConnectedVisioExecutor implements VisioExecutor {
  async healthCheck(): Promise<VisioHealthResult> {
    return { connected: false, reason: ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED };
  }

  async executeDiagram(_input: { jobId: string }): Promise<{ path: string }> {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio executor is not configured", 503);
  }

  async readback(_input: { path: string }): Promise<{ valid: boolean; shapeCount: number }> {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio executor is not configured", 503);
  }
}
