import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError, type FigureDraft, type FigureDraftRevision, type FigureDraftStatus } from "./domain.js";
import {
  parseFigureDraftConfirmation,
  parseFigureDraftRevisionPayload,
  type FigureDraftResolvedConfirmation,
  type FigureDraftRevisionPayload,
} from "./figure-draft-payload.js";
import type { FigureAnalysisResult } from "./publication-figure-agent.js";
import type { FoundationStore } from "./store.js";
import { adaptCanonicalNetworkIRv2 } from "./network-ir-v2-to-v3.js";
import { projectArchitectureIrV3ToUniversalGraphSpec } from "./universal-graph-spec-adapter.js";

export interface FigureDraftServiceOptions {
  store: FoundationStore;
  createDraftId?: () => string;
  now?: () => string;
}

export interface FigureDraftSnapshot {
  draft: FigureDraft;
  revision: FigureDraftRevision;
}

export type FigureDraftConfirmation = FigureDraftResolvedConfirmation;

export interface FigureDraftConfirmationResult {
  conflict: boolean;
  draft: FigureDraft | null;
  revision: FigureDraftRevision | null;
}

export class FigureDraftService {
  private readonly createDraftId: () => string;
  private readonly now: () => string;

  constructor(private readonly options: FigureDraftServiceOptions) {
    this.createDraftId = options.createDraftId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createFromAnalysis(userId: string, conversationId: string, analysis: FigureAnalysisResult): Promise<FigureDraftSnapshot> {
    const payload = publicPayload(analysis);
    const timestamp = this.now();
    return this.options.store.createFigureDraft({
      id: this.createDraftId(),
      userId,
      conversationId,
      status: payloadStatus(payload),
      createdAt: timestamp,
      updatedAt: timestamp,
    }, payload);
  }

  async get(userId: string, draftId: string): Promise<FigureDraftSnapshot | null> {
    const draft = await this.options.store.getFigureDraft(userId, draftId);
    if (!draft) return null;
    const revision = await this.options.store.getFigureDraftRevision(userId, draftId, draft.currentRevision);
    if (!revision) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft has no current revision", 500);
    return { draft, revision };
  }

  async getRevision(userId: string, draftId: string, revisionNumber: number): Promise<FigureDraftSnapshot | null> {
    const draft = await this.options.store.getFigureDraft(userId, draftId);
    if (!draft) return null;
    const revision = await this.options.store.getFigureDraftRevision(userId, draftId, revisionNumber);
    if (!revision) return null;
    return { draft, revision };
  }

  async confirm(userId: string, draftId: string, expectedRevision: number, answer: FigureDraftConfirmation): Promise<FigureDraftConfirmationResult> {
    const confirmation = parseFigureDraftConfirmation(answer);
    const draft = await this.options.store.getFigureDraft(userId, draftId);
    if (!draft) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft was not found", 404);
    if (draft.currentRevision !== expectedRevision) return { conflict: true, draft: null, revision: null };

    const revision = await this.options.store.getFigureDraftRevision(userId, draftId, expectedRevision);
    if (!revision) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft revision was not found", 500);
    const payload = parseFigureDraftRevisionPayload(revision.payload, { statusCode: 500 });
    const question = payload.blockingQuestions[0];
    if (revision.status !== "needs_confirmation" || payload.blockingQuestions.length !== 1 || !question) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft has no single blocking question to confirm", 409);
    }
    if (question.id !== confirmation.questionId || !question.candidateValues.includes(confirmation.value)) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Confirmation answer must be a candidate of the current blocking question", 400);
    }

    const nextPayload = parseFigureDraftRevisionPayload({
      ...payload,
      blockingQuestions: [],
      resolvedConfirmations: [confirmation],
      readyForVisio: false,
    });
    return this.options.store.appendFigureDraftRevision({
      userId,
      draftId,
      expectedRevision,
      status: "ready_for_preview",
      payload: nextPayload,
      createdAt: this.now(),
    });
  }
}

function publicPayload(analysis: FigureAnalysisResult): FigureDraftRevisionPayload {
  const blockingQuestions = analysis.blockingQuestions.map((question) => ({
    id: question.id,
    question: question.question,
    candidateValues: [...question.candidateValues],
  }));
  const payload = parseFigureDraftRevisionPayload({
    taskIntent: structuredClone(analysis.taskIntent),
    evidence: structuredClone(analysis.evidence),
    canonicalNetworkIR: structuredClone(analysis.canonicalNetworkIR),
    universalGraphSpec: projectArchitectureIrV3ToUniversalGraphSpec(adaptCanonicalNetworkIRv2(analysis.canonicalNetworkIR)),
    blockingQuestions,
    resolvedConfirmations: [],
    warnings: [...analysis.warnings],
    readyForVisio: false,
  });
  if (analysis.readyForVisio !== false || blockingQuestions.length > 1 || payloadStatus(payload) !== analysis.status) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure analysis is not a valid Phase 2 draft payload", 400);
  }
  return payload;
}

function payloadStatus(payload: FigureDraftRevisionPayload): FigureDraftStatus {
  return payload.blockingQuestions.length === 0 ? "ready_for_preview" : "needs_confirmation";
}
