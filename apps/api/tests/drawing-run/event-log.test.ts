import { describe, expect, it } from "vitest";
import { InMemoryDrawingRunEventLog } from "../../src/drawing-run/event-log.js";

const event = {
  eventId: "run-1:1:received",
  runId: "run-1",
  revision: 1,
  status: "input_accepted" as const,
  action: "received" as const,
  artifactHashes: ["a".repeat(64)],
  errorCategory: "none" as const,
  occurredAt: "2026-08-22T00:00:00.000Z",
};

describe("Drawing Run event log", () => {
  it("replays the same idempotency key without duplicating an event", () => {
    const log = new InMemoryDrawingRunEventLog();
    expect(log.append(event, "key-1")).toEqual(event);
    expect(log.append(event, "key-1")).toEqual(event);
    expect(log.list("run-1")).toHaveLength(1);
  });

  it("rejects private filesystem paths in safe events", () => {
    const log = new InMemoryDrawingRunEventLog();
    expect(() => log.append({ ...event, artifactHashes: ["C:\\private\\model.py"] }, "key-1")).toThrow(/filesystem/i);
  });
});
