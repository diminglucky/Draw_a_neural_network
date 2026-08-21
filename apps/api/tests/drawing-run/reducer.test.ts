import { describe, expect, it } from "vitest";
import { createDrawingRun, type DrawingRunCommand } from "../../src/drawing-run/contracts.js";
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
  fields: Omit<Extract<DrawingRunCommand, { type: T }>, "type" | "ownerId" | "deviceId" | "runId" | "expectedRevision" | "idempotencyKey">,
): Extract<DrawingRunCommand, { type: T }> {
  return {
    type,
    ownerId: "owner-1",
    deviceId: "device-1",
    runId: "run-1",
    expectedRevision,
    idempotencyKey: `${type}-${expectedRevision}`,
    ...fields,
  } as Extract<DrawingRunCommand, { type: T }>;
}

function advanceToCandidate() {
  const accepted = reduceDrawingRun(createRun(), command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") })).next;
  const analyzing = reduceDrawingRun(accepted, command("begin_analysis", 1, { policyHash: hash("b") })).next;
  return reduceDrawingRun(analyzing, command("record_candidate", 2, { candidateHash: hash("c") })).next;
}

describe("DrawingRun reducer", () => {
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
    const clarification = reduceDrawingRun(candidate, command("request_clarification", 3, { clarificationHash: hash("d") })).next;
    const staleAnswer = command("answer_clarification", clarification.revision - 1, {
      clarificationId: clarification.clarification!.id,
      answerHash: hash("e"),
    });

    expect(() => reduceDrawingRun(clarification, staleAnswer)).toThrow(/revision/i);
  });

  it("advances legal transitions once and replays an accepted idempotency key without another revision", () => {
    const initial = createRun();
    const accept = command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const first = reduceDrawingRun(initial, accept);
    const replay = reduceDrawingRun(first.next, accept);
    const analysis = reduceDrawingRun(first.next, command("begin_analysis", 1, { policyHash: hash("b") }));

    expect(first.next).toMatchObject({ status: "input_accepted", revision: 1 });
    expect(first.event).toMatchObject({ revision: 1, status: "input_accepted", action: "received" });
    expect(replay).toMatchObject({ next: first.next, event: first.event, replayed: true });
    expect(analysis.next).toMatchObject({ status: "analyzing", revision: 2 });
  });

  it("cancels a non-terminal run and permits only an idempotent cancellation replay afterwards", () => {
    const state = createRun();
    const cancel = command("cancel", 0, { reasonCategory: "user" });
    const cancelled = reduceDrawingRun(state, cancel);

    expect(cancelled.next).toMatchObject({ status: "cancelled", revision: 1 });
    expect(cancelled.event).toMatchObject({ action: "failed", errorCategory: "cancelled" });
    expect(reduceDrawingRun(cancelled.next, cancel)).toMatchObject({ replayed: true, next: cancelled.next });
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
});
