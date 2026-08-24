import {
  type DrawingClarification,
  type DrawingIntent,
  type DrawingPreview,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunCommandBase,
  type DrawingRunErrorCategory,
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunFailureCategory,
  type DrawingRunStatus,
  type DrawingRunTransition,
  type DrawingRunTrustedScope,
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
import { DrawingRunError, failDrawingRun } from "./errors.js";
import { snapshotDrawingRunEvent } from "./event-log.js";

const terminalStatuses = new Set<DrawingRunStatus>(["readback_verified", "cancelled", "rejected", "failed", "conflicted"]);
const ordinaryFailureCategories = new Set<DrawingRunFailureCategory>([
  "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker",
]);
const clarificationPrompt = "A clarification is required before continuing.";

type SafeCommand = DrawingRunCommand & { occurredAt?: string; now?: string };

type Resolution = {
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  errorCategory: DrawingRunErrorCategory;
  artifactHashes?: string[];
  receiptIds?: string[];
  formalUgsHash?: string | null;
  clarification?: DrawingClarification | null;
  preview?: DrawingPreview | null;
};

export function reduceDrawingRun(
  state: DrawingRun,
  command: DrawingRunCommand,
  trustedScope?: DrawingRunTrustedScope,
): DrawingRunTransition {
  const safeCommand = snapshotDrawingRunCommand(command);
  const scope = trustedScope === undefined
    ? snapshotTrustedScope(safeCommand)
    : snapshotTrustedScope(trustedScope);
  const safeState = reconstructDrawingRunState(state, scope);
  assertCommandBoundToScope(safeCommand, scope);

  if (safeCommand.expectedRevision !== safeState.revision) failDrawingRun("revision");
  const occurredAt = resolveOccurredAt(safeCommand, safeState.updatedAt);
  const resolution = resolveTransition(safeState, safeCommand);
  const nextRevision = safeState.revision + 1;
  const nextHashes = appendRoleArtifacts(safeState.artifactHashes, resolution.artifactHashes ?? []);
  const nextReceiptIds = appendUniqueIds(safeState.privateReceiptIds, resolution.receiptIds ?? []);

  const proposedNext: DrawingRun = {
    runId: safeState.runId,
    ownerId: safeState.ownerId,
    deviceId: safeState.deviceId,
    status: resolution.status,
    revision: nextRevision,
    intent: copyIntent(safeState.intent),
    artifactHashes: nextHashes,
    privateReceiptIds: nextReceiptIds,
    startIdempotencyKey: safeState.startIdempotencyKey,
    startRequestHash: safeState.startRequestHash,
    createdAt: safeState.createdAt,
    updatedAt: occurredAt,
    clarification: resolution.clarification === undefined ? copyClarification(safeState.clarification) : resolution.clarification,
    preview: resolution.preview === undefined ? copyPreview(safeState.preview) : resolution.preview,
    errorCategory: resolution.errorCategory,
    formalUgsHash: resolution.formalUgsHash === undefined ? safeState.formalUgsHash ?? null : resolution.formalUgsHash,
  };

  const next = reconstructDrawingRunState(proposedNext, scope);
  const event = mutableEvent(snapshotDrawingRunEvent({
    eventId: `${next.runId}:${next.revision}:${safeCommand.type}`,
    runId: next.runId,
    revision: next.revision,
    status: next.status,
    action: resolution.action,
    artifactHashes: [...next.artifactHashes],
    errorCategory: next.errorCategory,
    occurredAt,
  }));

  return { next, event };
}

export function reconstructDrawingRunState(
  state: DrawingRun,
  trustedScope?: DrawingRunTrustedScope | number,
): DrawingRun {
  if (typeof state !== "object" || state === null) failDrawingRun("validation");
  const source = state as unknown as Record<string, unknown>;
  const snapshot = {
    runId: source.runId,
    ownerId: source.ownerId,
    deviceId: source.deviceId,
    status: source.status,
    revision: source.revision,
    intent: source.intent,
    artifactHashes: source.artifactHashes,
    privateReceiptIds: source.privateReceiptIds,
    startIdempotencyKey: source.startIdempotencyKey,
    startRequestHash: source.startRequestHash,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    clarification: source.clarification,
    preview: source.preview,
    errorCategory: source.errorCategory,
    formalUgsHash: source.formalUgsHash,
  };

  const scope = typeof trustedScope === "object" && trustedScope !== null
    ? snapshotTrustedScope(trustedScope)
    : snapshotTrustedScope({
      runId: snapshot.runId,
      ownerId: snapshot.ownerId,
      deviceId: snapshot.deviceId,
    });

  if (snapshot.runId !== scope.runId) failDrawingRun("run");
  if (snapshot.ownerId !== scope.ownerId) failDrawingRun("owner");
  if (snapshot.deviceId !== scope.deviceId) failDrawingRun("device");
  if (!isDrawingRunStatus(snapshot.status)
    || snapshot.status === "awaiting_apply_confirmation"
    || !Number.isSafeInteger(snapshot.revision)
    || (snapshot.revision as number) < 0
    || !isSafeDrawingRunIdentifier(snapshot.startIdempotencyKey)
    || !isDrawingRunArtifactHash(snapshot.startRequestHash)
    || !isDrawingRunTimestamp(snapshot.createdAt)
    || !isDrawingRunTimestamp(snapshot.updatedAt)
    || Date.parse(snapshot.updatedAt) < Date.parse(snapshot.createdAt)) {
    failDrawingRun("validation");
  }

  const revision = snapshot.revision as number;
  const intent = copyIntent(snapshot.intent);
  const artifactHashes = copyHashes(snapshot.artifactHashes, true);
  const privateReceiptIds = copyOpaqueIds(snapshot.privateReceiptIds, true);
  const clarification = copyClarification(snapshot.clarification);
  const preview = copyPreview(snapshot.preview);
  const errorCategory = copyErrorCategory(snapshot.errorCategory);
  const inferredFormalUgsHash = inferFormalUgsHash(snapshot.status, artifactHashes);
  const formalUgsHash = snapshot.formalUgsHash === undefined
    ? inferredFormalUgsHash
    : snapshot.formalUgsHash === null
      ? null
      : copyHash(snapshot.formalUgsHash);

  validateStateSemantics({
    status: snapshot.status,
    revision,
    artifactHashes,
    privateReceiptIds,
    clarification,
    preview,
    errorCategory,
    formalUgsHash,
    inferredFormalUgsHash,
  });

  return {
    runId: scope.runId,
    ownerId: scope.ownerId,
    deviceId: scope.deviceId,
    status: snapshot.status,
    revision,
    intent,
    artifactHashes,
    privateReceiptIds,
    startIdempotencyKey: snapshot.startIdempotencyKey,
    startRequestHash: snapshot.startRequestHash.toLowerCase(),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    clarification,
    preview,
    errorCategory,
    formalUgsHash,
  };
}

function resolveTransition(state: DrawingRun, command: SafeCommand): Resolution {
  switch (command.type) {
    case "accept_input":
      requireStatus(state, "received");
      return {
        status: "input_accepted",
        action: "received",
        errorCategory: "none",
        artifactHashes: [command.artifactHash],
        receiptIds: command.receiptIds,
      };
    case "begin_analysis":
      requireStatus(state, "input_accepted");
      return { status: "analyzing", action: "analyzed", errorCategory: "none", artifactHashes: [command.policyHash] };
    case "request_interpreter":
      requireStatus(state, "analyzing");
      return { status: "awaiting_interpreter", action: "proposed", errorCategory: "none", artifactHashes: [command.evidencePackHash] };
    case "record_candidate":
      requireOneOfStatuses(state, ["analyzing", "awaiting_interpreter"]);
      return { status: "candidate_structure", action: "proposed", errorCategory: "none", artifactHashes: [command.candidateHash] };
    case "formalize_ugs":
      requireStatus(state, "candidate_structure");
      return {
        status: "formal_ugs",
        action: "formalized",
        errorCategory: "none",
        artifactHashes: [command.ugsHash],
        formalUgsHash: command.ugsHash,
      };
    case "request_clarification":
      requireStatus(state, "candidate_structure");
      return {
        status: "awaiting_clarification",
        action: "clarified",
        errorCategory: "none",
        artifactHashes: [command.clarificationHash],
        clarification: {
          id: `clarification:${command.clarificationHash}`,
          prompt: clarificationPrompt,
          hash: command.clarificationHash,
        },
      };
    case "answer_clarification":
      requireStatus(state, "awaiting_clarification");
      if (state.clarification?.id !== command.clarificationId) failDrawingRun("validation");
      return {
        status: "analyzing",
        action: "analyzed",
        errorCategory: "none",
        artifactHashes: [command.answerHash],
        clarification: null,
      };
    case "compose_pvp":
      requireStatus(state, "formal_ugs");
      if (!state.formalUgsHash || command.ugsHash !== state.formalUgsHash) failDrawingRun("validation");
      return { status: "composing_pvp", action: "composed", errorCategory: "none" };
    case "publish_preview":
      requireStatus(state, "composing_pvp");
      return {
        status: "preview_ready",
        action: "composed",
        errorCategory: "none",
        artifactHashes: [command.pvpHash, command.qaHash],
        preview: { artifactId: `preview:${command.pvpHash}`, hash: command.pvpHash },
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
      return { status: "cancelled", action: "failed", errorCategory: "cancelled", clarification: null };
    case "reject":
      requireNonTerminal(state);
      return { status: "rejected", action: "failed", errorCategory: command.errorCategory, clarification: null };
    case "fail":
      requireNonTerminal(state);
      return { status: "failed", action: "failed", errorCategory: command.errorCategory, clarification: null };
    case "conflict":
      requireNonTerminal(state);
      return {
        status: "conflicted",
        action: "failed",
        errorCategory: "conflict",
        artifactHashes: [command.conflictHash],
        clarification: null,
      };
    default:
      return assertNever(command);
  }
}

function snapshotDrawingRunCommand(value: DrawingRunCommand): SafeCommand {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const source = value as unknown as Record<string, unknown>;
  const type = source.type;
  const ownerId = source.ownerId;
  const deviceId = source.deviceId;
  const runId = source.runId;
  const expectedRevision = source.expectedRevision;
  const idempotencyKey = source.idempotencyKey;
  const occurredAt = source.occurredAt;
  const now = source.now;

  if (!isSafeDrawingRunIdentifier(ownerId)
    || !isSafeDrawingRunIdentifier(deviceId)
    || !isDrawingRunId(runId)
    || !Number.isSafeInteger(expectedRevision)
    || (expectedRevision as number) < 0
    || !isSafeDrawingRunIdentifier(idempotencyKey)
    || (occurredAt !== undefined && !isDrawingRunTimestamp(occurredAt))
    || (now !== undefined && !isDrawingRunTimestamp(now))
    || (occurredAt !== undefined && now !== undefined && occurredAt !== now)) {
    failDrawingRun("validation");
  }

  const base: DrawingRunCommandBase = {
    ownerId,
    deviceId,
    runId,
    expectedRevision: expectedRevision as number,
    idempotencyKey,
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(now === undefined ? {} : { now }),
  };

  switch (type) {
    case "accept_input":
      return { ...base, type, receiptIds: copyOpaqueIds(source.receiptIds, false), artifactHash: copyHash(source.artifactHash) };
    case "begin_analysis": return { ...base, type, policyHash: copyHash(source.policyHash) };
    case "request_interpreter": return { ...base, type, evidencePackHash: copyHash(source.evidencePackHash) };
    case "record_candidate": return { ...base, type, candidateHash: copyHash(source.candidateHash) };
    case "formalize_ugs": return { ...base, type, ugsHash: copyHash(source.ugsHash) };
    case "request_clarification": return { ...base, type, clarificationHash: copyHash(source.clarificationHash) };
    case "answer_clarification": {
      const clarificationId = source.clarificationId;
      if (!isSafeDrawingRunIdentifier(clarificationId)) failDrawingRun("validation");
      return { ...base, type, clarificationId, answerHash: copyHash(source.answerHash) };
    }
    case "compose_pvp": return { ...base, type, ugsHash: copyHash(source.ugsHash) };
    case "publish_preview": return { ...base, type, pvpHash: copyHash(source.pvpHash), qaHash: copyHash(source.qaHash) };
    case "discover_page_target": return { ...base, type, discoveryHash: copyHash(source.discoveryHash) };
    case "bind_page": return { ...base, type, bindingHash: copyHash(source.bindingHash) };
    case "request_apply": return { ...base, type, authorizationHash: copyHash(source.authorizationHash) };
    case "verify_readback": return { ...base, type, readbackHash: copyHash(source.readbackHash) };
    case "cancel": {
      const reasonCategory = source.reasonCategory;
      if (!isDrawingRunCancelReasonCategory(reasonCategory)) failDrawingRun("validation");
      return { ...base, type, reasonCategory };
    }
    case "reject":
    case "fail": {
      const errorCategory = source.errorCategory;
      if (!isDrawingRunFailureCategory(errorCategory) || !ordinaryFailureCategories.has(errorCategory)) failDrawingRun("validation");
      return { ...base, type, errorCategory };
    }
    case "conflict": return { ...base, type, conflictHash: copyHash(source.conflictHash) };
    default: return failDrawingRun("validation");
  }
}

function snapshotTrustedScope(value: unknown): DrawingRunTrustedScope {
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const source = value as Record<string, unknown>;
  const runId = source.runId;
  const ownerId = source.ownerId;
  const deviceId = source.deviceId;
  if (!isDrawingRunId(runId) || !isSafeDrawingRunIdentifier(ownerId) || !isSafeDrawingRunIdentifier(deviceId)) {
    failDrawingRun("validation");
  }
  return { runId, ownerId, deviceId };
}

function validateStateSemantics(input: {
  status: DrawingRunStatus;
  revision: number;
  artifactHashes: readonly string[];
  privateReceiptIds: readonly string[];
  clarification: DrawingClarification | null;
  preview: DrawingPreview | null;
  errorCategory: DrawingRunErrorCategory;
  formalUgsHash: string | null;
  inferredFormalUgsHash: string | null;
}): void {
  const minimumRevision: Partial<Record<DrawingRunStatus, number>> = {
    received: 0,
    input_accepted: 1,
    analyzing: 2,
    awaiting_interpreter: 3,
    candidate_structure: 3,
    awaiting_clarification: 4,
    formal_ugs: 4,
    composing_pvp: 5,
    preview_ready: 6,
    awaiting_page_binding: 7,
    page_bound: 8,
    applying: 9,
    readback_verified: 10,
  };
  const minimumArtifacts: Partial<Record<DrawingRunStatus, number>> = {
    input_accepted: 1,
    analyzing: 2,
    awaiting_interpreter: 3,
    candidate_structure: 3,
    awaiting_clarification: 4,
    formal_ugs: 4,
    composing_pvp: 4,
    preview_ready: 6,
    awaiting_page_binding: 7,
    page_bound: 8,
    applying: 9,
    readback_verified: 10,
  };
  const minimum = minimumRevision[input.status];
  if (input.status === "received") {
    if (input.revision !== 0
      || input.artifactHashes.length !== 0
      || input.privateReceiptIds.length !== 0
      || input.clarification !== null
      || input.preview !== null
      || input.formalUgsHash !== null
      || input.errorCategory !== "none") {
      failDrawingRun("validation");
    }
    return;
  }
  if (minimum !== undefined && input.revision < minimum) failDrawingRun("validation");
  const minArtifacts = minimumArtifacts[input.status];
  if (minArtifacts !== undefined
    && (input.artifactHashes.length < minArtifacts || input.privateReceiptIds.length === 0)) {
    failDrawingRun("validation");
  }

  if (input.status === "cancelled") {
    if (input.errorCategory !== "cancelled") failDrawingRun("validation");
  } else if (input.status === "conflicted") {
    if (input.errorCategory !== "conflict") failDrawingRun("validation");
  } else if (input.status === "rejected" || input.status === "failed") {
    if (!ordinaryFailureCategories.has(input.errorCategory as DrawingRunFailureCategory)) failDrawingRun("validation");
  } else if (input.errorCategory !== "none") {
    failDrawingRun("validation");
  }

  if ((input.status === "awaiting_clarification") !== (input.clarification !== null)) failDrawingRun("validation");
  const previewStatuses = new Set<DrawingRunStatus>([
    "preview_ready", "awaiting_page_binding", "page_bound", "applying", "readback_verified",
  ]);
  if (previewStatuses.has(input.status) && input.preview === null) failDrawingRun("validation");
  if (!previewStatuses.has(input.status) && !terminalStatuses.has(input.status) && input.preview !== null) {
    failDrawingRun("validation");
  }

  const formalStatuses = new Set<DrawingRunStatus>([
    "formal_ugs", "composing_pvp", "preview_ready", "awaiting_page_binding", "page_bound", "applying", "readback_verified",
  ]);
  if (formalStatuses.has(input.status)) {
    if (input.formalUgsHash === null
      || input.inferredFormalUgsHash === null
      || input.formalUgsHash !== input.inferredFormalUgsHash) {
      failDrawingRun("validation");
    }
  } else if (!terminalStatuses.has(input.status) && input.formalUgsHash !== null) {
    failDrawingRun("validation");
  }
}

function inferFormalUgsHash(status: DrawingRunStatus, hashes: readonly string[]): string | null {
  const offsetByStatus: Partial<Record<DrawingRunStatus, number>> = {
    formal_ugs: 1,
    composing_pvp: 1,
    preview_ready: 3,
    awaiting_page_binding: 4,
    page_bound: 5,
    applying: 6,
    readback_verified: 7,
  };
  const offset = offsetByStatus[status];
  if (offset === undefined || hashes.length < offset) return null;
  return hashes[hashes.length - offset] ?? null;
}

function resolveOccurredAt(command: SafeCommand, updatedAt: string): string {
  const value = command.occurredAt ?? command.now ?? incrementTimestamp(updatedAt);
  if (!isDrawingRunTimestamp(value) || Date.parse(value) <= Date.parse(updatedAt)) failDrawingRun("validation");
  return value;
}

function incrementTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) failDrawingRun("validation");
  return new Date(parsed + 1).toISOString();
}

function copyIntent(value: unknown): DrawingIntent {
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

function copyHash(value: unknown): string {
  if (!isDrawingRunArtifactHash(value)) failDrawingRun("validation");
  return value.toLowerCase();
}

function copyHashes(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) failDrawingRun("validation");
  const hashes = Array.from(value as readonly unknown[]);
  if ((!allowEmpty && hashes.length === 0)
    || hashes.some((hash) => !isDrawingRunArtifactHash(hash))) {
    failDrawingRun("validation");
  }
  return hashes.map((hash) => (hash as string).toLowerCase());
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

function copyClarification(value: unknown): DrawingClarification | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const source = value as Record<string, unknown>;
  const id = source.id;
  const hash = copyHash(source.hash);
  if (id !== `clarification:${hash}` && id !== `clarification:${hash.slice(0, 16)}`) failDrawingRun("validation");
  return { id: id as string, prompt: clarificationPrompt, hash };
}

function copyPreview(value: unknown): DrawingPreview | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) failDrawingRun("validation");
  const source = value as Record<string, unknown>;
  const artifactId = source.artifactId;
  const hash = copyHash(source.hash);
  if (artifactId !== `preview:${hash}` && artifactId !== `preview:${hash.slice(0, 16)}`) failDrawingRun("validation");
  return { artifactId: artifactId as string, hash };
}

function copyErrorCategory(value: unknown): DrawingRunErrorCategory {
  const categories: readonly DrawingRunErrorCategory[] = [
    "none", "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker", "conflict", "cancelled",
  ];
  if (typeof value !== "string" || !categories.includes(value as DrawingRunErrorCategory)) failDrawingRun("validation");
  return value as DrawingRunErrorCategory;
}

function appendRoleArtifacts(existing: readonly string[], additions: readonly string[]): string[] {
  return [...existing, ...additions];
}

function appendUniqueIds(existing: readonly string[], additions: readonly string[]): string[] {
  if (additions.length === 0) return [...existing];
  if (new Set(additions).size !== additions.length || additions.some((value) => existing.includes(value))) failDrawingRun("validation");
  return [...existing, ...additions];
}

function assertCommandBoundToScope(command: DrawingRunCommand, scope: DrawingRunTrustedScope): void {
  if (command.ownerId !== scope.ownerId) failDrawingRun("owner");
  if (command.deviceId !== scope.deviceId) failDrawingRun("device");
  if (command.runId !== scope.runId) failDrawingRun("run");
}

function requireStatus(state: DrawingRun, expected: DrawingRunStatus): void {
  if (terminalStatuses.has(state.status)) throw new DrawingRunError("DRAWING_RUN_TERMINAL", `Run is already terminal: ${state.status}`);
  if (state.status !== expected) failDrawingRun("transition");
}

function requireOneOfStatuses(state: DrawingRun, expected: readonly DrawingRunStatus[]): void {
  if (terminalStatuses.has(state.status)) throw new DrawingRunError("DRAWING_RUN_TERMINAL", `Run is already terminal: ${state.status}`);
  if (!expected.includes(state.status)) failDrawingRun("transition");
}

function requireNonTerminal(state: DrawingRun): void {
  if (terminalStatuses.has(state.status)) throw new DrawingRunError("DRAWING_RUN_TERMINAL", `Run is already terminal: ${state.status}`);
}

function mutableEvent(event: DrawingRunEvent): DrawingRunEvent {
  return {
    eventId: event.eventId,
    runId: event.runId,
    revision: event.revision,
    status: event.status,
    action: event.action,
    artifactHashes: [...event.artifactHashes],
    errorCategory: event.errorCategory,
    occurredAt: event.occurredAt,
    ...(event.requestHash === undefined ? {} : { requestHash: event.requestHash }),
  };
}

function assertNever(value: never): never {
  void value;
  return failDrawingRun("validation");
}
