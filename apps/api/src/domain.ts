import type { FigureDraftRevisionPayload } from "./figure-draft-payload.js";

export type {
  FigureAnalysisBlockingQuestion,
  FigureAnalysisCreationResult,
  FigureAnalysisRecord,
  FigureAnalysisSourceRef,
  FigureAnalysisStatus,
  PublicFigureAnalysis,
} from "./figure-analysis.js";

export const ApiErrorCode = {
  ACCOUNT_ALREADY_IN_USE: "ACCOUNT_ALREADY_IN_USE",
  SESSION_REVOKED: "SESSION_REVOKED",
  AGENT_PROVIDER_NOT_CONFIGURED: "AGENT_PROVIDER_NOT_CONFIGURED",
  AGENT_QUOTA_EXCEEDED: "AGENT_QUOTA_EXCEEDED",
  AGENT_IDEMPOTENCY_KEY_REUSED: "AGENT_IDEMPOTENCY_KEY_REUSED",
  FIGURE_STRUCTURE_NEEDS_CONFIRMATION: "FIGURE_STRUCTURE_NEEDS_CONFIRMATION",
  FIGURE_ANALYSIS_INVALID: "FIGURE_ANALYSIS_INVALID",
  VISIO_EXECUTOR_NOT_CONFIGURED: "VISIO_EXECUTOR_NOT_CONFIGURED",
  VISIO_EXECUTION_FAILED: "VISIO_EXECUTION_FAILED",
  VISIO_IDEMPOTENCY_KEY_REUSED: "VISIO_IDEMPOTENCY_KEY_REUSED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_TOKEN: "INVALID_TOKEN",
  DEVICE_NOT_AUTHORIZED: "DEVICE_NOT_AUTHORIZED",
  DEVICE_PROOF_REQUIRED: "DEVICE_PROOF_REQUIRED",
  DEVICE_PROOF_INVALID: "DEVICE_PROOF_INVALID",
  DEVICE_CHALLENGE_INVALID: "DEVICE_CHALLENGE_INVALID",
  SUBSCRIPTION_REQUIRED: "SUBSCRIPTION_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  JOB_NOT_CANCELLABLE: "JOB_NOT_CANCELLABLE",
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  USER_DISABLED: "USER_DISABLED",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export class FoundationError extends Error {
  constructor(
    public readonly code: ApiErrorCode | string,
    message: string,
    public readonly statusCode = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FoundationError";
  }
}

export type EntityStatus = "active" | "suspended" | "revoked" | "disabled";
export type SessionStatus = "active" | "revoked" | "expired" | "logged_out";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
export type FigureDraftStatus = "needs_confirmation" | "ready_for_preview" | "failed";

export interface FigureDraft {
  id: string;
  userId: string;
  conversationId: string;
  status: FigureDraftStatus;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface FigureDraftRevision {
  draftId: string;
  revision: number;
  status: FigureDraftStatus;
  payload: FigureDraftRevisionPayload;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  status: EntityStatus;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Device {
  id: string;
  userId: string | null;
  name: string;
  publicKey: string;
  fingerprintHash: string;
  status: EntityStatus;
  clientVersion: string;
  osVersion: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface DeviceChallenge {
  id: string;
  userId: string;
  deviceId: string;
  value: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  deviceId: string;
  status: SessionStatus;
  accessTokenId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  leaseFencingToken: number;
  revokedAt: string | null;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: string;
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  startsAt: string;
  endsAt: string | null;
  features: string[];
  limits: Record<string, number>;
}

export interface Job {
  id: string;
  userId: string;
  deviceId: string;
  type: "chat" | "code-analysis" | "image-analysis" | "visio-export" | "universal-figure-export";
  status: JobStatus;
  input: unknown;
  output: unknown | null;
  errorCode: ApiErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface VisioJobCreationResult {
  job: Job;
  duplicate: boolean;
  requestHashMatches: boolean;
}

export interface AuditRecord {
  id: string;
  actorType: "user" | "admin" | "system";
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AgentUsageMetric = "agentChatRequests";
export type AgentUsageState = "accepted" | "completed" | "failed" | "unknown";

export interface AgentUsageReservationInput {
  userId: string;
  metric: AgentUsageMetric;
  periodStart: string;
  idempotencyKey: string;
  requestHash: string;
  amount: number;
  limit: number;
}

export interface AgentUsageReservation {
  id: string;
  userId: string;
  metric: AgentUsageMetric;
  periodStart: string;
  idempotencyKey: string;
  requestHash: string;
  amount: number;
  limit: number;
  consumed: number;
  remaining: number;
  state: AgentUsageState;
  outcome: string | null;
  provider: string | null;
  errorCode: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface AgentUsageDuplicate {
  duplicate: true;
  requestHashMatches: boolean;
  reservation: AgentUsageReservation;
}

export interface AgentUsageFinalizationInput {
  id: string;
  state: Exclude<AgentUsageState, "accepted">;
  outcome: string;
  provider?: string;
  errorCode?: string;
  finalizedAt?: string;
}
