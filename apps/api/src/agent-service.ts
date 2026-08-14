import { ApiErrorCode, FoundationError } from "./domain.js";
import type { AgentAttachment, AgentDraftOutput, AgentEvidence, AgentProvider } from "./adapters.js";
import { applyCanvasActions, parseCanvasActionSet, type CanvasActionSet, type CanvasSnapshot } from "./agent-actions.js";
import { PublicationFigureAgent, type FigureAnalysisResult } from "./publication-figure-agent.js";

export type AgentStageName = "received" | "analyzing" | "evidence" | "building_ir" | "validating" | "layouting" | "completed" | "failed";

export interface AgentStageRecord {
  name: AgentStageName;
  status: "completed" | "failed";
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface AgentChatInput {
  userId: string;
  conversationId?: string;
  message: string;
  attachments?: AgentAttachment[];
  canvas?: CanvasSnapshot;
  providerApiKey?: string;
}

export interface AgentChatResponse {
  provider: AgentDraftOutput["provider"];
  text: string;
  summary: string;
  confidence: number;
  evidence: AgentEvidence[];
  warnings: string[];
}

export interface AgentChatResult {
  conversationId: string;
  status: "completed";
  stages: AgentStageRecord[];
  response: AgentChatResponse;
  networkIR: unknown;
  diagram: unknown;
  diagramIntent: "replace" | "modify" | "explain";
  actions: CanvasActionSet;
  figureAnalysis?: FigureAnalysisResult;
}

export interface AgentChatOptions {
  onStage?: (stage: AgentStageRecord) => void;
}

export interface AgentServiceOptions {
  provider: AgentProvider;
  providerForApiKey?: (apiKey: string) => AgentProvider;
  parseNetworkIR: (value: unknown) => unknown;
  validateNetworkIR?: (value: unknown) => boolean | { valid: boolean; warnings?: string[] };
  layoutNetworkIR?: (value: unknown) => unknown;
  createConversationId?: () => string;
  now?: () => string;
}

export class AgentService {
  private readonly provider: AgentProvider;
  private readonly providerForApiKey?: (apiKey: string) => AgentProvider;
  private readonly parseNetworkIR: (value: unknown) => unknown;
  private readonly validateNetworkIR: (value: unknown) => { valid: boolean; warnings: string[] };
  private readonly layoutNetworkIR: (value: unknown) => unknown;
  private readonly createConversationId: () => string;
  private readonly now: () => string;

  constructor(options: AgentServiceOptions) {
    this.provider = options.provider;
    this.providerForApiKey = options.providerForApiKey;
    this.parseNetworkIR = options.parseNetworkIR;
    this.validateNetworkIR = (value) => {
      const result = options.validateNetworkIR?.(value);
      if (typeof result === "boolean") return { valid: result, warnings: [] };
      if (result && typeof result === "object") return { valid: Boolean(result.valid), warnings: Array.isArray(result.warnings) ? result.warnings : [] };
      return { valid: true, warnings: [] };
    };
    this.layoutNetworkIR = options.layoutNetworkIR ?? ((value) => value);
    this.createConversationId = options.createConversationId ?? (() => `conv-${Date.now()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async chat(input: AgentChatInput, options: AgentChatOptions = {}): Promise<AgentChatResult> {
    const conversationId = input.conversationId?.trim() || this.createConversationId();
    const normalizedInput = {
      userId: input.userId,
      conversationId,
      message: input.message,
      attachments: normalizeAttachments(input.attachments),
      ...(input.canvas ? { canvas: input.canvas } : {}),
      ...(input.providerApiKey ? { providerApiKey: input.providerApiKey } : {}),
    };
    const stages: AgentStageRecord[] = [];
    const pushStage = (name: AgentStageName, status: "completed" | "failed" = "completed", details?: Record<string, unknown>) => {
      const stage: AgentStageRecord = { name, status, timestamp: this.now(), ...(details ? { details } : {}) };
      stages.push(stage);
      options.onStage?.(stage);
      return stage;
    };

    pushStage("received");

    try {
      pushStage("analyzing");
      const provider = normalizedInput.providerApiKey && this.providerForApiKey
        ? this.providerForApiKey(normalizedInput.providerApiKey)
        : this.provider;
      const figureAnalysis = await new PublicationFigureAgent({ provider }).analyze({
        userId: normalizedInput.userId,
        conversationId: normalizedInput.conversationId,
        message: normalizedInput.message,
        attachments: normalizedInput.attachments,
        draftRef: null,
        ...(normalizedInput.canvas ? { canvas: normalizedInput.canvas } : {}),
      });

      pushStage("evidence");

      pushStage("building_ir");
      const draft = await provider.buildDraft(normalizedInput);
      const actions = parseCanvasActionSet(draft.actions ?? { actions: [] });
      if (normalizedInput.canvas && actions.actions.length > 0) applyCanvasActions(normalizedInput.canvas, actions);
      const networkIR = this.parseNetworkIR(draft.networkIR);

      pushStage("validating");
      const validation = this.validateNetworkIR(networkIR);
      if (!validation.valid) {
        throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Validated network IR is invalid", 502);
      }

      pushStage("layouting");
      const diagram = this.layoutNetworkIR(networkIR);

      const response: AgentChatResponse = {
        provider: draft.provider,
        text: draft.responseText,
        summary: draft.summary,
        confidence: draft.confidence,
        evidence: draft.evidence,
        warnings: [...draft.warnings, ...validation.warnings],
      };

      pushStage("completed");
      return {
        conversationId,
        status: "completed",
        stages,
        response,
        networkIR,
        diagram,
        diagramIntent: draft.diagramIntent ?? "replace",
        actions,
        figureAnalysis,
      };
    } catch (error) {
      const foundationError = toFoundationError(error);
      const failedStage = pushStage("failed", "failed", { code: foundationError.code });
      throw new FoundationError(
        foundationError.code,
        foundationError.message,
        foundationError.statusCode,
        {
          ...foundationError.details,
          conversationId,
          stages: [...stages.slice(0, -1), failedStage],
        },
      );
    }
  }
}

function normalizeAttachments(attachments: AgentAttachment[] | undefined): AgentAttachment[] {
  return Array.isArray(attachments)
    ? attachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: attachment.data,
    }))
    : [];
}

function toFoundationError(error: unknown): FoundationError {
  if (error instanceof FoundationError) return error;
  if (error instanceof Error) {
    return new FoundationError(ApiErrorCode.VALIDATION_FAILED, error.message || "Agent request failed", 502);
  }
  return new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Agent request failed", 502);
}
