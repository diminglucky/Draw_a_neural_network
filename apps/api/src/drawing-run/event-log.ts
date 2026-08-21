import {
  type DrawingRunEvent,
  type DrawingRunEventAction,
  type DrawingRunEventErrorCategory,
  type DrawingRunStatus,
  isDrawingRunArtifactHash,
  isDrawingRunEventAction,
  isDrawingRunEventErrorCategory,
  isDrawingRunId,
  isDrawingRunStatus,
  isDrawingRunTimestamp,
} from "./contracts.js";
import { failDrawingRun } from "./errors.js";

const terminalStatuses = new Set<DrawingRunStatus>(["cancelled", "rejected", "failed", "conflicted", "readback_verified"]);
const ordinaryFailureCategories = new Set<DrawingRunEventErrorCategory>([
  "validation",
  "provider_unavailable",
  "provider_timeout",
  "provider_invalid",
  "worker",
]);

type SafeEventFields = {
  eventId: string;
  runId: string;
  revision: number;
  status: DrawingRunStatus;
  action: DrawingRunEventAction;
  artifactHashes: readonly string[];
  errorCategory: DrawingRunEventErrorCategory;
  occurredAt: string;
};

export function appendDrawingRunEvent(history: readonly DrawingRunEvent[], event: DrawingRunEvent): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");
  const historySnapshot = Array.from(history as readonly unknown[]);
  return reconstructDrawingRunEventHistory([...historySnapshot, event] as readonly DrawingRunEvent[]);
}

export function reconstructDrawingRunEventHistory(history: readonly DrawingRunEvent[]): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");
  const inputEvents = Array.from(history as readonly unknown[]);
  const safeHistory: DrawingRunEvent[] = [];
  let runId: string | null = null;
  let previousStatus: DrawingRunStatus = "received";
  let previousOccurredAt: string | null = null;
  let previousArtifactHashes: readonly string[] = [];

  for (let index = 0; index < inputEvents.length; index += 1) {
    const candidate = snapshotEvent(inputEvents[index]);
    if (runId !== null && candidate.runId !== runId) failDrawingRun("event");
    const expectedRevision = index + 1;
    if (candidate.revision !== expectedRevision || candidate.eventId !== `${candidate.runId}:${expectedRevision}`) failDrawingRun("event");
    if (previousOccurredAt !== null && Date.parse(candidate.occurredAt) <= Date.parse(previousOccurredAt)) failDrawingRun("event");
    if (!previousArtifactHashes.every((hash, hashIndex) => candidate.artifactHashes[hashIndex] === hash)) failDrawingRun("event");

    const artifactDelta = candidate.artifactHashes.slice(previousArtifactHashes.length);
    if (!isValidTransitionEvent(previousStatus, candidate, artifactDelta.length)) failDrawingRun("event");

    const safeEvent = Object.freeze<DrawingRunEvent>({
      ...candidate,
      artifactHashes: Object.freeze([...candidate.artifactHashes]),
    });
    safeHistory.push(safeEvent);
    runId = safeEvent.runId;
    previousStatus = safeEvent.status;
    previousOccurredAt = safeEvent.occurredAt;
    previousArtifactHashes = safeEvent.artifactHashes;
  }

  return Object.freeze(safeHistory);
}

function snapshotEvent(value: unknown): SafeEventFields {
  if (typeof value !== "object" || value === null) failDrawingRun("event");
  const candidate = value as Record<string, unknown>;
  const eventId = candidate.eventId;
  const runId = candidate.runId;
  const revision = candidate.revision;
  const status = candidate.status;
  const action = candidate.action;
  const rawArtifactHashes = candidate.artifactHashes;
  const errorCategory = candidate.errorCategory;
  const occurredAt = candidate.occurredAt;

  if (!isDrawingRunId(runId)
    || typeof eventId !== "string"
    || !Number.isSafeInteger(revision)
    || (revision as number) < 1
    || !isDrawingRunStatus(status)
    || !isDrawingRunEventAction(action)
    || !isDrawingRunEventErrorCategory(errorCategory)
    || !isDrawingRunTimestamp(occurredAt)
    || !Array.isArray(rawArtifactHashes)) {
    failDrawingRun("event");
  }
  const artifactHashes = Array.from(rawArtifactHashes as readonly unknown[]);
  if (artifactHashes.some((hash) => !isDrawingRunArtifactHash(hash))
    || new Set(artifactHashes).size !== artifactHashes.length) {
    failDrawingRun("event");
  }
  return {
    eventId,
    runId,
    revision: revision as number,
    status,
    action,
    artifactHashes: artifactHashes as string[],
    errorCategory,
    occurredAt,
  };
}

function isValidTransitionEvent(previousStatus: DrawingRunStatus, event: SafeEventFields, artifactDelta: number): boolean {
  if (terminalStatuses.has(previousStatus)) return false;
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
      return ((event.status === "awaiting_interpreter" && event.action === "analyzed")
        || (event.status === "candidate_structure" && event.action === "proposed")) && artifactDelta === 1;
    case "awaiting_interpreter": return event.status === "candidate_structure" && event.action === "proposed" && artifactDelta === 1;
    case "candidate_structure":
      return ((event.status === "formal_ugs" && event.action === "formalized")
        || (event.status === "awaiting_clarification" && event.action === "clarified")) && artifactDelta === 1;
    case "awaiting_clarification": return event.status === "analyzing" && event.action === "clarified" && artifactDelta === 1;
    case "formal_ugs": return event.status === "composing_pvp" && event.action === "composed" && artifactDelta === 0;
    case "composing_pvp": return event.status === "preview_ready" && event.action === "composed" && artifactDelta === 2;
    case "preview_ready": return event.status === "awaiting_page_binding" && event.action === "bound" && artifactDelta === 1;
    case "awaiting_page_binding": return event.status === "page_bound" && event.action === "bound" && artifactDelta === 1;
    case "page_bound": return event.status === "applying" && event.action === "applied" && artifactDelta === 1;
    case "applying": return event.status === "readback_verified" && event.action === "readback" && artifactDelta === 1;
    default: return false;
  }
}
