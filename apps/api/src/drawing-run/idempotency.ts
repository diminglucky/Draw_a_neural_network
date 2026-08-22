import { DrawingRunError } from "./errors.js";

export class DrawingRunIdempotency {
  private readonly results = new Map<string, { requestHash: string; revision: number }>();

  read(ownerId: string, deviceId: string, runId: string, key: string, requestHash: string): number | null {
    const stored = this.results.get(this.index(ownerId, deviceId, runId, key));
    if (!stored) return null;
    if (stored.requestHash !== requestHash) {
      throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different command");
    }
    return stored.revision;
  }

  record(ownerId: string, deviceId: string, runId: string, key: string, requestHash: string, revision: number): void {
    this.results.set(this.index(ownerId, deviceId, runId, key), { requestHash, revision });
  }

  private index(ownerId: string, deviceId: string, runId: string, key: string): string {
    return `${ownerId}:${deviceId}:${runId}:${key}`;
  }
}
