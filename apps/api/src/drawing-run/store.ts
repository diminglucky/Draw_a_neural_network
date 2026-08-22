import type { DrawingRun, DrawingRunEvent } from "./contracts.js";
import type { FoundationStore } from "../store.js";

export interface DrawingRunStore {
  create(run: DrawingRun): Promise<void>;
  get(ownerId: string, runId: string): Promise<DrawingRun | null>;
  getByStartIdempotency(ownerId: string, deviceId: string, idempotencyKey: string): Promise<DrawingRun | null>;
  compareAndSet(input: {
    ownerId: string;
    runId: string;
    expectedRevision: number;
    next: DrawingRun;
  }): Promise<"updated" | "conflict">;
  appendEvent(event: DrawingRunEvent, idempotencyKey: string): Promise<DrawingRunEvent>;
  getEvent(ownerId: string, runId: string, idempotencyKey: string): Promise<DrawingRunEvent | null>;
  listEvents(ownerId: string, runId: string): Promise<DrawingRunEvent[]>;
}

export class InMemoryDrawingRunStore implements DrawingRunStore {
  private readonly runs = new Map<string, DrawingRun>();
  private readonly events = new Map<string, DrawingRunEvent[]>();
  private readonly eventKeys = new Map<string, DrawingRunEvent>();

  async create(run: DrawingRun): Promise<void> {
    this.runs.set(this.key(run.ownerId, run.runId), structuredClone(run));
  }

  async get(ownerId: string, runId: string): Promise<DrawingRun | null> {
    const run = this.runs.get(this.key(ownerId, runId));
    return run ? structuredClone(run) : null;
  }

  async getByStartIdempotency(ownerId: string, deviceId: string, idempotencyKey: string): Promise<DrawingRun | null> {
    const run = [...this.runs.values()].find((candidate) => candidate.ownerId === ownerId && candidate.deviceId === deviceId && candidate.startIdempotencyKey === idempotencyKey);
    return run ? structuredClone(run) : null;
  }

  async compareAndSet(input: {
    ownerId: string;
    runId: string;
    expectedRevision: number;
    next: DrawingRun;
  }): Promise<"updated" | "conflict"> {
    const key = this.key(input.ownerId, input.runId);
    const current = this.runs.get(key);
    if (!current || current.revision !== input.expectedRevision) return "conflict";
    this.runs.set(key, structuredClone(input.next));
    return "updated";
  }

  async appendEvent(event: DrawingRunEvent, idempotencyKey: string): Promise<DrawingRunEvent> {
    const key = `${event.runId}:${idempotencyKey}`;
    const existing = this.eventKeys.get(key);
    if (existing) {
      if (existing.requestHash && event.requestHash && existing.requestHash !== event.requestHash) throw new Error("Idempotency key was reused for a different Drawing Run command");
      return structuredClone(existing);
    }
    const stored = structuredClone(event);
    const events = this.events.get(event.runId) ?? [];
    events.push(stored);
    this.events.set(event.runId, events);
    this.eventKeys.set(key, stored);
    return structuredClone(stored);
  }

  async getEvent(_ownerId: string, runId: string, idempotencyKey: string): Promise<DrawingRunEvent | null> {
    const event = this.eventKeys.get(`${runId}:${idempotencyKey}`);
    return event ? structuredClone(event) : null;
  }

  async listEvents(ownerId: string, runId: string): Promise<DrawingRunEvent[]> {
    if (!(await this.get(ownerId, runId))) return [];
    return (this.events.get(runId) ?? []).map((event) => structuredClone(event));
  }

  private key(ownerId: string, runId: string): string {
    return `${ownerId}:${runId}`;
  }
}

export class FoundationDrawingRunStoreAdapter implements DrawingRunStore {
  constructor(private readonly foundation: FoundationStore) {}

  create(run: DrawingRun): Promise<void> {
    return this.foundation.createDrawingRun(run);
  }

  get(ownerId: string, runId: string): Promise<DrawingRun | null> {
    return this.foundation.getDrawingRun(ownerId, runId);
  }

  getByStartIdempotency(ownerId: string, deviceId: string, idempotencyKey: string): Promise<DrawingRun | null> {
    return this.foundation.getDrawingRunByStartIdempotency(ownerId, deviceId, idempotencyKey);
  }

  compareAndSet(input: {
    ownerId: string;
    runId: string;
    expectedRevision: number;
    next: DrawingRun;
  }): Promise<"updated" | "conflict"> {
    return this.foundation.compareAndSetDrawingRun(input);
  }

  appendEvent(event: DrawingRunEvent, idempotencyKey: string): Promise<DrawingRunEvent> {
    return this.foundation.appendDrawingRunEvent(event, idempotencyKey);
  }

  getEvent(ownerId: string, runId: string, idempotencyKey: string): Promise<DrawingRunEvent | null> {
    return this.foundation.getDrawingRunEvent(ownerId, runId, idempotencyKey);
  }

  listEvents(ownerId: string, runId: string): Promise<DrawingRunEvent[]> {
    return this.foundation.listDrawingRunEvents(ownerId, runId);
  }
}
