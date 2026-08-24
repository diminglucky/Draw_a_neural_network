import type { DrawingRunErrorCategory } from "./contracts.js";

export type DrawingRunErrorCode =
  | "DRAWING_RUN_IDENTITY_MISMATCH"
  | "DRAWING_RUN_REVISION_CONFLICT"
  | "DRAWING_RUN_TRANSITION_INVALID"
  | "DRAWING_RUN_TERMINAL"
  | "DRAWING_RUN_EVENT_INVALID"
  | "DRAWING_RUN_IDEMPOTENCY_CONFLICT";

export type DrawingRunGuardCategory =
  | "validation"
  | "owner"
  | "device"
  | "run"
  | "revision"
  | "idempotency"
  | "transition"
  | "event";

const safeMessages: Readonly<Record<DrawingRunGuardCategory, string>> = {
  validation: "Drawing run command is invalid.",
  owner: "Drawing run owner does not match.",
  device: "Drawing run device does not match.",
  run: "Drawing run identity does not match.",
  revision: "Drawing run revision is stale.",
  idempotency: "Drawing run idempotency key cannot be replayed with different content.",
  transition: "Drawing run transition is not allowed.",
  event: "Drawing run event is not safe to record.",
};

const codeByCategory: Readonly<Record<DrawingRunGuardCategory, DrawingRunErrorCode>> = {
  validation: "DRAWING_RUN_TRANSITION_INVALID",
  owner: "DRAWING_RUN_IDENTITY_MISMATCH",
  device: "DRAWING_RUN_IDENTITY_MISMATCH",
  run: "DRAWING_RUN_IDENTITY_MISMATCH",
  revision: "DRAWING_RUN_REVISION_CONFLICT",
  idempotency: "DRAWING_RUN_IDEMPOTENCY_CONFLICT",
  transition: "DRAWING_RUN_TRANSITION_INVALID",
  event: "DRAWING_RUN_EVENT_INVALID",
};

function categoryForCode(code: DrawingRunErrorCode): DrawingRunGuardCategory {
  if (code === "DRAWING_RUN_REVISION_CONFLICT") return "revision";
  if (code === "DRAWING_RUN_IDEMPOTENCY_CONFLICT") return "idempotency";
  if (code === "DRAWING_RUN_EVENT_INVALID") return "event";
  if (code === "DRAWING_RUN_IDENTITY_MISMATCH") return "run";
  return "transition";
}

export class DrawingRunError extends Error {
  readonly code: DrawingRunErrorCode;
  readonly category: DrawingRunGuardCategory;

  constructor(category: DrawingRunGuardCategory);
  constructor(code: DrawingRunErrorCode, message: string);
  constructor(categoryOrCode: DrawingRunGuardCategory | DrawingRunErrorCode, message?: string) {
    const isCode = categoryOrCode.startsWith("DRAWING_RUN_");
    const category = isCode ? categoryForCode(categoryOrCode as DrawingRunErrorCode) : categoryOrCode as DrawingRunGuardCategory;
    const code = isCode ? categoryOrCode as DrawingRunErrorCode : codeByCategory[category];
    super(message ?? safeMessages[category]);
    this.name = "DrawingRunError";
    this.code = code;
    this.category = category;
  }
}

export function failDrawingRun(category: DrawingRunGuardCategory): never {
  throw new DrawingRunError(category);
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
