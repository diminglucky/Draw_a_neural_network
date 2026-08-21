import { type DrawingRunEvent } from "./contracts.js";
import { failDrawingRun } from "./errors.js";

const hashPattern = /^[a-f0-9]{64}$/;
const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;

export function appendDrawingRunEvent(history: readonly DrawingRunEvent[], event: DrawingRunEvent): readonly DrawingRunEvent[] {
  if (!safeIdentifierPattern.test(event.eventId) || !safeIdentifierPattern.test(event.runId)) failDrawingRun("event");
  if (!Number.isSafeInteger(event.revision) || event.revision < 1) failDrawingRun("event");
  if (Number.isNaN(Date.parse(event.occurredAt)) || event.artifactHashes.some((hash) => !hashPattern.test(hash))) failDrawingRun("event");
  if (history.some((item) => item.eventId === event.eventId)) failDrawingRun("event");

  const safeEvent: DrawingRunEvent = {
    eventId: event.eventId,
    runId: event.runId,
    revision: event.revision,
    status: event.status,
    action: event.action,
    artifactHashes: [...event.artifactHashes],
    errorCategory: event.errorCategory,
    occurredAt: event.occurredAt,
  };
  return [...history, safeEvent];
}
