import { createHash } from "node:crypto";
import { failDrawingRun } from "./errors.js";

export const DRAWING_RUN_CONTRACT_VERSION = 1 as const;

export const drawingRunStatuses = [
  "received", "input_accepted", "analyzing", "awaiting_interpreter", "candidate_structure", "awaiting_clarification",
  "formal_ugs", "composing_pvp", "preview_ready", "awaiting_page_binding", "page_bound", "awaiting_apply_confirmation",
  "applying", "readback_verified", "cancelled", "rejected", "failed", "conflicted",
] as const;
export type DrawingRunStatus = typeof drawingRunStatuses[number];

export const drawingIntentActions = ["analyze_network", "create_figure", "revise_figure"] as const;
export const drawingIntentDetailLevels = ["overview", "architecture", "operator_detail"] as const;
export const drawingIntentTargets = ["browser_preview", "existing_visio_page"] as const;
export const drawingIntentSourceKinds = ["typed_text", "pytorch_source", "architecture_description", "sketch"] as const;

export type DrawingIntent = {
  action: typeof drawingIntentActions[number];
  requestedDetail: typeof drawingIntentDetailLevels[number];
  target: typeof drawingIntentTargets[number];
  sourceKinds: readonly (typeof drawingIntentSourceKinds[number])[];
};

export const drawingRunErrorCategories = [
  "none", "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker", "conflict", "cancelled",
] as const;
export type DrawingRunErrorCategory = typeof drawingRunErrorCategories[number];
export type DrawingRunEventErrorCategory = DrawingRunErrorCategory;
export type DrawingRunFailureCategory = Exclude<DrawingRunErrorCategory, "none" | "conflict" | "cancelled">;

export const drawingRunEventActions = [
  "received", "analyzed", "proposed", "formalized", "clarified", "composed", "bound", "applied", "readback", "failed",
] as const;
export type DrawingRunEventAction = typeof drawingRunEventActions[number];

export interface DrawingClarification {
  id: string;
  prompt: string;
  hash: string;
}
export type InternalClarification = DrawingClarification;

export interface DrawingPreview {
  artifactId: string;
  hash: string;
}
export type InternalPreview = DrawingPreview;

export interface DrawingRun {
  runId: string;
  ownerId: string;
  deviceId: string;
  status: DrawingRunStatus;
  revision: number;
  intent: DrawingIntent;
  artifactHashes: string[];
  privateReceiptIds: string[];
  startIdempotencyKey: string;
  startRequestHash: string;
  createdAt: string;
  updatedAt: string;
  clarification: DrawingClarification | null;
  preview: DrawingPreview | null;
  errorCategory: DrawingRunErrorCategory;
  /**
   * Role binding used by the reducer. It is optional at the storage DTO
   * boundary because the current PostgreSQL row predates this field; the
   * reducer reconstructs it from the canonical artifact tail when possible.
   */
  formalUgsHash?: string | null;
}

export interface DrawingRunTrustedScope {
  runId: string;
  ownerId: string;
  deviceId: string;
}

export interface DrawingRunCommandBase {
  ownerId: string;
  deviceId: string;
  runId: string;
  expectedRevision: number;
  idempotencyKey: string;
  occurredAt?: string;
  now?: string;
}

export const drawingRunCancelReasonCategories = ["user", "timeout", "lease_lost"] as const;
export type DrawingRunCancelReasonCategory = typeof drawingRunCancelReasonCategories[number];

export type DrawingRunCommand =
  | (DrawingRunCommandBase & { type: "accept_input"; receiptIds: string[]; artifactHash: string })
  | (DrawingRunCommandBase & { type: "begin_analysis"; policyHash: string })
  | (DrawingRunCommandBase & { type: "request_interpreter"; evidencePackHash: string })
  | (DrawingRunCommandBase & { type: "record_candidate"; candidateHash: string })
  | (DrawingRunCommandBase & { type: "formalize_ugs"; ugsHash: string })
  | (DrawingRunCommandBase & { type: "request_clarification"; clarificationHash: string })
  | (DrawingRunCommandBase & { type: "answer_clarification"; clarificationId: string; answerHash: string })
  | (DrawingRunCommandBase & { type: "compose_pvp"; ugsHash: string })
  | (DrawingRunCommandBase & { type: "publish_preview"; pvpHash: string; qaHash: string })
  | (DrawingRunCommandBase & { type: "discover_page_target"; discoveryHash: string })
  | (DrawingRunCommandBase & { type: "bind_page"; bindingHash: string })
  | (DrawingRunCommandBase & { type: "request_apply"; authorizationHash: string })
  | (DrawingRunCommandBase & { type: "verify_readback"; readbackHash: string })
  | (DrawingRunCommandBase & { type: "cancel"; reasonCategory: DrawingRunCancelReasonCategory })
  | (DrawingRunCommandBase & { type: "reject"; errorCategory: DrawingRunFailureCategory })
  | (DrawingRunCommandBase & { type: "fail"; errorCategory: DrawingRunFailureCategory })
  | (DrawingRunCommandBase & { type: "conflict"; conflictHash: string });

export interface DrawingRunEvent {
  eventId: string;
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  artifactHashes: string[];
  errorCategory: DrawingRunErrorCategory;
  occurredAt: string;
  requestHash?: string;
}

export interface DrawingRunTransition {
  next: DrawingRun;
  event: DrawingRunEvent;
}

export interface PublicDrawingRun {
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  errorCategory: DrawingRunErrorCategory;
  allowedActions: DrawingRunCommand["type"][];
  clarification: { id: string; prompt: string } | null;
  preview: DrawingPreview | null;
}

export interface PublicDrawingRunEvent {
  eventId: string;
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  errorCategory: DrawingRunErrorCategory;
  occurredAt: string;
}

export type DrawingRunSnapshot = PublicDrawingRun;

export const DRAWING_CLARIFICATION_CONFIRMATION_HASH = createHash("sha256")
  .update(JSON.stringify("confirm"), "utf8")
  .digest("hex");

export interface DrawingRunCommandInput {
  ownerId: string;
  deviceId: string;
  runId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface StartDrawingRunInput extends Omit<DrawingRunCommandInput, "runId" | "expectedRevision"> {
  intent: DrawingIntent;
}

export interface AcceptDrawingInput extends DrawingRunCommandInput {
  receiptIds: string[];
  artifactHash: string;
}

export type ResumeDrawingRunInput = DrawingRunCommandInput;

export interface DiscoverPageTargetInput extends DrawingRunCommandInput {
  discoveryIdentity: string;
}

export interface AnswerClarificationInput extends DrawingRunCommandInput {
  clarificationId: string;
  answer: string;
}

export interface BindExistingPageInput extends DrawingRunCommandInput {
  pageTargetHandle: string;
  ownedRegionId: string;
}

export interface RequestDrawingApplyInput extends DrawingRunCommandInput {
  confirmationNonce: string;
}

export interface RequestDrawingApplyResult {
  run: DrawingRunSnapshot;
  replayed: boolean;
}

export interface VerifyDrawingReadbackInput extends DrawingRunCommandInput {
  readback: unknown;
}

export interface FailDrawingRunInput extends DrawingRunCommandInput {
  errorCategory: DrawingRunFailureCategory;
}

export type CancelDrawingRunInput = DrawingRunCommandInput;

const safeOpaqueIdentifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const mintedDrawingRunIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isSafeDrawingRunIdentifier(value: unknown): value is string {
  return typeof value === "string" && safeOpaqueIdentifierPattern.test(value);
}

export function isDrawingRunId(value: unknown): value is string {
  return typeof value === "string" && mintedDrawingRunIdPattern.test(value);
}

export function isDrawingRunArtifactHash(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

export function isDrawingIntent(value: unknown): value is DrawingIntent {
  try {
    copyDrawingIntent(value);
    return true;
  } catch {
    return false;
  }
}

export function isDrawingRunCancelReasonCategory(value: unknown): value is DrawingRunCancelReasonCategory {
  return typeof value === "string" && (drawingRunCancelReasonCategories as readonly string[]).includes(value);
}

export function isDrawingRunStatus(value: unknown): value is DrawingRunStatus {
  return typeof value === "string" && (drawingRunStatuses as readonly string[]).includes(value);
}

export function isDrawingRunEventAction(value: unknown): value is DrawingRunEventAction {
  return typeof value === "string" && (drawingRunEventActions as readonly string[]).includes(value);
}

export function isDrawingRunEventErrorCategory(value: unknown): value is DrawingRunEventErrorCategory {
  return typeof value === "string" && (drawingRunErrorCategories as readonly string[]).includes(value);
}

export function isDrawingRunFailureCategory(value: unknown): value is DrawingRunFailureCategory {
  return isDrawingRunEventErrorCategory(value) && value !== "none" && value !== "conflict" && value !== "cancelled";
}

export function isDrawingRunTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !utcTimestampPattern.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function createDrawingRun(input: {
  runId: string;
  ownerId: string;
  deviceId: string;
  intent: DrawingIntent;
  now: string;
  startIdempotencyKey?: string;
  startRequestHash?: string;
}): DrawingRun {
  if (typeof input !== "object" || input === null) failDrawingRun("validation");
  const source = input as Record<string, unknown>;
  const runId = source.runId;
  const ownerId = source.ownerId;
  const deviceId = source.deviceId;
  const now = source.now;
  const startIdempotencyKey = source.startIdempotencyKey ?? (typeof runId === "string" ? `start:${runId}` : "");
  const startRequestHash = source.startRequestHash ?? "0".repeat(64);
  const intent = copyDrawingIntent(source.intent);

  if (!isDrawingRunId(runId)
    || !isSafeDrawingRunIdentifier(ownerId)
    || !isSafeDrawingRunIdentifier(deviceId)
    || !isSafeDrawingRunIdentifier(startIdempotencyKey)
    || !isDrawingRunArtifactHash(startRequestHash)
    || !isDrawingRunTimestamp(now)) {
    failDrawingRun("validation");
  }

  return {
    runId,
    ownerId,
    deviceId,
    status: "received",
    revision: 0,
    intent,
    artifactHashes: [],
    privateReceiptIds: [],
    startIdempotencyKey,
    startRequestHash: startRequestHash.toLowerCase(),
    createdAt: now,
    updatedAt: now,
    clarification: null,
    preview: null,
    errorCategory: "none",
    formalUgsHash: null,
  };
}

function copyDrawingIntent(value: unknown): DrawingIntent {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const source = value as Record<string, unknown>;
  const action = source.action;
  const requestedDetail = source.requestedDetail;
  const target = source.target;
  const rawSourceKinds = source.sourceKinds;

  if (typeof action !== "string" || !(drawingIntentActions as readonly string[]).includes(action)
    || typeof requestedDetail !== "string" || !(drawingIntentDetailLevels as readonly string[]).includes(requestedDetail)
    || typeof target !== "string" || !(drawingIntentTargets as readonly string[]).includes(target)
    || !Array.isArray(rawSourceKinds)) {
    failDrawingRun("validation");
  }

  const sourceKinds = Array.from(rawSourceKinds as readonly unknown[]);
  if (sourceKinds.length === 0
    || sourceKinds.some((kind) => typeof kind !== "string" || !(drawingIntentSourceKinds as readonly string[]).includes(kind))
    || new Set(sourceKinds).size !== sourceKinds.length) {
    failDrawingRun("validation");
  }

  return {
    action: action as DrawingIntent["action"],
    requestedDetail: requestedDetail as DrawingIntent["requestedDetail"],
    target: target as DrawingIntent["target"],
    sourceKinds: sourceKinds as DrawingIntent["sourceKinds"],
  };
}
