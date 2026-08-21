import { failDrawingRun } from "./errors.js";

export const DRAWING_RUN_CONTRACT_VERSION = 1 as const;

export const drawingRunStatuses = [
  "received", "input_accepted", "analyzing", "awaiting_interpreter", "candidate_structure", "awaiting_clarification",
  "formal_ugs", "composing_pvp", "preview_ready", "awaiting_page_binding", "page_bound", "applying", "readback_verified",
  "cancelled", "rejected", "failed", "conflicted",
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

export const drawingRunEventActions = ["received", "analyzed", "proposed", "formalized", "clarified", "composed", "bound", "applied", "readback", "failed"] as const;

export type DrawingRunEventAction = typeof drawingRunEventActions[number];

export const drawingRunEventErrorCategories = ["none", "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker", "conflict", "cancelled"] as const;

export type DrawingRunEventErrorCategory = typeof drawingRunEventErrorCategories[number];

export type DrawingRunFailureCategory = Exclude<DrawingRunEventErrorCategory, "none" | "conflict" | "cancelled">;

export interface DrawingRunEvent {
  eventId: string;
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  artifactHashes: readonly string[];
  errorCategory: DrawingRunEventErrorCategory;
  occurredAt: string;
}

export interface InternalClarification {
  id: string;
  prompt: string;
  hash: string;
}

export interface InternalPreview {
  artifactId: string;
  hash: string;
}

export interface DrawingRunIdempotencyRecord {
  key: string;
  fingerprint: string;
  response: DrawingRunIdempotencyResponse;
}

export interface DrawingRunTransitionSnapshot {
  runId: string;
  revision: number;
  status: DrawingRunStatus;
}

export interface DrawingRunIdempotencyResponse {
  event: DrawingRunEvent;
  snapshot: DrawingRunTransitionSnapshot;
}

export interface DrawingRun {
  version: typeof DRAWING_RUN_CONTRACT_VERSION;
  runId: string;
  ownerId: string;
  deviceId: string;
  status: DrawingRunStatus;
  revision: number;
  intent: DrawingIntent;
  artifactHashes: readonly string[];
  privateReceiptIds: readonly string[];
  formalUgsHash: string | null;
  clarification: InternalClarification | null;
  preview: InternalPreview | null;
  idempotencyRecords: readonly DrawingRunIdempotencyRecord[];
  createdAt: string;
  updatedAt: string;
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
  occurredAt: string;
}

export const drawingRunCancelReasonCategories = ["user", "timeout", "lease_lost"] as const;
export type DrawingRunCancelReasonCategory = typeof drawingRunCancelReasonCategories[number];

export type DrawingRunCommand =
  | (DrawingRunCommandBase & { type: "accept_input"; receiptIds: readonly string[]; artifactHash: string })
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

export type DrawingRunTransition =
  | { kind: "accepted"; next: DrawingRun; event: DrawingRunEvent }
  | { kind: "replayed"; current: DrawingRun; original: DrawingRunIdempotencyResponse };

export interface PublicDrawingRun {
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  allowedActions: readonly DrawingRunCommand["type"][];
  clarification: { id: string; prompt: string } | null;
  preview: { artifactId: string; hash: string } | null;
}

export type DrawingRunSnapshot = PublicDrawingRun;

const safeOpaqueIdentifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const mintedDrawingRunIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
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
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof DrawingIntent, unknown>>;
  const action = candidate.action;
  const requestedDetail = candidate.requestedDetail;
  const target = candidate.target;
  const rawSourceKinds = candidate.sourceKinds;
  if (typeof action !== "string" || !(drawingIntentActions as readonly string[]).includes(action)) return false;
  if (typeof requestedDetail !== "string" || !(drawingIntentDetailLevels as readonly string[]).includes(requestedDetail)) return false;
  if (typeof target !== "string" || !(drawingIntentTargets as readonly string[]).includes(target)) return false;
  if (!Array.isArray(rawSourceKinds)) return false;
  const sourceKinds = Array.from(rawSourceKinds as readonly unknown[]);
  if (sourceKinds.length === 0) return false;
  if (sourceKinds.some((kind) => typeof kind !== "string" || !(drawingIntentSourceKinds as readonly string[]).includes(kind))) return false;
  return new Set(sourceKinds).size === sourceKinds.length;
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
  return typeof value === "string" && (drawingRunEventErrorCategories as readonly string[]).includes(value);
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
}): DrawingRun {
  if (typeof input !== "object" || input === null) failDrawingRun("validation");
  const candidate = input as Record<string, unknown>;
  const runId = candidate.runId;
  const ownerId = candidate.ownerId;
  const deviceId = candidate.deviceId;
  const now = candidate.now;
  const rawIntent = candidate.intent;
  if (!isDrawingRunId(runId) || !isSafeDrawingRunIdentifier(ownerId) || !isSafeDrawingRunIdentifier(deviceId) || !isDrawingRunTimestamp(now)) {
    failDrawingRun("validation");
  }
  const intent = copyDrawingIntent(rawIntent);

  return {
    version: DRAWING_RUN_CONTRACT_VERSION,
    runId,
    ownerId,
    deviceId,
    status: "received",
    revision: 0,
    intent,
    artifactHashes: [],
    privateReceiptIds: [],
    formalUgsHash: null,
    clarification: null,
    preview: null,
    idempotencyRecords: [],
    createdAt: now,
    updatedAt: now,
  };
}

function copyDrawingIntent(value: unknown): DrawingIntent {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  const action = candidate.action;
  const requestedDetail = candidate.requestedDetail;
  const target = candidate.target;
  const rawSourceKinds = candidate.sourceKinds;
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
  return Object.freeze({
    action: action as DrawingIntent["action"],
    requestedDetail: requestedDetail as DrawingIntent["requestedDetail"],
    target: target as DrawingIntent["target"],
    sourceKinds: Object.freeze(sourceKinds as DrawingIntent["sourceKinds"]),
  });
}
