import { describe, expect, it } from "vitest";
import { createDrawingRun } from "../../src/drawing-run/contracts.js";
import { projectPublicDrawingRun, projectPublicDrawingRunEvent } from "../../src/drawing-run/public-projection.js";

describe("Drawing Run public projection", () => {
  it("exposes observable state while excluding private receipts and internal hashes", () => {
    const run = createDrawingRun({
      runId: "run-1",
      ownerId: "owner-1",
      deviceId: "device-1",
      intent: { action: "create_figure", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["pytorch_source"] },
      now: "2026-08-22T00:00:00.000Z",
    });
    run.privateReceiptIds.push("private-receipt");
    run.clarification = { id: "clarification:1", prompt: "Which branch is the merge?", hash: "secret-hash" };
    const projected = projectPublicDrawingRun(run);
    expect(projected).toMatchObject({ runId: "run-1", status: "received", revision: 0, errorCategory: "none", clarification: { id: "clarification:1" } });
    expect(projected).not.toHaveProperty("privateReceiptIds");
    expect(JSON.stringify(projected)).not.toContain("private-receipt");
    expect(JSON.stringify(projected)).not.toContain("C:\\private\\model.py");
  });

  it("exposes only the bounded error category for failed runs", () => {
    const run = createDrawingRun({
      runId: "run-2",
      ownerId: "owner-1",
      deviceId: "device-1",
      intent: { action: "analyze_network", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["pytorch_source"] },
      now: "2026-08-22T00:00:00.000Z",
    });
    run.status = "rejected";
    run.errorCategory = "provider_invalid";
    const projected = projectPublicDrawingRun(run);
    expect(projected).toMatchObject({ status: "rejected", errorCategory: "provider_invalid" });
    expect(JSON.stringify(projected)).not.toContain("proposalHash");
  });

  it("projects event history without artifact or request hashes", () => {
    const projected = projectPublicDrawingRunEvent({
      eventId: "run-1:1:accept_input",
      runId: "run-1",
      revision: 1,
      status: "input_accepted",
      action: "received",
      artifactHashes: ["a".repeat(64)],
      errorCategory: "none",
      occurredAt: "2026-08-22T00:00:00.000Z",
      requestHash: "b".repeat(64),
    });
    expect(projected).toEqual({ eventId: "run-1:1:accept_input", runId: "run-1", revision: 1, status: "input_accepted", action: "received", errorCategory: "none", occurredAt: "2026-08-22T00:00:00.000Z" });
    expect(JSON.stringify(projected)).not.toContain("aaaa");
    expect(JSON.stringify(projected)).not.toContain("bbbb");
  });
});
