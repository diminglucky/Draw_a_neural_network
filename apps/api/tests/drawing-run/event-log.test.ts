import { describe, expect, it } from "vitest";
import type { DrawingRunEvent } from "../../src/drawing-run/contracts.js";
import { appendDrawingRunEvent, InMemoryDrawingRunEventLog } from "../../src/drawing-run/event-log.js";

const event: DrawingRunEvent = {
  eventId: "run-1:1:accept_input",
  runId: "run-1",
  revision: 1,
  status: "input_accepted",
  action: "received",
  artifactHashes: ["a".repeat(64)],
  errorCategory: "none",
  occurredAt: "2026-08-21T00:00:01.000Z",
};

const nextEvent: DrawingRunEvent = {
  eventId: "run-1:2:begin_analysis",
  runId: "run-1",
  revision: 2,
  status: "analyzing",
  action: "analyzed",
  artifactHashes: ["a".repeat(64), "b".repeat(64)],
  errorCategory: "none",
  occurredAt: "2026-08-21T00:00:02.000Z",
};

describe("Drawing Run event log integration", () => {
  it("retains the remote idempotent log API without duplicating events", () => {
    const log = new InMemoryDrawingRunEventLog();
    expect(log.append(event, "key-1")).toEqual(event);
    expect(log.append(event, "key-1")).toEqual(event);
    expect(log.list("run-1")).toEqual([event]);
  });

  it("rejects filesystem paths and conflicting reuse of an idempotency key", () => {
    const log = new InMemoryDrawingRunEventLog();
    expect(() => log.append({ ...event, artifactHashes: ["C:\\private\\model.py"] }, "key-1")).toThrow(/filesystem/i);
    log.append(event, "key-1");
    expect(() => log.append({ ...event, occurredAt: "2026-08-21T00:00:02.000Z" }, "key-1")).toThrow(/idempotency/i);
  });

  it("appends an allowlisted copy without retaining private fields", () => {
    const unsafe = { ...event, rawSource: "C:\\private\\model.py", providerPayload: { apiKey: "secret" } } as DrawingRunEvent;
    const history = appendDrawingRunEvent([], unsafe);
    expect(history).toEqual([event]);
    expect(JSON.stringify(history)).not.toContain("C:\\private\\model.py");
    expect(JSON.stringify(history)).not.toContain("secret");
  });

  it.each([
    ["status", "C:\\private\\model.py"],
    ["action", "class SecretModel(torch.nn.Module): pass"],
    ["errorCategory", "{\"providerPayload\":\"secret\"}"],
    ["status", "unknown_status"],
    ["action", "unknown_action"],
    ["errorCategory", "unknown_error_category"],
  ] as const)("rejects an unsafe %s enum before serialization", (field, value) => {
    expect(() => appendDrawingRunEvent([], { ...event, [field]: value } as DrawingRunEvent)).toThrow(/event/i);
  });

  it("rejects coercible non-string hashes", () => {
    const hostile = { secret: "C:\\private\\model.py", toString: () => "a".repeat(64) } as unknown as string;
    expect(() => appendDrawingRunEvent([], { ...event, artifactHashes: [hostile] })).toThrow(/event/i);
  });

  it.each([
    ["unsafe historical enum", (history: any[]) => { history[0].action = "C:\\private\\provider.txt"; }],
    ["unsafe historical hash", (history: any[]) => { history[0].artifactHashes = [{ providerPayload: "secret" }]; }],
    ["foreign run", (history: any[]) => { history[0].runId = "run-2"; }],
    ["non-canonical event id", (history: any[]) => { history[0].eventId = "event-1"; }],
  ])("validates existing history before appending: %s", (_label, tamper) => {
    const history = [JSON.parse(JSON.stringify(event))];
    tamper(history);
    expect(() => appendDrawingRunEvent(history, nextEvent)).toThrow(/event/i);
  });

  it.each([
    ["revision gap", { ...nextEvent, revision: 3, eventId: "run-1:3:begin_analysis" }],
    ["non-increasing timestamp", { ...nextEvent, occurredAt: event.occurredAt }],
    ["invalid status/action tuple", { ...nextEvent, status: "readback_verified", action: "received" }],
    ["invalid error tuple", { ...nextEvent, errorCategory: "provider_invalid" }],
  ] as const)("rejects an inconsistent event: %s", (_label, malformed) => {
    expect(() => appendDrawingRunEvent([event], malformed as DrawingRunEvent)).toThrow(/event/i);
  });

  it("returns an immutable reconstruction and snapshot-reads accessors once", () => {
    let reads = 0;
    const accessor = { ...event } as DrawingRunEvent;
    Object.defineProperty(accessor, "artifactHashes", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? ["a".repeat(64)] : [{ secret: "C:\\private\\model.py" }];
      },
    });
    const history = appendDrawingRunEvent([], accessor);
    expect(reads).toBe(1);
    expect(history[0]).not.toBe(accessor);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0])).toBe(true);
    expect(Object.isFrozen(history[0].artifactHashes)).toBe(true);
    expect(JSON.stringify(history)).not.toContain("C:\\private\\model.py");
  });

  it("copies artifact array elements once before validating and serializing them", () => {
    let reads = 0;
    const artifactHashes: string[] = [];
    Object.defineProperty(artifactHashes, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? "a".repeat(64) : "C:\\private\\model.py";
      },
    });
    artifactHashes.length = 1;

    const history = appendDrawingRunEvent([], { ...event, artifactHashes });

    expect(reads).toBe(1);
    expect(history[0].artifactHashes).toEqual(["a".repeat(64)]);
    expect(JSON.stringify(history)).not.toContain("C:\\private\\model.py");
  });

  it.each([
    ["accepted input without an artifact", { ...event, artifactHashes: [] }],
    ["cancelled with a new artifact", { ...event, status: "cancelled", action: "failed", errorCategory: "cancelled" }],
    ["failed with cancelled category", { ...event, status: "failed", action: "failed", errorCategory: "cancelled", artifactHashes: [] }],
    ["rejected with conflict category", { ...event, status: "rejected", action: "failed", errorCategory: "conflict", artifactHashes: [] }],
    ["conflicted without one artifact", { ...event, status: "conflicted", action: "failed", errorCategory: "conflict", artifactHashes: [] }],
  ] as const)("rejects an invalid terminal or artifact tuple: %s", (_label, malformed) => {
    expect(() => appendDrawingRunEvent([], malformed as DrawingRunEvent)).toThrow(/event/i);
  });

  it("accepts conflict only with one conflict artifact and validates request hashes", () => {
    const conflicted = { ...event, status: "conflicted", action: "failed", errorCategory: "conflict" } as const;
    expect(appendDrawingRunEvent([], conflicted)).toEqual([conflicted]);
    expect(() => appendDrawingRunEvent([], { ...event, requestHash: "C:\\private\\request.txt" })).toThrow(/event/i);
  });
});
