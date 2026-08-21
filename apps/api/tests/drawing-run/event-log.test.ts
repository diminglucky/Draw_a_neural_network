import { describe, expect, it } from "vitest";
import type { DrawingRunEvent } from "../../src/drawing-run/contracts.js";
import { appendDrawingRunEvent } from "../../src/drawing-run/event-log.js";

const event: DrawingRunEvent = {
  eventId: "run-1:1",
  runId: "run-1",
  revision: 1,
  status: "input_accepted",
  action: "received",
  artifactHashes: ["a".repeat(64)],
  errorCategory: "none",
  occurredAt: "2026-08-21T00:00:00.000Z",
};

describe("DrawingRun event log", () => {
  it("appends an allowlisted copy without mutating previous history or retaining unsafe fields", () => {
    const previous: readonly DrawingRunEvent[] = [];
    const unsafeEvent = { ...event, rawSource: "C:\\private\\model.py", providerPayload: { apiKey: "secret" } } as DrawingRunEvent;
    const next = appendDrawingRunEvent(previous, unsafeEvent);

    expect(previous).toEqual([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(event);
    expect(JSON.stringify(next)).not.toContain("C:\\private\\model.py");
    expect(JSON.stringify(next)).not.toContain("secret");
  });

  it("rejects duplicate event identities and unsafe artifact values", () => {
    const history = appendDrawingRunEvent([], event);

    expect(() => appendDrawingRunEvent(history, event)).toThrow(/event/i);
    expect(() => appendDrawingRunEvent([], { ...event, artifactHashes: ["C:\\private\\model.py"] })).toThrow(/event/i);
  });
});
