import type { DrawingRunErrorCategory } from "./contracts.js";

export type DrawingRunErrorCode =
  | "DRAWING_RUN_IDENTITY_MISMATCH"
  | "DRAWING_RUN_REVISION_CONFLICT"
  | "DRAWING_RUN_TRANSITION_INVALID"
  | "DRAWING_RUN_TERMINAL"
  | "DRAWING_RUN_EVENT_INVALID"
  | "DRAWING_RUN_IDEMPOTENCY_CONFLICT";

export class DrawingRunError extends Error {
  readonly code: DrawingRunErrorCode;

  constructor(code: DrawingRunErrorCode, message: string) {
    super(message);
    this.name = "DrawingRunError";
    this.code = code;
  }
}

export type DrawingWorkflowFailureCategory = Exclude<DrawingRunErrorCategory, "none" | "cancelled" | "conflict">;

export class DrawingWorkflowError extends Error {
  readonly category: DrawingWorkflowFailureCategory;
  readonly causeValue: unknown;

  constructor(category: DrawingWorkflowFailureCategory, message: string, causeValue?: unknown) {
    super(message);
    this.name = "DrawingWorkflowError";
    this.category = category;
    this.causeValue = causeValue;
  }
}

export function classifyProviderFailure(error: unknown): Exclude<DrawingWorkflowFailureCategory, "worker" | "validation"> {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (isTimeoutCode(code) || /\b(?:timeout|timed out|deadline exceeded)\b/i.test(message)) return "provider_timeout";
  if (isUnavailableCode(code) || /\b(?:unavailable|connection refused|service unavailable|temporarily down)\b/i.test(message)) return "provider_unavailable";
  if (/\b(?:invalid|malformed|schema|parse|decode)\b/i.test(message)) return "provider_invalid";
  return "provider_unavailable";
}

export function classifyDrawingWorkflowFailure(error: unknown): DrawingWorkflowFailureCategory {
  if (error instanceof DrawingWorkflowError) return error.category;
  return "worker";
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : null;
}

function isTimeoutCode(code: string | null): boolean {
  return code === "ETIMEDOUT" || code === "ECONNABORTED" || code === "ABORT_ERR" || code === "UND_ERR_CONNECT_TIMEOUT";
}

function isUnavailableCode(code: string | null): boolean {
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EHOSTUNREACH" || code === "SERVICE_UNAVAILABLE";
}
