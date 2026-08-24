import { describe, expect, it } from "vitest";
import {
  createDrawingRun,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunTrustedScope,
} from "../../src/drawing-run/contracts.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { reconstructDrawingRunState, reduceDrawingRun } from "../../src/drawing-run/reducer.js";

const hash = (value: string) => value.repeat(64).slice(0, 64);
const intent = {
  action: "create_figure",
  requestedDetail: "architecture",
  target: "browser_preview",
  sourceKinds: ["architecture_description"],
} as const;
const trustedScope: DrawingRunTrustedScope = { runId: "run-1", ownerId: "owner-1", deviceId: "device-1" };

function createRun(): DrawingRun {
  return createDrawingRun({
    ...trustedScope,
    intent,
    now: "2026-08-21T00:00:00.000Z",
    startIdempotencyKey: "start-1",
    startRequestHash: hash("0"),
  });
}

function command<T extends DrawingRunCommand["type"]>(
  type: T,
  state: DrawingRun,
  fields: Omit<Extract<DrawingRunCommand, { type: T }>, "type" | "ownerId" | "deviceId" | "runId" | "expectedRevision" | "idempotencyKey" | "occurredAt" | "now">,
): Extract<DrawingRunCommand, { type: T }> {
  return {
    type,
    ownerId: state.ownerId,
    deviceId: state.deviceId,
    runId: state.runId,
    expectedRevision: state.revision,
    idempotencyKey: `${type}-${state.revision}`,
    occurredAt: `2026-08-21T00:00:${String(state.revision + 1).padStart(2, "0")}.000Z`,
    ...fields,
  } as Extract<DrawingRunCommand, { type: T }>;
}

function advance<T extends DrawingRunCommand["type"]>(
  state: DrawingRun,
  type: T,
  fields: Parameters<typeof command<T>>[2],
  scope?: DrawingRunTrustedScope,
): DrawingRun {
  return reduceDrawingRun(state, command(type, state, fields), scope).next;
}

function advanceToCandidate(): DrawingRun {
  let state = advance(createRun(), "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") });
  state = advance(state, "begin_analysis", { policyHash: hash("b") });
  return advance(state, "record_candidate", { candidateHash: hash("c") });
}

describe("Drawing Run reducer integration", () => {
  it.each([
    [{ ...intent, action: "provider_native_action" }, "action"],
    [{ ...intent, requestedDetail: "raw_source" }, "detail"],
    [{ ...intent, target: "C:\\private\\drawing.vsdx" }, "target"],
    [{ ...intent, sourceKinds: "pytorch_source" }, "source array"],
    [{ ...intent, sourceKinds: ["pytorch_source", "pytorch_source"] }, "duplicate source"],
    [{ ...intent, sourceKinds: ["provider_payload"] }, "unknown source"],
  ])("rejects a type-erased malformed DrawingIntent (%s)", (malformedIntent, _label) => {
    expect(() => createDrawingRun({
      ...trustedScope,
      intent: malformedIntent as never,
      now: "2026-08-21T00:00:00.000Z",
    })).toThrow(DrawingRunError);
  });

  it("keeps the remote canonical transition API and revision fence", () => {
    const initial = createRun();
    expect(() => reduceDrawingRun(initial, command("compose_pvp", initial, { ugsHash: hash("a") }))).toThrow(/transition/i);

    const accepted = advance(initial, "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    expect(accepted).toMatchObject({ status: "input_accepted", revision: 1, privateReceiptIds: ["receipt-1"] });

    const stale = { ...command("begin_analysis", accepted, { policyHash: hash("b") }), expectedRevision: 0 };
    expect(() => reduceDrawingRun(accepted, stale)).toThrow(/revision/i);
  });

  it("rejects foreign commands and persisted identity rebinding against an external trusted scope", () => {
    const initial = createRun();
    const foreign = { ...command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), deviceId: "device-2" };
    expect(() => reduceDrawingRun(initial, foreign, trustedScope)).toThrow(/device/i);

    const accepted = advance(initial, "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") }, trustedScope);
    const rebound = JSON.parse(JSON.stringify(accepted));
    rebound.ownerId = "owner-2";
    rebound.deviceId = "device-2";
    expect(() => reduceDrawingRun(rebound, command("begin_analysis", accepted, { policyHash: hash("b") }), trustedScope)).toThrow(/owner|device/i);
  });

  it("supports remote two-argument callers while preserving safe reconstruction", () => {
    const initial = createRun();
    const transition = reduceDrawingRun(initial, command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }));
    expect(transition.next).toMatchObject({ status: "input_accepted", revision: 1 });
    expect(transition.event).toMatchObject({ status: "input_accepted", action: "received", errorCategory: "none" });
  });

  it("rejects a stale clarification answer", () => {
    let state = advanceToCandidate();
    state = advance(state, "request_clarification", { clarificationHash: hash("d") });
    const stale = {
      ...command("answer_clarification", state, { clarificationId: state.clarification!.id, answerHash: hash("e") }),
      expectedRevision: state.revision - 1,
    };
    expect(() => reduceDrawingRun(state, stale)).toThrow(/revision/i);
  });

  it("supports a formal preview path without native authority", () => {
    let state = advanceToCandidate();
    state = advance(state, "formalize_ugs", { ugsHash: hash("d") });
    state = advance(state, "compose_pvp", { ugsHash: hash("d") });
    state = advance(state, "publish_preview", { pvpHash: hash("e"), qaHash: hash("f") });
    expect(state).toMatchObject({ status: "preview_ready", preview: { hash: hash("e") }, formalUgsHash: hash("d") });
  });

  it("fails closed for unknown commands and error categories without reflecting private text", () => {
    const initial = createRun();
    const unknown = {
      ...command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }),
      type: "provider_native_command",
      providerPayload: "C:\\private\\model.py",
    } as unknown as DrawingRunCommand;
    expect(() => reduceDrawingRun(initial, unknown)).toThrow(DrawingRunError);

    for (const [type, errorCategory] of [
      ["reject", "C:\\private\\model.py"],
      ["fail", "class SecretModel(torch.nn.Module): pass"],
      ["reject", "{\"providerPayload\":\"secret\"}"],
      ["fail", "unknown_provider_category"],
    ] as const) {
      expect(() => reduceDrawingRun(initial, command(type, initial, { errorCategory: errorCategory as never }))).toThrow(DrawingRunError);
    }
  });

  it("uses a validated forward timestamp and derives one for remote commands that omit it", () => {
    const initial = createRun();
    const accepted = reduceDrawingRun(initial, command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }));
    expect(accepted.next.updatedAt).toBe("2026-08-21T00:00:01.000Z");
    expect(accepted.event.occurredAt).toBe(accepted.next.updatedAt);

    const staleTime = { ...command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), occurredAt: initial.updatedAt };
    expect(() => reduceDrawingRun(initial, staleTime)).toThrow(DrawingRunError);

    const noTime = {
      type: "accept_input",
      ownerId: initial.ownerId,
      deviceId: initial.deviceId,
      runId: initial.runId,
      expectedRevision: 0,
      idempotencyKey: "remote-no-time",
      receiptIds: ["receipt-1"],
      artifactHash: hash("a"),
    } as DrawingRunCommand;
    expect(reduceDrawingRun(initial, noTime).event.occurredAt).toBe("2026-08-21T00:00:00.001Z");
  });

  it("rejects coercible hashes and snapshot-reads accessor command fields once", () => {
    const initial = createRun();
    const coercibleHash = { secret: "C:\\private\\model.py", toString: () => hash("a") } as unknown as string;
    expect(() => reduceDrawingRun(initial, command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: coercibleHash }))).toThrow(DrawingRunError);

    let reads = 0;
    const accessor = command("accept_input", initial, { receiptIds: ["receipt-1"], artifactHash: hash("a") }) as DrawingRunCommand & Record<string, unknown>;
    Object.defineProperty(accessor, "artifactHash", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? hash("a") : { secret: "C:\\private\\model.py" };
      },
    });
    const result = reduceDrawingRun(initial, accessor);
    expect(reads).toBe(1);
    expect(result.next.artifactHashes).toEqual([hash("a")]);
    expect(JSON.stringify(result)).not.toContain("C:\\private\\model.py");
  });

  it("validates cancellation reasons and minted run identifiers", () => {
    const initial = createRun();
    expect(() => reduceDrawingRun(initial, command("cancel", initial, { reasonCategory: "C:\\private\\reason.txt" as never }))).toThrow(DrawingRunError);
    expect(() => createDrawingRun({ ...trustedScope, runId: "C:private", intent, now: initial.createdAt })).toThrow(DrawingRunError);
  });

  it.each([
    ["receipt evidence", (state: any) => { state.privateReceiptIds = []; }],
    ["input artifact", (state: any) => { state.artifactHashes = []; }],
  ])("rejects a persisted accepted-input state missing its %s", (_label, tamper) => {
    const accepted = advance(createRun(), "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    const persisted = JSON.parse(JSON.stringify(accepted));
    tamper(persisted);
    expect(() => reduceDrawingRun(persisted, command("begin_analysis", accepted, { policyHash: hash("b") }), trustedScope)).toThrow(DrawingRunError);
  });

  it("binds composition to the exact formalized UGS and reconstructs the role after persistence", () => {
    const candidate = advanceToCandidate();
    const formal = advance(candidate, "formalize_ugs", { ugsHash: hash("d") });
    expect(formal.formalUgsHash).toBe(hash("d"));
    expect(() => reduceDrawingRun(formal, command("compose_pvp", formal, { ugsHash: hash("e") }))).toThrow(DrawingRunError);

    const persisted = JSON.parse(JSON.stringify(formal));
    delete persisted.formalUgsHash;
    const restored = reconstructDrawingRunState(persisted, trustedScope);
    expect(restored.formalUgsHash).toBe(hash("d"));
    expect(reduceDrawingRun(restored, command("compose_pvp", restored, { ugsHash: hash("d") })).next.status).toBe("composing_pvp");
  });

  it("rejects the declared but unreachable apply-confirmation state", () => {
    const impossible = { ...createRun(), status: "awaiting_apply_confirmation", revision: 1 } as DrawingRun;
    expect(() => reconstructDrawingRunState(impossible, trustedScope)).toThrow(DrawingRunError);
  });

  it("permits a terminal control transition after preview without changing the verified preview", () => {
    let state = advanceToCandidate();
    state = advance(state, "formalize_ugs", { ugsHash: hash("d") });
    state = advance(state, "compose_pvp", { ugsHash: hash("d") });
    state = advance(state, "publish_preview", { pvpHash: hash("e"), qaHash: hash("f") });

    const cancelled = reduceDrawingRun(state, command("cancel", state, { reasonCategory: "user" }), trustedScope);

    expect(cancelled.next).toMatchObject({
      status: "cancelled",
      errorCategory: "cancelled",
      preview: { hash: hash("e") },
    });
    expect(cancelled.event.artifactHashes).toEqual(state.artifactHashes);
  });
});
