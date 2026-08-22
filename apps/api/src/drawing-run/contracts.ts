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
  sourceKinds: Array<"typed_text" | "pytorch_source" | "architecture_description" | "sketch">;
};

export type DrawingRunErrorCategory =
  | "none"
  | "validation"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_invalid"
  | "worker"
  | "conflict"
  | "cancelled";

export interface DrawingClarification {
  id: string;
  prompt: string;
  hash: string;
}

export interface DrawingPreview {
  artifactId: string;
  hash: string;
}

export interface DrawingRun {
  runId: string;
  ownerId: string;
  deviceId: string;
  status: DrawingRunStatus;
  revision: number;
  intent: DrawingIntent;
  artifactHashes: string[];
  privateReceiptIds: string[];
  startIdempotencyKey?: string;
  startRequestHash?: string;
  createdAt: string;
  updatedAt: string;
  clarification: DrawingClarification | null;
  preview: DrawingPreview | null;
  errorCategory: DrawingRunErrorCategory;
}

export interface DrawingRunCommandBase {
  ownerId: string;
  deviceId: string;
  runId: string;
  expectedRevision: number;
  idempotencyKey: string;
  now?: string;
}

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
  | (DrawingRunCommandBase & { type: "cancel"; reasonCategory: "user" | "timeout" | "lease_lost" })
  | (DrawingRunCommandBase & { type: "reject"; errorCategory: string })
  | (DrawingRunCommandBase & { type: "fail"; errorCategory: string })
  | (DrawingRunCommandBase & { type: "conflict"; conflictHash: string });

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
  allowedActions: DrawingRunCommand["type"][];
  clarification: { id: string; prompt: string } | null;
  preview: DrawingPreview | null;
}

export type DrawingRunSnapshot = PublicDrawingRun;

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

export type ResumeDrawingRunInput = DrawingRunCommandInput;

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

export type CancelDrawingRunInput = DrawingRunCommandInput;

export function createDrawingRun(input: {
  runId: string;
  ownerId: string;
  deviceId: string;
  intent: DrawingIntent;
  now: string;
  startIdempotencyKey?: string;
  startRequestHash?: string;
}): DrawingRun {
  return {
    runId: input.runId,
    ownerId: input.ownerId,
    deviceId: input.deviceId,
    status: "received",
    revision: 0,
    intent: structuredClone(input.intent),
    artifactHashes: [],
    privateReceiptIds: [],
    startIdempotencyKey: input.startIdempotencyKey ?? `start:${input.runId}`,
    startRequestHash: input.startRequestHash ?? "0".repeat(64),
    createdAt: input.now,
    updatedAt: input.now,
    clarification: null,
    preview: null,
    errorCategory: "none",
  };
}
