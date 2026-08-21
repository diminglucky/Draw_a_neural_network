import {
  type DrawingRunEvent,
  type DrawingRunStatus,
  isDrawingRunArtifactHash,
  isDrawingRunEventAction,
  isDrawingRunEventErrorCategory,
  isDrawingRunFailureCategory,
  isDrawingRunId,
  isDrawingRunStatus,
  isDrawingRunTimestamp,
} from "./contracts.js";
import { failDrawingRun } from "./errors.js";

const terminalStatuses = new Set<DrawingRunStatus>(["cancelled", "rejected", "failed", "conflicted", "readback_verified"]);

export function appendDrawingRunEvent(history: readonly DrawingRunEvent[], event: DrawingRunEvent): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");
  return reconstructDrawingRunEventHistory([...history, event]);
}

export function reconstructDrawingRunEventHistory(history: readonly DrawingRunEvent[]): readonly DrawingRunEvent[] {
  if (!Array.isArray(history)) failDrawingRun("event");

  const safeHistory: DrawingRunEvent[] = [];
  let runId: string | null = null;
  let previousStatus: DrawingRunStatus = "received";
  let previousOccurredAt: string | null = null;
  let previousArtifactHashes: readonly string[] = [];

  for (let index = 0; index < history.length; index += 1) {
    const event = history[index] as unknown;
    if (typeof event !== "object" || event === null) failDrawingRun("event");
    const candidate = event as DrawingRunEvent;

    if (!isDrawingRunId(candidate.runId)) failDrawingRun("event");
    if (runId !== null && candidate.runId !== runId) failDrawingRun("event");
    const expectedRevision = index + 1;
    if (candidate.revision !== expectedRevision || candidate.eventId !== `${candidate.runId}:${expectedRevision}`) failDrawingRun("event");
    if (!isDrawingRunStatus(candidate.status) || !isDrawingRunEventAction(candidate.action) || !isDrawingRunEventErrorCategory(candidate.errorCategory)) failDrawingRun("event");
    if (!isDrawingRunTimestamp(candidate.occurredAt)) failDrawingRun("event");
    if (previousOccurredAt !== null && Date.parse(candidate.occurredAt) <= Date.parse(previousOccurredAt)) failDrawingRun("event");
    if (!Array.isArray(candidate.artifactHashes) || candidate.artifactHashes.some((hash) => !isDrawingRunArtifactHash(hash))) failDrawingRun("event");
    if (new Set(candidate.artifactHashes).size !== candidate.artifactHashes.length) failDrawingRun("event");
    if (!previousArtifactHashes.every((hash, hashIndex) => candidate.artifactHashes[hashIndex] === hash)) failDrawingRun("event");
    if (!isValidTransitionEvent(previousStatus, candidate)) failDrawingRun("event");

    const safeEvent = Object.freeze<DrawingRunEvent>({
      eventId: candidate.eventId,
      runId: candidate.runId,
      revision: candidate.revision,
      status: candidate.status,
      action: candidate.action,
      artifactHashes: Object.freeze([...candidate.artifactHashes]),
      errorCategory: candidate.errorCategory,
      occurredAt: candidate.occurredAt,
    });
    safeHistory.push(safeEvent);
    runId = safeEvent.runId;
    previousStatus = safeEvent.status;
    previousOccurredAt = safeEvent.occurredAt;
    previousArtifactHashes = safeEvent.artifactHashes;
  }

  return Object.freeze(safeHistory);
}

function isValidTransitionEvent(previousStatus: DrawingRunStatus, event: DrawingRunEvent): boolean {
  if (terminalStatuses.has(previousStatus)) return false;
  if (event.status === "cancelled") return event.action === "failed" && event.errorCategory === "cancelled";
  if (event.status === "rejected" || event.status === "failed") return event.action === "failed" && isDrawingRunFailureCategory(event.errorCategory);
  if (event.status === "conflicted") return event.action === "failed" && event.errorCategory === "conflict";
  if (event.errorCategory !== "none") return false;

  switch (previousStatus) {
    case "received": return event.status === "input_accepted" && event.action === "received";
    case "input_accepted": return event.status === "analyzing" && event.action === "analyzed";
    case "analyzing":
      return (event.status === "awaiting_interpreter" && event.action === "analyzed")
        || (event.status === "candidate_structure" && event.action === "proposed");
    case "awaiting_interpreter": return event.status === "candidate_structure" && event.action === "proposed";
    case "candidate_structure":
      return (event.status === "formal_ugs" && event.action === "formalized")
        || (event.status === "awaiting_clarification" && event.action === "clarified");
    case "awaiting_clarification": return event.status === "analyzing" && event.action === "clarified";
    case "formal_ugs": return event.status === "composing_pvp" && event.action === "composed";
    case "composing_pvp": return event.status === "preview_ready" && event.action === "composed";
    case "preview_ready": return event.status === "awaiting_page_binding" && event.action === "bound";
    case "awaiting_page_binding": return event.status === "page_bound" && event.action === "bound";
    case "page_bound": return event.status === "applying" && event.action === "applied";
    case "applying": return event.status === "readback_verified" && event.action === "readback";
    default: return false;
  }
}
