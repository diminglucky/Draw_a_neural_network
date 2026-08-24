import { describe, expect, it } from "vitest";
import {
  createDrawingRun,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunEvent,
  type DrawingRunTrustedScope,
} from "../../src/drawing-run/contracts.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { projectPublicDrawingRun, projectPublicDrawingRunEvent } from "../../src/drawing-run/public-projection.js";
import { reduceDrawingRun } from "../../src/drawing-run/reducer.js";

const scope: DrawingRunTrustedScope = { runId: "run-1", ownerId: "owner-1", deviceId: "device-1" };
const hash = (value: string) => value.repeat(64).slice(0, 64);

function createRun(): DrawingRun {
  return createDrawingRun({
    ...scope,
    intent: { action: "create_figure", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["architecture_description"] },
    now: "2026-08-21T00:00:00.000Z",
  });
}

function command<T extends DrawingRunCommand["type"]>(
  type: T,
  state: DrawingRun,
  fields: Omit<Extract<DrawingRunCommand, { type: T }>, "type" | "ownerId" | "deviceId" | "runId" | "expectedRevision" | "idempotencyKey" | "occurredAt" | "now">,
): Extract<DrawingRunCommand, { type: T }> {
  return {
    type,
    ...scope,
    expectedRevision: state.revision,
    idempotencyKey: `${type}-${state.revision}`,
    occurredAt: `2026-08-21T00:00:${String(state.revision + 1).padStart(2, "0")}.000Z`,
    ...fields,
  } as Extract<DrawingRunCommand, { type: T }>;
}

function advance<T extends DrawingRunCommand["type"]>(state: DrawingRun, type: T, fields: Parameters<typeof command<T>>[2]): DrawingRun {
  return reduceDrawingRun(state, command(type, state, fields), scope).next;
}

describe("public Drawing Run projection integration", () => {
  it("rejects path-like run IDs at creation and projection", () => {
    const base = createRun();
    for (const runId of ["C:\\private\\model.py", "C:private", "\\\\server\\share", "../run-1", "..", "run/one"]) {
      expect(() => createDrawingRun({ ...base, runId, now: base.createdAt })).toThrow(DrawingRunError);
      expect(() => projectPublicDrawingRun({ ...base, runId }, scope)).toThrow(DrawingRunError);
    }
  });

  it("enforces an explicit trusted scope but remains compatible with one-argument and map callers", () => {
    const run = createRun();
    expect(projectPublicDrawingRun(run)).toMatchObject({ runId: "run-1", status: "received" });
    expect([run].map(projectPublicDrawingRun)).toHaveLength(1);
    expect(() => projectPublicDrawingRun({ ...run, ownerId: "owner-2" }, scope)).toThrow(/owner/i);
  });

  it("rejects the unreachable apply-confirmation state", () => {
    expect(() => projectPublicDrawingRun({ ...createRun(), status: "awaiting_apply_confirmation", revision: 1 }, scope)).toThrow(DrawingRunError);
  });

  it("reconstructs only allowlisted public fields", () => {
    const hostile = {
      ...createRun(),
      privateReceipts: [{ receiptId: "receipt-1", path: "C:\\private\\model.py", content: "class SecretModel" }],
      rawSource: "class SecretModel",
      providerPayload: { apiKey: "secret" },
      providerContext: { contextId: "context-1" },
      nativeData: { pagePath: "C:\\private\\drawing.vsdx" },
    } as DrawingRun & Record<string, unknown>;
    const projected = projectPublicDrawingRun(hostile, scope);
    expect(projected).toEqual({
      runId: "run-1",
      revision: 0,
      status: "received",
      errorCategory: "none",
      allowedActions: ["accept_input", "cancel"],
      clarification: null,
      preview: null,
    });
    expect(JSON.stringify(projected)).not.toMatch(/receipt-1|SecretModel|apiKey|context-1|drawing\.vsdx/);
  });

  it("projects clarification and preview only from valid reducer states", () => {
    let state = advance(createRun(), "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    state = advance(state, "begin_analysis", { policyHash: hash("b") });
    state = advance(state, "record_candidate", { candidateHash: hash("c") });
    const clarification = advance(state, "request_clarification", { clarificationHash: hash("d") });
    expect(projectPublicDrawingRun(clarification, scope).clarification).toEqual({
      id: `clarification:${hash("d")}`,
      prompt: "A clarification is required before continuing.",
    });

    state = advance(state, "formalize_ugs", { ugsHash: hash("d") });
    state = advance(state, "compose_pvp", { ugsHash: hash("d") });
    state = advance(state, "publish_preview", { pvpHash: hash("e"), qaHash: hash("f") });
    expect(projectPublicDrawingRun(state, scope).preview).toEqual({ artifactId: `preview:${hash("e")}`, hash: hash("e") });
  });

  it("exposes only bounded failure state", () => {
    const run = createRun();
    const rejected = reduceDrawingRun(run, command("reject", run, { errorCategory: "provider_invalid" }), scope).next;
    const projected = projectPublicDrawingRun(rejected, scope);
    expect(projected).toMatchObject({ status: "rejected", errorCategory: "provider_invalid", allowedActions: [] });
    expect(JSON.stringify(projected)).not.toContain("proposalHash");
  });

  it("rejects coercible hashes and impossible preview combinations", () => {
    const base = createRun();
    const hostile = { secret: "C:\\private\\model.py", toString: () => hash("a") } as unknown as string;
    expect(() => projectPublicDrawingRun({
      ...base,
      status: "preview_ready",
      revision: 6,
      artifactHashes: [hash("a"), hash("b"), hash("c"), hash("d"), hash("e"), hash("f")],
      privateReceiptIds: ["receipt-1"],
      preview: { artifactId: "preview:unsafe", hash: hostile },
    }, scope)).toThrow(DrawingRunError);
    expect(() => projectPublicDrawingRun({ ...base, preview: { artifactId: `preview:${hash("f")}`, hash: hash("f") } }, scope)).toThrow(DrawingRunError);
    expect(() => projectPublicDrawingRun({
      ...base,
      status: "awaiting_clarification",
      revision: 4,
      artifactHashes: [hash("a"), hash("b"), hash("c"), hash("d")],
      privateReceiptIds: ["receipt-1"],
      clarification: { id: `clarification:${hash("d")}`, prompt: "A clarification is required before continuing.", hash: hash("d") },
      preview: { artifactId: `preview:${hash("f")}`, hash: hash("f") },
    }, scope)).toThrow(DrawingRunError);
  });

  it("snapshot-reads preview once so accessors cannot replace a validated hash", () => {
    let state = advance(createRun(), "accept_input", { receiptIds: ["receipt-1"], artifactHash: hash("a") });
    state = advance(state, "begin_analysis", { policyHash: hash("b") });
    state = advance(state, "record_candidate", { candidateHash: hash("c") });
    state = advance(state, "formalize_ugs", { ugsHash: hash("d") });
    state = advance(state, "compose_pvp", { ugsHash: hash("d") });
    state = advance(state, "publish_preview", { pvpHash: hash("e"), qaHash: hash("f") });
    const safePreview = state.preview;
    let reads = 0;
    Object.defineProperty(state, "preview", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? safePreview : { artifactId: "preview:hostile", hash: "C:\\private\\model.py" };
      },
    });
    const projected = projectPublicDrawingRun(state, scope);
    expect(reads).toBe(1);
    expect(projected.preview?.hash).toBe(hash("e"));
    expect(JSON.stringify(projected)).not.toContain("C:\\private\\model.py");
  });

  it("projects event history without artifact/request hashes and snapshot-reads fields", () => {
    const event: DrawingRunEvent = {
      eventId: "run-1:1:accept_input",
      runId: "run-1",
      revision: 1,
      status: "input_accepted",
      action: "received",
      artifactHashes: [hash("a")],
      errorCategory: "none",
      occurredAt: "2026-08-21T00:00:01.000Z",
      requestHash: hash("b"),
    };
    const projected = projectPublicDrawingRunEvent(event);
    expect(projected).toEqual({
      eventId: event.eventId,
      runId: "run-1",
      revision: 1,
      status: "input_accepted",
      action: "received",
      errorCategory: "none",
      occurredAt: event.occurredAt,
    });
    expect(JSON.stringify(projected)).not.toMatch(/aaaa|bbbb/);
    expect(() => projectPublicDrawingRunEvent({
      ...event,
      eventId: "C:\\private\\event.json",
    })).toThrow(DrawingRunError);
  });
});
