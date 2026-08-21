import {
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunEventErrorCategory,
  type DrawingRunIdempotencyResponse,
  type DrawingRunStatus,
  type DrawingRunTransition,
  isDrawingRunFailureCategory,
  isDrawingRunStatus,
  isDrawingRunTimestamp,
  isSafeDrawingRunIdentifier,
} from "./contracts.js";
import { failDrawingRun } from "./errors.js";

const hashPattern = /^[a-f0-9]{64}$/;
const terminalStatuses = new Set<DrawingRunStatus>(["cancelled", "rejected", "failed", "conflicted", "readback_verified"]);

type Resolution = {
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  errorCategory: DrawingRunEventErrorCategory;
  artifactHashes?: readonly string[];
  receiptIds?: readonly string[];
  clarification?: DrawingRun["clarification"];
  preview?: DrawingRun["preview"];
};

export function reduceDrawingRun(state: DrawingRun, command: DrawingRunCommand): DrawingRunTransition {
  assertBoundToRun(state, command);
  const fingerprint = commandFingerprint(command);
  const existing = state.idempotencyRecords.find((record) => record.key === command.idempotencyKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) failDrawingRun("idempotency");
    return { kind: "replayed", current: state, original: existing.response };
  }
  if (command.expectedRevision !== state.revision) failDrawingRun("revision");
  if (Date.parse(command.occurredAt) <= Date.parse(state.updatedAt)) failDrawingRun("validation");

  const resolution = resolveTransition(state, command);
  const nextRevision = state.revision + 1;
  const next: DrawingRun = {
    ...state,
    status: resolution.status,
    revision: nextRevision,
    artifactHashes: appendDistinct(state.artifactHashes, resolution.artifactHashes ?? []),
    privateReceiptIds: appendDistinct(state.privateReceiptIds, resolution.receiptIds ?? []),
    clarification: resolution.clarification === undefined ? state.clarification : resolution.clarification,
    preview: resolution.preview === undefined ? state.preview : resolution.preview,
    updatedAt: command.occurredAt,
    idempotencyRecords: state.idempotencyRecords,
  };
  const event: DrawingRunEvent = {
    eventId: `${state.runId}:${nextRevision}`,
    runId: state.runId,
    revision: nextRevision,
    status: next.status,
    action: resolution.action,
    artifactHashes: [...next.artifactHashes],
    errorCategory: resolution.errorCategory,
    occurredAt: command.occurredAt,
  };
  const response = immutableIdempotencyResponse(event);
  return {
    kind: "accepted",
    next: {
      ...next,
      idempotencyRecords: [...state.idempotencyRecords, { key: command.idempotencyKey, fingerprint, response }],
    },
    event: response.event,
  };
}

function resolveTransition(state: DrawingRun, command: DrawingRunCommand): Resolution {
  switch (command.type) {
    case "accept_input":
      requireStatus(state, "received");
      assertHashes([command.artifactHash]);
      assertOpaqueIds(command.receiptIds);
      return { status: "input_accepted", action: "received", errorCategory: "none", artifactHashes: [command.artifactHash], receiptIds: command.receiptIds };
    case "begin_analysis":
      requireStatus(state, "input_accepted");
      assertHashes([command.policyHash]);
      return { status: "analyzing", action: "analyzed", errorCategory: "none", artifactHashes: [command.policyHash] };
    case "request_interpreter":
      requireStatus(state, "analyzing");
      assertHashes([command.evidencePackHash]);
      return { status: "awaiting_interpreter", action: "analyzed", errorCategory: "none", artifactHashes: [command.evidencePackHash] };
    case "record_candidate":
      requireOneOfStatuses(state, ["analyzing", "awaiting_interpreter"]);
      assertHashes([command.candidateHash]);
      return { status: "candidate_structure", action: "proposed", errorCategory: "none", artifactHashes: [command.candidateHash] };
    case "formalize_ugs":
      requireStatus(state, "candidate_structure");
      assertHashes([command.ugsHash]);
      return { status: "formal_ugs", action: "formalized", errorCategory: "none", artifactHashes: [command.ugsHash] };
    case "request_clarification":
      requireStatus(state, "candidate_structure");
      assertHashes([command.clarificationHash]);
      return {
        status: "awaiting_clarification",
        action: "clarified",
        errorCategory: "none",
        artifactHashes: [command.clarificationHash],
        clarification: {
          id: `clarification:${command.clarificationHash}`,
          prompt: "A clarification is required before continuing.",
          hash: command.clarificationHash,
        },
      };
    case "answer_clarification":
      requireStatus(state, "awaiting_clarification");
      assertHashes([command.answerHash]);
      if (state.clarification?.id !== command.clarificationId) failDrawingRun("validation");
      return { status: "analyzing", action: "clarified", errorCategory: "none", artifactHashes: [command.answerHash], clarification: null };
    case "compose_pvp":
      requireStatus(state, "formal_ugs");
      assertHashes([command.ugsHash]);
      return { status: "composing_pvp", action: "composed", errorCategory: "none", artifactHashes: [command.ugsHash] };
    case "publish_preview":
      requireStatus(state, "composing_pvp");
      assertHashes([command.pvpHash, command.qaHash]);
      return {
        status: "preview_ready",
        action: "composed",
        errorCategory: "none",
        artifactHashes: [command.pvpHash, command.qaHash],
        preview: { artifactId: `preview:${command.pvpHash}`, hash: command.pvpHash },
      };
    case "discover_page_target":
      requireStatus(state, "preview_ready");
      assertHashes([command.discoveryHash]);
      return { status: "awaiting_page_binding", action: "bound", errorCategory: "none", artifactHashes: [command.discoveryHash] };
    case "bind_page":
      requireStatus(state, "awaiting_page_binding");
      assertHashes([command.bindingHash]);
      return { status: "page_bound", action: "bound", errorCategory: "none", artifactHashes: [command.bindingHash] };
    case "request_apply":
      requireStatus(state, "page_bound");
      assertHashes([command.authorizationHash]);
      return { status: "applying", action: "applied", errorCategory: "none", artifactHashes: [command.authorizationHash] };
    case "verify_readback":
      requireStatus(state, "applying");
      assertHashes([command.readbackHash]);
      return { status: "readback_verified", action: "readback", errorCategory: "none", artifactHashes: [command.readbackHash] };
    case "cancel":
      requireNonTerminal(state);
      return { status: "cancelled", action: "failed", errorCategory: "cancelled" };
    case "reject":
      requireNonTerminal(state);
      if (!isDrawingRunFailureCategory(command.errorCategory)) failDrawingRun("validation");
      return { status: "rejected", action: "failed", errorCategory: command.errorCategory };
    case "fail":
      requireNonTerminal(state);
      if (!isDrawingRunFailureCategory(command.errorCategory)) failDrawingRun("validation");
      return { status: "failed", action: "failed", errorCategory: command.errorCategory };
    case "conflict":
      requireNonTerminal(state);
      assertHashes([command.conflictHash]);
      return { status: "conflicted", action: "failed", errorCategory: "conflict", artifactHashes: [command.conflictHash] };
    default:
      return assertNever(command);
  }
}

function assertBoundToRun(state: DrawingRun, command: DrawingRunCommand): void {
  if (!isDrawingRunStatus(state.status) || !isSafeDrawingRunIdentifier(state.runId) || !isSafeDrawingRunIdentifier(state.ownerId) || !isSafeDrawingRunIdentifier(state.deviceId) || !isDrawingRunTimestamp(state.updatedAt)) {
    failDrawingRun("validation");
  }
  if (command.ownerId !== state.ownerId) failDrawingRun("owner");
  if (command.deviceId !== state.deviceId) failDrawingRun("device");
  if (command.runId !== state.runId) failDrawingRun("run");
  if (!isSafeDrawingRunIdentifier(command.ownerId) || !isSafeDrawingRunIdentifier(command.deviceId) || !isSafeDrawingRunIdentifier(command.runId) || !isSafeDrawingRunIdentifier(command.idempotencyKey) || !isDrawingRunTimestamp(command.occurredAt)) {
    failDrawingRun("validation");
  }
}

function requireStatus(state: DrawingRun, expected: DrawingRunStatus): void {
  if (state.status !== expected) failDrawingRun("transition");
}

function requireOneOfStatuses(state: DrawingRun, expected: readonly DrawingRunStatus[]): void {
  if (!expected.includes(state.status)) failDrawingRun("transition");
}

function requireNonTerminal(state: DrawingRun): void {
  if (terminalStatuses.has(state.status)) failDrawingRun("transition");
}

function assertHashes(hashes: readonly string[]): void {
  if (hashes.length === 0 || hashes.some((hash) => !hashPattern.test(hash))) failDrawingRun("validation");
}

function assertOpaqueIds(ids: readonly string[]): void {
  if (ids.length === 0 || ids.some((id) => !isSafeKey(id))) failDrawingRun("validation");
}

function appendDistinct(existing: readonly string[], additions: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...additions])];
}

function isSafeKey(value: string): boolean {
  return isSafeDrawingRunIdentifier(value);
}

function commandFingerprint(command: DrawingRunCommand): string {
  const base = [command.type, command.ownerId, command.deviceId, command.runId, command.expectedRevision, command.idempotencyKey, command.occurredAt];
  switch (command.type) {
    case "accept_input": return [...base, command.artifactHash, ...command.receiptIds].join("|");
    case "begin_analysis": return [...base, command.policyHash].join("|");
    case "request_interpreter": return [...base, command.evidencePackHash].join("|");
    case "record_candidate": return [...base, command.candidateHash].join("|");
    case "formalize_ugs": return [...base, command.ugsHash].join("|");
    case "request_clarification": return [...base, command.clarificationHash].join("|");
    case "answer_clarification": return [...base, command.clarificationId, command.answerHash].join("|");
    case "compose_pvp": return [...base, command.ugsHash].join("|");
    case "publish_preview": return [...base, command.pvpHash, command.qaHash].join("|");
    case "discover_page_target": return [...base, command.discoveryHash].join("|");
    case "bind_page": return [...base, command.bindingHash].join("|");
    case "request_apply": return [...base, command.authorizationHash].join("|");
    case "verify_readback": return [...base, command.readbackHash].join("|");
    case "cancel": return [...base, command.reasonCategory].join("|");
    case "reject": return [...base, command.errorCategory].join("|");
    case "fail": return [...base, command.errorCategory].join("|");
    case "conflict": return [...base, command.conflictHash].join("|");
    default: return assertNever(command);
  }
}

function assertNever(value: never): never {
  void value;
  return failDrawingRun("validation");
}

function immutableIdempotencyResponse(event: DrawingRunEvent): DrawingRunIdempotencyResponse {
  const safeEvent = Object.freeze({
    ...event,
    artifactHashes: Object.freeze([...event.artifactHashes]),
  });
  return Object.freeze({
    event: safeEvent,
    snapshot: Object.freeze({ runId: safeEvent.runId, revision: safeEvent.revision, status: safeEvent.status }),
  });
}
