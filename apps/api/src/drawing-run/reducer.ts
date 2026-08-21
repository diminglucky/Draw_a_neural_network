import {
  type DrawingIntent,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunCommandBase,
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunEventErrorCategory,
  type DrawingRunIdempotencyResponse,
  type DrawingRunStatus,
  type DrawingRunTransition,
  type DrawingRunTrustedScope,
  DRAWING_RUN_CONTRACT_VERSION,
  drawingIntentActions,
  drawingIntentDetailLevels,
  drawingIntentSourceKinds,
  drawingIntentTargets,
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
const ordinaryFailureCategories = new Set<DrawingRunEventErrorCategory>([
  "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker",
]);
const fingerprintPattern = /^[A-Za-z0-9._:|\-]{1,4096}$/;
const clarificationPrompt = "A clarification is required before continuing.";

type Resolution = {
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  errorCategory: DrawingRunEventErrorCategory;
  artifactHashes?: readonly string[];
  receiptIds?: readonly string[];
  formalUgsHash?: string;
  clarification?: DrawingRun["clarification"];
  preview?: DrawingRun["preview"];
};

type RawRecord = {
  key: string;
  fingerprint: string;
  event: DrawingRunEvent;
  snapshot: { runId: unknown; revision: unknown; status: unknown };
};

export function reduceDrawingRun(
  state: DrawingRun,
  command: DrawingRunCommand,
  trustedScope: DrawingRunTrustedScope,
): DrawingRunTransition {
  const safeScope = snapshotTrustedScope(trustedScope);
  const safeCommand = snapshotDrawingRunCommand(command);
  const safeState = reconstructDrawingRunState(state, safeScope);
  assertCommandBoundToScope(safeCommand, safeScope);

  const fingerprint = commandFingerprint(safeCommand);
  const existingIndex = safeState.idempotencyRecords.findIndex((record) => record.key === safeCommand.idempotencyKey);
  if (existingIndex >= 0) {
    const existing = safeState.idempotencyRecords[existingIndex];
    if (existing.fingerprint !== fingerprint) failDrawingRun("idempotency");
    assertReplayMatchesCommand(safeState, existingIndex, safeCommand, existing.response);
    return Object.freeze({ kind: "replayed", current: safeState, original: existing.response });
  }
  if (safeCommand.expectedRevision !== safeState.revision) failDrawingRun("revision");
  if (Date.parse(safeCommand.occurredAt) <= Date.parse(safeState.updatedAt)) failDrawingRun("validation");

  const resolution = resolveTransition(safeState, safeCommand);
  const nextRevision = safeState.revision + 1;
  const nextHashes = appendDistinct(safeState.artifactHashes, resolution.artifactHashes ?? []);
  const nextReceipts = appendDistinct(safeState.privateReceiptIds, resolution.receiptIds ?? []);
  const proposedEvent: DrawingRunEvent = {
    eventId: `${safeState.runId}:${nextRevision}`,
    runId: safeState.runId,
    revision: nextRevision,
    status: resolution.status,
    action: resolution.action,
    artifactHashes: nextHashes,
    errorCategory: resolution.errorCategory,
    occurredAt: safeCommand.occurredAt,
  };
  const priorEvents = safeState.idempotencyRecords.map((record) => record.response.event);
  const safeHistory = reconstructDrawingRunEventHistory([...priorEvents, proposedEvent]);
  const safeEvent = safeHistory[safeHistory.length - 1];
  const response = immutableIdempotencyResponse(safeEvent);
  const proposedNext: DrawingRun = {
    ...safeState,
    status: resolution.status,
    revision: nextRevision,
    artifactHashes: nextHashes,
    privateReceiptIds: nextReceipts,
    formalUgsHash: resolution.formalUgsHash ?? safeState.formalUgsHash,
    clarification: resolution.clarification === undefined ? safeState.clarification : resolution.clarification,
    preview: resolution.preview === undefined ? safeState.preview : resolution.preview,
    updatedAt: safeCommand.occurredAt,
    idempotencyRecords: [...safeState.idempotencyRecords, {
      key: safeCommand.idempotencyKey,
      fingerprint,
      response,
    }],
  };
  const next = reconstructDrawingRunState(proposedNext, safeScope);
  const finalEvent = next.idempotencyRecords[next.idempotencyRecords.length - 1].response.event;
  return Object.freeze({ kind: "accepted", next, event: finalEvent });
}

export function reconstructDrawingRunState(state: DrawingRun, trustedScope: DrawingRunTrustedScope): DrawingRun {
  const safeScope = snapshotTrustedScope(trustedScope);
  if (typeof state !== "object" || state === null) failDrawingRun("validation");
  const source = state as unknown as Record<string, unknown>;
  const snapshot = {
    version: source.version,
    runId: source.runId,
    ownerId: source.ownerId,
    deviceId: source.deviceId,
    status: source.status,
    revision: source.revision,
    intent: source.intent,
    artifactHashes: source.artifactHashes,
    privateReceiptIds: source.privateReceiptIds,
    formalUgsHash: source.formalUgsHash,
    clarification: source.clarification,
    preview: source.preview,
    idempotencyRecords: source.idempotencyRecords,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };

  if (snapshot.runId !== safeScope.runId) failDrawingRun("run");
  if (snapshot.ownerId !== safeScope.ownerId) failDrawingRun("owner");
  if (snapshot.deviceId !== safeScope.deviceId) failDrawingRun("device");
  if (snapshot.version !== DRAWING_RUN_CONTRACT_VERSION
    || !isDrawingRunStatus(snapshot.status)
    || !Number.isSafeInteger(snapshot.revision)
    || (snapshot.revision as number) < 0
    || !isDrawingRunTimestamp(snapshot.createdAt)
    || !isDrawingRunTimestamp(snapshot.updatedAt)
    || Date.parse(snapshot.updatedAt) < Date.parse(snapshot.createdAt)) {
    failDrawingRun("validation");
  }

  const revision = snapshot.revision as number;
  const intent = copyIntent(snapshot.intent);
  const artifactHashes = copyHashes(snapshot.artifactHashes, true);
  const privateReceiptIds = copyOpaqueIds(snapshot.privateReceiptIds, true);
  const formalUgsHash = snapshot.formalUgsHash === null
    ? null
    : copyHash(snapshot.formalUgsHash);
  const clarification = copyClarification(snapshot.clarification);
  const preview = copyPreview(snapshot.preview);
  const rawRecords = copyArray(snapshot.idempotencyRecords);
  if (rawRecords.length !== revision) failDrawingRun("validation");

  const recordSnapshots = rawRecords.map(snapshotIdempotencyRecord);
  const events = reconstructDrawingRunEventHistory(recordSnapshots.map((record) => record.event));
  const recordKeys = new Set<string>();
  const idempotencyRecords = recordSnapshots.map((record, index) => {
    const event = events[index];
    if (recordKeys.has(record.key)
      || record.snapshot.runId !== event.runId
      || record.snapshot.revision !== event.revision
      || record.snapshot.status !== event.status) {
      failDrawingRun("validation");
    }
    recordKeys.add(record.key);
    return Object.freeze({
      key: record.key,
      fingerprint: record.fingerprint,
      response: immutableIdempotencyResponse(event),
    });
  });

  if (revision === 0) {
    if (snapshot.status !== "received"
      || artifactHashes.length !== 0
      || privateReceiptIds.length !== 0
      || formalUgsHash !== null
      || clarification !== null
      || preview !== null
      || snapshot.updatedAt !== snapshot.createdAt) {
      failDrawingRun("validation");
    }
  } else {
    const lastEvent = events[events.length - 1];
    if (lastEvent.runId !== safeScope.runId
      || lastEvent.status !== snapshot.status
      || lastEvent.occurredAt !== snapshot.updatedAt
      || Date.parse(events[0].occurredAt) <= Date.parse(snapshot.createdAt)
      || !sameStrings(lastEvent.artifactHashes, artifactHashes)) {
      failDrawingRun("validation");
    }
    validateStateFacts(events, privateReceiptIds, formalUgsHash, clarification, preview);
    validateHistoricalFingerprints(idempotencyRecords, safeScope, privateReceiptIds);
  }

  return Object.freeze({
    version: DRAWING_RUN_CONTRACT_VERSION,
    runId: safeScope.runId,
    ownerId: safeScope.ownerId,
    deviceId: safeScope.deviceId,
    status: snapshot.status,
    revision,
    intent,
    artifactHashes: Object.freeze(artifactHashes),
    privateReceiptIds: Object.freeze(privateReceiptIds),
    formalUgsHash,
    clarification,
    preview,
    idempotencyRecords: Object.freeze(idempotencyRecords),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
}

function resolveTransition(state: DrawingRun, command: DrawingRunCommand): Resolution {
  switch (command.type) {
    case "accept_input":
      requireStatus(state, "received");
      return { status: "input_accepted", action: "received", errorCategory: "none", artifactHashes: [command.artifactHash], receiptIds: command.receiptIds };
    case "begin_analysis":
      requireStatus(state, "input_accepted");
      return { status: "analyzing", action: "analyzed", errorCategory: "none", artifactHashes: [command.policyHash] };
    case "request_interpreter":
      requireStatus(state, "analyzing");
      return { status: "awaiting_interpreter", action: "analyzed", errorCategory: "none", artifactHashes: [command.evidencePackHash] };
    case "record_candidate":
      requireOneOfStatuses(state, ["analyzing", "awaiting_interpreter"]);
      return { status: "candidate_structure", action: "proposed", errorCategory: "none", artifactHashes: [command.candidateHash] };
    case "formalize_ugs":
      requireStatus(state, "candidate_structure");
      return { status: "formal_ugs", action: "formalized", errorCategory: "none", artifactHashes: [command.ugsHash], formalUgsHash: command.ugsHash };
    case "request_clarification":
      requireStatus(state, "candidate_structure");
      return {
        status: "awaiting_clarification",
        action: "clarified",
        errorCategory: "none",
        artifactHashes: [command.clarificationHash],
        clarification: Object.freeze({
          id: `clarification:${command.clarificationHash}`,
          prompt: clarificationPrompt,
          hash: command.clarificationHash,
        }),
      };
    case "answer_clarification":
      requireStatus(state, "awaiting_clarification");
      if (state.clarification?.id !== command.clarificationId) failDrawingRun("validation");
      return { status: "analyzing", action: "clarified", errorCategory: "none", artifactHashes: [command.answerHash], clarification: null };
    case "compose_pvp":
      requireStatus(state, "formal_ugs");
      if (state.formalUgsHash === null || command.ugsHash !== state.formalUgsHash) failDrawingRun("validation");
      return { status: "composing_pvp", action: "composed", errorCategory: "none" };
    case "publish_preview":
      requireStatus(state, "composing_pvp");
      return {
        status: "preview_ready",
        action: "composed",
        errorCategory: "none",
        artifactHashes: [command.pvpHash, command.qaHash],
        preview: Object.freeze({ artifactId: `preview:${command.pvpHash}`, hash: command.pvpHash }),
      };
    case "discover_page_target":
      requireStatus(state, "preview_ready");
      return { status: "awaiting_page_binding", action: "bound", errorCategory: "none", artifactHashes: [command.discoveryHash] };
    case "bind_page":
      requireStatus(state, "awaiting_page_binding");
      return { status: "page_bound", action: "bound", errorCategory: "none", artifactHashes: [command.bindingHash] };
    case "request_apply":
      requireStatus(state, "page_bound");
      return { status: "applying", action: "applied", errorCategory: "none", artifactHashes: [command.authorizationHash] };
    case "verify_readback":
      requireStatus(state, "applying");
      return { status: "readback_verified", action: "readback", errorCategory: "none", artifactHashes: [command.readbackHash] };
    case "cancel":
      requireNonTerminal(state);
      return { status: "cancelled", action: "failed", errorCategory: "cancelled" };
    case "reject":
      requireNonTerminal(state);
      if (!ordinaryFailureCategories.has(command.errorCategory)) failDrawingRun("validation");
      return { status: "rejected", action: "failed", errorCategory: command.errorCategory };
    case "fail":
      requireNonTerminal(state);
      if (!ordinaryFailureCategories.has(command.errorCategory)) failDrawingRun("validation");
      return { status: "failed", action: "failed", errorCategory: command.errorCategory };
    case "conflict":
      requireNonTerminal(state);
      return { status: "conflicted", action: "failed", errorCategory: "conflict", artifactHashes: [command.conflictHash] };
    default:
      return assertNever(command);
  }
}

function snapshotTrustedScope(value: DrawingRunTrustedScope): DrawingRunTrustedScope {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as unknown as Record<string, unknown>;
  const runId = candidate.runId;
  const ownerId = candidate.ownerId;
  const deviceId = candidate.deviceId;
  if (!isDrawingRunId(runId) || !isSafeDrawingRunIdentifier(ownerId) || !isSafeDrawingRunIdentifier(deviceId)) failDrawingRun("validation");
  return Object.freeze({ runId, ownerId, deviceId });
}

function snapshotDrawingRunCommand(value: DrawingRunCommand): DrawingRunCommand {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as unknown as Record<string, unknown>;
  const type = candidate.type;
  const ownerId = candidate.ownerId;
  const deviceId = candidate.deviceId;
  const runId = candidate.runId;
  const expectedRevision = candidate.expectedRevision;
  const idempotencyKey = candidate.idempotencyKey;
  const occurredAt = candidate.occurredAt;
  if (!isSafeDrawingRunIdentifier(ownerId)
    || !isSafeDrawingRunIdentifier(deviceId)
    || !isDrawingRunId(runId)
    || !Number.isSafeInteger(expectedRevision)
    || (expectedRevision as number) < 0
    || !isSafeDrawingRunIdentifier(idempotencyKey)
    || !isDrawingRunTimestamp(occurredAt)) {
    failDrawingRun("validation");
  }
  const base: DrawingRunCommandBase = { ownerId, deviceId, runId, expectedRevision: expectedRevision as number, idempotencyKey, occurredAt };
  switch (type) {
    case "accept_input": return Object.freeze({ ...base, type, receiptIds: Object.freeze(copyOpaqueIds(candidate.receiptIds, false)), artifactHash: copyHash(candidate.artifactHash) });
    case "begin_analysis": return Object.freeze({ ...base, type, policyHash: copyHash(candidate.policyHash) });
    case "request_interpreter": return Object.freeze({ ...base, type, evidencePackHash: copyHash(candidate.evidencePackHash) });
    case "record_candidate": return Object.freeze({ ...base, type, candidateHash: copyHash(candidate.candidateHash) });
    case "formalize_ugs": return Object.freeze({ ...base, type, ugsHash: copyHash(candidate.ugsHash) });
    case "request_clarification": return Object.freeze({ ...base, type, clarificationHash: copyHash(candidate.clarificationHash) });
    case "answer_clarification": {
      const clarificationId = candidate.clarificationId;
      if (!isSafeDrawingRunIdentifier(clarificationId)) failDrawingRun("validation");
      return Object.freeze({ ...base, type, clarificationId, answerHash: copyHash(candidate.answerHash) });
    }
    case "compose_pvp": return Object.freeze({ ...base, type, ugsHash: copyHash(candidate.ugsHash) });
    case "publish_preview": return Object.freeze({ ...base, type, pvpHash: copyHash(candidate.pvpHash), qaHash: copyHash(candidate.qaHash) });
    case "discover_page_target": return Object.freeze({ ...base, type, discoveryHash: copyHash(candidate.discoveryHash) });
    case "bind_page": return Object.freeze({ ...base, type, bindingHash: copyHash(candidate.bindingHash) });
    case "request_apply": return Object.freeze({ ...base, type, authorizationHash: copyHash(candidate.authorizationHash) });
    case "verify_readback": return Object.freeze({ ...base, type, readbackHash: copyHash(candidate.readbackHash) });
    case "cancel": {
      const reasonCategory = candidate.reasonCategory;
      if (!isDrawingRunCancelReasonCategory(reasonCategory)) failDrawingRun("validation");
      return Object.freeze({ ...base, type, reasonCategory });
    }
    case "reject":
    case "fail": {
      const errorCategory = candidate.errorCategory;
      if (!isDrawingRunFailureCategory(errorCategory) || !ordinaryFailureCategories.has(errorCategory)) failDrawingRun("validation");
      return Object.freeze({ ...base, type, errorCategory });
    }
    case "conflict": return Object.freeze({ ...base, type, conflictHash: copyHash(candidate.conflictHash) });
    default: return failDrawingRun("validation");
  }
}

function snapshotIdempotencyRecord(value: unknown): RawRecord {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  const key = candidate.key;
  const fingerprint = candidate.fingerprint;
  const rawResponse = candidate.response;
  if (!isSafeDrawingRunIdentifier(key) || !isSafeFingerprint(fingerprint) || typeof rawResponse !== "object" || rawResponse === null) failDrawingRun("validation");
  const response = rawResponse as Record<string, unknown>;
  const event = response.event;
  const rawSnapshot = response.snapshot;
  if (typeof event !== "object" || event === null || typeof rawSnapshot !== "object" || rawSnapshot === null) failDrawingRun("validation");
  const snapshot = rawSnapshot as Record<string, unknown>;
  return {
    key,
    fingerprint,
    event: event as DrawingRunEvent,
    snapshot: { runId: snapshot.runId, revision: snapshot.revision, status: snapshot.status },
  };
}

function copyIntent(value: unknown): DrawingIntent {
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

function copyHash(value: unknown): string {
  if (!isDrawingRunArtifactHash(value)) failDrawingRun("validation");
  return value;
}

function copyHashes(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) failDrawingRun("validation");
  const hashes = Array.from(value as readonly unknown[]);
  if ((!allowEmpty && hashes.length === 0)
    || hashes.some((hash) => !isDrawingRunArtifactHash(hash))
    || new Set(hashes).size !== hashes.length) {
    failDrawingRun("validation");
  }
  return hashes as string[];
}

function copyOpaqueIds(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) failDrawingRun("validation");
  const ids = Array.from(value as readonly unknown[]);
  if ((!allowEmpty && ids.length === 0)
    || ids.some((id) => !isSafeDrawingRunIdentifier(id))
    || new Set(ids).size !== ids.length) {
    failDrawingRun("validation");
  }
  return ids as string[];
}

function copyArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) failDrawingRun("validation");
  return Array.from(value as readonly unknown[]);
}

function copyClarification(value: unknown): DrawingRun["clarification"] {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const prompt = candidate.prompt;
  const hash = candidate.hash;
  if (!isDrawingRunArtifactHash(hash) || id !== `clarification:${hash}` || prompt !== clarificationPrompt) failDrawingRun("validation");
  return Object.freeze({ id: id as string, prompt, hash });
}

function copyPreview(value: unknown): DrawingRun["preview"] {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const candidate = value as Record<string, unknown>;
  const artifactId = candidate.artifactId;
  const hash = candidate.hash;
  if (!isDrawingRunArtifactHash(hash) || artifactId !== `preview:${hash}`) failDrawingRun("validation");
  return Object.freeze({ artifactId: artifactId as string, hash });
}

function validateStateFacts(
  events: readonly DrawingRunEvent[],
  receiptIds: readonly string[],
  formalUgsHash: string | null,
  clarification: DrawingRun["clarification"],
  preview: DrawingRun["preview"],
): void {
  const firstAccepted = events[0]?.status === "input_accepted";
  if (firstAccepted !== (receiptIds.length > 0)) failDrawingRun("validation");

  let derivedFormalUgsHash: string | null = null;
  let derivedClarificationHash: string | null = null;
  let derivedPreviewHash: string | null = null;
  let previousHashes: readonly string[] = [];
  for (const event of events) {
    const delta = event.artifactHashes.slice(previousHashes.length);
    if (event.status === "formal_ugs") derivedFormalUgsHash = delta[0] ?? null;
    if (event.status === "awaiting_clarification") derivedClarificationHash = delta[0] ?? null;
    if (event.status === "analyzing" && event.action === "clarified") derivedClarificationHash = null;
    if (event.status === "preview_ready") derivedPreviewHash = delta[0] ?? null;
    previousHashes = event.artifactHashes;
  }
  if (formalUgsHash !== derivedFormalUgsHash) failDrawingRun("validation");
  if ((clarification?.hash ?? null) !== derivedClarificationHash) failDrawingRun("validation");
  if ((preview?.hash ?? null) !== derivedPreviewHash) failDrawingRun("validation");
}

function validateHistoricalFingerprints(
  records: readonly DrawingRun["idempotencyRecords"][number][],
  scope: DrawingRunTrustedScope,
  receiptIds: readonly string[],
): void {
  let previousStatus: DrawingRunStatus = "received";
  let previousHashes: readonly string[] = [];
  let clarificationHash: string | null = null;
  let formalUgsHash: string | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const event = record.response.event;
    const delta = event.artifactHashes.slice(previousHashes.length);
    const type = inferCommandType(previousStatus, event.status);
    const prefix = [type, scope.ownerId, scope.deviceId, scope.runId, String(index), record.key, event.occurredAt];
    let details: readonly string[];
    switch (type) {
      case "accept_input": details = [delta[0], ...receiptIds]; break;
      case "answer_clarification":
        if (clarificationHash === null) failDrawingRun("validation");
        details = [`clarification:${clarificationHash}`, delta[0]];
        break;
      case "compose_pvp":
        if (formalUgsHash === null) failDrawingRun("validation");
        details = [formalUgsHash];
        break;
      case "publish_preview": details = [delta[0], delta[1]]; break;
      case "cancel": {
        const parts = record.fingerprint.split("|");
        if (!sameStrings(parts.slice(0, 7), prefix)
          || parts.length !== 8
          || !isDrawingRunCancelReasonCategory(parts[7])) {
          failDrawingRun("validation");
        }
        details = [parts[7]];
        break;
      }
      case "reject":
      case "fail": details = [event.errorCategory]; break;
      default: details = [delta[0]]; break;
    }
    if (record.fingerprint !== [...prefix, ...details].join("|")) failDrawingRun("validation");
    if (event.status === "awaiting_clarification") clarificationHash = delta[0];
    if (event.status === "analyzing" && event.action === "clarified") clarificationHash = null;
    if (event.status === "formal_ugs") formalUgsHash = delta[0];
    previousStatus = event.status;
    previousHashes = event.artifactHashes;
  }
}

function inferCommandType(previousStatus: DrawingRunStatus, status: DrawingRunStatus): DrawingRunCommand["type"] {
  if (status === "cancelled") return "cancel";
  if (status === "rejected") return "reject";
  if (status === "failed") return "fail";
  if (status === "conflicted") return "conflict";
  if (previousStatus === "received" && status === "input_accepted") return "accept_input";
  if (previousStatus === "input_accepted" && status === "analyzing") return "begin_analysis";
  if (previousStatus === "analyzing" && status === "awaiting_interpreter") return "request_interpreter";
  if ((previousStatus === "analyzing" || previousStatus === "awaiting_interpreter") && status === "candidate_structure") return "record_candidate";
  if (previousStatus === "candidate_structure" && status === "formal_ugs") return "formalize_ugs";
  if (previousStatus === "candidate_structure" && status === "awaiting_clarification") return "request_clarification";
  if (previousStatus === "awaiting_clarification" && status === "analyzing") return "answer_clarification";
  if (previousStatus === "formal_ugs" && status === "composing_pvp") return "compose_pvp";
  if (previousStatus === "composing_pvp" && status === "preview_ready") return "publish_preview";
  if (previousStatus === "preview_ready" && status === "awaiting_page_binding") return "discover_page_target";
  if (previousStatus === "awaiting_page_binding" && status === "page_bound") return "bind_page";
  if (previousStatus === "page_bound" && status === "applying") return "request_apply";
  if (previousStatus === "applying" && status === "readback_verified") return "verify_readback";
  return failDrawingRun("validation");
}

function assertCommandBoundToScope(command: DrawingRunCommand, scope: DrawingRunTrustedScope): void {
  if (command.ownerId !== scope.ownerId) failDrawingRun("owner");
  if (command.deviceId !== scope.deviceId) failDrawingRun("device");
  if (command.runId !== scope.runId) failDrawingRun("run");
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

function appendDistinct(existing: readonly string[], additions: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...additions])];
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
  const previousHashes = recordIndex === 0 ? [] : state.idempotencyRecords[recordIndex - 1].response.event.artifactHashes;
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
    case "compose_pvp": return { status: "composing_pvp", action: "composed", errorCategory: "none", artifactHashes: [] };
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

function immutableIdempotencyResponse(event: DrawingRunEvent): DrawingRunIdempotencyResponse {
  const safeEvent = Object.freeze({ ...event, artifactHashes: Object.freeze([...event.artifactHashes]) });
  return Object.freeze({
    event: safeEvent,
    snapshot: Object.freeze({ runId: safeEvent.runId, revision: safeEvent.revision, status: safeEvent.status }),
  });
}

function assertNever(value: never): never {
  void value;
  return failDrawingRun("validation");
}
