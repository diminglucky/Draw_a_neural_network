import {
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunErrorCategory,
  type DrawingRunStatus,
  isDrawingRunArtifactHash,
  isDrawingRunEventAction,
  isDrawingRunEventErrorCategory,
  isDrawingRunId,
  isDrawingRunStatus,
  isDrawingRunTimestamp,
  isSafeDrawingRunIdentifier,
} from "./contracts.js";
import { DrawingRunError, failDrawingRun } from "./errors.js";

const terminalStatuses = new Set<DrawingRunStatus>(["cancelled", "rejected", "failed", "conflicted", "readback_verified"]);
const ordinaryFailureCategories = new Set<DrawingRunErrorCategory>([
  "validation", "provider_unavailable", "provider_timeout", "provider_invalid", "worker",
]);

type SafeEventFields = {
  eventId: string;
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  artifactHashes: string[];
  errorCategory: DrawingRunErrorCategory;
  occurredAt: string;
  requestHash?: string;
};

export interface DrawingRunEventLog {
  append(event: DrawingRunEvent, idempotencyKey: string): DrawingRunEvent;
  list(runId: string): DrawingRunEvent[];
}

export class InMemoryDrawingRunEventLog implements DrawingRunEventLog {
  private readonly events = new Map<string, readonly DrawingRunEvent[]>();
  private readonly byIdempotency = new Map<string, DrawingRunEvent>();

  append(event: DrawingRunEvent, idempotencyKey: string): DrawingRunEvent {
    if (!isSafeDrawingRunIdentifier(idempotencyKey)) {
      throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Drawing Run event idempotency key is invalid");
    }
    const safeCandidate = snapshotDrawingRunEvent(event);
    const key = `${safeCandidate.runId}:${idempotencyKey}`;
    const existing = this.byIdempotency.get(key);
    if (existing) {
      if (!sameEvent(existing, safeCandidate)) {
        throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Drawing Run event idempotency key was reused");
      }
      return cloneEvent(existing);
    }

    const nextHistory = appendDrawingRunEvent(this.events.get(safeCandidate.runId) ?? [], safeCandidate);
    const appended = nextHistory[nextHistory.length - 1]!;
    this.events.set(safeCandidate.runId, nextHistory);
    this.byIdempotency.set(key, appended);
    return cloneEvent(appended);
  }

  list(runId: string): DrawingRunEvent[] {
    if (!isDrawingRunId(runId)) failDrawingRun("event");
    const safeHistory = reconstructDrawingRunEventHistory(this.events.get(runId) ?? []);
    return safeHistory.map(cloneEvent);
  }
}

export function appendDrawingRunEvent(
  history: readonly DrawingRunEvent[],
  event: DrawingRunEvent,
): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");
  const historySnapshot = Array.from(history as readonly unknown[]);
  return reconstructDrawingRunEventHistory([...historySnapshot, event] as readonly DrawingRunEvent[]);
}

export function reconstructDrawingRunEventHistory(history: readonly DrawingRunEvent[]): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");
  const inputs = Array.from(history as readonly unknown[]);
  const safeHistory: DrawingRunEvent[] = [];
  let runId: string | null = null;
  let previousStatus: DrawingRunStatus = "received";
  let previousOccurredAt: string | null = null;
  let previousHashes: readonly string[] = [];

  for (let index = 0; index < inputs.length; index += 1) {
    const event = snapshotDrawingRunEvent(inputs[index]);
    if (runId !== null && event.runId !== runId) failDrawingRun("event");
    const expectedRevision = index + 1;
    if (event.revision !== expectedRevision || !hasCanonicalEventId(event.eventId, event.runId, expectedRevision)) {
      failDrawingRun("event");
    }
    if (previousOccurredAt !== null && Date.parse(event.occurredAt) <= Date.parse(previousOccurredAt)) {
      failDrawingRun("event");
    }
    if (!previousHashes.every((hash, hashIndex) => event.artifactHashes[hashIndex] === hash)) {
      failDrawingRun("event");
    }

    const artifactDelta = event.artifactHashes.length - previousHashes.length;
    if (!isValidTransitionEvent(previousStatus, event, artifactDelta)) failDrawingRun("event");

    safeHistory.push(event);
    runId = event.runId;
    previousStatus = event.status;
    previousOccurredAt = event.occurredAt;
    previousHashes = event.artifactHashes;
  }

  return Object.freeze(safeHistory);
}

export function snapshotDrawingRunEvent(value: unknown): DrawingRunEvent {
  if (typeof value !== "object" || value === null) failDrawingRun("event");
  const source = value as Record<string, unknown>;
  const eventId = source.eventId;
  const runId = source.runId;
  const revision = source.revision;
  const status = source.status;
  const action = source.action;
  const rawArtifactHashes = source.artifactHashes;
  const errorCategory = source.errorCategory;
  const occurredAt = source.occurredAt;
  const requestHash = source.requestHash;

  const artifactHashes = Array.isArray(rawArtifactHashes)
    ? Array.from(rawArtifactHashes as readonly unknown[])
    : null;
  if (artifactHashes !== null) {
    const unsafePath = artifactHashes
      .some((hash) => typeof hash === "string" && /(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:\.\.[\\/])/.test(hash));
    if (unsafePath) {
      throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Drawing Run events cannot contain filesystem paths");
    }
  }

  if (!isDrawingRunId(runId)
    || typeof eventId !== "string"
    || !Number.isSafeInteger(revision)
    || (revision as number) < 1
    || !isDrawingRunStatus(status)
    || !isDrawingRunEventAction(action)
    || !isDrawingRunEventErrorCategory(errorCategory)
    || !isDrawingRunTimestamp(occurredAt)
    || artifactHashes === null
    || (requestHash !== undefined && !isDrawingRunArtifactHash(requestHash))) {
    failDrawingRun("event");
  }
  if (!hasCanonicalEventId(eventId, runId, revision as number)) failDrawingRun("event");

  if (artifactHashes.some((hash) => !isDrawingRunArtifactHash(hash))) {
    failDrawingRun("event");
  }

  return Object.freeze({
    eventId,
    runId,
    revision: revision as number,
    status,
    action,
    artifactHashes: Object.freeze(artifactHashes as string[]) as unknown as string[],
    errorCategory,
    occurredAt,
    ...(requestHash === undefined ? {} : { requestHash: requestHash.toLowerCase() }),
  });
}

function hasCanonicalEventId(eventId: string, runId: string, revision: number): boolean {
  const prefix = `${runId}:${revision}`;
  if (eventId === prefix) return true;
  if (!eventId.startsWith(`${prefix}:`)) return false;
  return /^[A-Za-z0-9_-]{1,64}$/.test(eventId.slice(prefix.length + 1));
}

function isValidTransitionEvent(previousStatus: DrawingRunStatus, event: DrawingRunEvent, artifactDelta: number): boolean {
  if (terminalStatuses.has(previousStatus) || previousStatus === "awaiting_apply_confirmation") return false;
  if (event.status === "cancelled") {
    return event.action === "failed" && event.errorCategory === "cancelled" && artifactDelta === 0;
  }
  if (event.status === "rejected" || event.status === "failed") {
    return event.action === "failed" && ordinaryFailureCategories.has(event.errorCategory) && artifactDelta === 0;
  }
  if (event.status === "conflicted") {
    return event.action === "failed" && event.errorCategory === "conflict" && artifactDelta === 1;
  }
  if (event.errorCategory !== "none") return false;

  switch (previousStatus) {
    case "received": return event.status === "input_accepted" && event.action === "received" && artifactDelta === 1;
    case "input_accepted": return event.status === "analyzing" && event.action === "analyzed" && artifactDelta === 1;
    case "analyzing":
      return ((event.status === "awaiting_interpreter" && event.action === "proposed")
        || (event.status === "candidate_structure" && event.action === "proposed")) && artifactDelta === 1;
    case "awaiting_interpreter": return event.status === "candidate_structure" && event.action === "proposed" && artifactDelta === 1;
    case "candidate_structure":
      return ((event.status === "formal_ugs" && event.action === "formalized")
        || (event.status === "awaiting_clarification" && event.action === "clarified")) && artifactDelta === 1;
    case "awaiting_clarification": return event.status === "analyzing" && event.action === "analyzed" && artifactDelta === 1;
    case "formal_ugs": return event.status === "composing_pvp" && event.action === "composed" && artifactDelta === 0;
    case "composing_pvp": return event.status === "preview_ready" && event.action === "composed" && artifactDelta === 2;
    case "preview_ready": return event.status === "awaiting_page_binding" && event.action === "bound" && artifactDelta === 1;
    case "awaiting_page_binding": return event.status === "page_bound" && event.action === "bound" && artifactDelta === 1;
    case "page_bound": return event.status === "applying" && event.action === "applied" && artifactDelta === 1;
    case "applying": return event.status === "readback_verified" && event.action === "readback" && artifactDelta === 1;
    default: return false;
  }
}

function sameEvent(left: DrawingRunEvent, right: DrawingRunEvent): boolean {
  return left.eventId === right.eventId
    && left.runId === right.runId
    && left.revision === right.revision
    && left.status === right.status
    && left.action === right.action
    && left.errorCategory === right.errorCategory
    && left.occurredAt === right.occurredAt
    && left.requestHash === right.requestHash
    && left.artifactHashes.length === right.artifactHashes.length
    && left.artifactHashes.every((hash, index) => hash === right.artifactHashes[index]);
}

function cloneEvent(event: DrawingRunEvent): DrawingRunEvent {
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
