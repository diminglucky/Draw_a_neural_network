import { describe, expect, it } from "vitest";
import { createDrawingRun, type DrawingRun } from "../../src/drawing-run/contracts.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { projectPublicDrawingRun } from "../../src/drawing-run/public-projection.js";

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
      expect(() => projectPublicDrawingRun({ ...base, runId: unsafeRunId })).toThrow(DrawingRunError);
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

    expect(() => projectPublicDrawingRun(state)).toThrow(DrawingRunError);
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

    const projected = projectPublicDrawingRun(state);
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

  it("derives clarification and preview values from hashes instead of copying mutable internal text or identifiers", () => {
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
      status: "awaiting_clarification" as const,
      clarification: {
        id: "C:\\private\\clarification.txt",
        prompt: "class SecretModel",
        hash: "a".repeat(64),
      },
      preview: {
        artifactId: "C:\\private\\preview.svg",
        hash: "b".repeat(64),
      },
    };

    const projected = projectPublicDrawingRun(state);

    expect(projected).toMatchObject({
      clarification: {
        id: `clarification:${"a".repeat(64)}`,
        prompt: "A clarification is required before continuing.",
      },
      preview: {
        artifactId: `preview:${"b".repeat(64)}`,
        hash: "b".repeat(64),
      },
    });
    expect(JSON.stringify(projected)).not.toContain("C:\\private");
    expect(JSON.stringify(projected)).not.toContain("SecretModel");
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
    })).toThrow(DrawingRunError);
    expect(() => projectPublicDrawingRun({
      ...base,
      status: "preview_ready",
      preview: { artifactId: "preview:unsafe", hash: coercibleHash },
    })).toThrow(DrawingRunError);
  });
});
