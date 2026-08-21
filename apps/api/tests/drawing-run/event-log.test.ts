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

const nextEvent: DrawingRunEvent = {
  eventId: "run-1:2",
  runId: "run-1",
  revision: 2,
  status: "analyzing",
  action: "analyzed",
  artifactHashes: ["a".repeat(64), "b".repeat(64)],
  errorCategory: "none",
  occurredAt: "2026-08-21T00:00:01.000Z",
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

  it.each([
    ["status", "C:\\private\\model.py"],
    ["action", "class SecretModel(torch.nn.Module): pass"],
    ["errorCategory", '{"providerPayload":"secret"}'],
    ["status", "unknown_status"],
    ["action", "unknown_action"],
    ["errorCategory", "unknown_error_category"],
  ] as const)("rejects a type-erased unsafe %s enum before it can be serialized", (field, value) => {
    const unsafe = { ...event, [field]: value } as DrawingRunEvent;
    const history: readonly DrawingRunEvent[] = [];

    expect(() => appendDrawingRunEvent(history, unsafe)).toThrow(/event/i);
    expect(JSON.stringify(history)).not.toContain(value);
  });

  it("rejects a coercible non-string hash without retaining the hostile object", () => {
    const coercibleHash = {
      secret: "C:\\private\\model.py",
      toString: () => "a".repeat(64),
    } as unknown as string;
    const unsafe = { ...event, artifactHashes: [coercibleHash] };

    expect(() => appendDrawingRunEvent([], unsafe)).toThrow(/event/i);
  });

  it.each([
    ["unsafe historical enum", (history: any[]) => { history[0].action = "C:\\private\\provider.txt"; }],
    ["unsafe historical hash", (history: any[]) => { history[0].artifactHashes = [{ providerPayload: "secret" }]; }],
    ["foreign run", (history: any[]) => { history[0].runId = "run-2"; }],
    ["non-canonical event id", (history: any[]) => { history[0].eventId = "event-1"; }],
  ])("validates all existing history before appending: %s", (_label, tamper) => {
    const history = [JSON.parse(JSON.stringify(event))];
    tamper(history);

    expect(() => appendDrawingRunEvent(history, nextEvent)).toThrow(/event/i);
  });

  it.each([
    ["revision gap", { ...nextEvent, revision: 3, eventId: "run-1:3" }],
    ["non-increasing timestamp", { ...nextEvent, occurredAt: event.occurredAt }],
    ["invalid status/action tuple", { ...nextEvent, status: "readback_verified", action: "received" }],
    ["invalid error tuple", { ...nextEvent, errorCategory: "provider_invalid" }],
  ] as const)("rejects a semantically inconsistent appended event: %s", (_label, malformed) => {
    expect(() => appendDrawingRunEvent([event], malformed as DrawingRunEvent)).toThrow(/event/i);
  });

  it("returns a deeply immutable reconstruction without retaining caller references", () => {
    const source = { ...event, artifactHashes: [...event.artifactHashes] };
    const history = appendDrawingRunEvent([], source);

    expect(history[0]).not.toBe(source);
    expect(history[0].artifactHashes).not.toBe(source.artifactHashes);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0])).toBe(true);
    expect(Object.isFrozen(history[0].artifactHashes)).toBe(true);
  });
});
