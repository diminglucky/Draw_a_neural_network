import { describe, expect, it } from "vitest";
import { createDrawingRun } from "../../src/drawing-run/contracts.js";
import { projectPublicDrawingRun } from "../../src/drawing-run/public-projection.js";

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
    expect(projected).toMatchObject({ runId: "run-1", status: "received", revision: 0, clarification: { id: "clarification:1" } });
    expect(projected).not.toHaveProperty("privateReceiptIds");
    expect(JSON.stringify(projected)).not.toContain("private-receipt");
    expect(JSON.stringify(projected)).not.toContain("C:\\private\\model.py");
  });
});
