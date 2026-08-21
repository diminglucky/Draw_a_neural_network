import { describe, expect, it } from "vitest";
import { createDrawingRun, type DrawingRunCommand, type DrawingRunTransition } from "../../src/drawing-run/contracts.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { reduceDrawingRun } from "../../src/drawing-run/reducer.js";

const hash = (value: string) => value.repeat(64).slice(0, 64);
const intent = {
  action: "create_figure",
  requestedDetail: "architecture",
  target: "browser_preview",
  sourceKinds: ["architecture_description"],
} as const;

function createRun() {
  return createDrawingRun({
    runId: "run-1",
    ownerId: "owner-1",
    deviceId: "device-1",
    intent,
    now: "2026-08-21T00:00:00.000Z",
  });
}

function command<T extends DrawingRunCommand["type"]>(
  type: T,
  expectedRevision: number,
  fields: Omit<Extract<DrawingRunCommand, { type: T }>, "type" | "ownerId" | "deviceId" | "runId" | "expectedRevision" | "idempotencyKey" | "occurredAt">,
  occurredAt = `2026-08-21T00:00:${String(expectedRevision + 1).padStart(2, "0")}.000Z`,
): Extract<DrawingRunCommand, { type: T }> {
  return {
    type,
    ownerId: "owner-1",
    deviceId: "device-1",
    runId: "run-1",
    expectedRevision,
    idempotencyKey: `${type}-${expectedRevision}`,
    occurredAt,
    ...fields,
  } as Extract<DrawingRunCommand, { type: T }>;
}

function acceptedTransition(transition: DrawingRunTransition): Extract<DrawingRunTransition, { kind: "accepted" }> {
  if (transition.kind !== "accepted") throw new Error("expected an accepted DrawingRun transition");
  return transition;
}

function replayedTransition(transition: DrawingRunTransition): Extract<DrawingRunTransition, { kind: "replayed" }> {
  if (transition.kind !== "replayed") throw new Error("expected a replayed DrawingRun transition");
  return transition;
}

function advanceToCandidate() {
  const accepted = acceptedTransition(
    reduceDrawingRun(createRun(), command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") })),
  ).next;
  const analyzing = acceptedTransition(
    reduceDrawingRun(accepted, command("begin_analysis", 1, { policyHash: hash("b") })),
  ).next;
  return acceptedTransition(
    reduceDrawingRun(analyzing, command("record_candidate", 2, { candidateHash: hash("c") })),
  ).next;
}

describe("DrawingRun reducer", () => {
  it.each([
    [{ ...intent, action: "provider_native_action" }, "action"],
    [{ ...intent, requestedDetail: "raw_source" }, "requested detail"],
    [{ ...intent, target: "C:\\private\\drawing.vsdx" }, "target"],
    [{ ...intent, sourceKinds: "pytorch_source" }, "source kind array"],
    [{ ...intent, sourceKinds: ["pytorch_source", "pytorch_source"] }, "duplicate source kinds"],
    [{ ...intent, sourceKinds: ["provider_payload"] }, "unknown source kind"],
  ])("rejects a type-erased malformed DrawingIntent before creating state (%s)", (malformedIntent, _label) => {
    expect(() => createDrawingRun({
      runId: "run-1",
      ownerId: "owner-1",
      deviceId: "device-1",
      intent: malformedIntent as never,
      now: "2026-08-21T00:00:00.000Z",
    })).toThrow(DrawingRunError);
  });

  it("rejects composition before a formal UGS without changing state", () => {
    const state = createRun();

    expect(() => reduceDrawingRun(state, command("compose_pvp", 0, { ugsHash: hash("a") }))).toThrow(/transition/i);
    expect(state).toMatchObject({ status: "received", revision: 0 });
  });

  it("rejects a command from a foreign device", () => {
    const state = createRun();
    const foreign = { ...command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), deviceId: "device-2" };

    expect(() => reduceDrawingRun(state, foreign)).toThrow(DrawingRunError);
    expect(() => reduceDrawingRun(state, foreign)).toThrow(/device/i);
  });

  it("rejects a stale clarification answer", () => {
    const candidate = advanceToCandidate();
    const clarification = acceptedTransition(
      reduceDrawingRun(candidate, command("request_clarification", 3, { clarificationHash: hash("d") })),
    ).next;
    const staleAnswer = command("answer_clarification", clarification.revision - 1, {
      clarificationId: clarification.clarification!.id,
      answerHash: hash("e"),
    });

    expect(() => reduceDrawingRun(clarification, staleAnswer)).toThrow(/revision/i);
  });

  it("advances legal transitions once and replays an accepted idempotency key without another revision", () => {
    const initial = createRun();
    const accept = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const first = acceptedTransition(reduceDrawingRun(initial, accept));
    const replay = replayedTransition(reduceDrawingRun(first.next, accept));
    const analysis = acceptedTransition(reduceDrawingRun(first.next, command("begin_analysis", 1, { policyHash: hash("b") })));

    expect(first.next).toMatchObject({ status: "input_accepted", revision: 1 });
    expect(first.event).toMatchObject({ revision: 1, status: "input_accepted", action: "received" });
    expect(replay).toMatchObject({
      kind: "replayed",
      current: first.next,
      original: { event: first.event, snapshot: { runId: "run-1", revision: 1, status: "input_accepted" } },
    });
    expect(analysis.next).toMatchObject({ status: "analyzing", revision: 2 });
  });

  it("cancels a non-terminal run and permits only an idempotent cancellation replay afterwards", () => {
    const state = createRun();
    const cancel = command("cancel", 0, { reasonCategory: "user" });
    const cancelled = acceptedTransition(reduceDrawingRun(state, cancel));

    expect(cancelled.next).toMatchObject({ status: "cancelled", revision: 1 });
    expect(cancelled.event).toMatchObject({ action: "failed", errorCategory: "cancelled" });
    expect(replayedTransition(reduceDrawingRun(cancelled.next, cancel))).toMatchObject({ kind: "replayed", current: cancelled.next });
    expect(() => reduceDrawingRun(cancelled.next, command("accept_input", 1, { receiptIds: ["receipt-2"], artifactHash: hash("b") }))).toThrow(/transition/i);
  });

  it("fails closed with a safe validation category for a type-erased unknown command", () => {
    const malformed = {
      ...command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }),
      type: "provider_native_command",
      providerPayload: "C:\\private\\model.py",
    } as unknown as DrawingRunCommand;

    try {
      reduceDrawingRun(createRun(), malformed);
      throw new Error("expected reducer to reject the unknown command");
    } catch (error) {
      expect(error).toBeInstanceOf(DrawingRunError);
      expect(error).toMatchObject({ category: "validation" });
      expect(String(error)).not.toContain("C:\\private\\model.py");
    }
  });

  it.each([
    ["reject", "C:\\private\\model.py"],
    ["fail", "class SecretModel(torch.nn.Module): pass"],
    ["reject", '{"providerPayload":"secret"}'],
    ["fail", "unknown_provider_category"],
  ] as const)("rejects a type-erased %s error category without returning an unsafe event", (type, errorCategory) => {
    const malformed = command(type, 0, { errorCategory: errorCategory as never }) as unknown as DrawingRunCommand;

    expect(() => reduceDrawingRun(createRun(), malformed)).toThrow(DrawingRunError);
  });

  it("returns an immutable original response rather than pairing a historical event with later state", () => {
    const accept = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const first = acceptedTransition(reduceDrawingRun(createRun(), accept));
    const later = acceptedTransition(reduceDrawingRun(first.next, command("begin_analysis", 1, { policyHash: hash("b") })));
    const replay = replayedTransition(reduceDrawingRun(later.next, accept));

    expect(replay).toEqual({
      kind: "replayed",
      current: later.next,
      original: {
        event: first.event,
        snapshot: { runId: "run-1", revision: 1, status: "input_accepted" },
      },
    });
    expect("next" in replay).toBe(false);
    expect(replay.current).toMatchObject({ status: "analyzing", revision: 2 });
    expect(replay.original.snapshot).toMatchObject({ status: "input_accepted", revision: 1 });
  });

  it("advances the state and event timestamps from a validated command time", () => {
    const occurredAt = "2026-08-21T00:00:05.000Z";
    const accepted = acceptedTransition(reduceDrawingRun(createRun(), command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }, occurredAt)));

    expect(accepted.next.updatedAt).toBe(occurredAt);
    expect(accepted.event.occurredAt).toBe(occurredAt);
    expect(() => reduceDrawingRun(createRun(), command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }, "2026-08-21T00:00:00.000Z"))).toThrow(DrawingRunError);
    expect(() => reduceDrawingRun(createRun(), command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }, "not-a-timestamp"))).toThrow(DrawingRunError);
  });

  it("rejects coercible non-string hashes before they can enter state or events", () => {
    const initial = createRun();
    const coercibleHash = {
      secret: "C:\\private\\model.py",
      toString: () => hash("a"),
    } as unknown as string;
    const malformed = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: coercibleHash });

    expect(() => reduceDrawingRun(initial, malformed)).toThrow(DrawingRunError);
    expect(initial.artifactHashes).toEqual([]);
    expect(JSON.stringify(initial)).not.toContain("C:\\private\\model.py");
  });

  it("rejects an invalid type-erased cancellation reason before advancing state", () => {
    const initial = createRun();
    const malformed = command("cancel", 0, { reasonCategory: "C:\\private\\reason.txt" as never });

    expect(() => reduceDrawingRun(initial, malformed)).toThrow(DrawingRunError);
    expect(initial).toMatchObject({ status: "received", revision: 0 });
  });

  it("rejects a persisted state with a non-minted run identity at the reducer boundary", () => {
    const hostile = { ...createRun(), runId: "C:private" };
    const malformed = { ...command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), runId: "C:private" };

    expect(() => reduceDrawingRun(hostile, malformed)).toThrow(DrawingRunError);
  });

  it.each([
    ["historical action", (state: any) => { state.idempotencyRecords[0].response.event.action = "C:\\private\\provider.txt"; }],
    ["historical hash", (state: any) => { state.idempotencyRecords[0].response.event.artifactHashes = [{ secret: "class SecretModel" }]; }],
    ["historical event id", (state: any) => { state.idempotencyRecords[0].response.event.eventId = "C:\\private\\event.txt"; }],
    ["historical snapshot", (state: any) => { state.idempotencyRecords[0].response.snapshot.status = "failed"; }],
    ["historical fingerprint", (state: any) => { state.idempotencyRecords[0].fingerprint = { providerPayload: "secret" }; }],
  ])("fails closed when JSON-restored replay data has a malformed %s", (_label, tamper) => {
    const accept = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const accepted = acceptedTransition(reduceDrawingRun(createRun(), accept));
    const persisted = JSON.parse(JSON.stringify(accepted.next));
    tamper(persisted);

    expect(() => reduceDrawingRun(persisted, accept)).toThrow(DrawingRunError);
  });

  it("validates and deep-freezes a safely reconstructed replay response after JSON restoration", () => {
    const accept = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const accepted = acceptedTransition(reduceDrawingRun(createRun(), accept));
    const persisted = JSON.parse(JSON.stringify(accepted.next));
    const replay = replayedTransition(reduceDrawingRun(persisted, accept));

    expect(replay.original).toEqual(accepted.next.idempotencyRecords[0].response);
    expect(replay.original).not.toBe(persisted.idempotencyRecords[0].response);
    expect(Object.isFrozen(replay.original)).toBe(true);
    expect(Object.isFrozen(replay.original.event)).toBe(true);
    expect(Object.isFrozen(replay.original.event.artifactHashes)).toBe(true);
    expect(Object.isFrozen(replay.original.snapshot)).toBe(true);
  });
});
