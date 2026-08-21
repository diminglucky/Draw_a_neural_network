export const DRAWING_RUN_CONTRACT_VERSION = 1 as const;

export type DrawingRunStatus =
  | "received"
  | "input_accepted"
  | "analyzing"
  | "awaiting_interpreter"
  | "candidate_structure"
  | "awaiting_clarification"
  | "formal_ugs"
  | "composing_pvp"
  | "preview_ready"
  | "awaiting_page_binding"
  | "page_bound"
  | "awaiting_apply_confirmation"
  | "applying"
  | "readback_verified"
  | "cancelled"
  | "rejected"
  | "failed"
  | "conflicted";

export type DrawingIntent = {
  action: "analyze_network" | "create_figure" | "revise_figure";
  requestedDetail: "overview" | "architecture" | "operator_detail";
  target: "browser_preview" | "existing_visio_page";
  sourceKinds: readonly ("typed_text" | "pytorch_source" | "architecture_description" | "sketch")[];
};

export type DrawingRunEventAction =
  | "received"
  | "analyzed"
  | "proposed"
  | "formalized"
  | "clarified"
  | "composed"
  | "bound"
  | "applied"
  | "readback"
  | "failed";

export type DrawingRunEventErrorCategory =
  | "none"
  | "validation"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_invalid"
  | "worker"
  | "conflict"
  | "cancelled";

export type DrawingRunFailureCategory = Exclude<DrawingRunEventErrorCategory, "none">;

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
  event: DrawingRunEvent;
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
  clarification: InternalClarification | null;
  preview: InternalPreview | null;
  idempotencyRecords: readonly DrawingRunIdempotencyRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface DrawingRunCommandBase {
  ownerId: string;
  deviceId: string;
  runId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

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
  | (DrawingRunCommandBase & { type: "cancel"; reasonCategory: "user" | "timeout" | "lease_lost" })
  | (DrawingRunCommandBase & { type: "reject"; errorCategory: DrawingRunFailureCategory })
  | (DrawingRunCommandBase & { type: "fail"; errorCategory: DrawingRunFailureCategory })
  | (DrawingRunCommandBase & { type: "conflict"; conflictHash: string });

export interface DrawingRunTransition {
  next: DrawingRun;
  event: DrawingRunEvent;
  replayed?: true;
}

export interface PublicDrawingRun {
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  allowedActions: readonly DrawingRunCommand["type"][];
  clarification: { id: string; prompt: string } | null;
  preview: { artifactId: string; hash: string } | null;
}

export type DrawingRunSnapshot = PublicDrawingRun;

export function createDrawingRun(input: {
  runId: string;
  ownerId: string;
  deviceId: string;
  intent: DrawingIntent;
  now: string;
}): DrawingRun {
  return {
    version: DRAWING_RUN_CONTRACT_VERSION,
    runId: input.runId,
    ownerId: input.ownerId,
    deviceId: input.deviceId,
    status: "received",
    revision: 0,
    intent: {
      action: input.intent.action,
      requestedDetail: input.intent.requestedDetail,
      target: input.intent.target,
      sourceKinds: [...input.intent.sourceKinds],
    },
    artifactHashes: [],
    privateReceiptIds: [],
    clarification: null,
    preview: null,
    idempotencyRecords: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}
