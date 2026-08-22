import { describe, expect, it } from "vitest";
import { createDrawingRun, type DrawingRunCommand } from "../../src/drawing-run/contracts.js";
import { reduceDrawingRun } from "../../src/drawing-run/reducer.js";

const base = createDrawingRun({
  runId: "run-1",
  ownerId: "owner-1",
  deviceId: "device-1",
  intent: { action: "create_figure", requestedDetail: "overview", target: "browser_preview", sourceKinds: ["typed_text"] },
  now: "2026-08-22T00:00:00.000Z",
});

function command(type: DrawingRunCommand["type"], state = base, extra: Record<string, unknown> = {}): DrawingRunCommand {
  const defaults: Record<string, unknown> = {
    type,
    ownerId: state.ownerId,
    deviceId: state.deviceId,
    runId: state.runId,
    expectedRevision: state.revision,
    idempotencyKey: `${type}-${state.revision}`,
    ...extra,
  };
  return defaults as unknown as DrawingRunCommand;
}

function advance(state: typeof base, next: DrawingRunCommand["type"], extra: Record<string, unknown> = {}) {
  return reduceDrawingRun(state, command(next, state, extra)).next;
}

describe("Drawing Run reducer", () => {
  it("enforces the canonical state order and revision fencing", () => {
    expect(() => reduceDrawingRun(base, command("compose_pvp", base, { ugsHash: "a".repeat(64) }))).toThrow(/transition/i);
    const accepted = advance(base, "accept_input", { receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });
    expect(accepted).toMatchObject({ status: "input_accepted", revision: 1, privateReceiptIds: ["receipt-1"] });
    expect(() => reduceDrawingRun(accepted, command("begin_analysis", accepted, { expectedRevision: 0, policyHash: "b".repeat(64) }))).toThrow(/revision/i);
  });

  it("rejects foreign devices and stale clarification answers", () => {
    expect(() => reduceDrawingRun(base, { ...command("accept_input"), deviceId: "foreign-device", receiptIds: [], artifactHash: "a".repeat(64) } as unknown as DrawingRunCommand)).toThrow(/device/i);
    let state = advance(base, "accept_input", { receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });
    state = advance(state, "begin_analysis", { policyHash: "b".repeat(64) });
    state = advance(state, "record_candidate", { candidateHash: "c".repeat(64) });
    state = advance(state, "request_clarification", { clarificationHash: "d".repeat(64) });
    expect(() => reduceDrawingRun(state, command("answer_clarification", state, { clarificationId: "clarification:stale", answerHash: "e".repeat(64) }))).toThrow(/clarification/i);
  });

  it("supports a formal preview path without granting native authority", () => {
    let state = advance(base, "accept_input", { receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });
    state = advance(state, "begin_analysis", { policyHash: "b".repeat(64) });
    state = advance(state, "record_candidate", { candidateHash: "c".repeat(64) });
    state = advance(state, "formalize_ugs", { ugsHash: "d".repeat(64) });
    state = advance(state, "compose_pvp", { ugsHash: "d".repeat(64) });
    state = advance(state, "publish_preview", { pvpHash: "e".repeat(64), qaHash: "f".repeat(64) });
    expect(state).toMatchObject({ status: "preview_ready", preview: { hash: "e".repeat(64) } });
  });
});
