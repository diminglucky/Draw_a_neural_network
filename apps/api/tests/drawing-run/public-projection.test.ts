import { describe, expect, it } from "vitest";
import {
  createDrawingRun,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunTransition,
  type DrawingRunTrustedScope,
} from "../../src/drawing-run/contracts.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { projectPublicDrawingRun } from "../../src/drawing-run/public-projection.js";
import { reduceDrawingRun } from "../../src/drawing-run/reducer.js";

const trustedScope: DrawingRunTrustedScope = { runId: "run-1", ownerId: "owner-1", deviceId: "device-1" };
const hash = (value: string) => value.repeat(64).slice(0, 64);

function accepted(transition: DrawingRunTransition): DrawingRun {
  if (transition.kind !== "accepted") throw new Error("expected accepted transition");
  return transition.next;
}

function command<T extends DrawingRunCommand["type"]>(
  type: T,
  expectedRevision: number,
  fields: Omit<Extract<DrawingRunCommand, { type: T }>, "type" | "ownerId" | "deviceId" | "runId" | "expectedRevision" | "idempotencyKey" | "occurredAt">,
): Extract<DrawingRunCommand, { type: T }> {
  return {
    type,
    ...trustedScope,
    expectedRevision,
    idempotencyKey: `${type}-${expectedRevision}`,
    occurredAt: `2026-08-21T00:00:${String(expectedRevision + 1).padStart(2, "0")}.000Z`,
    ...fields,
  } as Extract<DrawingRunCommand, { type: T }>;
}

describe("public DrawingRun projection", () => {
  it("rejects path-like opaque run IDs at creation and before projection", () => {
    const input = {
      runId: "run-1",
      ownerId: "owner-1",
      deviceId: "device-1",
      intent: {
        action: "create_figure",
        requestedDetail: "architecture",
        target: "browser_preview",
        sourceKinds: ["architecture_description"],
      },
      now: "2026-08-21T00:00:00.000Z",
    } as const;
    const base = createDrawingRun(input);

    for (const unsafeRunId of ["C:\\private\\model.py", "C:private", "\\\\server\\share", "../run-1", "..", "run/one"]) {
      expect(() => createDrawingRun({ ...input, runId: unsafeRunId })).toThrow(DrawingRunError);
      expect(() => projectPublicDrawingRun({ ...base, runId: unsafeRunId }, trustedScope)).toThrow(DrawingRunError);
    }
  });

  it("does not expose the removed apply-confirmation state as a public action surface", () => {
    const state = {
      ...createDrawingRun({
        runId: "run-1",
        ownerId: "owner-1",
        deviceId: "device-1",
        intent: {
          action: "create_figure",
          requestedDetail: "architecture",
          target: "browser_preview",
          sourceKinds: ["architecture_description"],
        },
        now: "2026-08-21T00:00:00.000Z",
      }),
      status: "awaiting_apply_confirmation",
    } as unknown as DrawingRun;

    expect(() => projectPublicDrawingRun(state, trustedScope)).toThrow(DrawingRunError);
  });

  it("reconstructs only allowlisted public fields and excludes private receipts, paths, source, provider, context, and native data", () => {
    const state = {
      ...createDrawingRun({
        runId: "run-1",
        ownerId: "owner-1",
        deviceId: "device-1",
        intent: {
          action: "create_figure",
          requestedDetail: "architecture",
          target: "browser_preview",
          sourceKinds: ["architecture_description"],
        },
        now: "2026-08-21T00:00:00.000Z",
      }),
      privateReceipts: [{ receiptId: "receipt-1", path: "C:\\private\\model.py", content: "class SecretModel" }],
      rawSource: "class SecretModel",
      imageBase64: "aGVsbG8=",
      providerPayload: { apiKey: "secret" },
      providerContext: { contextId: "context-1" },
      nativeData: { pagePath: "C:\\private\\drawing.vsdx" },
    } as DrawingRun & Record<string, unknown>;

    const projected = projectPublicDrawingRun(state, trustedScope);
    const serialized = JSON.stringify(projected);

    expect(projected).toEqual({
      runId: "run-1",
      revision: 0,
      status: "received",
      allowedActions: ["accept_input", "cancel", "reject", "fail", "conflict"],
      clarification: null,
      preview: null,
    });
    expect(serialized).not.toContain("receipt-1");
    expect(serialized).not.toContain("C:\\private\\model.py");
    expect(serialized).not.toContain("SecretModel");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("context-1");
    expect(serialized).not.toContain("drawing.vsdx");
  });

  it("projects clarification only from a semantically valid reducer state", () => {
    let state = createDrawingRun({
      ...trustedScope,
      intent: { action: "create_figure", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["architecture_description"] },
      now: "2026-08-21T00:00:00.000Z",
    });
    state = accepted(reduceDrawingRun(state, command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("begin_analysis", 1, { policyHash: hash("b") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("record_candidate", 2, { candidateHash: hash("c") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("request_clarification", 3, { clarificationHash: hash("d") }), trustedScope));

    const projected = projectPublicDrawingRun(state, trustedScope);

    expect(projected.clarification).toEqual({
      id: `clarification:${hash("d")}`,
      prompt: "A clarification is required before continuing.",
    });
    expect(projected.preview).toBeNull();
  });

  it("rejects coercible non-string clarification and preview hashes", () => {
    const base = createDrawingRun({
      runId: "run-1",
      ownerId: "owner-1",
      deviceId: "device-1",
      intent: {
        action: "create_figure",
        requestedDetail: "architecture",
        target: "browser_preview",
        sourceKinds: ["architecture_description"],
      },
      now: "2026-08-21T00:00:00.000Z",
    });
    const coercibleHash = {
      secret: "C:\\private\\model.py",
      toString: () => "a".repeat(64),
    } as unknown as string;

    expect(() => projectPublicDrawingRun({
      ...base,
      status: "awaiting_clarification",
      clarification: { id: "clarification:unsafe", prompt: "secret", hash: coercibleHash },
    }, trustedScope)).toThrow(DrawingRunError);
    expect(() => projectPublicDrawingRun({
      ...base,
      status: "preview_ready",
      preview: { artifactId: "preview:unsafe", hash: coercibleHash },
    }, trustedScope)).toThrow(DrawingRunError);
  });

  it.each([
    ["received plus preview", (base: DrawingRun): DrawingRun => ({ ...base, preview: { artifactId: `preview:${hash("f")}`, hash: hash("f") } })],
    ["clarification plus preview", (base: DrawingRun) => ({
      ...base,
      status: "awaiting_clarification" as const,
      clarification: { id: `clarification:${hash("e")}`, prompt: "A clarification is required before continuing.", hash: hash("e") },
      preview: { artifactId: `preview:${hash("f")}`, hash: hash("f") },
    })],
  ])("rejects an impossible semantic state: %s", (_label, mutate) => {
    const base = createDrawingRun({
      ...trustedScope,
      intent: { action: "create_figure", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["architecture_description"] },
      now: "2026-08-21T00:00:00.000Z",
    });

    expect(() => projectPublicDrawingRun(mutate(base), trustedScope)).toThrow(DrawingRunError);
  });

  it("snapshot-reads preview state once so accessors cannot replace a validated hash", () => {
    let state = createDrawingRun({
      ...trustedScope,
      intent: { action: "create_figure", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["architecture_description"] },
      now: "2026-08-21T00:00:00.000Z",
    });
    state = accepted(reduceDrawingRun(state, command("accept_input", 0, { receiptIds: ["receipt-1"], artifactHash: hash("a") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("begin_analysis", 1, { policyHash: hash("b") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("record_candidate", 2, { candidateHash: hash("c") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("formalize_ugs", 3, { ugsHash: hash("d") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("compose_pvp", 4, { ugsHash: hash("d") }), trustedScope));
    state = accepted(reduceDrawingRun(state, command("publish_preview", 5, { pvpHash: hash("e"), qaHash: hash("f") }), trustedScope));
    const safePreview = state.preview;
    const accessorState = { ...state };
    let reads = 0;
    Object.defineProperty(accessorState, "preview", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? safePreview : { artifactId: "preview:hostile", hash: "C:\\private\\model.py" };
      },
    });

    const projected = projectPublicDrawingRun(accessorState, trustedScope);

    expect(reads).toBe(1);
    expect(projected.preview).toEqual({ artifactId: `preview:${hash("e")}`, hash: hash("e") });
    expect(JSON.stringify(projected)).not.toContain("C:\\private\\model.py");
  });
});
