import {
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunEventErrorCategory,
  type DrawingRunIdempotencyResponse,
  type DrawingRunStatus,
  type DrawingRunTransition,
  DRAWING_RUN_CONTRACT_VERSION,
  isDrawingIntent,
  isDrawingRunArtifactHash,
  isDrawingRunCancelReasonCategory,
  isDrawingRunFailureCategory,
  isDrawingRunId,
  isDrawingRunStatus,
  isDrawingRunTimestamp,
  isSafeDrawingRunIdentifier,
} from "./contracts.js";
import { failDrawingRun } from "./errors.js";
import { reconstructDrawingRunEventHistory } from "./event-log.js";

const terminalStatuses = new Set<DrawingRunStatus>(["cancelled", "rejected", "failed", "conflicted", "readback_verified"]);
const fingerprintPattern = /^[A-Za-z0-9._:|\-]{1,4096}$/;
const clarificationPrompt = "A clarification is required before continuing.";

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
  assertDrawingRunCommand(command);
  const safeState = reconstructDrawingRunState(state);
  assertBoundToRun(safeState, command);
  const fingerprint = commandFingerprint(command);
  const existingIndex = safeState.idempotencyRecords.findIndex((record) => record.key === command.idempotencyKey);
  if (existingIndex >= 0) {
    const existing = safeState.idempotencyRecords[existingIndex];
    if (existing.fingerprint !== fingerprint) failDrawingRun("idempotency");
    assertReplayMatchesCommand(safeState, existingIndex, command, existing.response);
    return { kind: "replayed", current: safeState, original: existing.response };
  }
  if (command.expectedRevision !== safeState.revision) failDrawingRun("revision");
  if (Date.parse(command.occurredAt) <= Date.parse(safeState.updatedAt)) failDrawingRun("validation");

  const resolution = resolveTransition(safeState, command);
  const nextRevision = safeState.revision + 1;
  const next: DrawingRun = {
    ...safeState,
    status: resolution.status,
    revision: nextRevision,
    artifactHashes: appendDistinct(safeState.artifactHashes, resolution.artifactHashes ?? []),
    privateReceiptIds: appendDistinct(safeState.privateReceiptIds, resolution.receiptIds ?? []),
    clarification: resolution.clarification === undefined ? safeState.clarification : resolution.clarification,
    preview: resolution.preview === undefined ? safeState.preview : resolution.preview,
    updatedAt: command.occurredAt,
    idempotencyRecords: safeState.idempotencyRecords,
  };
  const event: DrawingRunEvent = {
    eventId: `${safeState.runId}:${nextRevision}`,
    runId: safeState.runId,
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
      idempotencyRecords: [...safeState.idempotencyRecords, { key: command.idempotencyKey, fingerprint, response }],
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

function assertDrawingRunCommand(command: DrawingRunCommand): void {
  if (typeof command !== "object" || command === null) failDrawingRun("validation");
  const candidate = command as unknown as Record<string, unknown>;
  if (!isSafeDrawingRunIdentifier(candidate.ownerId)
    || !isSafeDrawingRunIdentifier(candidate.deviceId)
    || !isDrawingRunId(candidate.runId)
    || !Number.isSafeInteger(candidate.expectedRevision)
    || (candidate.expectedRevision as number) < 0
    || !isSafeDrawingRunIdentifier(candidate.idempotencyKey)
    || !isDrawingRunTimestamp(candidate.occurredAt)) {
    failDrawingRun("validation");
  }

  switch (candidate.type) {
    case "accept_input":
      assertHashes([candidate.artifactHash]);
      assertOpaqueIds(candidate.receiptIds);
      return;
    case "begin_analysis": assertHashes([candidate.policyHash]); return;
    case "request_interpreter": assertHashes([candidate.evidencePackHash]); return;
    case "record_candidate": assertHashes([candidate.candidateHash]); return;
    case "formalize_ugs": assertHashes([candidate.ugsHash]); return;
    case "request_clarification": assertHashes([candidate.clarificationHash]); return;
    case "answer_clarification":
      if (!isSafeDrawingRunIdentifier(candidate.clarificationId)) failDrawingRun("validation");
      assertHashes([candidate.answerHash]);
      return;
    case "compose_pvp": assertHashes([candidate.ugsHash]); return;
    case "publish_preview": assertHashes([candidate.pvpHash, candidate.qaHash]); return;
    case "discover_page_target": assertHashes([candidate.discoveryHash]); return;
    case "bind_page": assertHashes([candidate.bindingHash]); return;
    case "request_apply": assertHashes([candidate.authorizationHash]); return;
    case "verify_readback": assertHashes([candidate.readbackHash]); return;
    case "cancel":
      if (!isDrawingRunCancelReasonCategory(candidate.reasonCategory)) failDrawingRun("validation");
      return;
    case "reject":
    case "fail":
      if (!isDrawingRunFailureCategory(candidate.errorCategory)) failDrawingRun("validation");
      return;
    case "conflict": assertHashes([candidate.conflictHash]); return;
    default: failDrawingRun("validation");
  }
}

function reconstructDrawingRunState(state: DrawingRun): DrawingRun {
  if (typeof state !== "object" || state === null) failDrawingRun("validation");
  const candidate = state as unknown as Record<string, unknown>;
  if (candidate.version !== DRAWING_RUN_CONTRACT_VERSION
    || !isDrawingRunId(candidate.runId)
    || !isSafeDrawingRunIdentifier(candidate.ownerId)
    || !isSafeDrawingRunIdentifier(candidate.deviceId)
    || !isDrawingRunStatus(candidate.status)
    || !Number.isSafeInteger(candidate.revision)
    || (candidate.revision as number) < 0
    || !isDrawingIntent(candidate.intent)
    || !isDrawingRunTimestamp(candidate.createdAt)
    || !isDrawingRunTimestamp(candidate.updatedAt)
    || Date.parse(candidate.updatedAt) < Date.parse(candidate.createdAt)) {
    failDrawingRun("validation");
  }

  const revision = candidate.revision as number;
  const artifactHashes = copyHashes(candidate.artifactHashes, true);
  const privateReceiptIds = copyOpaqueIds(candidate.privateReceiptIds, true);
  const clarification = copyClarification(candidate.clarification);
  const preview = copyPreview(candidate.preview);
  if (!Array.isArray(candidate.idempotencyRecords) || candidate.idempotencyRecords.length !== revision) failDrawingRun("validation");

  const rawRecords = candidate.idempotencyRecords as unknown[];
  const recordKeys = new Set<string>();
  const rawEvents: DrawingRunEvent[] = [];
  for (const value of rawRecords) {
    if (typeof value !== "object" || value === null) failDrawingRun("validation");
    const record = value as Record<string, unknown>;
    if (!isSafeDrawingRunIdentifier(record.key) || recordKeys.has(record.key) || !isSafeFingerprint(record.fingerprint)) failDrawingRun("validation");
    if (typeof record.response !== "object" || record.response === null) failDrawingRun("validation");
    const response = record.response as Record<string, unknown>;
    if (typeof response.event !== "object" || response.event === null || typeof response.snapshot !== "object" || response.snapshot === null) failDrawingRun("validation");
    recordKeys.add(record.key);
    rawEvents.push(response.event as DrawingRunEvent);
  }

  const events = reconstructDrawingRunEventHistory(rawEvents);
  const idempotencyRecords = rawRecords.map((value, index) => {
    const record = value as unknown as Record<string, unknown>;
    const response = record.response as Record<string, unknown>;
    const snapshot = response.snapshot as Record<string, unknown>;
    const event = events[index];
    if (snapshot.runId !== event.runId || snapshot.revision !== event.revision || snapshot.status !== event.status) failDrawingRun("validation");
    return Object.freeze({
      key: record.key as string,
      fingerprint: record.fingerprint as string,
      response: immutableIdempotencyResponse(event),
    });
  });

  if (revision === 0) {
    if (candidate.status !== "received" || artifactHashes.length !== 0 || privateReceiptIds.length !== 0 || candidate.updatedAt !== candidate.createdAt) failDrawingRun("validation");
  } else {
    const lastEvent = events[events.length - 1];
    if (lastEvent.runId !== candidate.runId
      || lastEvent.status !== candidate.status
      || lastEvent.occurredAt !== candidate.updatedAt
      || Date.parse(events[0].occurredAt) <= Date.parse(candidate.createdAt)
      || !sameStrings(lastEvent.artifactHashes, artifactHashes)) {
      failDrawingRun("validation");
    }
  }

  return {
    version: DRAWING_RUN_CONTRACT_VERSION,
    runId: candidate.runId as string,
    ownerId: candidate.ownerId as string,
    deviceId: candidate.deviceId as string,
    status: candidate.status as DrawingRunStatus,
    revision,
    intent: Object.freeze({
      action: candidate.intent.action,
      requestedDetail: candidate.intent.requestedDetail,
      target: candidate.intent.target,
      sourceKinds: Object.freeze([...candidate.intent.sourceKinds]),
    }),
    artifactHashes: Object.freeze(artifactHashes),
    privateReceiptIds: Object.freeze(privateReceiptIds),
    clarification,
    preview,
    idempotencyRecords: Object.freeze(idempotencyRecords),
    createdAt: candidate.createdAt as string,
    updatedAt: candidate.updatedAt as string,
  };
}

function assertBoundToRun(state: DrawingRun, command: DrawingRunCommand): void {
  if (command.ownerId !== state.ownerId) failDrawingRun("owner");
  if (command.deviceId !== state.deviceId) failDrawingRun("device");
  if (command.runId !== state.runId) failDrawingRun("run");
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

function assertHashes(hashes: readonly unknown[]): asserts hashes is readonly string[] {
  if (hashes.length === 0 || hashes.some((hash) => !isDrawingRunArtifactHash(hash))) failDrawingRun("validation");
}

function assertOpaqueIds(ids: unknown): asserts ids is readonly string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !isSafeKey(id)) || new Set(ids).size !== ids.length) failDrawingRun("validation");
}

function appendDistinct(existing: readonly string[], additions: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...additions])];
}

function isSafeKey(value: unknown): value is string {
  return isSafeDrawingRunIdentifier(value);
}

function copyHashes(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((hash) => !isDrawingRunArtifactHash(hash)) || new Set(value).size !== value.length) {
    failDrawingRun("validation");
  }
  return [...value] as string[];
}

function copyOpaqueIds(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((id) => !isSafeDrawingRunIdentifier(id)) || new Set(value).size !== value.length) {
    failDrawingRun("validation");
  }
  return [...value] as string[];
}

function copyClarification(value: unknown): DrawingRun["clarification"] {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  if (!isDrawingRunArtifactHash(candidate.hash)
    || candidate.id !== `clarification:${candidate.hash}`
    || candidate.prompt !== clarificationPrompt) {
    failDrawingRun("validation");
  }
  return Object.freeze({ id: candidate.id, prompt: candidate.prompt, hash: candidate.hash });
}

function copyPreview(value: unknown): DrawingRun["preview"] {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  if (!isDrawingRunArtifactHash(candidate.hash) || candidate.artifactId !== `preview:${candidate.hash}`) failDrawingRun("validation");
  return Object.freeze({ artifactId: candidate.artifactId, hash: candidate.hash });
}

function isSafeFingerprint(value: unknown): value is string {
  return typeof value === "string" && fingerprintPattern.test(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertReplayMatchesCommand(
  state: DrawingRun,
  recordIndex: number,
  command: DrawingRunCommand,
  response: DrawingRunIdempotencyResponse,
): void {
  const expected = commandEventExpectation(command);
  const previousHashes = recordIndex === 0
    ? []
    : state.idempotencyRecords[recordIndex - 1].response.event.artifactHashes;
  const expectedHashes = appendDistinct(previousHashes, expected.artifactHashes);
  if (command.expectedRevision !== response.event.revision - 1
    || command.occurredAt !== response.event.occurredAt
    || response.event.status !== expected.status
    || response.event.action !== expected.action
    || response.event.errorCategory !== expected.errorCategory
    || !sameStrings(response.event.artifactHashes, expectedHashes)) {
    failDrawingRun("idempotency");
  }
}

function commandEventExpectation(command: DrawingRunCommand): Required<Pick<Resolution, "status" | "action" | "errorCategory">> & { artifactHashes: readonly string[] } {
  switch (command.type) {
    case "accept_input": return { status: "input_accepted", action: "received", errorCategory: "none", artifactHashes: [command.artifactHash] };
    case "begin_analysis": return { status: "analyzing", action: "analyzed", errorCategory: "none", artifactHashes: [command.policyHash] };
    case "request_interpreter": return { status: "awaiting_interpreter", action: "analyzed", errorCategory: "none", artifactHashes: [command.evidencePackHash] };
    case "record_candidate": return { status: "candidate_structure", action: "proposed", errorCategory: "none", artifactHashes: [command.candidateHash] };
    case "formalize_ugs": return { status: "formal_ugs", action: "formalized", errorCategory: "none", artifactHashes: [command.ugsHash] };
    case "request_clarification": return { status: "awaiting_clarification", action: "clarified", errorCategory: "none", artifactHashes: [command.clarificationHash] };
    case "answer_clarification": return { status: "analyzing", action: "clarified", errorCategory: "none", artifactHashes: [command.answerHash] };
    case "compose_pvp": return { status: "composing_pvp", action: "composed", errorCategory: "none", artifactHashes: [command.ugsHash] };
    case "publish_preview": return { status: "preview_ready", action: "composed", errorCategory: "none", artifactHashes: [command.pvpHash, command.qaHash] };
    case "discover_page_target": return { status: "awaiting_page_binding", action: "bound", errorCategory: "none", artifactHashes: [command.discoveryHash] };
    case "bind_page": return { status: "page_bound", action: "bound", errorCategory: "none", artifactHashes: [command.bindingHash] };
    case "request_apply": return { status: "applying", action: "applied", errorCategory: "none", artifactHashes: [command.authorizationHash] };
    case "verify_readback": return { status: "readback_verified", action: "readback", errorCategory: "none", artifactHashes: [command.readbackHash] };
    case "cancel": return { status: "cancelled", action: "failed", errorCategory: "cancelled", artifactHashes: [] };
    case "reject": return { status: "rejected", action: "failed", errorCategory: command.errorCategory, artifactHashes: [] };
    case "fail": return { status: "failed", action: "failed", errorCategory: command.errorCategory, artifactHashes: [] };
    case "conflict": return { status: "conflicted", action: "failed", errorCategory: "conflict", artifactHashes: [command.conflictHash] };
    default: return assertNever(command);
  }
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
