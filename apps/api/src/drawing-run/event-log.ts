import type { DrawingRunEvent } from "./contracts.js";
import { DrawingRunError } from "./errors.js";

export interface DrawingRunEventLog {
  append(event: DrawingRunEvent, idempotencyKey: string): DrawingRunEvent;
  list(runId: string): DrawingRunEvent[];
}

export class InMemoryDrawingRunEventLog implements DrawingRunEventLog {
  private readonly events: DrawingRunEvent[] = [];
  private readonly byIdempotency = new Map<string, DrawingRunEvent>();

  append(event: DrawingRunEvent, idempotencyKey: string): DrawingRunEvent {
    validateEvent(event, idempotencyKey);
    const existing = this.byIdempotency.get(`${event.runId}:${idempotencyKey}`);
    if (existing) return structuredClone(existing);
    this.events.push(structuredClone(event));
    this.byIdempotency.set(`${event.runId}:${idempotencyKey}`, structuredClone(event));
    return structuredClone(event);
  }

  list(runId: string): DrawingRunEvent[] {
    return this.events.filter((event) => event.runId === runId).map((event) => structuredClone(event));
  }
}

function validateEvent(event: DrawingRunEvent, idempotencyKey: string): void {
  if (!idempotencyKey.trim() || !event.eventId.trim() || !event.runId.trim()) {
    throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Drawing Run event identity is invalid");
  }
  if (event.artifactHashes.some((hash) => /[A-Za-z]:[\\/]|\\\\/.test(hash))) {
    throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Drawing Run events cannot contain filesystem paths");
  }
  if (!Number.isSafeInteger(event.revision) || event.revision < 1) {
    throw new DrawingRunError("DRAWING_RUN_EVENT_INVALID", "Drawing Run event revision is invalid");
  }
}
