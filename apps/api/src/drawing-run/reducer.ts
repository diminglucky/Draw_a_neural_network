import {
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunErrorCategory,
  type DrawingRunEventAction,
  type DrawingRunStatus,
  type DrawingRunTransition,
} from "./contracts.js";
import { DrawingRunError } from "./errors.js";

const terminalStatuses = new Set<DrawingRunStatus>(["readback_verified", "cancelled", "rejected", "failed", "conflicted"]);
const transitions = new Map<DrawingRunStatus, Partial<Record<DrawingRunCommand["type"], DrawingRunStatus>>>([
  ["received", { accept_input: "input_accepted" }],
  ["input_accepted", { begin_analysis: "analyzing" }],
  ["analyzing", { request_interpreter: "awaiting_interpreter", record_candidate: "candidate_structure" }],
  ["awaiting_interpreter", { record_candidate: "candidate_structure" }],
  ["candidate_structure", { formalize_ugs: "formal_ugs", request_clarification: "awaiting_clarification" }],
  ["awaiting_clarification", { answer_clarification: "analyzing" }],
  ["formal_ugs", { compose_pvp: "composing_pvp" }],
  ["composing_pvp", { publish_preview: "preview_ready" }],
  ["preview_ready", { discover_page_target: "awaiting_page_binding" }],
  ["awaiting_page_binding", { bind_page: "page_bound" }],
  ["page_bound", { request_apply: "applying" }],
  ["applying", { verify_readback: "readback_verified" }],
]);

const actionByCommand: Record<DrawingRunCommand["type"], DrawingRunEventAction> = {
  accept_input: "received",
  begin_analysis: "analyzed",
  request_interpreter: "proposed",
  record_candidate: "proposed",
  formalize_ugs: "formalized",
  request_clarification: "clarified",
  answer_clarification: "analyzed",
  compose_pvp: "composed",
  publish_preview: "composed",
  discover_page_target: "bound",
  bind_page: "bound",
  request_apply: "applied",
  verify_readback: "readback",
  cancel: "failed",
  reject: "failed",
  fail: "failed",
  conflict: "failed",
};

export function reduceDrawingRun(state: DrawingRun, command: DrawingRunCommand): DrawingRunTransition {
  validateCommand(state, command);
  const nextStatus = terminalStatuses.has(state.status)
    ? undefined
    : transitions.get(state.status)?.[command.type];
  const controlStatus = controlStatusFor(command);
  if (!nextStatus && !controlStatus) {
    if (terminalStatuses.has(state.status)) {
      throw new DrawingRunError("DRAWING_RUN_TERMINAL", `Run is already terminal: ${state.status}`);
    }
    throw new DrawingRunError("DRAWING_RUN_TRANSITION_INVALID", `Invalid transition: ${state.status} -> ${command.type}`);
  }

  const next: DrawingRun = {
    ...structuredClone(state),
    status: nextStatus ?? controlStatus!,
    revision: state.revision + 1,
    updatedAt: command.now ?? state.updatedAt,
    artifactHashes: [...state.artifactHashes],
    privateReceiptIds: [...state.privateReceiptIds],
  };

  applyCommandEffects(next, command);
  const event: DrawingRunTransition["event"] = {
    eventId: `${state.runId}:${next.revision}:${command.type}`,
    runId: state.runId,
    revision: next.revision,
    status: next.status,
    action: actionByCommand[command.type],
    artifactHashes: [...next.artifactHashes],
    errorCategory: next.errorCategory,
    occurredAt: next.updatedAt,
  };
  return { next, event };
}

function validateCommand(state: DrawingRun, command: DrawingRunCommand): void {
  if (command.ownerId !== state.ownerId) {
    throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Owner does not match the Drawing Run");
  }
  if (command.deviceId !== state.deviceId) {
    throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Device does not match the Drawing Run");
  }
  if (command.runId !== state.runId) {
    throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Run ID does not match the Drawing Run");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== state.revision) {
    throw new DrawingRunError("DRAWING_RUN_REVISION_CONFLICT", "Drawing Run revision is stale");
  }
  if (!command.idempotencyKey.trim()) {
    throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Idempotency key is required");
  }
}

function controlStatusFor(command: DrawingRunCommand): DrawingRunStatus | undefined {
  if (command.type === "cancel") return "cancelled";
  if (command.type === "reject") return "rejected";
  if (command.type === "fail") return "failed";
  if (command.type === "conflict") return "conflicted";
  return undefined;
}

function applyCommandEffects(next: DrawingRun, command: DrawingRunCommand): void {
  switch (command.type) {
    case "accept_input":
      next.privateReceiptIds = [...new Set([...next.privateReceiptIds, ...command.receiptIds])];
      addHash(next, command.artifactHash);
      return;
    case "begin_analysis":
      addHash(next, command.policyHash);
      return;
    case "request_interpreter":
      addHash(next, command.evidencePackHash);
      return;
    case "record_candidate":
      addHash(next, command.candidateHash);
      return;
    case "formalize_ugs":
      addHash(next, command.ugsHash);
      return;
    case "request_clarification":
      next.clarification = {
        id: `clarification:${command.clarificationHash.slice(0, 16)}`,
        prompt: "A structural clarification is required before formalization.",
        hash: command.clarificationHash,
      };
      addHash(next, command.clarificationHash);
      return;
    case "answer_clarification":
      if (!next.clarification || next.clarification.id !== command.clarificationId) {
        throw new DrawingRunError("DRAWING_RUN_TRANSITION_INVALID", "Clarification does not match the current run");
      }
      addHash(next, command.answerHash);
      next.clarification = null;
      return;
    case "compose_pvp":
      addHash(next, command.ugsHash);
      return;
    case "publish_preview":
      addHash(next, command.pvpHash);
      addHash(next, command.qaHash);
      next.preview = { artifactId: `preview:${command.pvpHash.slice(0, 16)}`, hash: command.pvpHash };
      return;
    case "discover_page_target":
      addHash(next, command.discoveryHash);
      return;
    case "bind_page":
      addHash(next, command.bindingHash);
      return;
    case "request_apply":
      addHash(next, command.authorizationHash);
      return;
    case "verify_readback":
      addHash(next, command.readbackHash);
      return;
    case "cancel":
      next.errorCategory = "cancelled";
      return;
    case "reject":
      next.errorCategory = normalizeErrorCategory(command.errorCategory);
      return;
    case "fail":
      next.errorCategory = normalizeErrorCategory(command.errorCategory);
      return;
    case "conflict":
      next.errorCategory = "conflict";
      addHash(next, command.conflictHash);
      return;
  }
}

function addHash(state: DrawingRun, hash: string): void {
  if (hash.trim() && !state.artifactHashes.includes(hash)) state.artifactHashes.push(hash);
}

function normalizeErrorCategory(value: string): DrawingRunErrorCategory {
  const allowed: DrawingRunErrorCategory[] = ["none", "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker", "conflict", "cancelled"];
  return allowed.includes(value as DrawingRunErrorCategory) ? value as DrawingRunErrorCategory : "validation";
}
