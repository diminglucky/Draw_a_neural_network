export const ApiErrorCode = {
  ACCOUNT_ALREADY_IN_USE: "ACCOUNT_ALREADY_IN_USE",
  SESSION_REVOKED: "SESSION_REVOKED",
  AGENT_PROVIDER_NOT_CONFIGURED: "AGENT_PROVIDER_NOT_CONFIGURED",
  VISIO_EXECUTOR_NOT_CONFIGURED: "VISIO_EXECUTOR_NOT_CONFIGURED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_TOKEN: "INVALID_TOKEN",
  DEVICE_NOT_AUTHORIZED: "DEVICE_NOT_AUTHORIZED",
  SUBSCRIPTION_REQUIRED: "SUBSCRIPTION_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  JOB_NOT_CANCELLABLE: "JOB_NOT_CANCELLABLE",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type EntityStatus = "active" | "suspended" | "revoked" | "disabled";
export type SessionStatus = "active" | "revoked" | "expired" | "logged_out";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

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

export interface Session {
  id: string;
  userId: string;
  deviceId: string;
  status: SessionStatus;
  accessTokenId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
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
  type: "chat" | "code-analysis" | "image-analysis" | "visio-export";
  status: JobStatus;
  input: unknown;
  output: unknown | null;
  errorCode: ApiErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
